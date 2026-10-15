import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { emitNotification } from "@/lib/notifications/emitNotification";
import {
  newPersonColumns,
  type HouseholdTarget,
  type MemberColumnSet,
  type RosterDiff,
} from "@/lib/roster/paste/buildRosterDiff";
import type { Database, Json } from "@/types/database";

// Selected checklist ids → one call to apply_roster_paste (migration 090) → one audit row → one
// notification. The diff here is the one the apply route RECOMPUTED from the paste and the current
// roster; nothing the client sent is written except which ids it ticked.

export type ApplyResult = {
  householdsCreated: number;
  householdsUpdated: number;
  membersCreated: number;
  membersUpdated: number;
  membersChanged: number;
  membersMovedOut: number;
  membersReturned: number;
  silentFieldUpdates: number;
  staleSelections: number;
};

type PlanUpdate = {
  member_id: string;
  household_id?: string;
  household_key?: string;
  set: MemberColumnSet;
};

type ApplyPlan = {
  households: { key: string; family_name: string; address: string | null }[];
  household_addresses: { household_id: string; address: string | null }[];
  creates: (MemberColumnSet & { household_id?: string; household_key?: string })[];
  updates: PlanUpdate[];
  move_outs: string[];
};

const NAMED_HOUSEHOLDS_IN_BODY = 4;

function householdFields(target: HouseholdTarget): { household_id?: string; household_key?: string } {
  return "householdId" in target
    ? { household_id: target.householdId }
    : { household_key: target.householdKey };
}

function allItemIds(diff: RosterDiff): Set<string> {
  return new Set([
    ...diff.newPeople.map((item) => item.id),
    ...diff.changedPeople.map((item) => item.id),
    ...diff.householdAddresses.map((item) => item.id),
    ...diff.movedOut.map((item) => item.id),
  ]);
}

export function buildApplyPlan(
  diff: RosterDiff,
  selectedIds: ReadonlySet<string>,
): { plan: ApplyPlan; membersChanged: number; membersReturned: number; staleSelections: number } {
  const neededHouseholdKeys = new Set<string>();
  const updates = new Map<string, PlanUpdate>();
  let membersChanged = 0;
  let membersReturned = 0;

  const creates = diff.newPeople
    .filter((item) => selectedIds.has(item.id))
    .map((item) => {
      if ("householdKey" in item.household) neededHouseholdKeys.add(item.household.householdKey);
      return { ...householdFields(item.household), ...newPersonColumns(item.person) };
    });

  for (const item of diff.changedPeople) {
    if (!selectedIds.has(item.id)) continue;

    membersChanged += 1;
    const set: MemberColumnSet = { ...item.set };
    if (item.returning) {
      set.status = "active";
      membersReturned += 1;
    }

    const update: PlanUpdate = { member_id: item.memberId, set };
    if (item.householdChange) {
      Object.assign(update, householdFields(item.householdChange));
      if ("householdKey" in item.householdChange) {
        neededHouseholdKeys.add(item.householdChange.householdKey);
      }
    }
    updates.set(item.memberId, update);
  }

  // Silent fields are applied whether or not the member's reviewed item is ticked.
  for (const silent of diff.silentUpdates) {
    const existing = updates.get(silent.memberId);
    if (existing) {
      existing.set = { ...silent.set, ...existing.set };
    } else {
      updates.set(silent.memberId, { member_id: silent.memberId, set: { ...silent.set } });
    }
  }

  const known = allItemIds(diff);
  const staleSelections = [...selectedIds].filter((id) => !known.has(id)).length;

  return {
    plan: {
      households: diff.newHouseholds
        .filter((household) => neededHouseholdKeys.has(household.key))
        .map((household) => ({
          key: household.key,
          family_name: household.familyName,
          address: household.address,
        })),
      household_addresses: diff.householdAddresses
        .filter((item) => selectedIds.has(item.id))
        .map((item) => ({ household_id: item.householdId, address: item.after })),
      creates,
      updates: [...updates.values()],
      move_outs: diff.movedOut
        .filter((item) => selectedIds.has(item.id))
        .map((item) => item.memberId),
    },
    membersChanged,
    membersReturned,
    staleSelections,
  };
}

function readCount(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return typeof value === "number" ? value : 0;
}

export function buildNotificationBody(names: readonly string[], total: number): string {
  if (names.length === 0) {
    return `${total} ${total === 1 ? "household was" : "households were"} added by a roster import.`;
  }

  const named = names.slice(0, NAMED_HOUSEHOLDS_IN_BODY);
  const remaining = total - named.length;

  return remaining > 0
    ? `${named.join("; ")}; and ${remaining} more were added by a roster import.`
    : `${named.join("; ")} ${named.length === 1 ? "was" : "were"} added by a roster import.`;
}

export async function applyRosterPaste(
  params: {
    wardId: string;
    userId: string;
    diff: RosterDiff;
    selectedIds: ReadonlySet<string>;
    rowsRead: number;
    problemCount: number;
  },
  supabase: SupabaseClient<Database>,
): Promise<ApplyResult> {
  const { wardId, userId, diff, selectedIds, rowsRead, problemCount } = params;
  const { plan, membersChanged, membersReturned, staleSelections } = buildApplyPlan(
    diff,
    selectedIds,
  );

  const { data, error } = await supabase.rpc("apply_roster_paste", {
    p_ward_id: wardId,
    p_plan: plan as unknown as Json,
  });

  if (error) {
    console.error(`Could not apply the roster paste — ${error.message}`, {
      wardId,
      createCount: plan.creates.length,
      updateCount: plan.updates.length,
      moveOutCount: plan.move_outs.length,
    });
    throw new Error(`Could not apply the roster paste: ${error.message}`);
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      "apply_roster_paste returned something other than an object. Migration 090 and " +
        "lib/roster/paste/applyRosterPaste.ts have drifted.",
    );
  }

  const payload = data as Record<string, unknown>;

  // The counts the FUNCTION returned. An RLS-refused write is a zero-row success, and reporting the
  // length of what was sent would call that a success too.
  const result: ApplyResult = {
    householdsCreated: readCount(payload, "households_created"),
    householdsUpdated: readCount(payload, "households_updated"),
    membersCreated: readCount(payload, "members_created"),
    membersUpdated: readCount(payload, "members_updated"),
    membersChanged,
    membersMovedOut: readCount(payload, "members_moved_out"),
    membersReturned,
    silentFieldUpdates: diff.silentUpdates.length,
    staleSelections,
  };

  // Counts only: no names, no ids.
  await writeAuditLog(
    {
      wardId,
      userId,
      action: "roster_imported",
      module: "roster",
      detail: {
        rowsRead,
        householdsCreated: result.householdsCreated,
        householdsUpdated: result.householdsUpdated,
        membersCreated: result.membersCreated,
        membersUpdated: result.membersUpdated,
        membersMovedOut: result.membersMovedOut,
        silentFieldUpdates: result.silentFieldUpdates,
        staleSelections: result.staleSelections,
        problemCount,
      },
    },
    supabase,
  );

  // ONE notification for the whole paste, not one per household.
  if (result.householdsCreated > 0) {
    await emitNotification({
      wardId,
      triggerKey: "new_household_added",
      title: `${result.householdsCreated} new ${
        result.householdsCreated === 1 ? "household" : "households"
      } added`,
      body: buildNotificationBody(
        plan.households.map((household) => household.family_name).sort(),
        result.householdsCreated,
      ),
    });
  }

  return result;
}
