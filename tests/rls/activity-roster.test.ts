// @vitest-environment node
//
// Migration 062f's policies on `activity_roster`, asserted from the database rather than from the
// routes.
//
// ---------------------------------------------------------------------------
// THE FOUR THINGS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. WARD ISOLATION. Ward A cannot read or write ward B's roster rows. Everything else here is
//    about how WIDE the policy is inside one ward, so the boundary has to be pinned first.
//
// 2. READS ARE WARD-WIDE ACROSS ORGANIZATIONS. An Elders Quorum president reads a roster row on a
//    Young Women team. Without this case the ward-wide read could be an accident of the seed
//    rather than a decision, and the first person to "tidy up" the select policy would find every
//    test still green. (That sentence is youth-activity-scope.test.ts's own, and it applies here
//    verbatim.)
//
// 3. WRITES ARE WARD-WIDE **TOO**, and this is the one that will surprise a reader. It is the
//    deliberate opposite of `youth_activity_profiles`, whose writes migration 054d scopes to an
//    organization. A roster row hangs off a profile that ALREADY answers the organization
//    question, and migration 062f's header gives three reasons. So there is a case below asserting
//    a cross-organization write SUCCEEDS — a future narrowing then breaks a test rather than
//    silently removing the feature (youth-g's pattern).
//
// 4. THE CASCADE IMPROVEMENT IS PROVED, NOT ASSERTED IN A COMMENT. Migration 062a claims that
//    deleting a MEMBER now removes them from rosters and LEAVES THE TEAM, ITS EVENTS AND ITS
//    FOLLOW-UPS INTACT — where before youth-j it destroyed the whole season. That is the single
//    most valuable thing in this file, because it is a claim about what does NOT happen.
//
// A REFUSED UPDATE OR DELETE IS A ZERO-ROW SUCCESS, NOT AN ERROR. Only INSERT raises. Every
// refusal below is therefore asserted by RE-READING the row with the service client.
//
// The suite runs over the network against the shared hosted project, so it cleans up after itself
// and never assumes an empty table (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("activity roster scoping", () => {
  let fixtures: Fixtures;

  let eqPresident: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;
  let bishop: SupabaseClient<Database>;
  let wardBBishop: SupabaseClient<Database>;

  let wardAYouthId: string;
  let wardASecondYouthId: string;
  let wardBYouthId: string;

  let rsProfileId: string;
  let wardBProfileId: string;

  let rsRosterId: string;
  let wardBRosterId: string;

  const seedProfile = async (
    orgId: string | null,
    wardId: string,
    activityName: string,
  ): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: wardId,
        org_id: orgId,
        activity_name: `${activityName} ${fixtures.runId}`,
        activity_type: "sport",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return data.id;
  };

  const seedRoster = async (
    wardId: string,
    profileId: string,
    memberId: string,
  ): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("activity_roster")
      .insert({ ward_id: wardId, profile_id: profileId, member_id: memberId })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return data.id;
  };

  // The service client bypasses RLS, so this is the ground truth a refused write is measured
  // against. A zero-row UPDATE looks identical to a successful one from the caller's side.
  const storedEndedOn = async (rosterId: string): Promise<string | null | undefined> => {
    const { data, error } = await fixtures.service
      .from("activity_roster")
      .select("ended_on")
      .eq("id", rosterId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data === null ? undefined : data.ended_on;
  };

  const readableRosterIds = async (
    client: SupabaseClient<Database>,
  ): Promise<Set<string>> => {
    const { data, error } = await client.from("activity_roster").select("id");

    expect(error).toBeNull();
    return new Set((data ?? []).map((row) => row.id));
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "rsPresident", "wardBBishop"]);

    [eqPresident, rsPresident, bishop, wardBBishop] = await Promise.all([
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "rsPresident"),
      asRole(fixtures, "bishop"),
      asRole(fixtures, "wardBBishop"),
    ]);

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: fixtures.wardAId,
          first_name: "Ada",
          last_name: `RosterA${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: fixtures.wardAId,
          first_name: "Cal",
          last_name: `RosterC${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: fixtures.wardBId,
          first_name: "Bo",
          last_name: `RosterB${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
      ])
      .select("id, ward_id, first_name");

    if (memberError) throw new Error(memberError.message);

    wardAYouthId = members!.find((row) => row.first_name === "Ada")!.id;
    wardASecondYouthId = members!.find((row) => row.first_name === "Cal")!.id;
    wardBYouthId = members!.find((row) => row.first_name === "Bo")!.id;

    // OWNED BY THE RELIEF SOCIETY, so the Elders Quorum president below is genuinely reading and
    // writing ANOTHER organization's roster.
    rsProfileId = await seedProfile(fixtures.reliefSocietyId, fixtures.wardAId, "RS choir");
    wardBProfileId = await seedProfile(fixtures.wardBOrgId, fixtures.wardBId, "Ward B track");

    rsRosterId = await seedRoster(fixtures.wardAId, rsProfileId, wardAYouthId);
    wardBRosterId = await seedRoster(fixtures.wardBId, wardBProfileId, wardBYouthId);
  }, 60_000);

  afterAll(async () => {
    await fixtures.cleanup();
  });

  // ---------------------------------------------------------------------------
  // 1. WARD ISOLATION
  // ---------------------------------------------------------------------------
  describe("ward isolation", () => {
    it("hides another ward's roster rows", async () => {
      const readable = await readableRosterIds(bishop);

      expect(readable.has(rsRosterId)).toBe(true);
      expect(readable.has(wardBRosterId)).toBe(false);
    });

    it("hides ward A's roster rows from ward B", async () => {
      const readable = await readableRosterIds(wardBBishop);

      expect(readable.has(wardBRosterId)).toBe(true);
      expect(readable.has(rsRosterId)).toBe(false);
    });

    // ONLY INSERT RAISES, so this is the one refusal asserted on the error rather than by
    // re-reading.
    it("refuses an insert carrying another ward's id", async () => {
      const { error } = await eqPresident.from("activity_roster").insert({
        ward_id: fixtures.wardBId,
        profile_id: wardBProfileId,
        member_id: wardBYouthId,
      });

      expect(error).not.toBeNull();
    });

    it("cannot update another ward's roster row", async () => {
      const { error } = await eqPresident
        .from("activity_roster")
        .update({ ended_on: "2027-02-15" })
        .eq("id", wardBRosterId);

      // A ZERO-ROW SUCCESS, NOT AN ERROR. Asserting on `error` alone would pass against a policy
      // that permits everything, which is why the row is re-read below.
      expect(error).toBeNull();
      expect(await storedEndedOn(wardBRosterId)).toBeNull();
    });

    it("cannot delete another ward's roster row", async () => {
      const { error } = await eqPresident
        .from("activity_roster")
        .delete()
        .eq("id", wardBRosterId);

      expect(error).toBeNull();
      expect(await storedEndedOn(wardBRosterId)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // 2 AND 3. WARD-WIDE ACROSS ORGANIZATIONS, ON READS **AND** WRITES
  // ---------------------------------------------------------------------------
  // This block is the decision. If a later reader narrows either half to
  // `org_id = current_org_id()`, every one of these fails — which is the point.
  describe("across organizations, inside one ward", () => {
    it("lets an Elders Quorum president READ a Relief Society team's roster", async () => {
      const readable = await readableRosterIds(eqPresident);

      expect(readable.has(rsRosterId)).toBe(true);
    });

    // THE ONE THAT WILL SURPRISE A READER, AND IT IS DELIBERATE. Migration 062f's header gives
    // the three reasons; the shortest is that migration 061 already put this exact fact under
    // ward-wide writes, so moving it to a new table must move no boundary.
    it("lets an Elders Quorum president ADD to a Relief Society team's roster", async () => {
      const { data, error } = await eqPresident
        .from("activity_roster")
        .insert({
          ward_id: fixtures.wardAId,
          profile_id: rsProfileId,
          member_id: wardASecondYouthId,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();

      // Cleaned up here rather than left for the fixture teardown, so the cascade block below
      // starts from a known roster.
      await fixtures.service.from("activity_roster").delete().eq("id", data!.id);
    });

    it("lets a Relief Society president record that a youth LEFT their own team", async () => {
      const { error } = await rsPresident
        .from("activity_roster")
        .update({ ended_on: "2027-02-15" })
        .eq("id", rsRosterId);

      expect(error).toBeNull();
      expect(await storedEndedOn(rsRosterId)).toBe("2027-02-15");

      // Put back, so the ward-isolation assertions above stay true if the file is re-run.
      await fixtures.service
        .from("activity_roster")
        .update({ ended_on: null })
        .eq("id", rsRosterId);
    });

    // THE UNIQUE INDEX, from the database side. Migration 062a's index is what stops a double tap
    // on a slow phone doubling a young person in every denominator on /youth — and it needs no
    // `nulls not distinct`, because both its columns are `not null`.
    it("refuses a second row for the same (team, young person)", async () => {
      const { error } = await bishop.from("activity_roster").insert({
        ward_id: fixtures.wardAId,
        profile_id: rsProfileId,
        member_id: wardAYouthId,
      });

      expect(error?.code).toBe("23505");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. THE CASCADE IMPROVEMENT — PROVED RATHER THAN CLAIMED
  // ---------------------------------------------------------------------------
  // BEFORE youth-j, `youth_activity_profiles.member_id` carried `on delete cascade` to `members`,
  // so deleting a member deleted their whole profile: the season, its events, its sign-ups and
  // its follow-ups. Migration 062a moves that cascade onto the roster row, so a ward that loses
  // one player keeps the team's schedule.
  //
  // THE ASSERTION IS ABOUT WHAT SURVIVES, which is the half a comment cannot be trusted for.
  describe("deleting a member", () => {
    it("removes their roster row and LEAVES the team, its events and its follow-ups", async () => {
      const profileId = await seedProfile(
        fixtures.reliefSocietyId,
        fixtures.wardAId,
        "Cascade choir",
      );

      const { data: member, error: memberError } = await fixtures.service
        .from("members")
        .insert({
          ward_id: fixtures.wardAId,
          first_name: "Del",
          last_name: `Cascade${fixtures.runId}`,
          category: "youth",
          status: "active",
        })
        .select("id")
        .single();
      if (memberError) throw new Error(memberError.message);

      const rosterId = await seedRoster(fixtures.wardAId, profileId, member.id);

      const { data: event, error: eventError } = await fixtures.service
        .from("activity_events")
        .insert({
          ward_id: fixtures.wardAId,
          profile_id: profileId,
          title: `Cascade concert ${fixtures.runId}`,
          event_date: "2027-01-16T02:30:00.000Z",
          event_type: "home",
          status: "upcoming",
        })
        .select("id")
        .single();
      if (eventError) throw new Error(eventError.message);

      // A PASTORAL RECORD hanging off the event — the thing youth-h narrowed `Remove` to protect,
      // and the thing this cascade must not touch.
      const { data: log, error: logError } = await fixtures.service
        .from("activity_logs")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: event.id,
          logged_by: fixtures.user("rsPresident").id,
          shared_notes: "They sang beautifully.",
        })
        .select("id")
        .single();
      if (logError) throw new Error(logError.message);

      // A participation marker, which SHOULD go — it is a marker about this member and nothing
      // else (migration 062d).
      const { error: participationError } = await fixtures.service
        .from("activity_event_participation")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: event.id,
          member_id: member.id,
          taking_part: false,
        });
      if (participationError) throw new Error(participationError.message);

      const { error: deleteError } = await fixtures.service
        .from("members")
        .delete()
        .eq("id", member.id);
      expect(deleteError).toBeNull();

      // GONE: the roster row and the participation marker.
      const { data: rosterAfter } = await fixtures.service
        .from("activity_roster")
        .select("id")
        .eq("id", rosterId)
        .maybeSingle();
      expect(rosterAfter).toBeNull();

      const { data: participationAfter } = await fixtures.service
        .from("activity_event_participation")
        .select("id")
        .eq("event_id", event.id);
      expect(participationAfter).toEqual([]);

      // SURVIVING: the team, its event, and the follow-up somebody wrote. This is the whole
      // improvement, and before youth-j all three would have been destroyed.
      const { data: profileAfter } = await fixtures.service
        .from("youth_activity_profiles")
        .select("id")
        .eq("id", profileId)
        .maybeSingle();
      expect(profileAfter?.id).toBe(profileId);

      const { data: eventAfter } = await fixtures.service
        .from("activity_events")
        .select("id")
        .eq("id", event.id)
        .maybeSingle();
      expect(eventAfter?.id).toBe(event.id);

      const { data: logAfter } = await fixtures.service
        .from("activity_logs")
        .select("id")
        .eq("id", log.id)
        .maybeSingle();
      expect(logAfter?.id).toBe(log.id);
    });
  });

  // Deleting a PROFILE still cascades to its roster, and that is correct rather than an
  // inconsistency: a roster row has no meaning without the team it is a roster for. It is the
  // MEMBER direction that changed.
  describe("deleting a team", () => {
    it("cascades to its roster rows", async () => {
      const profileId = await seedProfile(
        fixtures.reliefSocietyId,
        fixtures.wardAId,
        "Doomed squad",
      );
      const rosterId = await seedRoster(fixtures.wardAId, profileId, wardAYouthId);

      await fixtures.service.from("youth_activity_profiles").delete().eq("id", profileId);

      const { data } = await fixtures.service
        .from("activity_roster")
        .select("id")
        .eq("id", rosterId)
        .maybeSingle();

      expect(data).toBeNull();
    });
  });
});
