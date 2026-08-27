// @vitest-environment node
//
// `cross-org-read` and `cross-org-write` (07-visits.md §Tests).
//
// The rule: cross-org visibility widens READS ONLY. With the ward setting on, an Elders Quorum
// leader reads the Relief Society's visit logs and their shared notes; they never gain the right
// to WRITE one, in either mode.
//
// ---------------------------------------------------------------------------
// WHICH TABLES IT WIDENS — ALL FOUR, AS OF MIGRATION 053
// ---------------------------------------------------------------------------
// `ward_allows_cross_org_visibility()` now appears in four SELECT policies, and this file is where
// every one of them is asserted on both sides of the setting, on one household:
//
//   WIDENED    visit_logs_select               (019) — what happened
//   WIDENED    household_stewardships_select   (052) — whose family it is
//   WIDENED    visit_goals_select              (053) — what interval they hold it to
//   WIDENED    household_visit_cadences_select (053) — the override on that interval
//
// ---------------------------------------------------------------------------
// THIS FILE RECORDS A REVERSAL, AND THE OLD SHAPE IS NAMED RATHER THAN DELETED
// ---------------------------------------------------------------------------
// Until 2026-08-27 the last two were pointedly NARROW, and the contrast between them and the
// first two was itself the decision — "facts are shared, judgements are not" (migration 050's
// header, ITER-019 D6). The assertions below used to prove that goals and cadences did NOT widen.
//
// They now prove the opposite, by a product decision taken after walking scenario 048: an org
// leader saw the other organizations' CHIPS on the all-organizations view but no BANDS, and the
// page had to explain per chip that the number was being withheld. A ward turning on
// "cross-organization visibility" is asking for that number.
//
// Written as an inversion rather than a rewrite so the change reads as a decision. If somebody
// later restores the narrow shape, these are the tests that will fail and this is the paragraph
// telling them what they are undoing.
//
// WHAT DID NOT MOVE: every WRITE policy, and visit_private_notes. Wider reads on shared work do
// not widen a private note by one row (CLAUDE.md rule 5), and the assertions proving both are
// unchanged below.
//
// And in BOTH modes, private notes do not move at all. Cross-org visibility is a setting about
// an organization's work; a private note was never the organization's (CLAUDE.md rule 5).
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

describe("visit cross-org visibility", () => {
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

  describe("with cross-org visibility ON", () => {
    beforeAll(async () => {
      await setCrossOrgVisibility(true);
    });

    it("shows the EQ president both visit logs", async () => {
      const ids = await readLogIds(eqPresident);

      expect(ids).toHaveLength(2);
      expect(ids).toContain(eqLogId);
      expect(ids).toContain(rsLogId);
    });

    it("shows the EQ president the RS shared notes", async () => {
      const { data, error } = await eqPresident
        .from("visit_logs")
        .select("shared_notes")
        .eq("id", rsLogId)
        .single();

      expect(error).toBeNull();
      expect(data?.shared_notes).toBe(RS_SHARED);
    });

    // REVERSED BY MIGRATION 053. This read "still shows the EQ president only their own visit
    // goal", and it was the recorded answer to an open question 07-visits.md §Integration Notes
    // handed to visits-b: with visibility on, a leader read another organization's logs but not
    // the goal supplying their denominator.
    //
    // The all-organizations view settled it the other way. A band is computed FROM a goal, so
    // withholding the goal meant showing a chip with no standing on it — which is not what a ward
    // asks for when it turns this setting on.
    it("shows the EQ president BOTH visit goals", async () => {
      const visible = await readGoalIds(eqPresident);

      expect(visible).toHaveLength(2);
      expect(visible).toContain(eqGoalId);
      expect(visible).toContain(rsGoalId);
    });

    // ALSO REVERSED BY MIGRATION 053, and this is the pair that used to carry migration 050's
    // reasoning: "the setting widens reads of visit REPORTS so a ward council can read what
    // happened; a cadence is a CONFIGURATION, not a report."
    //
    // THE CADENCE HAD TO FOLLOW THE GOAL, and would have been wrong to leave behind. A band
    // prefers the per-household override and falls back to the goal, so widening the goal alone
    // would have rendered a pill computed from the WRONG INTERVAL — the Elders Quorum's 3-month
    // override on one family reading as their 1-year goal, and the chip saying "on track" about a
    // family they consider overdue. A number that is visible and wrong is worse than one withheld.
    it("shows the EQ president BOTH household cadences", async () => {
      const visible = await readCadenceIds(eqPresident);

      expect(visible).toEqual([eqCadenceId, rsCadenceId].sort());
      expect(visible).toContain(rsCadenceId);
    });

    it("shows the RS president both as well", async () => {
      expect(await readCadenceIds(rsPresident)).toEqual([eqCadenceId, rsCadenceId].sort());
    });

    // The stewardship table, widened by migration 052 and now sitting alongside the goal and the
    // cadence rather than in contrast to them. All four say the same thing under this setting,
    // which is the point of the reversal: an organization's PROGRESS is one object, and handing a
    // reader three quarters of it was the state scenario 048 found unsatisfying.
    it("shows the EQ president BOTH organizations' stewardship claims", async () => {
      const visible = await readStewardshipIds(eqPresident);

      expect(visible).toHaveLength(2);
      expect(visible).toContain(eqStewardshipId);
      expect(visible).toContain(rsStewardshipId);
    });

    it("shows the RS president both as well", async () => {
      expect(await readStewardshipIds(rsPresident)).toEqual(
        [eqStewardshipId, rsStewardshipId].sort(),
      );
    });

    // THE READ WIDENS AND THE WRITE DOES NOT. Reading who has claimed a family is a fact anybody
    // on the ward council may need; claiming one on another organization's behalf is not, and no
    // write policy on this table mentions the setting at all.
    //
    // Written against a SPARE household with no existing claim, so the refusal below is the
    // POLICY refusing and not the unique constraint — a test that passed on the constraint would
    // keep passing after the policy was removed.
    it("still refuses the EQ president a stewardship claim for the RS", async () => {
      const { error } = await eqPresident.from("household_stewardships").insert({
        ward_id: wardId,
        household_id: spareHouseholdId,
        org_id: fixtures.reliefSocietyId,
      });

      expect(error).not.toBeNull();
    });

    // The positive control for the test above: the same insert, on the same spare household, for
    // the caller's OWN organization succeeds. Without it, the refusal would also pass against a
    // policy that refused everybody everything.
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

    // The line this whole slice exists to hold. Wider reads on shared work do not widen private
    // notes by even one row.
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
