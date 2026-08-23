// @vitest-environment node
//
// `goals` is ORG-SCOPED as of migration 030, replacing the ward-scoped policies migration 019's
// loop gave it. The rule:
//
//   org_id is null  ->  a ward-level goal. Bishopric only.
//   org_id is set   ->  that organization's leadership, plus the bishopric.
//
// This suite exists because the change is easy to get subtly wrong in a way nothing else would
// catch. Two failure modes in particular:
//
//   1. A leftover ward-scoped policy. PostgreSQL ORs permissive policies together, so if
//      `goals_ward_select` had survived alongside `goals_org_select`, every read would still be
//      ward-wide and the migration would appear to have worked while changing nothing.
//   2. `org_id = current_org_id()` with both sides null. SQL says that is NOT true, which is what
//      makes a null-org goal bishopric-only — but it also means a null-org USER sees nothing, and
//      that needs to be true on purpose rather than by accident.
//
// Every negative assertion re-reads the row with the service client: an RLS-denied UPDATE or
// DELETE is a zero-row SUCCESS, not an error (plans/retros/foundation-c-services.md).
//
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("goal access", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let counselorA: SupabaseClient<Database>;
  let eqPresident: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;

  let wardLevelGoalId = "";
  let eqGoalId = "";
  let rsGoalId = "";
  let wardBGoalId = "";

  const seedGoal = async (wardId: string, orgId: string | null, title: string) => {
    const { data, error } = await fixtures.service
      .from("goals")
      .insert({
        ward_id: wardId,
        org_id: orgId,
        title,
        desired_frequency_months: 12,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "eqPresident",
      "rsPresident",
      "wardBBishop",
    ]);

    bishopA = await asRole(fixtures, "bishop");
    counselorA = await asRole(fixtures, "counselor1");
    eqPresident = await asRole(fixtures, "eqPresident");
    rsPresident = await asRole(fixtures, "rsPresident");
    bishopB = await asRole(fixtures, "wardBBishop");

    wardLevelGoalId = await seedGoal(fixtures.wardAId, null, `ward level ${fixtures.runId}`);
    eqGoalId = await seedGoal(fixtures.wardAId, fixtures.eldersQuorumId, `eq ${fixtures.runId}`);
    rsGoalId = await seedGoal(fixtures.wardAId, fixtures.reliefSocietyId, `rs ${fixtures.runId}`);
    wardBGoalId = await seedGoal(fixtures.wardBId, null, `ward B ${fixtures.runId}`);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("the bishopric owns everything", () => {
    it("lets the bishop read all three of ward A's goals", async () => {
      const { data, error } = await bishopA
        .from("goals")
        .select("id")
        .in("id", [wardLevelGoalId, eqGoalId, rsGoalId]);

      expect(error).toBeNull();
      expect(new Set((data ?? []).map((row) => row.id))).toEqual(
        new Set([wardLevelGoalId, eqGoalId, rsGoalId]),
      );
    });

    // CLAUDE.md §7: bishopric authority is shared. A counselor sees exactly what the bishop sees.
    it("gives a counselor the identical three", async () => {
      const { data, error } = await counselorA
        .from("goals")
        .select("id")
        .in("id", [wardLevelGoalId, eqGoalId, rsGoalId]);

      expect(error).toBeNull();
      expect(new Set((data ?? []).map((row) => row.id))).toEqual(
        new Set([wardLevelGoalId, eqGoalId, rsGoalId]),
      );
    });

    it("lets the bishop update another organization's goal", async () => {
      const { error } = await bishopA
        .from("goals")
        .update({ notes: "edited by the bishop" })
        .eq("id", eqGoalId)
        .select("id");

      expect(error).toBeNull();

      const { data } = await fixtures.service
        .from("goals")
        .select("notes")
        .eq("id", eqGoalId)
        .single();

      expect(data?.notes).toBe("edited by the bishop");
    });
  });

  describe("an organization sees its own and no other", () => {
    it("lets the EQ president read the EQ goal", async () => {
      const { data, error } = await eqPresident.from("goals").select("id").eq("id", eqGoalId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("hides the Relief Society's goal from the EQ president", async () => {
      const { data, error } = await eqPresident.from("goals").select("id").eq("id", rsGoalId);

      // An RLS refusal is a zero-row success, not an error.
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("hides the EQ goal from the Relief Society president", async () => {
      const { data, error } = await rsPresident.from("goals").select("id").eq("id", eqGoalId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    // THE ONE THAT WOULD HAVE CAUGHT A LEFTOVER WARD-SCOPED POLICY. Before migration 030 this
    // returned every goal in the ward.
    it("shows the EQ president exactly one goal across the whole ward", async () => {
      const { data, error } = await eqPresident
        .from("goals")
        .select("id")
        .eq("ward_id", fixtures.wardAId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([eqGoalId]);
    });

    it("refuses the EQ president an update to the Relief Society's goal", async () => {
      const { data, error } = await eqPresident
        .from("goals")
        .update({ notes: "written by the EQ" })
        .eq("id", rsGoalId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      // The assertion that matters — a denied UPDATE is a zero-row success, so "no rows" alone
      // would also be the shape of a write that succeeded against nothing.
      const { data: untouched } = await fixtures.service
        .from("goals")
        .select("notes")
        .eq("id", rsGoalId)
        .single();

      expect(untouched?.notes).toBeNull();
    });

    it("refuses the EQ president an insert into the Relief Society", async () => {
      const { error } = await eqPresident.from("goals").insert({
        ward_id: fixtures.wardAId,
        org_id: fixtures.reliefSocietyId,
        title: `smuggled ${fixtures.runId}`,
        desired_frequency_months: 6,
      });

      // INSERT is the one verb that raises on refusal.
      expect(error).not.toBeNull();
    });

    it("refuses the EQ president a delete of the Relief Society's goal", async () => {
      const { data, error } = await eqPresident
        .from("goals")
        .delete()
        .eq("id", rsGoalId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: survivor } = await fixtures.service
        .from("goals")
        .select("id")
        .eq("id", rsGoalId)
        .maybeSingle();

      expect(survivor?.id).toBe(rsGoalId);
    });
  });

  describe("a ward-level goal is bishopric-only", () => {
    // `org_id = current_org_id()` is never true when org_id is null, so this falls out of the
    // comparison rather than needing a clause of its own. Asserted because it is the one part of
    // the policy whose behaviour is not obvious from reading it.
    it("hides the null-org goal from the EQ president", async () => {
      const { data, error } = await eqPresident
        .from("goals")
        .select("id")
        .eq("id", wardLevelGoalId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("refuses the EQ president an insert with no organization", async () => {
      const { error } = await eqPresident.from("goals").insert({
        ward_id: fixtures.wardAId,
        org_id: null,
        title: `ward level by eq ${fixtures.runId}`,
        desired_frequency_months: 6,
      });

      expect(error).not.toBeNull();
    });
  });

  describe("cross-ward isolation", () => {
    it("hides ward B's goal from ward A's bishop", async () => {
      const { data, error } = await bishopA.from("goals").select("id").eq("id", wardBGoalId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("hides ward A's goals from ward B's bishop", async () => {
      const { data, error } = await bishopB
        .from("goals")
        .select("id")
        .in("id", [wardLevelGoalId, eqGoalId, rsGoalId]);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("refuses ward A's bishop a delete of ward B's goal", async () => {
      const { data, error } = await bishopA
        .from("goals")
        .delete()
        .eq("id", wardBGoalId)
        .select("id");

      expect(error).toBeNull();
      expect(data).toEqual([]);

      const { data: survivor } = await fixtures.service
        .from("goals")
        .select("id")
        .eq("id", wardBGoalId)
        .maybeSingle();

      expect(survivor?.id).toBe(wardBGoalId);
    });
  });
});
