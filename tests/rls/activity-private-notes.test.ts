// @vitest-environment node
//
// CLAUDE.md rule 5, for the youth module. 08-youth-activities.md §Tests names this file.
//
// ---------------------------------------------------------------------------
// WHY IT EXISTS BESIDE tests/rls/private-notes.test.ts RATHER THAN INSIDE IT
// ---------------------------------------------------------------------------
// That suite proves both tables' four author-only policies and is called "the single most
// important test in the suite" by 00-foundation.md. This one proves the thing that suite CANNOT:
// that migration 057's narrowing of `activity_logs` next door changed nothing here, in either
// direction — not when a reader gains access to the parent follow-up, and not when a ward turns
// cross-organization visibility on.
//
// That is a live question rather than a theoretical one. Migration 053 widened four visits tables
// for that setting and deliberately left `visit_private_notes` alone; 057 widens nothing and
// narrows one table, and the same line has to hold. A wider read on shared work does not widen a
// private note by one row.
//
// THE BISHOPRIC CASE IS ASSERTED BY NAME, because that is the assertion the rule is actually
// about. Not the bishop, not an administrator, not a support query — ever.
//
// Every negative case uses an AUTHENTICATED client. Asserting them with the service-role client
// would prove nothing, because it bypasses RLS entirely.
//
// The suite runs over the network against the shared hosted project, so it cleans up after itself
// and never assumes an empty table (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database, Json } from "@/types/database";

describe("activity private notes", () => {
  let fixtures: Fixtures;

  // The AUTHOR of both the follow-up and the private note on it.
  let author: SupabaseClient<Database>;
  let bishop: SupabaseClient<Database>;
  let sameOrgSecretary: SupabaseClient<Database>;
  let otherOrgPresident: SupabaseClient<Database>;

  let activityLogId: string;
  let noteId: string;

  const noteBody = "Private: I am worried about how he took the loss.";

  const setCrossOrgVisibility = async (enabled: boolean): Promise<void> => {
    const { data, error } = await fixtures.service
      .from("wards")
      .select("settings")
      .eq("id", fixtures.wardAId)
      .single();
    if (error) throw new Error(error.message);

    // MERGED, never replaced — a settings write that overwrote the object would delete
    // role_access along with it (lib/ward/crossOrgVisibility.ts states the rule).
    const settings = { ...(data.settings as Record<string, unknown>) };
    settings.cross_org_visibility = enabled;

    const { error: writeError } = await fixtures.service
      .from("wards")
      .update({ settings: settings as Json })
      .eq("id", fixtures.wardAId);
    if (writeError) throw new Error(writeError.message);
  };

  const noteIdsVisibleTo = async (
    client: SupabaseClient<Database>,
  ): Promise<Set<string>> => {
    const { data, error } = await client.from("activity_private_notes").select("id");

    expect(error).toBeNull();
    return new Set((data ?? []).map((row) => row.id));
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
    ]);

    [author, bishop, sameOrgSecretary, otherOrgPresident] = await Promise.all([
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "bishop"),
      asRole(fixtures, "eqSecretary"),
      asRole(fixtures, "rsPresident"),
    ]);

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        first_name: "Ada",
        last_name: `Youth${fixtures.runId}`,
        category: "youth",
        status: "active",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);

    // The Elders Quorum's OWN activity, so the follow-up beneath it is one the same-organization
    // secretary can genuinely READ. That is what makes the assertion below meaningful: somebody
    // who can see the shared note still cannot see the private one.
    const { data: profile, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: fixtures.wardAId,
        org_id: fixtures.eldersQuorumId,
        member_id: member.id,
        activity_name: `EQ basketball ${fixtures.runId}`,
        activity_type: "sport",
      })
      .select("id")
      .single();
    if (profileError) throw new Error(profileError.message);

    const { data: event, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert({
        ward_id: fixtures.wardAId,
        profile_id: profile.id,
        title: `EQ game ${fixtures.runId}`,
        event_type: "home",
        event_date: "2026-11-14T19:30:00-07:00",
        status: "upcoming",
      })
      .select("id")
      .single();
    if (eventError) throw new Error(eventError.message);

    const { data: log, error: logError } = await fixtures.service
      .from("activity_logs")
      .insert({
        ward_id: fixtures.wardAId,
        event_id: event.id,
        logged_by: fixtures.user("eqPresident").id,
        shared_notes: "Shared: a close game, well played.",
      })
      .select("id")
      .single();
    if (logError) throw new Error(logError.message);
    activityLogId = log.id;

    // Written through the AUTHOR'S OWN authenticated client, so the INSERT policy is exercised
    // too, not just SELECT.
    const { data: note, error: noteError } = await author
      .from("activity_private_notes")
      .insert({
        ward_id: fixtures.wardAId,
        activity_log_id: activityLogId,
        user_id: fixtures.user("eqPresident").id,
        notes: noteBody,
      })
      .select("id")
      .single();
    if (noteError) throw new Error(noteError.message);
    noteId = note.id;

    await setCrossOrgVisibility(false);
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  // A policy that blocked everyone including the author would pass every negative assertion below
  // while making the feature useless.
  it("is readable by its author", async () => {
    const { data, error } = await author
      .from("activity_private_notes")
      .select("id, notes")
      .eq("id", noteId);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([noteId]);
    expect(data?.[0]?.notes).toBe(noteBody);
  });

  // THE ASSERTION THE RULE IS ACTUALLY ABOUT.
  it("returns ZERO rows to the bishop", async () => {
    const { data, error } = await bishop
      .from("activity_private_notes")
      .select("id, notes")
      .eq("id", noteId);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("returns ZERO rows to the bishop on an unfiltered read", async () => {
    expect((await noteIdsVisibleTo(bishop)).has(noteId)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // THE ONE THIS MODULE ADDS: READING THE FOLLOW-UP IS NOT READING THE NOTE
  // ---------------------------------------------------------------------------
  // The Elders Quorum secretary can read the parent follow-up — same organization, migration
  // 057c's org arm — and reads NOTHING here. That gap is the whole of rule 5's first mechanism: a
  // private note is a separate TABLE, so no widening of the parent can reach it.
  it("returns ZERO rows to somebody who CAN read the parent follow-up", async () => {
    const { data: parent, error: parentError } = await sameOrgSecretary
      .from("activity_logs")
      .select("id")
      .eq("id", activityLogId);

    // The premise, asserted rather than assumed — without it this test would pass against a
    // secretary who simply could not see anything at all.
    expect(parentError).toBeNull();
    expect(parent?.map((row) => row.id)).toEqual([activityLogId]);

    expect((await noteIdsVisibleTo(sameOrgSecretary)).has(noteId)).toBe(false);
  });

  it("returns ZERO rows to another organization's president", async () => {
    expect((await noteIdsVisibleTo(otherOrgPresident)).has(noteId)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // CROSS-ORGANIZATION VISIBILITY CHANGES NOTHING HERE, IN EITHER DIRECTION
  // ---------------------------------------------------------------------------
  // Migration 057 widened no private-note policy and 053 refused to widen the visits one. A ward
  // turning the setting on is asking to read other organizations' WORK, and a private note is not
  // work anybody shares.
  describe("with cross-organization visibility on", () => {
    it("still returns ZERO rows to every reader but the author", async () => {
      await setCrossOrgVisibility(true);

      // The premise again: with the setting on, the other organization's president CAN now read
      // the parent follow-up. So the note staying hidden is the setting failing to reach it rather
      // than the reader being blocked upstream.
      const { data: parent } = await otherOrgPresident
        .from("activity_logs")
        .select("id")
        .eq("id", activityLogId);
      expect(parent?.map((row) => row.id)).toEqual([activityLogId]);

      expect((await noteIdsVisibleTo(otherOrgPresident)).has(noteId)).toBe(false);
      expect((await noteIdsVisibleTo(bishop)).has(noteId)).toBe(false);
      expect((await noteIdsVisibleTo(sameOrgSecretary)).has(noteId)).toBe(false);

      // And the author still can, so this is not a suite that passes because everything is broken.
      expect((await noteIdsVisibleTo(author)).has(noteId)).toBe(true);

      await setCrossOrgVisibility(false);
    });
  });

  // A read-blocking policy that still allowed a bishopric UPDATE would violate rule 5 just as
  // badly as a leak: the note's author would find it silently rewritten.
  it("cannot be updated by the bishop", async () => {
    const { data: updated, error } = await bishop
      .from("activity_private_notes")
      .update({ notes: "tampered" })
      .eq("id", noteId)
      .select("id");

    expect(error).toBeNull();
    expect(updated ?? []).toEqual([]);

    const { data: after } = await fixtures.service
      .from("activity_private_notes")
      .select("notes")
      .eq("id", noteId)
      .single();

    expect(after?.notes).toBe(noteBody);
  });

  it("cannot be deleted by the bishop", async () => {
    const { data: deleted, error } = await bishop
      .from("activity_private_notes")
      .delete()
      .eq("id", noteId)
      .select("id");

    expect(error).toBeNull();
    expect(deleted ?? []).toEqual([]);

    const { data: after } = await fixtures.service
      .from("activity_private_notes")
      .select("id")
      .eq("id", noteId)
      .maybeSingle();

    expect(after?.id).toBe(noteId);
  });

  it("cannot be written on another user's behalf", async () => {
    const { error } = await bishop.from("activity_private_notes").insert({
      ward_id: fixtures.wardAId,
      activity_log_id: activityLogId,
      user_id: fixtures.user("eqPresident").id,
      notes: "impersonated",
    });

    expect(error).not.toBeNull();
  });

  // Migration 057b's `unique (activity_log_id, user_id)`, which is what the route's upsert
  // conflicts on. Without it a second save writes a second row and "the caller's note" stops being
  // a single row anybody can name.
  it("holds one note per author per follow-up", async () => {
    const { error } = await author.from("activity_private_notes").insert({
      ward_id: fixtures.wardAId,
      activity_log_id: activityLogId,
      user_id: fixtures.user("eqPresident").id,
      notes: "a second note",
    });

    expect(error?.code).toBe("23505");
  });

  // Two people may each hold their own note on the SAME follow-up, and neither sees the other's.
  // That is what the constraint above is scoped per author for.
  it("lets a second person hold their own note on the same follow-up", async () => {
    const { data, error } = await bishop
      .from("activity_private_notes")
      .insert({
        ward_id: fixtures.wardAId,
        activity_log_id: activityLogId,
        user_id: fixtures.user("bishop").id,
        notes: "Bishop's own private note.",
      })
      .select("id")
      .single();

    expect(error).toBeNull();

    // Each sees exactly one: their own.
    expect((await noteIdsVisibleTo(bishop)).has(data!.id)).toBe(true);
    expect((await noteIdsVisibleTo(bishop)).has(noteId)).toBe(false);
    expect((await noteIdsVisibleTo(author)).has(data!.id)).toBe(false);

    await fixtures.service.from("activity_private_notes").delete().eq("id", data!.id);
  });
});
