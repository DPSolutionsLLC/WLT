import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { rowHouseholdKey, rowMemberKey } from "@/lib/roster/csv/buildImportPreview";
import type { NormalizedRow, RowProblem } from "@/lib/roster/csv/normalizeRow";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

export type ImportResult = {
  householdsCreated: number;
  householdsUpdated: number;
  membersCreated: number;
  // How many rows matched somebody already in the roster, and how many of those the function
  // actually wrote. They are different numbers: migration 022 only counts an update when a value
  // changed, so re-importing an unchanged export matches everybody and updates nobody. Reporting
  // only the second one against a preview that counted the first reads as a silent skip.
  membersMatched: number;
  membersUpdated: number;
  newHouseholdNames: string[];
  problems: RowProblem[];
};

type HouseholdPayload = { family_name: string; address: string | null };

type MemberPayload = HouseholdPayload & {
  first_name: string;
  last_name: string;
  category: string | null;
  gender: string | null;
  phone: string | null;
};

// The names in the notification body before it starts counting instead. Four names and "and 8
// more" is readable on a phone; forty names is a wall.
const NAMED_HOUSEHOLDS_IN_BODY = 4;

function buildPayloads(normalized: readonly NormalizedRow[]): {
  households: HouseholdPayload[];
  members: MemberPayload[];
} {
  const households = new Map<string, HouseholdPayload>();
  const members = new Map<string, MemberPayload>();

  for (const row of normalized) {
    const household = rowHouseholdKey(row);
    if (!households.has(household)) {
      households.set(household, {
        family_name: row.familyName,
        address: row.address,
      });
    }

    // Deduped by the same key the preview counts with, so the counts the user agreed to and the
    // rows the function is handed describe the same import.
    const member = rowMemberKey(row);
    if (members.has(member)) continue;

    members.set(member, {
      family_name: row.familyName,
      address: row.address,
      first_name: row.firstName,
      last_name: row.lastName,
      category: row.category,
      gender: row.gender,
      phone: row.phone,
    });
  }

  return { households: [...households.values()], members: [...members.values()] };
}

function readCount(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" ? value : 0;
}

function readIds(payload: Record<string, unknown>): string[] {
  const value = payload.new_household_ids;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

// Only for the notification body, so a failure here degrades the message rather than failing an
// import that has already committed. It is logged, not swallowed.
async function readHouseholdNames(
  supabase: SupabaseClient<Database>,
  wardId: string,
  householdIds: readonly string[],
): Promise<string[]> {
  if (householdIds.length === 0) return [];

  const { data, error } = await supabase
    .from("households")
    .select("family_name")
    .eq("ward_id", wardId)
    .in("id", [...householdIds])
    .order("family_name", { nullsFirst: false });

  if (error) {
    console.error(
      `Could not read the names of the households the import created — ${error.message}`,
      { wardId, householdCount: householdIds.length },
    );
    return [];
  }

  return (data ?? []).map((row) => row.family_name);
}

function buildNotificationBody(names: readonly string[], total: number): string {
  if (names.length === 0) {
    return `${total} ${total === 1 ? "household was" : "households were"} added by a roster import.`;
  }

  const named = names.slice(0, NAMED_HOUSEHOLDS_IN_BODY);
  const remaining = total - named.length;

  return remaining > 0
    ? `${named.join(", ")}, and ${remaining} more were added by a roster import.`
    : `${named.join(", ")} ${named.length === 1 ? "was" : "were"} added by a roster import.`;
}

export async function applyRosterImport(
  wardId: string,
  userId: string,
  normalized: readonly NormalizedRow[],
  problems: readonly RowProblem[] = [],
  client?: SupabaseClient<Database>,
): Promise<ImportResult> {
  const supabase = client ?? (await createServerSupabaseClient());
  const { households, members } = buildPayloads(normalized);

  // One statement, so one implicit transaction. @supabase/supabase-js has no transaction API,
  // and 02-roster.md §Step C requires the apply to be all-or-nothing: a half-applied roster is
  // worse than a refused one.
  const { data, error } = await supabase.rpc("apply_roster_import", {
    p_ward_id: wardId,
    p_households: households as unknown as Json,
    p_members: members as unknown as Json,
  });

  if (error) {
    console.error(`Could not apply the roster import — ${error.message}`, {
      wardId,
      householdCount: households.length,
      memberCount: members.length,
    });
    throw new Error(`Could not apply the roster import: ${error.message}`);
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      "apply_roster_import returned something other than an object. Migration 022 and " +
        "lib/roster/csv/applyImport.ts have drifted.",
    );
  }

  const payload = data as Record<string, unknown>;

  // The counts the FUNCTION returned, never the length of what was submitted. A write refused by
  // policy is a zero-row success, not an error (plans/retros/foundation-c-services.md) — reading
  // the submitted length would report a successful import of nothing.
  const membersCreated = readCount(payload, "members_created");

  const result: ImportResult = {
    householdsCreated: readCount(payload, "households_created"),
    householdsUpdated: readCount(payload, "households_updated"),
    membersCreated,
    // Every deduped payload row either created somebody or matched somebody, so the difference is
    // the match count without a second round trip. Derived from the same map the function was
    // handed, which is what keeps it consistent with the preview's own deduping.
    membersMatched: Math.max(0, members.length - membersCreated),
    membersUpdated: readCount(payload, "members_updated"),
    newHouseholdNames: await readHouseholdNames(supabase, wardId, readIds(payload)),
    problems: [...problems],
  };

  // ONE audit row for the whole import, per 02-roster.md. One row per member would put 2000
  // rows in the log for a single user action, and an audit log nobody can read is not an audit
  // log.
  await writeAuditLog(
    {
      wardId,
      userId,
      action: "roster_imported",
      module: "roster",
      detail: {
        totalRows: normalized.length,
        householdsCreated: result.householdsCreated,
        householdsUpdated: result.householdsUpdated,
        membersCreated: result.membersCreated,
        membersUpdated: result.membersUpdated,
        problemCount: problems.length,
      },
    },
    supabase,
  );

  // ONE notification summarising every new household, not one per household. The trigger key is
  // per-event and an import is one event — a new ward imported row by row would otherwise fire
  // 150 notifications at four roles each. Recorded here as a deliberate reading of the trigger,
  // not an oversight.
  if (result.householdsCreated > 0) {
    await emitNotification({
      wardId,
      triggerKey: "new_household_added",
      title: `${result.householdsCreated} new ${
        result.householdsCreated === 1 ? "household" : "households"
      } added`,
      body: buildNotificationBody(result.newHouseholdNames, result.householdsCreated),
    });
  }

  return result;
}
