// @vitest-environment node
//
// Who may read and write a hymn selection, enforced by the DATABASE rather than by the route.
//
// Migration 043 narrows `hymn_selections` and `musical_numbers` writes below migration 019's
// ward-wide loop to bishop, counselor, music_coordinator and ward_secretary. SELECT stays
// ward-wide: what a ward sings on Sunday is read from the pulpit and printed on the programme,
// and the program builder, the PDF renderer and the public page all read these rows. WRITE was
// the boundary that was missing — calendar-c's rule that the first narrowing belongs in RLS and
// not only in the route.
//
// `hymns` itself has NO ward_id (migration 006, the one documented exception to CLAUDE.md rule 1)
// and is readable by every authenticated user. That is asserted here rather than assumed, because
// a well-meaning "every table needs a ward filter" change would break hymn search in a way no
// unit test could see.
//
// Every negative UPDATE and DELETE assertion RE-READS the row with the service client. An
// RLS-denied UPDATE or DELETE is a zero-row SUCCESS, not an error; only INSERT raises
// (plans/retros/foundation-c-services.md). A suite that only checked `error` would pass while the
// app leaked.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is
// deleted in afterAll and nothing assumes an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const SUNDAY_DATE = "2027-08-01";

describe("music access", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let secretaryA: SupabaseClient<Database>;
  let musicA: SupabaseClient<Database>;
  let orgSecretaryA: SupabaseClient<Database>;
  let eqPresidentA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;

  let wardASundayId = "";
  let wardBSundayId = "";
  let wardASelectionId = "";
  let wardBSelectionId = "";

  async function readSelectionNumber(selectionId: string): Promise<number | null> {
    const { data, error } = await fixtures.service
      .from("hymn_selections")
      .select("hymn_number")
      .eq("id", selectionId)
      .maybeSingle();

    if (error) throw new Error(`Could not re-read the hymn selection: ${error.message}`);
    return data?.hymn_number ?? null;
  }

  async function selectionStillExists(selectionId: string): Promise<boolean> {
    const { data, error } = await fixtures.service
      .from("hymn_selections")
      .select("id")
      .eq("id", selectionId)
      .maybeSingle();

    if (error) throw new Error(`Could not re-read the hymn selection: ${error.message}`);
    return data !== null;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "wardSecretary",
      "musicCoordinator",
      "eqSecretary",
      "eqPresident",
      "wardBBishop",
    ]);

    bishopA = await asRole(fixtures, "bishop");
    secretaryA = await asRole(fixtures, "wardSecretary");
    musicA = await asRole(fixtures, "musicCoordinator");
    orgSecretaryA = await asRole(fixtures, "eqSecretary");
    eqPresidentA = await asRole(fixtures, "eqPresident");
    bishopB = await asRole(fixtures, "wardBBishop");

    const seedSunday = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: wardId, date: SUNDAY_DATE, type: "standard", speaking_slots: 2 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    wardASundayId = await seedSunday(fixtures.wardAId);
    wardBSundayId = await seedSunday(fixtures.wardBId);

    const seedSelection = async (wardId: string, sundayId: string) => {
      const { data, error } = await fixtures.service
        .from("hymn_selections")
        .insert({
          ward_id: wardId,
          sunday_id: sundayId,
          hymn_type: "opening",
          hymn_number: 19,
          hymn_title: "We Thank Thee, O God, for a Prophet",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    wardASelectionId = await seedSelection(fixtures.wardAId, wardASundayId);
    wardBSelectionId = await seedSelection(fixtures.wardBId, wardBSundayId);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("the hymnbook is readable by everybody", () => {
    it("lets a music coordinator read hymns", async () => {
      const { data, error } = await musicA.from("hymns").select("number").eq("number", 2);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    // Not a ward's data. An org secretary has no music permission at all and still needs to be
    // able to read a hymn number — the hymnbook is a reference table, and GET /api/hymns is
    // deliberately behind no specific permission.
    it("lets a role with no music permission read hymns", async () => {
      const { data, error } = await orgSecretaryA.from("hymns").select("number").eq("number", 2);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("lets another ward read the same hymns", async () => {
      const { data, error } = await bishopB.from("hymns").select("number").eq("number", 2);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("does not let anyone write to the hymnbook", async () => {
      const { error } = await bishopA
        .from("hymns")
        .insert({ number: 9002, title: "Not A Hymn", source: "authoritative" });

      // Only the seed and supabase/scripts/hymns.ts write here, and both run as service_role.
      expect(error).not.toBeNull();
    });
  });

  describe("ward isolation", () => {
    it("cannot read another ward's hymn selection", async () => {
      const { data, error } = await bishopA
        .from("hymn_selections")
        .select("id")
        .eq("id", wardBSelectionId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("cannot update another ward's hymn selection", async () => {
      const { error } = await bishopA
        .from("hymn_selections")
        .update({ hymn_number: 1 })
        .eq("id", wardBSelectionId);

      // A denied UPDATE is a zero-row success, so the row itself is the assertion.
      expect(error).toBeNull();
      expect(await readSelectionNumber(wardBSelectionId)).toBe(19);
    });

    it("cannot delete another ward's hymn selection", async () => {
      const { error } = await bishopA
        .from("hymn_selections")
        .delete()
        .eq("id", wardBSelectionId);

      expect(error).toBeNull();
      expect(await selectionStillExists(wardBSelectionId)).toBe(true);
    });

    it("cannot insert a hymn selection into another ward", async () => {
      const { error } = await bishopA.from("hymn_selections").insert({
        ward_id: fixtures.wardBId,
        sunday_id: wardBSundayId,
        hymn_type: "closing",
        hymn_number: 152,
        hymn_title: "God Be with You Till We Meet Again",
      });

      // INSERT is the one verb that raises.
      expect(error).not.toBeNull();
    });
  });

  describe("who may write — migration 043", () => {
    it("lets a music coordinator insert a selection", async () => {
      const { data, error } = await musicA
        .from("hymn_selections")
        .insert({
          ward_id: fixtures.wardAId,
          sunday_id: wardASundayId,
          hymn_type: "sacrament",
          hymn_number: 169,
          hymn_title: "As Now We Take the Sacrament",
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
    });

    // The secretary builds the programme and has to be able to type in a hymn the coordinator
    // has not got to yet — which is why lib/auth/permissions.ts grants them music.view.
    it("lets a ward secretary insert a selection", async () => {
      const { error } = await secretaryA.from("hymn_selections").insert({
        ward_id: fixtures.wardAId,
        sunday_id: wardASundayId,
        hymn_type: "closing",
        hymn_number: 152,
        hymn_title: "God Be with You Till We Meet Again",
      });

      expect(error).toBeNull();
    });

    it("lets a bishop insert a selection", async () => {
      const { error } = await bishopA.from("hymn_selections").insert({
        ward_id: fixtures.wardAId,
        sunday_id: wardASundayId,
        hymn_type: "opening",
        hymn_number: 2,
        hymn_title: "The Spirit of God",
      });

      expect(error).toBeNull();
    });

    // THE NARROWING ITSELF. Before migration 043 this insert succeeded, because 019's loop gave
    // every authenticated member of the ward all four verbs.
    it("does not let an org secretary insert a selection", async () => {
      const { error } = await orgSecretaryA.from("hymn_selections").insert({
        ward_id: fixtures.wardAId,
        sunday_id: wardASundayId,
        hymn_type: "opening",
        hymn_number: 30,
        hymn_title: "Come, Come, Ye Saints",
      });

      expect(error).not.toBeNull();
    });

    it("does not let an org president insert a selection", async () => {
      const { error } = await eqPresidentA.from("hymn_selections").insert({
        ward_id: fixtures.wardAId,
        sunday_id: wardASundayId,
        hymn_type: "opening",
        hymn_number: 30,
        hymn_title: "Come, Come, Ye Saints",
      });

      expect(error).not.toBeNull();
    });

    it("does not let an org secretary update an existing selection", async () => {
      const { error } = await orgSecretaryA
        .from("hymn_selections")
        .update({ hymn_number: 1 })
        .eq("id", wardASelectionId);

      expect(error).toBeNull();
      expect(await readSelectionNumber(wardASelectionId)).toBe(19);
    });

    it("does not let an org secretary delete an existing selection", async () => {
      const { error } = await orgSecretaryA
        .from("hymn_selections")
        .delete()
        .eq("id", wardASelectionId);

      expect(error).toBeNull();
      expect(await selectionStillExists(wardASelectionId)).toBe(true);
    });
  });

  describe("SELECT stays ward-wide", () => {
    // Nothing in a hymn selection is private. An org secretary reading which hymn is sung on
    // Sunday is not a leak — narrowing SELECT here would break the program builder and the
    // public page for no gain.
    it("lets a role with no music permission read this ward's selections", async () => {
      const { data, error } = await orgSecretaryA
        .from("hymn_selections")
        .select("id")
        .eq("id", wardASelectionId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });

  describe("musical numbers follow the same rule", () => {
    it("lets a music coordinator insert a musical number", async () => {
      const { error } = await musicA.from("musical_numbers").insert({
        ward_id: fixtures.wardAId,
        sunday_id: wardASundayId,
        performer: "The Primary children",
        piece_title: "I Am a Child of God",
      });

      expect(error).toBeNull();
    });

    it("does not let an org secretary insert a musical number", async () => {
      const { error } = await orgSecretaryA.from("musical_numbers").insert({
        ward_id: fixtures.wardAId,
        sunday_id: wardASundayId,
        performer: "Somebody Else",
        piece_title: "A Piece",
      });

      expect(error).not.toBeNull();
    });

    it("cannot insert a musical number into another ward", async () => {
      const { error } = await bishopA.from("musical_numbers").insert({
        ward_id: fixtures.wardBId,
        sunday_id: wardBSundayId,
        performer: "Somebody",
        piece_title: "A Piece",
      });

      expect(error).not.toBeNull();
    });
  });
});
