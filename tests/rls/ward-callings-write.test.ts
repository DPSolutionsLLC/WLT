// @vitest-environment node
//
// A SECOND-WARD WRITE. THIS SUITE WOULD HAVE BEEN IMPOSSIBLE BEFORE MIGRATION 069, AND THAT IS
// WHAT IT DOCUMENTS.
//
// ---------------------------------------------------------------------------
// THE CONSTRAINT THAT MADE IT IMPOSSIBLE
// ---------------------------------------------------------------------------
// Forty-eight composite foreign keys asserted `(author, ward_id) -> users (id, ward_id)`: the
// person who wrote this row belongs to this row's ward. Under the calling model that is false —
// a Relief Society president whose ACCOUNT lives in ward A holds a real calling in ward B — and
// it failed as SQLSTATE 23503, a 500 rather than a refusal.
//
// Multi-ward would have been able to READ and not to WRITE. Migration 069 narrowed all
// forty-eight to the author alone; tests/db/user-author-fks.test.ts proves none came back.
//
// THREE DIFFERENT TABLES, ON PURPOSE. `visit_logs.recorded_by`, `activity_logs.logged_by` and
// `programs.approved_by` are three separate constraints from three separate migrations, so a
// catalog loop that skipped one shape fails HERE rather than in production on whichever module
// happened to be used first.
//
// EVERY WRITE IS RE-READ WITH THE SERVICE CLIENT. An RLS-denied INSERT raises, but a row that
// lands and is then unreadable, or a 200 with nothing written, both pass a naive assertion.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("writing in the ward of a second calling", () => {
  let fixtures: Fixtures;
  let bishopAway: SupabaseClient<Database>;
  let eqPresident: SupabaseClient<Database>;

  const wardB = {
    householdId: "",
    profileId: "",
    eventId: "",
    sundayId: "",
  };

  const writtenRowIds = { visitLogId: "", activityLogId: "", programId: "" };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "eqPresident",
      "wardBBishop",
      "wardBEqPresident",
      "twoCallingsBishopAway",
    ]);

    // BISHOP IN WARD B is the handle used throughout: `programs.approved_by` needs
    // `programs.approve`, which only the bishopric holds, and the point of the suite is that a
    // second calling carries THAT WARD'S access in full rather than a reduced tier.
    bishopAway = await asRole(fixtures, "twoCallingsBishopAway");
    eqPresident = await asRole(fixtures, "eqPresident");

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardBId, family_name: `Write ${fixtures.runId}` })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);
    wardB.householdId = household.id;

    const { data: profile, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: fixtures.wardBId,
        org_id: fixtures.wardBOrgId,
        activity_name: `Write ${fixtures.runId}`,
        activity_type: "sport",
        entered_by: fixtures.user("wardBEqPresident").id,
      })
      .select("id")
      .single();
    if (profileError) throw new Error(profileError.message);
    wardB.profileId = profile.id;

    const { data: event, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert({
        ward_id: fixtures.wardBId,
        profile_id: profile.id,
        title: "Home game",
        event_date: "2026-03-07T02:30:00Z",
      })
      .select("id")
      .single();
    if (eventError) throw new Error(eventError.message);
    wardB.eventId = event.id;

    const { data: sunday, error: sundayError } = await fixtures.service
      .from("sundays")
      .insert({ ward_id: fixtures.wardBId, date: "2026-03-01" })
      .select("id")
      .single();
    if (sundayError) throw new Error(sundayError.message);
    wardB.sundayId = sunday.id;

    const { error: switchError } = await bishopAway
      .from("users")
      .update({ active_ward_id: fixtures.wardBId })
      .eq("id", fixtures.user("twoCallingsBishopAway").id);
    if (switchError) {
      throw new Error(`Could not act under the ward B calling: ${switchError.message}`);
    }
  });

  afterAll(async () => {
    await bishopAway
      .from("users")
      .update({ active_ward_id: null })
      .eq("id", fixtures.user("twoCallingsBishopAway").id);
    await fixtures?.cleanup();
  });

  // visit_logs.recorded_by — migration 008. The scenario in migration 069's header, verbatim.
  it("inserts a visit log there, authored by an account that lives in another ward", async () => {
    const authorId = fixtures.user("twoCallingsBishopAway").id;

    const { data, error } = await bishopAway
      .from("visit_logs")
      .insert({
        ward_id: fixtures.wardBId,
        org_id: fixtures.wardBOrgId,
        household_id: wardB.householdId,
        visit_date: "2026-03-08",
        shared_notes: "written from a second calling",
        recorded_by: authorId,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    writtenRowIds.visitLogId = data?.id ?? "";

    // THE ROW REALLY LANDED, and it really names an author whose `users.ward_id` is ward A. That
    // pair is exactly what the composite key forbade.
    const { data: reread } = await fixtures.service
      .from("visit_logs")
      .select("id, ward_id, recorded_by")
      .eq("id", writtenRowIds.visitLogId)
      .single();

    expect(reread?.ward_id).toBe(fixtures.wardBId);
    expect(reread?.recorded_by).toBe(authorId);

    const { data: author } = await fixtures.service
      .from("users")
      .select("ward_id")
      .eq("id", authorId)
      .single();
    expect(author?.ward_id).toBe(fixtures.wardAId);
  });

  // activity_logs.logged_by — migration 057a, a second constraint from a second migration.
  it("writes a youth follow-up there", async () => {
    const authorId = fixtures.user("twoCallingsBishopAway").id;

    const { data, error } = await bishopAway
      .from("activity_logs")
      .insert({
        ward_id: fixtures.wardBId,
        event_id: wardB.eventId,
        logged_by: authorId,
        shared_notes: "went to the game",
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    writtenRowIds.activityLogId = data?.id ?? "";

    const { data: reread } = await fixtures.service
      .from("activity_logs")
      .select("ward_id, logged_by")
      .eq("id", writtenRowIds.activityLogId)
      .single();

    expect(reread?.ward_id).toBe(fixtures.wardBId);
    expect(reread?.logged_by).toBe(authorId);
  });

  // programs.approved_by — migration 007, a third constraint, and the one that needs a BISHOPRIC
  // calling. It is also the proof that a second calling carries that ward's FULL access: this
  // person is a music coordinator at home and could not approve anything there.
  it("approves a program there, under a bishopric calling it does not hold at home", async () => {
    const authorId = fixtures.user("twoCallingsBishopAway").id;

    const { data, error } = await bishopAway
      .from("programs")
      .insert({
        ward_id: fixtures.wardBId,
        sunday_id: wardB.sundayId,
        status: "approved",
        approved_by: authorId,
        approved_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    writtenRowIds.programId = data?.id ?? "";

    const { data: reread } = await fixtures.service
      .from("programs")
      .select("ward_id, approved_by")
      .eq("id", writtenRowIds.programId)
      .single();

    expect(reread?.ward_id).toBe(fixtures.wardBId);
    expect(reread?.approved_by).toBe(authorId);
  });

  // ---------------------------------------------------------------------------
  // THE BOUNDARY DID NOT MOVE
  // ---------------------------------------------------------------------------
  //
  // Narrowing forty-eight constraints gave up one thing: the database no longer PROVES an author
  // belonged to the ward they wrote in. What still holds is the thing that actually matters —
  // RLS scopes every insert to current_ward_id() (CLAUDE.md rule 2). These two prove the
  // relaxation did not become a hole.

  it("still refuses an insert from somebody with no calling in that ward", async () => {
    const { error } = await eqPresident.from("visit_logs").insert({
      ward_id: fixtures.wardBId,
      org_id: fixtures.wardBOrgId,
      household_id: wardB.householdId,
      visit_date: "2026-03-09",
      shared_notes: "should never land",
      recorded_by: fixtures.user("eqPresident").id,
    });

    // An INSERT refused by a policy RAISES, unlike an UPDATE or a DELETE. The re-read is still
    // here because a passing error assertion with a row in the table is the failure that matters.
    expect(error).not.toBeNull();

    const { data } = await fixtures.service
      .from("visit_logs")
      .select("id")
      .eq("ward_id", fixtures.wardBId)
      .eq("visit_date", "2026-03-09");

    expect(data).toEqual([]);
  });

  // The author column is still a real foreign key: what 069 gave up was the WARD half, not the
  // reference. Authorship cannot be invented.
  it("still refuses an author who is not a real user at all", async () => {
    const { error } = await bishopAway.from("visit_logs").insert({
      ward_id: fixtures.wardBId,
      org_id: fixtures.wardBOrgId,
      household_id: wardB.householdId,
      visit_date: "2026-03-10",
      shared_notes: "should never land",
      recorded_by: "00000000-0000-4000-8000-0000000000ff",
    });

    expect(error).not.toBeNull();
  });
});
