// @vitest-environment node
//
// Migration 057c, asserted from the database rather than from the routes.
//
// ---------------------------------------------------------------------------
// THIS IS THE FIRST READ PHASE 8 NARROWS, AND THAT IS WHY THIS SUITE IS THE CENTREPIECE
// ---------------------------------------------------------------------------
// Migration 054 made youth activity coordination data ward-wide and CLAUDE.md records the rule:
// "do not re-propose making the read org-scoped for consistency — the asymmetry IS the feature."
// A pastoral follow-up note is not coordination data, so `activity_logs` alone gets Phase 7's
// shape: `is_bishopric() or logged_by = auth.uid() or activity_event_is_in_caller_org(event_id)
// or ward_allows_cross_org_visibility()`.
//
// FIVE THINGS THIS SUITE EXISTS FOR:
//
// 1. AN ORG LEADER READS THEIR OWN ORGANIZATION'S FOLLOW-UPS AND NOT ANOTHER'S. Without this the
//    narrowing could be an accident of the seed rather than a decision.
//
// 2. THE ABSENT-MEANS-WARD-WIDE BRANCH. A follow-up on an activity with `org_id` null is readable
//    by everybody, and that is the branch a careless policy loses — migration 057c uses a LEFT
//    JOIN and an explicit `profile.org_id is null` arm precisely because an inner join would hide
//    such a log from all but the bishopric.
//
// 3. DECISION 1's CONSEQUENCE, ASSERTED RATHER THAN DISCOVERED. `ward_council_member` is the role
//    most likely to have NO organization, and it is one of the two this module was built for. It
//    sees ward-wide follow-ups and its own, and nothing else. That is the price of the decision,
//    written down here so nobody "fixes" it with an `if (role = …)` branch.
//
// 4. BOTH SIDES OF THE WARD SETTING, as tests/rls/visit-cross-org.test.ts does. Turning cross-org
//    visibility on widens every follow-up; off narrows them again.
//
// 5. THE visits-d PARENT-SCOPE HOLE, IN ITS SECOND MODULE. `activity_logs` has no org_id at all,
//    so its scope is its EVENT'S — enforced on writes as well as reads, or an org leader could
//    file a follow-up against another organization's event.
//
// A REFUSED UPDATE OR DELETE IS A ZERO-ROW SUCCESS, NOT AN ERROR. Only INSERT raises. Every
// refusal below is asserted by RE-READING the row with the service client.
//
// The suite runs over the network against the shared hosted project, so it cleans up after itself
// and never assumes an empty table (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database, Json } from "@/types/database";

describe("activity log scoping", () => {
  let fixtures: Fixtures;

  let eqPresident: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;
  let bishop: SupabaseClient<Database>;
  let wardCouncilMember: SupabaseClient<Database>;

  let eqEventId: string;
  let rsEventId: string;
  let wardWideEventId: string;

  let eqLogId: string;
  let rsLogId: string;
  let wardWideLogId: string;
  // Written by the ward council member on the RELIEF SOCIETY's event — the "or logged_by =
  // auth.uid()" arm, which is the one that removes a whole class of "where did my note go".
  let ownLogInForeignOrgId: string;

  const readableLogIds = async (client: SupabaseClient<Database>): Promise<Set<string>> => {
    const { data, error } = await client.from("activity_logs").select("id");

    expect(error).toBeNull();
    return new Set((data ?? []).map((row) => row.id));
  };

  // The service client bypasses RLS, so this is the ground truth a refused write is measured
  // against. A zero-row UPDATE looks identical to a successful one from the caller's side.
  const storedNotes = async (logId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("activity_logs")
      .select("shared_notes")
      .eq("id", logId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.shared_notes ?? null;
  };

  const setCrossOrgVisibility = async (enabled: boolean): Promise<void> => {
    const { data, error } = await fixtures.service
      .from("wards")
      .select("settings")
      .eq("id", fixtures.wardAId)
      .single();
    if (error) throw new Error(error.message);

    // MERGED, never replaced. A settings write that overwrote the object would delete
    // role_access along with it (lib/ward/crossOrgVisibility.ts states the rule).
    const settings = { ...(data.settings as Record<string, unknown>) };
    settings.cross_org_visibility = enabled;

    const { error: writeError } = await fixtures.service
      .from("wards")
      .update({ settings: settings as Json })
      .eq("id", fixtures.wardAId);
    if (writeError) throw new Error(writeError.message);
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "rsPresident",
      "wardCouncilMember",
    ]);

    [eqPresident, rsPresident, bishop, wardCouncilMember] = await Promise.all([
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "rsPresident"),
      asRole(fixtures, "bishop"),
      asRole(fixtures, "wardCouncilMember"),
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

    // Three ownership shapes, so every read assertion has something to find AND something to not
    // find. The ward-wide one is the whole reason the policy has a LEFT JOIN.
    const { data: profiles, error: profileError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert([
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.eldersQuorumId,
          member_id: member.id,
          activity_name: `EQ basketball ${fixtures.runId}`,
          activity_type: "sport",
        },
        {
          ward_id: fixtures.wardAId,
          org_id: fixtures.reliefSocietyId,
          member_id: member.id,
          activity_name: `RS choir ${fixtures.runId}`,
          activity_type: "performance",
        },
        {
          ward_id: fixtures.wardAId,
          org_id: null,
          member_id: member.id,
          activity_name: `Ward-wide debate ${fixtures.runId}`,
          activity_type: "academic",
        },
      ])
      .select("id, org_id, activity_name");
    if (profileError) throw new Error(profileError.message);

    const profileFor = (orgId: string | null): string =>
      profiles.find((row) => row.org_id === orgId)!.id;

    const { data: events, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert([
        {
          ward_id: fixtures.wardAId,
          profile_id: profileFor(fixtures.eldersQuorumId),
          title: `EQ game ${fixtures.runId}`,
          event_type: "home",
          event_date: "2026-11-14T19:30:00-07:00",
          status: "upcoming",
        },
        {
          ward_id: fixtures.wardAId,
          profile_id: profileFor(fixtures.reliefSocietyId),
          title: `RS concert ${fixtures.runId}`,
          event_type: "home",
          event_date: "2026-11-15T19:30:00-07:00",
          status: "upcoming",
        },
        {
          ward_id: fixtures.wardAId,
          profile_id: profileFor(null),
          title: `Ward-wide final ${fixtures.runId}`,
          event_type: "home",
          event_date: "2026-11-16T19:30:00-07:00",
          status: "upcoming",
        },
      ])
      .select("id, profile_id");
    if (eventError) throw new Error(eventError.message);

    eqEventId = events.find((row) => row.profile_id === profileFor(fixtures.eldersQuorumId))!.id;
    rsEventId = events.find((row) => row.profile_id === profileFor(fixtures.reliefSocietyId))!.id;
    wardWideEventId = events.find((row) => row.profile_id === profileFor(null))!.id;

    const { data: logs, error: logError } = await fixtures.service
      .from("activity_logs")
      .insert([
        {
          ward_id: fixtures.wardAId,
          event_id: eqEventId,
          logged_by: fixtures.user("eqPresident").id,
          shared_notes: "EQ shared: they played well.",
        },
        {
          ward_id: fixtures.wardAId,
          event_id: rsEventId,
          logged_by: fixtures.user("rsPresident").id,
          shared_notes: "RS shared: the choir sang beautifully.",
        },
        {
          ward_id: fixtures.wardAId,
          event_id: wardWideEventId,
          logged_by: fixtures.user("bishop").id,
          shared_notes: "Ward-wide shared: a good turnout.",
        },
        {
          ward_id: fixtures.wardAId,
          event_id: rsEventId,
          logged_by: fixtures.user("wardCouncilMember").id,
          shared_notes: "Council member shared: I was there too.",
        },
      ])
      .select("id, event_id, logged_by");
    if (logError) throw new Error(logError.message);

    const logFor = (eventId: string, userId: string): string =>
      logs.find((row) => row.event_id === eventId && row.logged_by === userId)!.id;

    eqLogId = logFor(eqEventId, fixtures.user("eqPresident").id);
    rsLogId = logFor(rsEventId, fixtures.user("rsPresident").id);
    wardWideLogId = logFor(wardWideEventId, fixtures.user("bishop").id);
    ownLogInForeignOrgId = logFor(rsEventId, fixtures.user("wardCouncilMember").id);

    await setCrossOrgVisibility(false);
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  // ---------------------------------------------------------------------------
  // READS, WITH THE WARD SETTING OFF
  // ---------------------------------------------------------------------------
  describe("with cross-organization visibility off", () => {
    it("lets an org leader read their own organization's follow-ups", async () => {
      expect((await readableLogIds(eqPresident)).has(eqLogId)).toBe(true);
    });

    it("hides another organization's follow-up from an org leader", async () => {
      const readable = await readableLogIds(eqPresident);

      expect(readable.has(rsLogId)).toBe(false);
      expect(readable.has(ownLogInForeignOrgId)).toBe(false);
    });

    // THE ABSENT-MEANS-WARD-WIDE BRANCH. `profile.org_id is null` is an explicit arm of the
    // policy, and an inner join or a missing arm would hide this row from everybody but the
    // bishopric — the talks-d hole in its fourth place.
    it("lets an org leader read a follow-up on a WARD-WIDE activity", async () => {
      expect((await readableLogIds(eqPresident)).has(wardWideLogId)).toBe(true);
    });

    // ---------------------------------------------------------------------
    // DECISION 1's CONSEQUENCE, ASSERTED RATHER THAN DISCOVERED
    // ---------------------------------------------------------------------
    // A ward council member has NO organization. Under an org-scoped read they see the ward-wide
    // follow-up and their own, and nothing else. If that ever needs to change, the fix is a
    // product decision about the setting — never a role branch in a policy (CLAUDE.md rule 2).
    it("gives a ward council member with no organization the ward-wide follow-up and their own", async () => {
      const readable = await readableLogIds(wardCouncilMember);

      expect(readable.has(wardWideLogId)).toBe(true);
      expect(readable.has(ownLogInForeignOrgId)).toBe(true);
      expect(readable.has(eqLogId)).toBe(false);
      expect(readable.has(rsLogId)).toBe(false);
    });

    // `logged_by = auth.uid()` on the SELECT. A leader must be able to read back what they
    // themselves wrote, even about an organization they are not in — the assertion above covers
    // the ward council member; this one says it is the AUTHOR arm rather than the ward-wide one
    // doing the work, by using a reader whose organization is a third one.
    it("lets a reader see their own follow-up on another organization's event", async () => {
      expect((await readableLogIds(eqPresident)).has(ownLogInForeignOrgId)).toBe(false);
      expect((await readableLogIds(wardCouncilMember)).has(ownLogInForeignOrgId)).toBe(true);
    });

    it("lets the bishopric read every follow-up in the ward", async () => {
      const readable = await readableLogIds(bishop);

      expect(readable.has(eqLogId)).toBe(true);
      expect(readable.has(rsLogId)).toBe(true);
      expect(readable.has(wardWideLogId)).toBe(true);
      expect(readable.has(ownLogInForeignOrgId)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // BOTH SIDES OF THE SETTING, AS tests/rls/visit-cross-org.test.ts DOES
  // ---------------------------------------------------------------------------
  describe("the cross-organization visibility setting", () => {
    it("widens every follow-up when it is turned on", async () => {
      await setCrossOrgVisibility(true);

      const readable = await readableLogIds(eqPresident);

      expect(readable.has(rsLogId)).toBe(true);
      expect(readable.has(ownLogInForeignOrgId)).toBe(true);

      const councilReadable = await readableLogIds(wardCouncilMember);
      expect(councilReadable.has(eqLogId)).toBe(true);
      expect(councilReadable.has(rsLogId)).toBe(true);
    });

    // Wider READS do not widen a WRITE by one row. No write policy on this table mentions the
    // setting, in either direction — the same boundary migration 053 drew for visits.
    it("does not let one organization rewrite another's follow-up while it is on", async () => {
      const before = await storedNotes(rsLogId);

      const { error } = await eqPresident
        .from("activity_logs")
        .update({ shared_notes: `Hijacked ${fixtures.runId}` })
        .eq("id", rsLogId);

      // No error. That is the whole trap: the caller sees success and nothing happened.
      expect(error).toBeNull();
      expect(await storedNotes(rsLogId)).toBe(before);
    });

    it("narrows them again when it is turned off", async () => {
      await setCrossOrgVisibility(false);

      const readable = await readableLogIds(eqPresident);

      expect(readable.has(rsLogId)).toBe(false);
      expect(readable.has(eqLogId)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // WRITES — THE visits-d PARENT-SCOPE HOLE, IN ITS SECOND MODULE
  // ---------------------------------------------------------------------------
  describe("writing a follow-up", () => {
    it("lets an org leader file one on their own organization's event", async () => {
      const { data, error } = await eqPresident
        .from("activity_logs")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: wardWideEventId,
          logged_by: fixtures.user("eqPresident").id,
          shared_notes: `EQ on the ward-wide event ${fixtures.runId}`,
        })
        .select("id")
        .single();

      expect(error).toBeNull();

      await fixtures.service.from("activity_logs").delete().eq("id", data!.id);
    });

    // THE PARENT-SCOPE HOLE. `activity_logs` has no org_id of its own, so if the INSERT policy
    // did not resolve the event's organization an Elders Quorum president could file a follow-up
    // against a Relief Society game.
    it("refuses one against another organization's event", async () => {
      const { error } = await eqPresident.from("activity_logs").insert({
        ward_id: fixtures.wardAId,
        event_id: rsEventId,
        logged_by: fixtures.user("eqPresident").id,
        shared_notes: `Forged ${fixtures.runId}`,
      });

      // INSERT raises, unlike UPDATE and DELETE.
      expect(error).not.toBeNull();
    });

    // `logged_by = auth.uid()` WITH NO BISHOPRIC EXEMPTION. A follow-up is a personal account of
    // an event; one filed under somebody else's name is a record of something that did not
    // happen. The bishopric branch is on the PARENT-SCOPE half only.
    it("refuses a follow-up attributed to somebody else — even from the bishopric", async () => {
      const { error } = await bishop.from("activity_logs").insert({
        ward_id: fixtures.wardAId,
        event_id: eqEventId,
        logged_by: fixtures.user("eqPresident").id,
        shared_notes: `Impersonated ${fixtures.runId}`,
      });

      expect(error).not.toBeNull();
    });

    it("lets the bishopric file their OWN follow-up on any organization's event", async () => {
      const { data, error } = await bishop
        .from("activity_logs")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: rsEventId,
          logged_by: fixtures.user("bishop").id,
          shared_notes: `Bishop on an RS event ${fixtures.runId}`,
        })
        .select("id")
        .single();

      expect(error).toBeNull();

      await fixtures.service.from("activity_logs").delete().eq("id", data!.id);
    });

    // Migration 057a's `unique (event_id, logged_by)`. Without it a leader accumulates a row per
    // save and "my follow-up on this game" stops being a single row anybody can name.
    it("refuses a second follow-up from the same author on the same event", async () => {
      const { error } = await eqPresident.from("activity_logs").insert({
        ward_id: fixtures.wardAId,
        event_id: eqEventId,
        logged_by: fixtures.user("eqPresident").id,
        shared_notes: `Second ${fixtures.runId}`,
      });

      expect(error?.code).toBe("23505");
    });
  });

  // ---------------------------------------------------------------------------
  // REFUSALS ASSERTED BY RE-READING, BECAUSE A DENIED UPDATE IS A ZERO-ROW SUCCESS
  // ---------------------------------------------------------------------------
  describe("editing somebody else's follow-up", () => {
    it("lets the author change their own", async () => {
      const renamed = `EQ edited ${fixtures.runId}`;

      const { error } = await eqPresident
        .from("activity_logs")
        .update({ shared_notes: renamed })
        .eq("id", eqLogId);

      expect(error).toBeNull();
      expect(await storedNotes(eqLogId)).toBe(renamed);
    });

    // AN ORGANIZATION IS NOT A WAY IN. `activity_logs_update`'s USING clause is
    // `is_bishopric() or logged_by = auth.uid()` — the org arm is on the SELECT and nowhere else.
    // An org president may read their organization's follow-ups and may not rewrite one somebody
    // else wrote.
    it("does not let an org leader rewrite a colleague's follow-up on their own event", async () => {
      const { data: colleagueLog, error: seedError } = await fixtures.service
        .from("activity_logs")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: eqEventId,
          logged_by: fixtures.user("bishop").id,
          shared_notes: `Bishop wrote this ${fixtures.runId}`,
        })
        .select("id")
        .single();
      if (seedError) throw new Error(seedError.message);

      const before = await storedNotes(colleagueLog.id);

      const { error } = await eqPresident
        .from("activity_logs")
        .update({ shared_notes: `Taken over ${fixtures.runId}` })
        .eq("id", colleagueLog.id);

      expect(error).toBeNull();
      expect(await storedNotes(colleagueLog.id)).toBe(before);

      await fixtures.service.from("activity_logs").delete().eq("id", colleagueLog.id);
    });

    // THE BISHOPRIC MAY CLEAR A FLAG — they own the ward council agenda — which is what the
    // USING/WITH CHECK asymmetry is for.
    it("lets the bishopric clear a flag on somebody else's follow-up", async () => {
      await fixtures.service
        .from("activity_logs")
        .update({ flagged_for_ward_council: true })
        .eq("id", rsLogId);

      const { error } = await bishop
        .from("activity_logs")
        .update({ flagged_for_ward_council: false })
        .eq("id", rsLogId);

      expect(error).toBeNull();

      const { data } = await fixtures.service
        .from("activity_logs")
        .select("flagged_for_ward_council")
        .eq("id", rsLogId)
        .maybeSingle();

      expect(data?.flagged_for_ward_council).toBe(false);
    });

    // ---------------------------------------------------------------------
    // REATTRIBUTION, AND WHERE THAT GUARANTEE ACTUALLY LIVES
    // ---------------------------------------------------------------------
    // A NON-AUTHOR cannot reattribute, and the policy is what refuses it: an UPDATE whose WITH
    // CHECK fails DOES raise, unlike one refused by USING. Either way the stored value is what is
    // asserted.
    //
    // For the BISHOPRIC there is deliberately no policy assertion here, and 058's header argues
    // why at length: WITH CHECK sees only the row that WOULD RESULT, never the row that was, so
    // "this column may not change" is inexpressible in RLS. 057c tried it and the clause simply
    // locked the bishopric out of clearing a flag — the test above is what caught that.
    //
    // What holds it instead is the same thing that holds `visit_logs.recorded_by`, whose policy
    // pins nothing either: `updateActivityLogSchema` has no `loggedBy` field and
    // `updateActivityLog()` never assigns the column. tests/routes/youthLogs.test.ts asserts that
    // from the route's side, which is where it is true.
    it("does not let a non-author reattribute a follow-up to themselves", async () => {
      const { error } = await eqPresident
        .from("activity_logs")
        .update({ logged_by: fixtures.user("eqPresident").id })
        .eq("id", rsLogId);

      const { data } = await fixtures.service
        .from("activity_logs")
        .select("logged_by")
        .eq("id", rsLogId)
        .maybeSingle();

      expect(data?.logged_by).toBe(fixtures.user("rsPresident").id);
      expect(error === null || error.message.length > 0).toBe(true);
    });

    // The INSERT half of the same guarantee, and this one a policy CAN express — there is no old
    // row to compare against, so `logged_by = auth.uid()` with no bishopric exemption says exactly
    // what it means. Asserted again beside the update case so the contrast is readable.
    it("still refuses a follow-up CREATED under somebody else's name", async () => {
      const { error } = await bishop.from("activity_logs").insert({
        ward_id: fixtures.wardAId,
        event_id: wardWideEventId,
        logged_by: fixtures.user("rsPresident").id,
        shared_notes: `Created as somebody else ${fixtures.runId}`,
      });

      expect(error).not.toBeNull();
    });

    it("does not let an org leader delete a follow-up they did not write", async () => {
      const { error } = await rsPresident
        .from("activity_logs")
        .delete()
        .eq("id", wardWideLogId);

      expect(error).toBeNull();
      expect(await storedNotes(wardWideLogId)).not.toBeNull();
    });
  });
});
