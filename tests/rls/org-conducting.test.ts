// @vitest-environment node
//
// The first genuinely org-scoped WRITE boundary in this app, and the suite that proves it is the
// policy rather than the route (CLAUDE.md rule 2). A route that forgot its scope check would look
// completely normal on screen; only these assertions catch it.
//
// Migration 024, Part 6 drops the four ward-wide policies migration 019's loop created on
// `conducting_rotation` and replaces them with real ones. Part 5 gives `sunday_org_conducting`
// real policies from birth. Both predicates are:
//
//   ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id())
//
// with an extra `org_id is not null` on the rotation, because a NULL org_id there means the
// BISHOPRIC's rotation — and a user whose own org_id is NULL would otherwise match it.
//
// These run over the network against the shared hosted project (CLAUDE.md §9), so they clean up
// after themselves and never assume an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// Far enough out that it cannot collide with a fixture another suite left behind on the shared
// project, and every write below carries the run id in its dates rather than its text — the
// rotation has no free-text column to tag.
const ROTATION_DATE = "2028-04-02";
const OTHER_ROTATION_DATE = "2028-05-07";
const SUNDAY_DATE = "2028-04-02";

describe("organization conducting access", () => {
  let fixtures: Fixtures;

  let eqPresident: SupabaseClient<Database>;
  let eqSecretary: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;
  let wardSecretary: SupabaseClient<Database>;
  let musicCoordinator: SupabaseClient<Database>;
  let wardBEqPresident: SupabaseClient<Database>;

  let wardASundayId = "";
  let wardBSundayId = "";

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
      "wardSecretary",
      "musicCoordinator",
      "wardBEqPresident",
    ]);

    eqPresident = await asRole(fixtures, "eqPresident");
    eqSecretary = await asRole(fixtures, "eqSecretary");
    rsPresident = await asRole(fixtures, "rsPresident");
    wardSecretary = await asRole(fixtures, "wardSecretary");
    musicCoordinator = await asRole(fixtures, "musicCoordinator");
    wardBEqPresident = await asRole(fixtures, "wardBEqPresident");

    const seedSunday = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: wardId, date: SUNDAY_DATE, type: "standard", speaking_slots: 3 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    wardASundayId = await seedSunday(fixtures.wardAId);
    wardBSundayId = await seedSunday(fixtures.wardBId);

    // The bishopric rotation (org_id NULL) and a Relief Society rotation, both seeded through
    // the service client so the assertions below are about READING and WRITING them, not about
    // whether they could be created.
    const { error } = await fixtures.service.from("conducting_rotation").insert([
      {
        ward_id: fixtures.wardAId,
        org_id: null,
        position: 1,
        user_id: fixtures.user("bishop").id,
        effective_from: ROTATION_DATE,
        cadence: "monthly",
      },
      {
        ward_id: fixtures.wardAId,
        org_id: fixtures.reliefSocietyId,
        position: 1,
        user_id: fixtures.user("rsPresident").id,
        effective_from: ROTATION_DATE,
        cadence: "weekly",
      },
    ]);
    if (error) throw new Error(error.message);

    const { error: orgConductingError } = await fixtures.service
      .from("sunday_org_conducting")
      .insert([
        {
          ward_id: fixtures.wardAId,
          sunday_id: wardASundayId,
          org_id: fixtures.reliefSocietyId,
          user_id: fixtures.user("rsPresident").id,
        },
        {
          ward_id: fixtures.wardBId,
          sunday_id: wardBSundayId,
          org_id: fixtures.wardBOrgId,
          user_id: fixtures.user("wardBEqPresident").id,
        },
      ]);
    if (orgConductingError) throw new Error(orgConductingError.message);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("conducting_rotation", () => {
    it("lets an org president write their OWN organization's rotation", async () => {
      const { data, error } = await eqPresident
        .from("conducting_rotation")
        .insert({
          ward_id: fixtures.wardAId,
          org_id: fixtures.eldersQuorumId,
          position: 1,
          user_id: fixtures.user("eqPresident").id,
          effective_from: OTHER_ROTATION_DATE,
          cadence: "monthly",
        })
        .select("id");

      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const { data: updated, error: updateError } = await eqPresident
        .from("conducting_rotation")
        .update({ cadence: "weekly" })
        .eq("id", data![0].id)
        .select("id");

      expect(updateError).toBeNull();
      expect(updated).toHaveLength(1);

      await fixtures.service.from("conducting_rotation").delete().eq("id", data![0].id);
    });

    it("refuses an org president writing ANOTHER organization's rotation", async () => {
      // An INSERT that fails its WITH CHECK is a hard error, unlike a filtered UPDATE.
      const { error } = await eqPresident
        .from("conducting_rotation")
        .insert({
          ward_id: fixtures.wardAId,
          org_id: fixtures.reliefSocietyId,
          position: 2,
          user_id: fixtures.user("rsPresident").id,
          effective_from: OTHER_ROTATION_DATE,
          cadence: "weekly",
        })
        .select("id");

      expect(error).not.toBeNull();
    });

    it("refuses an org president updating another organization's rotation", async () => {
      const { data, error } = await eqPresident
        .from("conducting_rotation")
        .update({ user_id: fixtures.user("eqPresident").id })
        .eq("ward_id", fixtures.wardAId)
        .eq("org_id", fixtures.reliefSocietyId)
        .select("id");

      // An RLS refusal on UPDATE is a zero-row success, not an error.
      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: untouched } = await fixtures.service
        .from("conducting_rotation")
        .select("user_id")
        .eq("ward_id", fixtures.wardAId)
        .eq("org_id", fixtures.reliefSocietyId)
        .single();

      expect(untouched?.user_id).toBe(fixtures.user("rsPresident").id);
    });

    // THE check migration 024's `org_id is not null` clause exists for. Without that clause a
    // user whose own org_id is NULL matches the bishopric rotation's NULL org_id and gains write
    // access to it. This assertion fails loudly if the clause is ever dropped.
    it("refuses an org president writing the BISHOPRIC rotation", async () => {
      const { error } = await eqPresident
        .from("conducting_rotation")
        .insert({
          ward_id: fixtures.wardAId,
          org_id: null,
          position: 2,
          user_id: fixtures.user("eqPresident").id,
          effective_from: OTHER_ROTATION_DATE,
          cadence: "weekly",
        })
        .select("id");

      expect(error).not.toBeNull();

      const { data, error: updateError } = await eqPresident
        .from("conducting_rotation")
        .update({ cadence: "weekly" })
        .eq("ward_id", fixtures.wardAId)
        .is("org_id", null)
        .select("id");

      expect(updateError).toBeNull();
      expect(data).toEqual([]);
    });

    // The same clause, from the other direction: these accounts have a NULL org_id of their own,
    // so a missing `org_id is not null` would hand them the bishopric rotation outright.
    it("refuses every ward-wide role with a null org_id writing the bishopric rotation", async () => {
      for (const [label, client] of [
        ["wardSecretary", wardSecretary],
        ["musicCoordinator", musicCoordinator],
      ] as const) {
        const { error } = await client
          .from("conducting_rotation")
          .insert({
            ward_id: fixtures.wardAId,
            org_id: null,
            position: 3,
            user_id: fixtures.user("bishop").id,
            effective_from: OTHER_ROTATION_DATE,
            cadence: "weekly",
          })
          .select("id");

        expect(error, `${label} was allowed to write the bishopric rotation`).not.toBeNull();
      }
    });

    it("refuses a president in ward A writing ward B's rotation", async () => {
      const { error } = await eqPresident
        .from("conducting_rotation")
        .insert({
          ward_id: fixtures.wardBId,
          org_id: fixtures.wardBOrgId,
          position: 1,
          user_id: fixtures.user("wardBEqPresident").id,
          effective_from: OTHER_ROTATION_DATE,
          cadence: "weekly",
        })
        .select("id");

      expect(error).not.toBeNull();
    });

    it("hides another ward's rotation entirely", async () => {
      const { data, error } = await wardBEqPresident
        .from("conducting_rotation")
        .select("id")
        .eq("ward_id", fixtures.wardAId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    // Read is ward-wide on purpose: who conducts is not sensitive, and the music coordinator
    // plans against it.
    it("lets every calendar-reading role in the ward read every rotation", async () => {
      for (const [label, client] of [
        ["eqPresident", eqPresident],
        ["eqSecretary", eqSecretary],
        ["rsPresident", rsPresident],
        ["wardSecretary", wardSecretary],
        ["musicCoordinator", musicCoordinator],
      ] as const) {
        const { data, error } = await client
          .from("conducting_rotation")
          .select("id, org_id")
          .eq("ward_id", fixtures.wardAId)
          .eq("effective_from", ROTATION_DATE);

        expect(error, `${label} could not read the rotations`).toBeNull();
        expect(data, `${label} saw the wrong number of rotations`).toHaveLength(2);
      }
    });
  });

  describe("sunday_org_conducting", () => {
    it("lets an org president write their OWN organization's conductor", async () => {
      const { data, error } = await eqPresident
        .from("sunday_org_conducting")
        .insert({
          ward_id: fixtures.wardAId,
          sunday_id: wardASundayId,
          org_id: fixtures.eldersQuorumId,
          user_id: fixtures.user("eqPresident").id,
        })
        .select("id");

      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const { data: updated, error: updateError } = await eqPresident
        .from("sunday_org_conducting")
        .update({ user_id: null })
        .eq("id", data![0].id)
        .select("id");

      expect(updateError).toBeNull();
      expect(updated).toHaveLength(1);

      await fixtures.service.from("sunday_org_conducting").delete().eq("id", data![0].id);
    });

    it("refuses an org president writing ANOTHER organization's conductor", async () => {
      const { error } = await eqPresident
        .from("sunday_org_conducting")
        .insert({
          ward_id: fixtures.wardAId,
          sunday_id: wardASundayId,
          org_id: fixtures.reliefSocietyId,
          user_id: fixtures.user("eqPresident").id,
        })
        .select("id");

      expect(error).not.toBeNull();

      const { data, error: updateError } = await eqPresident
        .from("sunday_org_conducting")
        .update({ user_id: fixtures.user("eqPresident").id })
        .eq("ward_id", fixtures.wardAId)
        .eq("org_id", fixtures.reliefSocietyId)
        .select("id");

      expect(updateError).toBeNull();
      expect(data).toEqual([]);

      const { data: untouched } = await fixtures.service
        .from("sunday_org_conducting")
        .select("user_id")
        .eq("ward_id", fixtures.wardAId)
        .eq("org_id", fixtures.reliefSocietyId)
        .single();

      expect(untouched?.user_id).toBe(fixtures.user("rsPresident").id);
    });

    // No NULL org_id is possible on this table — the column is NOT NULL — so a ward-wide role
    // with a null org_id matches nothing at all rather than matching everything.
    it("refuses a ward_secretary writing any organization's conductor", async () => {
      const { error } = await wardSecretary
        .from("sunday_org_conducting")
        .insert({
          ward_id: fixtures.wardAId,
          sunday_id: wardASundayId,
          org_id: fixtures.eldersQuorumId,
          user_id: fixtures.user("eqPresident").id,
        })
        .select("id");

      expect(error).not.toBeNull();
    });

    it("refuses a president in ward A writing ward B's conductor", async () => {
      const { error } = await eqPresident
        .from("sunday_org_conducting")
        .insert({
          ward_id: fixtures.wardBId,
          sunday_id: wardBSundayId,
          org_id: fixtures.wardBOrgId,
          user_id: fixtures.user("wardBEqPresident").id,
        })
        .select("id");

      expect(error).not.toBeNull();

      const { data, error: updateError } = await eqPresident
        .from("sunday_org_conducting")
        .update({ user_id: null })
        .eq("id", wardBSundayId)
        .select("id");

      expect(updateError).toBeNull();
      expect(data).toEqual([]);
    });

    it("hides another ward's organization conducting entirely", async () => {
      const { data, error } = await eqPresident
        .from("sunday_org_conducting")
        .select("id")
        .eq("ward_id", fixtures.wardBId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("lets every calendar-reading role in the ward read every organization's conductor", async () => {
      for (const [label, client] of [
        ["eqPresident", eqPresident],
        ["eqSecretary", eqSecretary],
        ["rsPresident", rsPresident],
        ["wardSecretary", wardSecretary],
        ["musicCoordinator", musicCoordinator],
      ] as const) {
        const { data, error } = await client
          .from("sunday_org_conducting")
          .select("id")
          .eq("ward_id", fixtures.wardAId)
          .eq("sunday_id", wardASundayId);

        expect(error, `${label} could not read the organization conductors`).toBeNull();
        expect(data, `${label} saw no organization conductors`).toHaveLength(1);
      }
    });
  });
});
