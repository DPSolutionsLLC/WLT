// @vitest-environment node
//
// 00-foundation.md calls this "the single most important test in the suite."
//
// CLAUDE.md rule 5: private notes are readable by their author and nobody else. Not by the
// bishop. Not by an admin. Not by a support query. The negative cases below are deliberately
// asserted with an AUTHENTICATED client — asserting them with the service-role client would
// prove nothing, because it bypasses RLS entirely.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("private notes", () => {
  let fixtures: Fixtures;
  let author: SupabaseClient<Database>;
  let bishop: SupabaseClient<Database>;
  let orgPresident: SupabaseClient<Database>;

  let visitLogId: string;
  let activityLogId: string;
  let visitNoteId: string;
  let activityNoteId: string;

  const visitNoteBody = "Private: family asked us not to share this.";
  const activityNoteBody = "Private: concern raised after the game.";

  beforeAll(async () => {
    fixtures = await seedFixtures(["counselor1", "bishop", "eqPresident"]);

    author = await asRole(fixtures, "counselor1");
    bishop = await asRole(fixtures, "bishop");
    orgPresident = await asRole(fixtures, "eqPresident");

    const { data: visitLog, error: visitLogError } = await fixtures.service
      .from("visit_logs")
      .insert({
        ward_id: fixtures.wardAId,
        org_id: fixtures.eldersQuorumId,
        visit_date: "2026-03-01",
        shared_notes: "shared summary",
      })
      .select("id")
      .single();
    if (visitLogError) throw new Error(visitLogError.message);
    visitLogId = visitLog.id;

    const { data: activityLog, error: activityLogError } = await fixtures.service
      .from("activity_logs")
      .insert({
        ward_id: fixtures.wardAId,
        logged_by: fixtures.user("counselor1").id,
        shared_notes: "shared summary",
      })
      .select("id")
      .single();
    if (activityLogError) throw new Error(activityLogError.message);
    activityLogId = activityLog.id;

    // Written through the author's own authenticated client, so the INSERT policy is
    // exercised too, not just SELECT.
    const { data: visitNote, error: visitNoteError } = await author
      .from("visit_private_notes")
      .insert({
        ward_id: fixtures.wardAId,
        visit_log_id: visitLogId,
        user_id: fixtures.user("counselor1").id,
        notes: visitNoteBody,
      })
      .select("id")
      .single();
    if (visitNoteError) throw new Error(visitNoteError.message);
    visitNoteId = visitNote.id;

    const { data: activityNote, error: activityNoteError } = await author
      .from("activity_private_notes")
      .insert({
        ward_id: fixtures.wardAId,
        activity_log_id: activityLogId,
        user_id: fixtures.user("counselor1").id,
        notes: activityNoteBody,
      })
      .select("id")
      .single();
    if (activityNoteError) throw new Error(activityNoteError.message);
    activityNoteId = activityNote.id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("visit_private_notes", () => {
    // A policy that blocked everyone including the author would pass every negative
    // assertion below while making the feature useless.
    it("is readable by its author", async () => {
      const { data, error } = await author
        .from("visit_private_notes")
        .select("id, notes")
        .eq("id", visitNoteId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([visitNoteId]);
      expect(data?.[0]?.notes).toBe(visitNoteBody);
    });

    it("returns ZERO rows to the bishop", async () => {
      const { data, error } = await bishop
        .from("visit_private_notes")
        .select("id, notes")
        .eq("id", visitNoteId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("returns ZERO rows to an org president", async () => {
      const { data, error } = await orgPresident
        .from("visit_private_notes")
        .select("id")
        .eq("id", visitNoteId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("returns ZERO rows to the bishop on an unfiltered read", async () => {
      const { data, error } = await bishop.from("visit_private_notes").select("id");

      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id)).not.toContain(visitNoteId);
    });

    // A read-blocking policy that still allows a bishopric UPDATE violates rule 5 just as
    // badly as a leak: the note's author would find it silently rewritten.
    it("cannot be updated by the bishop", async () => {
      const { data: updated, error } = await bishop
        .from("visit_private_notes")
        .update({ notes: "tampered" })
        .eq("id", visitNoteId)
        .select("id");

      expect(error).toBeNull();
      expect(updated ?? []).toEqual([]);

      const { data: after } = await fixtures.service
        .from("visit_private_notes")
        .select("notes")
        .eq("id", visitNoteId)
        .single();

      expect(after?.notes).toBe(visitNoteBody);
    });

    it("cannot be deleted by the bishop", async () => {
      const { data: deleted, error } = await bishop
        .from("visit_private_notes")
        .delete()
        .eq("id", visitNoteId)
        .select("id");

      expect(error).toBeNull();
      expect(deleted ?? []).toEqual([]);

      const { data: after } = await fixtures.service
        .from("visit_private_notes")
        .select("id")
        .eq("id", visitNoteId)
        .maybeSingle();

      expect(after?.id).toBe(visitNoteId);
    });

    it("cannot be written on another user's behalf", async () => {
      const { error } = await bishop.from("visit_private_notes").insert({
        ward_id: fixtures.wardAId,
        visit_log_id: visitLogId,
        user_id: fixtures.user("counselor1").id,
        notes: "impersonated",
      });

      expect(error).not.toBeNull();
    });
  });

  describe("activity_private_notes", () => {
    it("is readable by its author", async () => {
      const { data, error } = await author
        .from("activity_private_notes")
        .select("id, notes")
        .eq("id", activityNoteId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([activityNoteId]);
      expect(data?.[0]?.notes).toBe(activityNoteBody);
    });

    it("returns ZERO rows to the bishop", async () => {
      const { data, error } = await bishop
        .from("activity_private_notes")
        .select("id")
        .eq("id", activityNoteId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("returns ZERO rows to an org president", async () => {
      const { data, error } = await orgPresident
        .from("activity_private_notes")
        .select("id")
        .eq("id", activityNoteId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("cannot be updated by the bishop", async () => {
      const { data: updated, error } = await bishop
        .from("activity_private_notes")
        .update({ notes: "tampered" })
        .eq("id", activityNoteId)
        .select("id");

      expect(error).toBeNull();
      expect(updated ?? []).toEqual([]);

      const { data: after } = await fixtures.service
        .from("activity_private_notes")
        .select("notes")
        .eq("id", activityNoteId)
        .single();

      expect(after?.notes).toBe(activityNoteBody);
    });

    it("cannot be deleted by the bishop", async () => {
      const { data: deleted, error } = await bishop
        .from("activity_private_notes")
        .delete()
        .eq("id", activityNoteId)
        .select("id");

      expect(error).toBeNull();
      expect(deleted ?? []).toEqual([]);

      const { data: after } = await fixtures.service
        .from("activity_private_notes")
        .select("id")
        .eq("id", activityNoteId)
        .maybeSingle();

      expect(after?.id).toBe(activityNoteId);
    });
  });
});
