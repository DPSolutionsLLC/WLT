import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedRow, RowProblem } from "@/lib/roster/csv/normalizeRow";
import { listHouseholds, listMembers } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { MEMBER_STATUSES } from "@/types/domain";

// This module performs NO writes. No insert, no update, no rpc, no writeAuditLog. A preview
// endpoint with a write path is a preview endpoint whose "nothing happened" guarantee has to be
// re-proved every time it changes; with no write path there is nothing to re-prove.
// tests/lib/csvPreview.test.ts asserts it against the client, not against the return value.

export type NewHouseholdPreview = {
  familyName: string;
  address: string | null;
  memberCount: number;
};

export type ImportPreview = {
  fileHash: string;
  totalRows: number;
  newHouseholds: NewHouseholdPreview[];
  matchedHouseholdCount: number;
  newMemberCount: number;
  matchedMemberCount: number;
  untouchedMemberCount: number;
  problems: RowProblem[];
};

// NUL as the separator. It is the one character that cannot appear in a family name or an
// address, so no combination of values can collide two different households onto one key. A
// space would merge "Smith Jones" + "12 Oak" with "Smith" + "Jones 12 Oak" — while the database
// function compares the two columns separately and would not, which is exactly the kind of
// preview-and-apply disagreement the shared helpers below exist to prevent.
//
// Built from a char code rather than written as an escape: a literal NUL byte in the source
// makes git treat this whole file as binary, costing every future diff, blame and merge on it.
const KEY_SEPARATOR = String.fromCharCode(0);

// The same keys apply_roster_import uses (migration 022), restated in TypeScript:
//   household  ward_id + lower(family_name) + coalesce(lower(address), '')
//   member     ward_id + household_id + lower(first_name) + lower(last_name)
//
// Exported and used by applyImport.ts as well. Two copies of this normalisation is the cheapest
// way for the preview and the apply to disagree about what "the same household" means, and the
// user only finds out after the write.
export function householdKey(familyName: string, address: string | null): string {
  return `${familyName.trim().toLowerCase()}${KEY_SEPARATOR}${(address ?? "").trim().toLowerCase()}`;
}

export function memberKey(
  household: string,
  firstName: string,
  lastName: string,
): string {
  return `${household}${KEY_SEPARATOR}${firstName.trim().toLowerCase()}${KEY_SEPARATOR}${lastName.trim().toLowerCase()}`;
}

export function rowHouseholdKey(row: NormalizedRow): string {
  return householdKey(row.familyName, row.address);
}

export function rowMemberKey(row: NormalizedRow): string {
  return memberKey(rowHouseholdKey(row), row.firstName, row.lastName);
}

export async function buildImportPreview(
  wardId: string,
  normalized: readonly NormalizedRow[],
  fileHash: string,
  problems: readonly RowProblem[] = [],
  client?: SupabaseClient<Database>,
): Promise<ImportPreview> {
  const supabase = client ?? (await createServerSupabaseClient());

  // Every status, deliberately. This is the one place in the codebase that overrides the
  // active-only default from roster-a — a member who moved out must MATCH an incoming row
  // rather than be created a second time, which would leave the ward with two of them and no
  // way to tell which one the visit history hangs off.
  const [households, members] = await Promise.all([
    listHouseholds(wardId, { statuses: MEMBER_STATUSES }, supabase),
    listMembers(wardId, { statuses: MEMBER_STATUSES }, supabase),
  ]);

  const existingHouseholdKeys = new Map<string, string>();
  for (const household of households) {
    existingHouseholdKeys.set(
      householdKey(household.familyName, household.address),
      household.id,
    );
  }

  // Keyed by household id, matching the function's `member.household_id` comparison. A member
  // with no household cannot be matched by any incoming row — every incoming row carries a
  // family name, so it always resolves to a household — but they still count as untouched.
  const existingMemberKeys = new Set<string>();
  for (const member of members) {
    existingMemberKeys.add(
      memberKey(member.householdId ?? "", member.firstName, member.lastName),
    );
  }

  const newHouseholds = new Map<string, NewHouseholdPreview>();
  const matchedHouseholdKeys = new Set<string>();
  const seenMemberKeys = new Set<string>();
  const touchedExistingMemberKeys = new Set<string>();

  let newMemberCount = 0;
  let matchedMemberCount = 0;

  for (const row of normalized) {
    const incomingHouseholdKey = rowHouseholdKey(row);
    const existingHouseholdId = existingHouseholdKeys.get(incomingHouseholdKey);

    if (existingHouseholdId) {
      matchedHouseholdKeys.add(incomingHouseholdKey);
    } else {
      const existing = newHouseholds.get(incomingHouseholdKey);
      if (existing) {
        existing.memberCount += 1;
      } else {
        newHouseholds.set(incomingHouseholdKey, {
          familyName: row.familyName,
          address: row.address,
          memberCount: 1,
        });
      }
    }

    // The existing-member key is built from the household ID when the household already exists,
    // so it lines up with the set above; a household this import would create cannot hold an
    // existing member, so its rows are new by construction.
    const existingKey = existingHouseholdId
      ? memberKey(existingHouseholdId, row.firstName, row.lastName)
      : null;

    // The same person listed twice in one file is one member, counted once. Without this a file
    // with a duplicate row reports one more member than the apply will create, and the mismatch
    // reads as the import having silently dropped somebody.
    const incomingKey = rowMemberKey(row);
    if (seenMemberKeys.has(incomingKey)) continue;
    seenMemberKeys.add(incomingKey);

    if (existingKey && existingMemberKeys.has(existingKey)) {
      matchedMemberCount += 1;
      touchedExistingMemberKeys.add(existingKey);
    } else {
      newMemberCount += 1;
    }
  }

  // Decision 5's number. Members in the roster and absent from the file are not touched, not
  // marked moved out, and not deleted — and the preview says so out loud, so the user is not
  // left wondering what happened to the other 200 people in their ward.
  const untouchedMemberCount = [...existingMemberKeys].filter(
    (key) => !touchedExistingMemberKeys.has(key),
  ).length;

  return {
    fileHash,
    totalRows: normalized.length,
    newHouseholds: [...newHouseholds.values()],
    matchedHouseholdCount: matchedHouseholdKeys.size,
    newMemberCount,
    matchedMemberCount,
    untouchedMemberCount,
    problems: [...problems],
  };
}
