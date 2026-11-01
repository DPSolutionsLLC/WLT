// @vitest-environment node
//
// THE WARD SWITCH NO LONGER WIDENS ANY VISIT TABLE — INVERTED BY MIGRATION 099 (ITER-055).
//
// This file used to prove that `cross_org_visibility` ON let an Elders Quorum leader read the
// Relief Society's visit logs, goals, cadences and stewardship. The user decided on 2026-10-31
// that each organization's visits are its own, shared ORGANIZATION BY ORGANIZATION by the
// bishopric (tests/rls/visit-org-sharing.test.ts proves that half). The switch survives for youth
// follow-ups only.
//
// So the ON block below now asserts the NARROW shape — the same reads, the same rows, one setting
// apart, and no difference. Written as an inversion rather than deleted, so the change reads as a
// decision: if somebody wires the switch back into a visit policy, these are the tests that fail
// and this is the paragraph telling them what they are undoing (053's reversal, reversed again).
//
// WHAT DID NOT MOVE: every WRITE policy, and visit_private_notes (CLAUDE.md rule 5).
//
// Everything negative is asserted with an AUTHENTICATED client. Asserting with the service-role
// client would prove nothing — it bypasses RLS entirely. And a refused UPDATE is a ZERO-ROW
// SUCCESS rather than an error (plans/retros/route-tests-and-realtime.md), so every write
// refusal below is proven by RE-READING the row with the service client afterwards.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const EQ_SHARED = "EQ shared: brought a meal round.";
const RS_SHARED = "RS shared: sister is recovering well.";
const EQ_PRIVATE = "EQ private: a confidence the family asked us to keep.";
const RS_PRIVATE = "RS private: a confidence the family asked us to keep.";

describe("the ward switch and visits", () => {
  let fixtures: Fixtures;
  let eqPresident: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;

  let wardId: string;
  let eqLogId: string;
  let rsLogId: string;
  let eqGoalId: string;
  let rsGoalId: string;
  let eqCadenceId: string;
  let rsCadenceId: string;
  let eqStewardshipId: string;
  let rsStewardshipId: string;
  // A household with NO claim on it, so a refused insert is the POLICY refusing rather than the
  // unique constraint.
  let spareHouseholdId: string;

  // Flipped with the service client between phases rather than reseeded, so both halves assert
  // against the SAME rows — which is what makes "the same query, one setting apart" a real
  // comparison rather than two unrelated fixtures.
  const setCrossOrgVisibility = async (enabled: boolean): Promise<void> => {
    const { error } = await fixtures.service
      .from("wards")
      .update({ settings: { cross_org_visibility: enabled, timezone: "America/Denver" } })
      .eq("id", wardId);

    if (error) throw new Error(error.message);
  };

  const readLogIds = async (client: SupabaseClient<Database>): Promise<string[]> => {
    // Ward-wide, with NO org filter. A filtered count would pass even if a permissive policy
    // had survived and was letting the other organization through (plans/retros/talks-d).
    const { data, error } = await client
      .from("visit_logs")
      .select("id")
      .eq("ward_id", wardId)
      .order("visit_date", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id);
  };

  // Ward-wide, with NO org filter — the same discipline as readGoalIds below. A filtered read
  // would pass even if the setting had started widening this table.
  const readCadenceIds = async (client: SupabaseClient<Database>): Promise<string[]> => {
    const { data, error } = await client
      .from("household_visit_cadences")
      .select("id")
      .eq("ward_id", wardId);

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id).sort();
  };

  // Shaped exactly like readCadenceIds — ward-wide, NO org filter — and that is what makes the
  // pair of them a real comparison. A filtered read here would pass even if the setting had
  // STOPPED widening this table, which is the regression this suite has to be able to see.
  const readStewardshipIds = async (client: SupabaseClient<Database>): Promise<string[]> => {
    const { data, error } = await client
      .from("household_stewardships")
      .select("id")
      .eq("ward_id", wardId);

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id).sort();
  };

  const readGoalIds = async (client: SupabaseClient<Database>): Promise<string[]> => {
    const { data, error } = await client
      .from("visit_goals")
      .select("id")
      .eq("ward_id", wardId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id);
  };

  const sharedNotesOf = async (logId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("visit_logs")
      .select("shared_notes")
      .eq("id", logId)
      .single();

    if (error) throw new Error(error.message);
    return data.shared_notes;
  };

  const goalTitleOf = async (goalId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("visit_goals")
      .select("title")
      .eq("id", goalId)
      .single();

    if (error) throw new Error(error.message);
    return data.title;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["eqPresident", "rsPresident"], {
      crossOrgVisibility: false,
    });
    wardId = fixtures.wardAId;

    eqPresident = await asRole(fixtures, "eqPresident");
    rsPresident = await asRole(fixtures, "rsPresident");

    const { data: logs, error: logError } = await fixtures.service
      .from("visit_logs")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          recorded_by: fixtures.user("eqPresident").id,
          visit_date: "2026-04-05",
          visit_type: "in_home",
          shared_notes: EQ_SHARED,
        },
        {
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          recorded_by: fixtures.user("rsPresident").id,
          visit_date: "2026-04-12",
          visit_type: "in_home",
          shared_notes: RS_SHARED,
        },
      ])
      .select("id, org_id");
    if (logError) throw new Error(logError.message);

    eqLogId = logs.find((row) => row.org_id === fixtures.eldersQuorumId)!.id;
    rsLogId = logs.find((row) => row.org_id === fixtures.reliefSocietyId)!.id;

    // Each president writes their OWN private note through their OWN authenticated client, so
    // the INSERT policy is exercised too rather than only SELECT.
    const { error: eqNoteError } = await eqPresident.from("visit_private_notes").insert({
      ward_id: wardId,
      visit_log_id: eqLogId,
      user_id: fixtures.user("eqPresident").id,
      notes: EQ_PRIVATE,
    });
    if (eqNoteError) throw new Error(eqNoteError.message);

    const { error: rsNoteError } = await rsPresident.from("visit_private_notes").insert({
      ward_id: wardId,
      visit_log_id: rsLogId,
      user_id: fixtures.user("rsPresident").id,
      notes: RS_PRIVATE,
    });
    if (rsNoteError) throw new Error(rsNoteError.message);

    const { data: goals, error: goalError } = await fixtures.service
      .from("visit_goals")
      .insert([
        {
          ward_id: wardId,
          org_id: fixtures.eldersQuorumId,
          title: "EQ goal",
          target_type: "all_households",
          cadence_amount: 1,
          cadence_unit: "year",
          notice_amount: 2,
          notice_unit: "month",
        },
        {
          ward_id: wardId,
          org_id: fixtures.reliefSocietyId,
          title: "RS goal",
          target_type: "all_households",
          cadence_amount: 1,
          cadence_unit: "year",
          notice_amount: 2,
          notice_unit: "month",
        },
      ])
      .select("id, org_id");
    if (goalError) throw new Error(goalError.message);

    eqGoalId = goals.find((row) => row.org_id === fixtures.eldersQuorumId)!.id;
    rsGoalId = goals.find((row) => row.org_id === fixtures.reliefSocietyId)!.id;

    // ONE household, with a per-organization cadence override from EACH organization. A new
    // table quietly riding along on a widened read is exactly the kind of thing that goes
    // unnoticed, so it is seeded into the suite that owns the widening.
    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: wardId, family_name: `Cross-org cadence ${fixtures.runId}` })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);

    const { data: cadences, error: cadenceError } = await fixtures.service
      .from("household_visit_cadences")
      .insert([
        {
          ward_id: wardId,
          household_id: household.id,
          org_id: fixtures.eldersQuorumId,
          cadence_amount: 3,
          cadence_unit: "month",
        },
        {
          ward_id: wardId,
          household_id: household.id,
          org_id: fixtures.reliefSocietyId,
          cadence_amount: 12,
          cadence_unit: "month",
        },
      ])
      .select("id, org_id");
    if (cadenceError) throw new Error(cadenceError.message);

    eqCadenceId = cadences.find((row) => row.org_id === fixtures.eldersQuorumId)!.id;
    rsCadenceId = cadences.find((row) => row.org_id === fixtures.reliefSocietyId)!.id;

    // The SAME household claimed by BOTH organizations, alongside the two cadence overrides
    // above. Seeding them onto one family is what lets the assertions below compare two tables
    // under one setting, one line apart — which is the whole point of putting the D6 contrast in
    // this file rather than in the new table's own suite.
    const { data: stewardships, error: stewardshipError } = await fixtures.service
      .from("household_stewardships")
      .insert([
        {
          ward_id: wardId,
          household_id: household.id,
          org_id: fixtures.eldersQuorumId,
        },
        {
          ward_id: wardId,
          household_id: household.id,
          org_id: fixtures.reliefSocietyId,
        },
      ])
      .select("id, org_id");
    if (stewardshipError) throw new Error(stewardshipError.message);

    eqStewardshipId = stewardships.find(
      (row) => row.org_id === fixtures.eldersQuorumId,
    )!.id;
    rsStewardshipId = stewardships.find(
      (row) => row.org_id === fixtures.reliefSocietyId,
    )!.id;

    const { data: spare, error: spareError } = await fixtures.service
      .from("households")
      .insert({ ward_id: wardId, family_name: `Cross-org spare ${fixtures.runId}` })
      .select("id")
      .single();
    if (spareError) throw new Error(spareError.message);

    spareHouseholdId = spare.id;
  }, 60_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("with cross-org visibility OFF", () => {
    beforeAll(async () => {
      await setCrossOrgVisibility(false);
    });

    it("shows the EQ president exactly one visit log across the whole ward", async () => {
      expect(await readLogIds(eqPresident)).toEqual([eqLogId]);
    });

    it("shows the EQ president only their own household cadence", async () => {
      expect(await readCadenceIds(eqPresident)).toEqual([eqCadenceId]);
    });

    it("shows the EQ president only their own stewardship claim", async () => {
      expect(await readStewardshipIds(eqPresident)).toEqual([eqStewardshipId]);
    });

    // THE OFF SIDE IS WHAT MAKES THE ON SIDE MEAN ANYTHING. Migration 053 widened four policies
    // for this setting and none of them unconditionally — with the setting off, every one of them
    // is back to `is_bishopric() or org_id = current_org_id()`. Without these, a policy that had
    // dropped the setting check entirely and simply let everybody read everything would pass every
    // assertion in the ON block below.
    it("shows the RS president only their own visit goal", async () => {
      expect(await readGoalIds(rsPresident)).toEqual([rsGoalId]);
    });

    it("shows the RS president only their own household cadence", async () => {
      expect(await readCadenceIds(rsPresident)).toEqual([rsCadenceId]);
    });

    it("shows the RS president only their own stewardship claim", async () => {
      expect(await readStewardshipIds(rsPresident)).toEqual([rsStewardshipId]);
    });

    it("shows the EQ president exactly one visit goal across the whole ward", async () => {
      expect(await readGoalIds(eqPresident)).toEqual([eqGoalId]);
    });

    it("hides the RS shared notes from the EQ president", async () => {
      const { data, error } = await eqPresident
        .from("visit_logs")
        .select("shared_notes")
        .eq("id", rsLogId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });
  });

  describe("with the ward switch ON — which no longer reaches visits", () => {
    beforeAll(async () => {
      await setCrossOrgVisibility(true);
    });

    it("still shows the EQ president exactly one visit log", async () => {
      expect(await readLogIds(eqPresident)).toEqual([eqLogId]);
    });

    it("still hides the RS shared notes from the EQ president", async () => {
      const { data, error } = await eqPresident
        .from("visit_logs")
        .select("shared_notes")
        .eq("id", rsLogId)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).toBeNull();
    });

    it("still shows the EQ president only their own visit goal", async () => {
      expect(await readGoalIds(eqPresident)).toEqual([eqGoalId]);
    });

    it("still shows the EQ president only their own household cadence", async () => {
      expect(await readCadenceIds(eqPresident)).toEqual([eqCadenceId]);
    });

    it("still shows the RS president only their own stewardship claim", async () => {
      expect(await readStewardshipIds(rsPresident)).toEqual([rsStewardshipId]);
    });

    it("still refuses the EQ president a stewardship claim for the RS", async () => {
      const { error } = await eqPresident.from("household_stewardships").insert({
        ward_id: wardId,
        household_id: spareHouseholdId,
        org_id: fixtures.reliefSocietyId,
      });

      expect(error).not.toBeNull();
    });

    it("still lets the EQ president claim that household for the EQ", async () => {
      const { data, error } = await eqPresident
        .from("household_stewardships")
        .insert({
          ward_id: wardId,
          household_id: spareHouseholdId,
          org_id: fixtures.eldersQuorumId,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();

      await fixtures.service.from("household_stewardships").delete().eq("id", data!.id);
    });

    it("still shows the EQ president no private note but their own", async () => {
      const { data, error } = await eqPresident
        .from("visit_private_notes")
        .select("visit_log_id, notes")
        .eq("ward_id", wardId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.visit_log_id).toBe(eqLogId);
      expect(JSON.stringify(data)).not.toContain(RS_PRIVATE);
    });
  });

  // Both modes, because the write refusal must not depend on the setting at all.
  describe.each([
    ["OFF", false],
    ["ON", true],
  ])("writes with cross-org visibility %s", (_label, enabled) => {
    beforeAll(async () => {
      await setCrossOrgVisibility(enabled);
    });

    it("raises when the EQ president inserts an RS visit log", async () => {
      const { error } = await eqPresident.from("visit_logs").insert({
        ward_id: wardId,
        org_id: fixtures.reliefSocietyId,
        visit_date: "2026-05-03",
        visit_type: "in_home",
        shared_notes: "should never exist",
      });

      // An INSERT is the one operation RLS refuses with an error rather than silently.
      expect(error).not.toBeNull();
    });

    it("changes nothing when the EQ president updates the RS visit log", async () => {
      const { error } = await eqPresident
        .from("visit_logs")
        .update({ shared_notes: "overwritten" })
        .eq("id", rsLogId);

      // Zero rows updated is a SUCCESS. The proof is the re-read, not the error.
      expect(error).toBeNull();
      expect(await sharedNotesOf(rsLogId)).toBe(RS_SHARED);
    });

    it("raises when the EQ president inserts an RS visit goal", async () => {
      const { error } = await eqPresident.from("visit_goals").insert({
        ward_id: wardId,
        org_id: fixtures.reliefSocietyId,
        title: "should never exist",
        target_type: "all_households",
        cadence_amount: 1,
        cadence_unit: "year",
        notice_amount: 2,
        notice_unit: "month",
      });

      expect(error).not.toBeNull();
    });

    it("changes nothing when the EQ president updates the RS visit goal", async () => {
      const { error } = await eqPresident
        .from("visit_goals")
        .update({ title: "overwritten" })
        .eq("id", rsGoalId);

      expect(error).toBeNull();
      expect(await goalTitleOf(rsGoalId)).toBe("RS goal");
    });
  });
});
