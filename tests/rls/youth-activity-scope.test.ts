// @vitest-environment node
//
// Migration 054's read/write asymmetry, asserted from the database rather than from the routes.
//
// ---------------------------------------------------------------------------
// THE FOUR THINGS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. READS ARE WARD-WIDE ACROSS ORGANIZATIONS. An Elders Quorum president reads a profile owned
//    by the Young Women. Without this case the asymmetry could be an accident of the seed rather
//    than a decision, and the first person to "tidy up" the select policy would find every test
//    still green.
//
// 2. WRITES ARE NOT. The same president cannot insert a profile carrying another organization's
//    org_id, and cannot update or delete one.
//
// 3. THE talks-d HOLE IS CLOSED. A user with `org_id = null` inserts a ward-wide profile AND
//    READS IT BACK. `org_id = current_org_id()` is NULL, not true, when both sides are null, so
//    without the explicit `org_id is null` branch the INSERT succeeds and only the subsequent
//    read is empty — the bug ships silently and looks like a UI fault.
//
// 4. A REFUSED UPDATE OR DELETE IS A ZERO-ROW SUCCESS, NOT AN ERROR. Only INSERT raises. Every
//    refusal below is therefore asserted by RE-READING the row with the service client; asserting
//    on `error` alone would pass against a policy that permits everything.
//
// The suite runs over the network against the shared hosted project, so it cleans up after itself
// and never assumes an empty table (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("youth activity profile scoping", () => {
  let fixtures: Fixtures;

  let eqPresident: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;
  let bishop: SupabaseClient<Database>;
  let wardCouncilMember: SupabaseClient<Database>;
  let wardBBishop: SupabaseClient<Database>;

  let wardAYouthId: string;
  let wardBYouthId: string;

  // One profile per ownership shape, so every read assertion has something to find and something
  // to not find.
  let eqProfileId: string;
  let rsProfileId: string;
  let wardWideProfileId: string;
  let wardBProfileId: string;
  let eqEventId: string;
  let wardBEventId: string;
  let eqCalendarId: string;
  let wardBCalendarId: string;

  const seedProfile = async (
    orgId: string | null,
    wardId: string,
    memberId: string,
    activityName: string,
    enteredBy?: string,
  ): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: wardId,
        org_id: orgId,
        activity_name: `${activityName} ${fixtures.runId}`,
        activity_type: "sport",
        entered_by: enteredBy ?? null,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    // A TEAM OF ONE — the shape migration 062b backfilled onto every profile that already
    // existed, so these fixtures describe exactly the wards they described before youth-j and
    // this suite's four stated purposes are unchanged. `member_id` is gone from the profile
    // (migration 063); who is on a team lives in `activity_roster`.
    const { error: rosterError } = await fixtures.service.from("activity_roster").insert({
      ward_id: wardId,
      profile_id: data.id,
      member_id: memberId,
      added_by: enteredBy ?? null,
    });

    if (rosterError) throw new Error(rosterError.message);

    return data.id;
  };

  // The service client bypasses RLS, so this is the ground truth a refused write is measured
  // against. A zero-row UPDATE looks identical to a successful one from the caller's side.
  const storedName = async (profileId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .select("activity_name")
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.activity_name ?? null;
  };

  const readableProfileIds = async (
    client: SupabaseClient<Database>,
  ): Promise<Set<string>> => {
    const { data, error } = await client.from("youth_activity_profiles").select("id");

    expect(error).toBeNull();
    return new Set((data ?? []).map((row) => row.id));
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "rsPresident",
      "wardCouncilMember",
      "wardBBishop",
    ]);

    [eqPresident, rsPresident, bishop, wardCouncilMember, wardBBishop] = await Promise.all([
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "rsPresident"),
      asRole(fixtures, "bishop"),
      asRole(fixtures, "wardCouncilMember"),
      asRole(fixtures, "wardBBishop"),
    ]);

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: fixtures.wardAId,
          first_name: "Ada",
          last_name: `YouthA${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: fixtures.wardBId,
          first_name: "Bo",
          last_name: `YouthB${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
      ])
      .select("id, ward_id");
    if (memberError) throw new Error(memberError.message);

    wardAYouthId = members!.find((row) => row.ward_id === fixtures.wardAId)!.id;
    wardBYouthId = members!.find((row) => row.ward_id === fixtures.wardBId)!.id;

    eqProfileId = await seedProfile(
      fixtures.eldersQuorumId,
      fixtures.wardAId,
      wardAYouthId,
      "EQ basketball",
    );
    rsProfileId = await seedProfile(
      fixtures.reliefSocietyId,
      fixtures.wardAId,
      wardAYouthId,
      "RS choir",
    );
    wardWideProfileId = await seedProfile(
      null,
      fixtures.wardAId,
      wardAYouthId,
      "Ward-wide debate",
      fixtures.user("wardCouncilMember").id,
    );
    wardBProfileId = await seedProfile(
      fixtures.wardBOrgId,
      fixtures.wardBId,
      wardBYouthId,
      "Ward B track",
    );

    const { data: events, error: eventError } = await fixtures.service
      .from("activity_events")
      .insert([
        {
          ward_id: fixtures.wardAId,
          profile_id: eqProfileId,
          title: `EQ game ${fixtures.runId}`,
          event_type: "home",
          event_date: "2026-11-14T19:30:00-07:00",
          status: "upcoming",
        },
        {
          ward_id: fixtures.wardBId,
          profile_id: wardBProfileId,
          title: `Ward B meet ${fixtures.runId}`,
          event_type: "away",
          event_date: "2026-11-15T09:00:00-07:00",
          status: "upcoming",
        },
      ])
      .select("id, ward_id");
    if (eventError) throw new Error(eventError.message);

    eqEventId = events!.find((row) => row.ward_id === fixtures.wardAId)!.id;
    wardBEventId = events!.find((row) => row.ward_id === fixtures.wardBId)!.id;

    const { data: calendars, error: calendarError } = await fixtures.service
      .from("activity_calendars")
      .insert([
        {
          ward_id: fixtures.wardAId,
          profile_id: eqProfileId,
          source_type: "ics_upload",
          source_url: null,
          last_synced_at: "2026-08-27T00:00:00Z",
        },
        {
          ward_id: fixtures.wardBId,
          profile_id: wardBProfileId,
          source_type: "ics_upload",
          source_url: null,
          last_synced_at: "2026-08-27T00:00:00Z",
        },
      ])
      .select("id, ward_id");
    if (calendarError) throw new Error(calendarError.message);

    eqCalendarId = calendars!.find((row) => row.ward_id === fixtures.wardAId)!.id;
    wardBCalendarId = calendars!.find((row) => row.ward_id === fixtures.wardBId)!.id;
  }, 180_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("wards do not leak into each other", () => {
    it("hides ward B's profile from every ward A account", async () => {
      for (const client of [eqPresident, bishop, wardCouncilMember]) {
        expect(await readableProfileIds(client)).not.toContain(wardBProfileId);
      }
    });

    it("hides ward A's profiles from ward B's bishop", async () => {
      const readable = await readableProfileIds(wardBBishop);

      expect(readable.has(eqProfileId)).toBe(false);
      expect(readable.has(wardWideProfileId)).toBe(false);
    });

    it("refuses an insert into another ward", async () => {
      const { error } = await eqPresident.from("youth_activity_profiles").insert({
        ward_id: fixtures.wardBId,
        member_id: wardBYouthId,
        activity_name: `Forged ${fixtures.runId}`,
        activity_type: "sport",
      });

      expect(error).not.toBeNull();
    });

    it("hides ward B's events from ward A", async () => {
      const { data, error } = await eqPresident
        .from("activity_events")
        .select("id")
        .eq("id", wardBEventId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("hides ward B's schedule feed from ward A", async () => {
      const { data, error } = await eqPresident
        .from("activity_calendars")
        .select("id")
        .eq("id", wardBCalendarId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("hides ward A's schedule feed from ward B's bishop", async () => {
      const { data, error } = await wardBBishop
        .from("activity_calendars")
        .select("id")
        .eq("id", eqCalendarId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // activity_calendars — MIGRATION 019's WARD-WIDE POLICIES, ON PURPOSE (migration 055c)
  // ---------------------------------------------------------------------------
  // A calendar hangs off a profile exactly as an event does, so its organization is already
  // answered once, on the profile. Narrowing it here would put a second copy of that answer where
  // it could disagree with the first — and would achieve nothing anyway, since the same leader
  // could create the same events one at a time through POST /api/youth/events.
  //
  // THE POSITIVE ASSERTIONS ARE THE POINT. Asserting only that ward B is hidden would leave a
  // later narrowing free to happen silently; asserting that a Relief Society president CAN reach
  // an Elders Quorum calendar means a narrowing has to break a test rather than quietly change
  // behaviour, and whoever breaks it has to write down why.
  describe("a schedule feed is ward-wide within its ward", () => {
    it("lets another organization's president read it", async () => {
      const { data, error } = await rsPresident
        .from("activity_calendars")
        .select("id, profile_id, source_type")
        .eq("id", eqCalendarId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([eqCalendarId]);
    });

    it("lets a ward council member with no organization read it", async () => {
      const { data, error } = await wardCouncilMember
        .from("activity_calendars")
        .select("id")
        .eq("id", eqCalendarId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([eqCalendarId]);
    });

    it("lets another organization's president stamp it", async () => {
      const stamped = "2026-09-01T12:00:00+00:00";

      const { error } = await rsPresident
        .from("activity_calendars")
        .update({ last_synced_at: stamped })
        .eq("id", eqCalendarId);

      expect(error).toBeNull();

      // Re-read with the service client. A refused UPDATE is a zero-row SUCCESS, so asserting on
      // `error` alone would pass against a policy that refused everything.
      const { data } = await fixtures.service
        .from("activity_calendars")
        .select("last_synced_at")
        .eq("id", eqCalendarId)
        .maybeSingle();

      expect(new Date(data!.last_synced_at!).toISOString()).toBe(
        new Date(stamped).toISOString(),
      );
    });

    it("refuses an insert into another ward", async () => {
      const { error } = await eqPresident.from("activity_calendars").insert({
        ward_id: fixtures.wardBId,
        profile_id: wardBProfileId,
        source_type: "ics_upload",
      });

      // Only INSERT raises. The two refusals above had to be re-read instead.
      expect(error).not.toBeNull();
    });

    it("refuses a calendar pointing at another ward's profile", async () => {
      const { error } = await eqPresident.from("activity_calendars").insert({
        ward_id: fixtures.wardAId,
        profile_id: wardBProfileId,
        source_type: "ics_upload",
      });

      // The composite foreign key (profile_id, ward_id) is what refuses this, before any policy
      // has to. Belt and braces, and it is the constraint slice B's route relies on rather than
      // re-checking.
      expect(error).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // THE ASYMMETRY, WHICH IS THE WHOLE POINT OF MIGRATION 054
  // ---------------------------------------------------------------------------
  describe("reads are ward-wide across organizations", () => {
    it("lets an Elders Quorum president read a Young-Women-shaped profile owned elsewhere", async () => {
      const readable = await readableProfileIds(eqPresident);

      expect(readable.has(rsProfileId)).toBe(true);
      expect(readable.has(wardWideProfileId)).toBe(true);
      expect(readable.has(eqProfileId)).toBe(true);
    });

    it("lets a ward council member with no organization read every profile in the ward", async () => {
      const readable = await readableProfileIds(wardCouncilMember);

      expect(readable.has(eqProfileId)).toBe(true);
      expect(readable.has(rsProfileId)).toBe(true);
      expect(readable.has(wardWideProfileId)).toBe(true);
    });

    it("lets an org leader read another organization's events", async () => {
      const { data, error } = await rsPresident
        .from("activity_events")
        .select("id")
        .eq("id", eqEventId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([eqEventId]);
    });
  });

  // ---------------------------------------------------------------------------
  // WHAT SLICE D DID **NOT** NARROW, ASSERTED NEXT TO WHAT IT DID
  // ---------------------------------------------------------------------------
  // Migration 057 gave `activity_logs` an org-scoped SELECT — the first read Phase 8 narrows, and
  // tests/rls/activity-logs.test.ts is where that is proved. These three tables were left ALONE,
  // and the whole value of asserting it is that it sits beside the narrowing rather than in a file
  // of its own.
  //
  // Each has its own reason, and none of them is "we forgot":
  //   youth_activity_profiles  FEATURES.md §Module 10 gives the ward council the FULL calendar.
  //   activity_events          an event inherits its organization through its profile.
  //   activity_attendees       LOAD-BEARING. Coverage is computed from an attendee COUNT, so a
  //                            narrower read would make the same event read covered to one leader
  //                            and uncovered to another from the same data (migration 056c).
  //
  // Read as an ORG LEADER whose organization owns none of it, with cross-org visibility OFF —
  // which is the state in which a follow-up on the same event would be hidden.
  describe("slice D narrowed the follow-up log and nothing else", () => {
    it("still lets another organization's president read a profile", async () => {
      expect((await readableProfileIds(rsPresident)).has(eqProfileId)).toBe(true);
    });

    it("still lets another organization's president read an event", async () => {
      const { data, error } = await rsPresident
        .from("activity_events")
        .select("id")
        .eq("id", eqEventId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([eqEventId]);
    });

    it("still lets another organization's president read an attendee row", async () => {
      const { data: attendee, error: seedError } = await fixtures.service
        .from("activity_attendees")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: eqEventId,
          user_id: fixtures.user("bishop").id,
          assigned_by: null,
        })
        .select("id")
        .single();
      if (seedError) throw new Error(seedError.message);

      const { data, error } = await rsPresident
        .from("activity_attendees")
        .select("id")
        .eq("id", attendee.id);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([attendee.id]);

      await fixtures.service.from("activity_attendees").delete().eq("id", attendee.id);
    });

    // THE CONTRAST, IN ONE TEST. The same reader, the same event, the same instant: the event is
    // visible and the follow-up on it is not. If a later change widens `activity_logs` back, this
    // fails here as well as in tests/rls/activity-logs.test.ts, and whoever does it has to write
    // down why.
    it("hides a follow-up on that same visible event", async () => {
      const { data: log, error: seedError } = await fixtures.service
        .from("activity_logs")
        .insert({
          ward_id: fixtures.wardAId,
          event_id: eqEventId,
          logged_by: fixtures.user("bishop").id,
          shared_notes: `EQ follow-up ${fixtures.runId}`,
        })
        .select("id")
        .single();
      if (seedError) throw new Error(seedError.message);

      const { data, error } = await rsPresident
        .from("activity_logs")
        .select("id")
        .eq("id", log.id);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);

      await fixtures.service.from("activity_logs").delete().eq("id", log.id);
    });
  });

  describe("writes are scoped to the author's organization", () => {
    it("refuses an insert carrying another organization's org_id", async () => {
      const { error } = await eqPresident.from("youth_activity_profiles").insert({
        ward_id: fixtures.wardAId,
        org_id: fixtures.reliefSocietyId,
        member_id: wardAYouthId,
        activity_name: `Forged RS ${fixtures.runId}`,
        activity_type: "sport",
      });

      expect(error).not.toBeNull();
    });

    it("allows an insert carrying the author's own org_id", async () => {
      const { data, error } = await eqPresident
        .from("youth_activity_profiles")
        .insert({
          ward_id: fixtures.wardAId,
          org_id: fixtures.eldersQuorumId,
          member_id: wardAYouthId,
          activity_name: `Own org ${fixtures.runId}`,
          activity_type: "sport",
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();

      await fixtures.service.from("youth_activity_profiles").delete().eq("id", data!.id);
    });

    // A ward-wide profile is a legitimate state, not a hole — which is exactly why the branch has
    // to be explicit rather than inherited from the org comparison.
    it("allows an org leader to insert a ward-wide profile", async () => {
      const { data, error } = await eqPresident
        .from("youth_activity_profiles")
        .insert({
          ward_id: fixtures.wardAId,
          org_id: null,
          member_id: wardAYouthId,
          activity_name: `Ward wide by EQ ${fixtures.runId}`,
          activity_type: "community",
        })
        .select("id")
        .single();

      expect(error).toBeNull();

      await fixtures.service.from("youth_activity_profiles").delete().eq("id", data!.id);
    });

    it("lets the bishopric insert for any organization", async () => {
      const { data, error } = await bishop
        .from("youth_activity_profiles")
        .insert({
          ward_id: fixtures.wardAId,
          org_id: fixtures.reliefSocietyId,
          member_id: wardAYouthId,
          activity_name: `Bishop for RS ${fixtures.runId}`,
          activity_type: "performance",
        })
        .select("id")
        .single();

      expect(error).toBeNull();

      await fixtures.service.from("youth_activity_profiles").delete().eq("id", data!.id);
    });
  });

  // ---------------------------------------------------------------------------
  // THE talks-d HOLE, SEEN FROM BOTH SIDES
  // ---------------------------------------------------------------------------
  // The INSERT succeeding is half the assertion and the useless half. Without the second read,
  // this test passes against the exact policy that made a visit goal invisible to its own author.
  describe("a user with no organization can write a ward-wide profile and read it back", () => {
    it("writes and then finds it", async () => {
      const { data, error } = await wardCouncilMember
        .from("youth_activity_profiles")
        .insert({
          ward_id: fixtures.wardAId,
          org_id: null,
          member_id: wardAYouthId,
          activity_name: `Council entered ${fixtures.runId}`,
          activity_type: "academic",
        })
        .select("id")
        .single();

      expect(error).toBeNull();

      const { data: readBack, error: readError } = await wardCouncilMember
        .from("youth_activity_profiles")
        .select("id")
        .eq("id", data!.id);

      expect(readError).toBeNull();
      expect(readBack?.map((row) => row.id)).toEqual([data!.id]);

      await fixtures.service.from("youth_activity_profiles").delete().eq("id", data!.id);
    });
  });

  // ---------------------------------------------------------------------------
  // REFUSALS ASSERTED BY RE-READING, BECAUSE A DENIED UPDATE IS A ZERO-ROW SUCCESS
  // ---------------------------------------------------------------------------
  describe("updating and deleting somebody else's profile", () => {
    it("does not change a Relief Society profile when an Elders Quorum president tries", async () => {
      const before = await storedName(rsProfileId);

      const { error } = await eqPresident
        .from("youth_activity_profiles")
        .update({ activity_name: `Hijacked ${fixtures.runId}` })
        .eq("id", rsProfileId);

      // No error. That is the whole trap: the caller sees success and nothing happened.
      expect(error).toBeNull();
      expect(await storedName(rsProfileId)).toBe(before);
    });

    it("does not delete a Relief Society profile when an Elders Quorum president tries", async () => {
      const { error } = await eqPresident
        .from("youth_activity_profiles")
        .delete()
        .eq("id", rsProfileId);

      expect(error).toBeNull();
      expect(await storedName(rsProfileId)).not.toBeNull();
    });

    it("does not let a non-creator change somebody else's ward-wide profile", async () => {
      const before = await storedName(wardWideProfileId);

      const { error } = await eqPresident
        .from("youth_activity_profiles")
        .update({ activity_name: `Taken over ${fixtures.runId}` })
        .eq("id", wardWideProfileId);

      expect(error).toBeNull();
      expect(await storedName(wardWideProfileId)).toBe(before);
    });

    // `entered_by = auth.uid()` in the USING clause, which is 08-youth-activities.md's rule in
    // full: "Creator, bishopric, or the youth's org leaders."
    it("lets the creator change their own ward-wide profile", async () => {
      const renamed = `Council renamed ${fixtures.runId}`;

      const { error } = await wardCouncilMember
        .from("youth_activity_profiles")
        .update({ activity_name: renamed })
        .eq("id", wardWideProfileId);

      expect(error).toBeNull();
      expect(await storedName(wardWideProfileId)).toBe(renamed);
    });

    // The WITH CHECK deliberately omits `entered_by`: you may edit your own ward-wide profile,
    // but you may not hand it to an organization that never agreed to own it.
    it("does not let the creator move their ward-wide profile into another organization", async () => {
      const { error } = await wardCouncilMember
        .from("youth_activity_profiles")
        .update({ org_id: fixtures.reliefSocietyId })
        .eq("id", wardWideProfileId);

      const { data } = await fixtures.service
        .from("youth_activity_profiles")
        .select("org_id")
        .eq("id", wardWideProfileId)
        .maybeSingle();

      // An UPDATE whose WITH CHECK fails DOES raise, unlike one refused by USING — the row was
      // reachable and the resulting row was not permitted. Either way the stored value is what
      // is asserted.
      expect(data?.org_id ?? null).toBeNull();
      expect(error === null || error.message.length > 0).toBe(true);
    });

    it("lets the bishopric change any organization's profile", async () => {
      const renamed = `Bishop renamed ${fixtures.runId}`;

      const { error } = await bishop
        .from("youth_activity_profiles")
        .update({ activity_name: renamed })
        .eq("id", rsProfileId);

      expect(error).toBeNull();
      expect(await storedName(rsProfileId)).toBe(renamed);
    });

    it("lets the owning organization change its own profile", async () => {
      const renamed = `RS renamed ${fixtures.runId}`;

      const { error } = await rsPresident
        .from("youth_activity_profiles")
        .update({ activity_name: renamed })
        .eq("id", rsProfileId);

      expect(error).toBeNull();
      expect(await storedName(rsProfileId)).toBe(renamed);
    });
  });

  // Events inherit their organization through the profile and keep migration 019's ward-wide
  // policies. Pinned so a later slice that assumes events are org-scoped fails here rather than
  // in production.
  describe("events stay ward-scoped and gain no org column", () => {
    it("lets any org leader in the ward update an event on another organization's profile", async () => {
      const { error } = await rsPresident
        .from("activity_events")
        .update({ location: `Gym ${fixtures.runId}` })
        .eq("id", eqEventId);

      expect(error).toBeNull();

      const { data } = await fixtures.service
        .from("activity_events")
        .select("location")
        .eq("id", eqEventId)
        .maybeSingle();

      expect(data?.location).toBe(`Gym ${fixtures.runId}`);
    });

    it("refuses an event pointing at another ward's profile", async () => {
      const { error } = await eqPresident.from("activity_events").insert({
        ward_id: fixtures.wardAId,
        profile_id: wardBProfileId,
        title: `Cross ward ${fixtures.runId}`,
        event_type: "home",
        event_date: "2026-12-01T18:00:00-07:00",
      });

      expect(error).not.toBeNull();
    });
  });

  // Migration 054c's narrowing, asserted against the database rather than against the TypeScript
  // union — a CHECK constraint and a `const` array that disagree is a runtime failure the
  // compiler cannot see.
  describe("the status check constraint", () => {
    it.each(["covered", "uncovered"])("refuses the removed status %s", async (status) => {
      const { error } = await fixtures.service.from("activity_events").insert({
        ward_id: fixtures.wardAId,
        profile_id: eqProfileId,
        title: `Bad status ${fixtures.runId}`,
        event_type: "home",
        event_date: "2026-12-02T18:00:00-07:00",
        status,
      });

      expect(error).not.toBeNull();
    });

    it("accepts cancelled", async () => {
      const { data, error } = await fixtures.service
        .from("activity_events")
        .insert({
          ward_id: fixtures.wardAId,
          profile_id: eqProfileId,
          title: `Cancelled ${fixtures.runId}`,
          event_type: "home",
          event_date: "2026-12-03T18:00:00-07:00",
          status: "cancelled",
        })
        .select("id")
        .single();

      expect(error).toBeNull();

      await fixtures.service.from("activity_events").delete().eq("id", data!.id);
    });
  });

  // The composite `on delete set null (org_id)` from 054a. A bare `on delete set null` would null
  // ward_id too, which is NOT NULL — so the cascade would raise and the organization would become
  // undeletable (migration 046's bug, fixed by 047). Asserted here because the failure mode is
  // "an admin cannot dissolve an organization" and nothing else would catch it.
  describe("releasing an organization does not take the youth's season with it", () => {
    it("nulls only org_id when the organization is deleted", async () => {
      const { data: organization, error: orgError } = await fixtures.service
        .from("organizations")
        .insert({
          ward_id: fixtures.wardAId,
          name: `Temporary ${fixtures.runId}`,
          type: "other",
        })
        .select("id")
        .single();
      if (orgError) throw new Error(orgError.message);

      const profileId = await seedProfile(
        organization.id,
        fixtures.wardAId,
        wardAYouthId,
        "Temporary org activity",
      );

      const { error: deleteError } = await fixtures.service
        .from("organizations")
        .delete()
        .eq("id", organization.id);

      expect(deleteError).toBeNull();

      const { data: survivor } = await fixtures.service
        .from("youth_activity_profiles")
        .select("org_id, ward_id")
        .eq("id", profileId)
        .maybeSingle();

      expect(survivor).not.toBeNull();
      expect(survivor?.org_id).toBeNull();
      expect(survivor?.ward_id).toBe(fixtures.wardAId);

      await fixtures.service.from("youth_activity_profiles").delete().eq("id", profileId);
    });
  });
});
