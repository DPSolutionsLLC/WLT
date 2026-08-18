// @vitest-environment node
//
// Run against the hosted database on purpose. The transaction, the matching, and the
// never-blank-an-existing-value rule all live inside apply_roster_import (migration 022), so a
// mocked client here would test the mock and prove nothing about the guarantee that matters.
//
// The assertions run through a BISHOP client, not the service client, so RLS applies exactly as
// it will in the app. Fixtures clean up after themselves and never assume an empty table —
// these run against the shared project (CLAUDE.md §9).
//
// The tests in this file run in order and share one seeded roster. Each one names what state it
// expects to inherit.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyRosterImport } from "@/lib/roster/csv/applyImport";
import type { NormalizedRow } from "@/lib/roster/csv/normalizeRow";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const EXISTING_FAMILY = "Existing";
const EXISTING_ADDRESS = "1 Main Street";
const SEEDED_PHONE = "555-9999";
const NOTE_BODY = "Prefers a visit on a Sunday afternoon.";

function importRow(
  rowNumber: number,
  firstName: string,
  lastName: string,
  familyName: string,
  address: string | null,
  overrides: Partial<NormalizedRow> = {},
): NormalizedRow {
  return {
    rowNumber,
    firstName,
    lastName,
    familyName,
    address,
    category: "adult",
    gender: null,
    phone: null,
    ...overrides,
  };
}

// Ten rows: one member who already exists (in a household that already exists), one new member
// in that same household, and eight members across three households the import has to create —
// two of which share a family name and differ only by address.
const PAYLOAD: NormalizedRow[] = [
  importRow(2, "Helen", "Existing", EXISTING_FAMILY, EXISTING_ADDRESS),
  importRow(3, "Newcomer", "Existing", EXISTING_FAMILY, EXISTING_ADDRESS),
  importRow(4, "Ann", "Alpha", "Alpha", "10 Alpha Way"),
  importRow(5, "Ben", "Alpha", "Alpha", "10 Alpha Way"),
  importRow(6, "Cara", "Alpha", "Alpha", "10 Alpha Way"),
  importRow(7, "Dan", "Alpha", "Alpha", "10 Alpha Way"),
  importRow(8, "Eve", "Alpha", "Alpha", "99 Beta Road"),
  importRow(9, "Finn", "Alpha", "Alpha", "99 Beta Road"),
  importRow(10, "Gus", "Gamma", "Gamma", null),
  importRow(11, "Hana", "Gamma", "Gamma", null),
];

describe("apply_roster_import", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;
  let wardBBishop: SupabaseClient<Database>;

  let existingHouseholdId: string;
  let helenId: string;
  let absentMemberId: string;
  let noteId: string;

  async function countRows(table: "households" | "members"): Promise<number> {
    const { count, error } = await fixtures.service
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);

    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "wardBBishop"], {
      notificationTriggers: [
        { triggerKey: "new_household_added", defaultRoles: ["bishop", "counselor"] },
      ],
    });

    bishop = await asRole(fixtures, "bishop");
    wardBBishop = await asRole(fixtures, "wardBBishop");

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({
        ward_id: fixtures.wardAId,
        family_name: EXISTING_FAMILY,
        address: EXISTING_ADDRESS,
      })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);
    existingHouseholdId = household.id;

    // Moved out on purpose. A re-import must MATCH her rather than create a second Helen, and
    // must not resurrect her status — status is not in the payload and is never written on
    // update (migration 022).
    const { data: helen, error: helenError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        household_id: existingHouseholdId,
        first_name: "Helen",
        last_name: EXISTING_FAMILY,
        category: "adult",
        gender: "female",
        status: "moved_out",
        phone: SEEDED_PHONE,
      })
      .select("id")
      .single();
    if (helenError) throw new Error(helenError.message);
    helenId = helen.id;

    // Never appears in the payload. Decision 5: an import is additive and there is no delete.
    const { data: absent, error: absentError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        household_id: existingHouseholdId,
        first_name: "Absent",
        last_name: EXISTING_FAMILY,
        category: "youth",
        gender: "male",
        status: "do_not_contact",
        phone: "555-1111",
      })
      .select("id")
      .single();
    if (absentError) throw new Error(absentError.message);
    absentMemberId = absent.id;

    const { data: note, error: noteError } = await fixtures.service
      .from("member_notes")
      .insert({
        ward_id: fixtures.wardAId,
        member_id: helenId,
        body: NOTE_BODY,
        created_by: fixtures.user("bishop").id,
      })
      .select("id")
      .single();
    if (noteError) throw new Error(noteError.message);
    noteId = note.id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("creates the households and members the payload describes", async () => {
    const result = await applyRosterImport(
      fixtures.wardAId,
      fixtures.user("bishop").id,
      PAYLOAD,
      [],
      bishop,
    );

    expect(result.householdsCreated).toBe(3);
    expect(result.membersCreated).toBe(9);
    // Helen matched. Her incoming category is the same and her phone is null, so nothing about
    // her changed and the function reports no update.
    expect(result.membersUpdated).toBe(0);
    // Matched is not updated. Helen is the tenth row and she matched, even though nothing about
    // her was written — the preview counts her the same way, and the two screens have to agree.
    expect(result.membersMatched).toBe(1);

    const { data: members, error } = await bishop
      .from("members")
      .select("first_name")
      .eq("ward_id", fixtures.wardAId)
      .eq("last_name", "Alpha");

    if (error) throw new Error(error.message);
    expect((members ?? []).map((row) => row.first_name).sort()).toEqual([
      "Ann",
      "Ben",
      "Cara",
      "Dan",
      "Eve",
      "Finn",
    ]);
  });

  it("names the households it created", async () => {
    const { data, error } = await bishop
      .from("households")
      .select("family_name, address")
      .eq("ward_id", fixtures.wardAId)
      .eq("family_name", "Gamma");

    if (error) throw new Error(error.message);
    expect(data).toHaveLength(1);
    expect(data?.[0].address).toBeNull();
  });

  // Two Alpha households at different addresses are two families, not one. This is why the
  // lookup indexes in migration 022 are deliberately not unique.
  it("keeps two households with the same family name and different addresses apart", async () => {
    const { data, error } = await bishop
      .from("households")
      .select("address")
      .eq("ward_id", fixtures.wardAId)
      .eq("family_name", "Alpha");

    if (error) throw new Error(error.message);
    expect((data ?? []).map((row) => row.address).sort()).toEqual([
      "10 Alpha Way",
      "99 Beta Road",
    ]);
  });

  // THE core assertion. Everything else in this file is a supporting detail.
  it("creates nothing and duplicates nothing when the identical payload is imported again", async () => {
    const householdsBefore = await countRows("households");
    const membersBefore = await countRows("members");

    const result = await applyRosterImport(
      fixtures.wardAId,
      fixtures.user("bishop").id,
      PAYLOAD,
      [],
      bishop,
    );

    expect(result.householdsCreated).toBe(0);
    expect(result.membersCreated).toBe(0);
    expect(result.householdsUpdated).toBe(0);
    expect(result.membersUpdated).toBe(0);
    // Every row matched and none of them changed. This is the pair the result screen reports —
    // "10 already in the roster, 0 changed" — because reporting only the zero against a preview
    // that counted ten reads as though the import skipped everybody.
    expect(result.membersMatched).toBe(PAYLOAD.length);

    expect(await countRows("households")).toBe(householdsBefore);
    expect(await countRows("members")).toBe(membersBefore);
  });

  // The irreplaceable-data guarantee. member_notes is a separate table precisely so a
  // column-blind write cannot clobber it (plans/retros/foundation-b-schema.md), and
  // apply_roster_import does not know the table exists. Do not delete this test.
  it("leaves member_notes present and unmodified after two imports", async () => {
    const { data, error } = await bishop
      .from("member_notes")
      .select("id, body, updated_at")
      .eq("ward_id", fixtures.wardAId)
      .eq("member_id", helenId);

    if (error) throw new Error(error.message);

    expect(data).toHaveLength(1);
    expect(data?.[0].id).toBe(noteId);
    expect(data?.[0].body).toBe(NOTE_BODY);
  });

  // Decision 5. A member absent from the file is not marked, not deactivated, not removed.
  it("leaves a member absent from the payload completely untouched", async () => {
    const { data, error } = await bishop
      .from("members")
      .select("first_name, category, gender, status, phone, household_id")
      .eq("ward_id", fixtures.wardAId)
      .eq("id", absentMemberId)
      .single();

    if (error) throw new Error(error.message);

    expect(data).toEqual({
      first_name: "Absent",
      category: "youth",
      gender: "male",
      status: "do_not_contact",
      phone: "555-1111",
      household_id: existingHouseholdId,
    });
  });

  // A blank cell in an export means "the export does not carry this", never "clear what the ward
  // typed in by hand". Helen's payload rows carry no phone and she keeps hers.
  it("does not blank an existing value with an incoming null", async () => {
    const { data, error } = await bishop
      .from("members")
      .select("phone, gender, status")
      .eq("ward_id", fixtures.wardAId)
      .eq("id", helenId)
      .single();

    if (error) throw new Error(error.message);

    expect(data.phone).toBe(SEEDED_PHONE);
    expect(data.gender).toBe("female");
    // Status is not in the payload and is never written on update, so a re-import cannot
    // resurrect somebody a human marked moved out.
    expect(data.status).toBe("moved_out");
  });

  it("matched the moved_out member rather than creating a second one", async () => {
    const { data, error } = await bishop
      .from("members")
      .select("id")
      .eq("ward_id", fixtures.wardAId)
      .eq("household_id", existingHouseholdId)
      .eq("first_name", "Helen");

    if (error) throw new Error(error.message);
    expect(data).toHaveLength(1);
  });

  it("updates an existing value when the incoming field is not null", async () => {
    const result = await applyRosterImport(
      fixtures.wardAId,
      fixtures.user("bishop").id,
      [
        importRow(2, "Helen", "Existing", EXISTING_FAMILY, EXISTING_ADDRESS, {
          phone: "555-0000",
        }),
      ],
      [],
      bishop,
    );

    expect(result.membersUpdated).toBe(1);

    const { data, error } = await bishop
      .from("members")
      .select("phone")
      .eq("ward_id", fixtures.wardAId)
      .eq("id", helenId)
      .single();

    if (error) throw new Error(error.message);
    expect(data.phone).toBe("555-0000");
  });

  // SECURITY INVOKER plus RLS, both in force. If this ever passes, the import has become a hole
  // straight through the ward boundary (CLAUDE.md rule 2).
  it("refuses a ward that is not the caller's", async () => {
    const { data, error } = await bishop.rpc("apply_roster_import", {
      p_ward_id: fixtures.wardBId,
      p_households: [{ family_name: "Trespass", address: null }],
      p_members: [
        {
          family_name: "Trespass",
          address: null,
          first_name: "Not",
          last_name: "Allowed",
          category: null,
          gender: null,
          phone: null,
        },
      ],
    });

    // The policy raises rather than returning zero rows for an INSERT, but either outcome is
    // acceptable — what is not acceptable is a row landing in ward B.
    if (!error && data !== null && typeof data === "object" && !Array.isArray(data)) {
      expect((data as Record<string, unknown>).households_created).toBe(0);
    }

    const { count, error: countError } = await fixtures.service
      .from("households")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardBId);

    if (countError) throw new Error(countError.message);
    expect(count).toBe(0);
  });

  it("returns nothing to a ward B session reading ward A's imported members", async () => {
    const { data, error } = await wardBBishop
      .from("members")
      .select("id")
      .eq("ward_id", fixtures.wardAId);

    if (error) throw new Error(error.message);
    expect(data).toEqual([]);
  });

  // One row per import, not one per member. 2000 audit rows for a single user action is an
  // audit log nobody can read (02-roster.md).
  it("writes exactly one audit row per confirmed import", async () => {
    const { data, error } = await fixtures.service
      .from("audit_log")
      .select("action, module, detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "roster_imported");

    if (error) throw new Error(error.message);

    // Three imports have run in this file: the first, the idempotent repeat, and the update.
    expect(data).toHaveLength(3);
    expect(data?.every((row) => row.module === "roster")).toBe(true);

    const first = data?.find(
      (row) => (row.detail as Record<string, unknown> | null)?.totalRows === 10,
    );
    expect((first?.detail as Record<string, unknown>).membersCreated).toBe(9);
  });

  // One notification summarising every new household, not one per household. An import of a new
  // ward would otherwise fire 150 notifications at four roles each.
  it("emits one summarising notification rather than one per new household", async () => {
    const { data, error } = await fixtures.service
      .from("notifications")
      .select("title, body")
      .eq("ward_id", fixtures.wardAId)
      .eq("trigger_key", "new_household_added");

    if (error) throw new Error(error.message);

    // Three households were created, by one import, for the one bishop in this ward.
    expect(data).toHaveLength(1);
    expect(data?.[0].title).toBe("3 new households added");
  });
});
