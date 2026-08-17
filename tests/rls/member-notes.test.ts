// @vitest-environment node
//
// FEATURES.md §Module 1 makes member notes bishopric-only. They live in their own table
// because RLS grants or denies a ROW and never a column, so a notes column on `members` could
// not have been protected at all (migration 003, plans/retros/foundation-b-schema.md).
//
// Every negative case below is asserted with an AUTHENTICATED client. Asserting with the
// service-role client would prove nothing — it bypasses RLS entirely.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("member notes", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;
  let counselor: SupabaseClient<Database>;
  let orgPresident: SupabaseClient<Database>;
  let wardSecretary: SupabaseClient<Database>;
  let wardBBishop: SupabaseClient<Database>;

  let memberId: string;
  let noteId: string;

  const noteBody = "Bishopric only: follow up after the interview.";

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "eqPresident",
      "wardSecretary",
      "wardBBishop",
    ]);

    bishop = await asRole(fixtures, "bishop");
    counselor = await asRole(fixtures, "counselor1");
    orgPresident = await asRole(fixtures, "eqPresident");
    wardSecretary = await asRole(fixtures, "wardSecretary");
    wardBBishop = await asRole(fixtures, "wardBBishop");

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardAId, family_name: "Andersen" })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        household_id: household.id,
        first_name: "Mark",
        last_name: "Andersen",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);
    memberId = member.id;

    // Written through the bishop's OWN authenticated client, so the INSERT policy is exercised
    // by the positive case too rather than only by the refusals below.
    const { data: note, error: noteError } = await bishop
      .from("member_notes")
      .insert({
        ward_id: fixtures.wardAId,
        member_id: memberId,
        body: noteBody,
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

  // A policy that denied everyone would pass every negative assertion below while making the
  // feature useless.
  it("is readable by the bishop", async () => {
    const { data, error } = await bishop
      .from("member_notes")
      .select("id, body")
      .eq("id", noteId);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([noteId]);
    expect(data?.[0]?.body).toBe(noteBody);
  });

  // CLAUDE.md §7: bishopric admin authority is shared. A counselor sees exactly what the
  // bishop sees, and a check that grants the bishop more is a bug.
  it("is readable by a counselor", async () => {
    const { data, error } = await counselor
      .from("member_notes")
      .select("id, body")
      .eq("id", noteId);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([noteId]);
    expect(data?.[0]?.body).toBe(noteBody);
  });

  it("returns ZERO rows to an org president", async () => {
    const { data, error } = await orgPresident
      .from("member_notes")
      .select("id")
      .eq("member_id", memberId);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("returns ZERO rows to the ward secretary", async () => {
    const { data, error } = await wardSecretary
      .from("member_notes")
      .select("id")
      .eq("member_id", memberId);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("returns ZERO rows to an org president on an unfiltered read", async () => {
    const { data, error } = await orgPresident.from("member_notes").select("id");

    expect(error).toBeNull();
    expect((data ?? []).map((row) => row.id)).not.toContain(noteId);
  });

  // The write half. A read-only assertion would miss a policy that denies SELECT but permits
  // INSERT — the notes would be unreadable and still writable by anyone in the ward.
  it("cannot be inserted by an org president", async () => {
    const { error } = await orgPresident.from("member_notes").insert({
      ward_id: fixtures.wardAId,
      member_id: memberId,
      body: "should never be stored",
      created_by: fixtures.user("eqPresident").id,
    });

    expect(error).not.toBeNull();

    const { count } = await fixtures.service
      .from("member_notes")
      .select("id", { head: true, count: "exact" })
      .eq("member_id", memberId);

    expect(count).toBe(1);
  });

  // An UPDATE denied by policy returns success with zero rows rather than raising
  // (plans/retros/foundation-c-services.md), so the state is re-read to prove it.
  it("cannot be updated by an org president", async () => {
    const { data: updated, error } = await orgPresident
      .from("member_notes")
      .update({ body: "tampered" })
      .eq("id", noteId)
      .select("id");

    expect(error).toBeNull();
    expect(updated ?? []).toEqual([]);

    const { data: after } = await fixtures.service
      .from("member_notes")
      .select("body")
      .eq("id", noteId)
      .single();

    expect(after?.body).toBe(noteBody);
  });

  // Bishopric authority does not cross the ward boundary. This is the assertion that would
  // catch a policy written as `is_bishopric()` without the ward_id term.
  it("returns ZERO rows to a bishop in another ward", async () => {
    const { data, error } = await wardBBishop
      .from("member_notes")
      .select("id")
      .eq("member_id", memberId);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });
});
