// @vitest-environment node
//
// GET, POST, PATCH and DELETE on /api/youth/profiles — where an activity's OWNERSHIP is decided.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. OWNERSHIP IS STAMPED FROM THE SESSION, NEVER FROM THE BODY. An org president's profile
//    carries their own org_id whether or not the body mentioned one, and a body naming a
//    DIFFERENT organization is refused with a sentence rather than silently overwritten — the
//    difference between "the API corrected me" and "I entered an activity for the Young Women and
//    it did not happen".
//
// 2. THE DEPARTURE FROM visit-goals. A ward council member with no organization gets 201 and a
//    null org_id, where visit-goals returns 409. A goal with no org is invisible to its author; a
//    PROFILE with no org is ward-wide and visible to everybody, which policy 054d permits on
//    purpose.
//
// 3. READS ARE WARD-WIDE. An org secretary — who holds `youth_activities.view` and `.log` but NOT
//    `.manage` — reads every organization's profiles and can write none of them. That role pair
//    was checked against lib/auth/permissions.ts rather than guessed; `music_coordinator` holds
//    none of the three and is the 403 case.
//
// 4. A DELETE CANNOT DESTROY A PASTORAL RECORD (ITER-031). This is the assertion the whole item
//    exists for, and it is asserted by RE-READING the profile, its events AND its logs after the
//    409.
//
//    THE FIXTURE IS THE ONE CASE WHERE THE TWO POLICIES DIVERGE, and it took a failing test to
//    find it. 054d admits a DELETE on `entered_by = auth.uid()`; 057c's log SELECT admits
//    `activity_event_is_in_caller_org(...)`, which is the EVENT's organization and NOT the
//    author's — so an Elders Quorum president reads a Relief Society leader's follow-up on an
//    Elders Quorum activity perfectly well, and a fixture built that way proves nothing.
//    What genuinely diverges is a profile whose `org_id` is one organization and whose
//    `entered_by` is a leader now in ANOTHER: the shape a release and a recall produce, because
//    the profile keeps the org it was created with and the user's org moves. That leader may
//    delete it and cannot read a word written on it — which is why the count is migration 060b's
//    `security definer` RPC rather than an ordinary query.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const PROFILES_URL = "http://localhost/api/youth/profiles";

type ProfileBody = {
  id: string;
  // WHO IS ON THE TEAM (youth-j). `memberId`/`memberName` are gone from ActivityProfile —
  // a profile is a TEAM now and its people live on `activity_roster`.
  roster: { memberId: string; memberName: string }[];
  orgId: string | null;
  activityName: string;
  activityType: string;
};

async function callGet() {
  const { GET } = await import("@/app/api/youth/profiles/route");
  return readResponse(await GET());
}

async function callPost(body: unknown) {
  const { POST } = await import("@/app/api/youth/profiles/route");
  return readResponse(await POST(jsonRequest(PROFILES_URL, { method: "POST", body })));
}

async function callPatch(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/youth/profiles/[id]/route");
  return readResponse(
    await PATCH(jsonRequest(`${PROFILES_URL}/${id}`, { method: "PATCH", body }), {
      // `params` is a PROMISE in Next 16, so the test has to hand the handler one.
      params: Promise.resolve({ id }),
    }),
  );
}

async function callDelete(id: string) {
  const { DELETE } = await import("@/app/api/youth/profiles/[id]/route");
  return readResponse(
    await DELETE(jsonRequest(`${PROFILES_URL}/${id}`, { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    }),
  );
}

describe("/api/youth/profiles", () => {
  let fixtures: Fixtures;
  let wardId: string;

  let youthId: string;
  // A SECOND YOUNG PERSON IN WARD A, so a team of TWO can be created — the shape youth-j exists
  // for, and one a fixture with a single youth cannot express.
  let secondYouthId: string;
  let wardBYouthId: string;
  let rsProfileId: string;
  let wardBOrganizationId: string;

  // Every created row is tracked and removed, because this suite runs against the shared hosted
  // project alongside every other suite (CLAUDE.md §9).
  const created: string[] = [];

  const profileFrom = (body: Record<string, unknown>): ProfileBody =>
    body.profile as ProfileBody;

  const storedOrgId = async (profileId: string): Promise<string | null | undefined> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .select("org_id")
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data === null ? undefined : data.org_id;
  };

  const storedName = async (profileId: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .select("activity_name")
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.activity_name ?? null;
  };

  const countAuditRows = async (action: string): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("action", action);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
      "wardCouncilMember",
      "musicCoordinator",
      "wardBBishop",
    ]);
    wardId = fixtures.wardAId;
    wardBOrganizationId = fixtures.wardBOrgId;

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: wardId,
          first_name: "Ada",
          last_name: `Youth${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: wardId,
          first_name: "Cal",
          last_name: `Youth2${fixtures.runId}`,
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
      .select("id, ward_id, first_name");
    if (memberError) throw new Error(memberError.message);

    youthId = members!.find((row) => row.first_name === "Ada")!.id;
    secondYouthId = members!.find((row) => row.first_name === "Cal")!.id;
    wardBYouthId = members!.find((row) => row.first_name === "Bo")!.id;

    // A profile owned by an organization the Elders Quorum does not belong to, so the read
    // assertion has something that could only come from a ward-wide policy.
    const { data: rsProfile, error: rsError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: wardId,
        org_id: fixtures.reliefSocietyId,
        activity_name: `RS choir ${fixtures.runId}`,
        activity_type: "performance",
      })
      .select("id")
      .single();
    if (rsError) throw new Error(rsError.message);
    rsProfileId = rsProfile.id;

    // A TEAM OF ONE, so the roster assertion below has a name to find. This is the shape
    // migration 062b backfilled onto every profile that already existed.
    const { error: rsRosterError } = await fixtures.service.from("activity_roster").insert({
      ward_id: wardId,
      profile_id: rsProfileId,
      member_id: youthId,
    });
    if (rsRosterError) throw new Error(rsRosterError.message);
  }, 180_000);

  afterAll(async () => {
    if (created.length > 0) {
      await fixtures.service.from("youth_activity_profiles").delete().in("id", created);
    }
    await fixtures?.cleanup();
  });

  describe("reading", () => {
    it("returns every organization's profiles to an org secretary", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status, body } = await callGet();
      const profiles = body.profiles as ProfileBody[];

      expect(status).toBe(200);
      // The Elders Quorum's secretary reading a Relief Society profile IS the decision. An org
      // filter added to the GET later would fail exactly here.
      expect(profiles.some((profile) => profile.id === rsProfileId)).toBe(true);
    });

    // THE NAME NOW ARRIVES THROUGH THE ROSTER (youth-j), from lib/youth/rosterQueries.ts's named
    // embed rather than from one on the profile itself. A profile is a TEAM, so the answer is a
    // LIST — and a team of one is what every pre-youth-j profile became.
    it("carries the roster, with each young person's name", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callGet();
      const profiles = body.profiles as ProfileBody[];
      const found = profiles.find((profile) => profile.id === rsProfileId);

      expect(found?.roster.map((member) => member.memberName)).toEqual([
        `Ada Youth${fixtures.runId}`,
      ]);
    });

    it("refuses a role holding none of the youth permissions", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callGet();

      expect(status).toBe(403);
    });
  });

  describe("creating", () => {
    // ---------------------------------------------------------------------------
    // A TEAM, WITH ITS ROSTER, IN ONE REQUEST (youth-j)
    // ---------------------------------------------------------------------------
    // `memberId: string` became `memberIds: string[]`, because a profile is a TEAM now. The two
    // cases below are the two shapes ITER-033's flow produces, and BOTH must work.
    it("writes a roster row for every memberId, in one request", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        memberIds: [youthId, secondYouthId],
        activityName: `Two players ${fixtures.runId}`,
        activityType: "sport",
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      // THE RESPONSE CARRIES THE ROSTER, so the page that just created the team can render it
      // without a second fetch.
      expect(profile.roster.map((member) => member.memberId).sort()).toEqual(
        [youthId, secondYouthId].sort(),
      );

      // AND THE ROWS ARE REALLY THERE, read back with the service client rather than trusted off
      // the response body.
      const { data: stored } = await fixtures.service
        .from("activity_roster")
        .select("member_id")
        .eq("profile_id", profile.id);

      expect((stored ?? []).map((row) => row.member_id).sort()).toEqual(
        [youthId, secondYouthId].sort(),
      );
    });

    // ---------------------------------------------------------------------------
    // AN EMPTY ROSTER IS A LEGITIMATE CREATE, AND THE TEAM IS READABLE AFTERWARDS
    // ---------------------------------------------------------------------------
    // ITER-033's flow is IMPORT ONCE, THEN ASSIGN — the user's own words — so a team with nobody
    // on it yet is a state every ward passes through on every schedule they import. Refusing it
    // would force a leader to name the players before they have the schedule in front of them,
    // which is exactly the friction this slice exists to remove.
    //
    // The state is made LOUD rather than refused: RosterPanel says so in a sentence, and
    // lib/youth/roster.ts's branch 5 keeps the team's games on ordinary coverage.
    it("accepts an empty memberIds and leaves the team readable", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        memberIds: [],
        activityName: `Nobody yet ${fixtures.runId}`,
        activityType: "sport",
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.roster).toEqual([]);

      // READABLE, which is the half that matters: a team nobody can find is not a team you can
      // assign anybody to.
      const { body: listBody } = await callGet();
      const profiles = listBody.profiles as ProfileBody[];

      expect(profiles.some((row) => row.id === profile.id)).toBe(true);
    });

    it("stamps an org president's own organization when the body names none", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        memberIds: [youthId],
        activityName: `EQ basketball ${fixtures.runId}`,
        activityType: "sport",
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.orgId).toBe(fixtures.eldersQuorumId);
      expect(await storedOrgId(profile.id)).toBe(fixtures.eldersQuorumId);
    });

    it("accepts a body orgId that matches the author's own organization", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        memberIds: [youthId],
        activityName: `EQ track ${fixtures.runId}`,
        activityType: "sport",
        orgId: fixtures.eldersQuorumId,
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.orgId).toBe(fixtures.eldersQuorumId);
    });

    // REFUSED, NOT IGNORED. A leader who thinks they entered an activity for another organization
    // and did not is worse off than one who was told they may not.
    it("refuses a body orgId naming another organization, with a sentence", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost({
        memberIds: [youthId],
        activityName: `Forged RS ${fixtures.runId}`,
        activityType: "performance",
        orgId: fixtures.reliefSocietyId,
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toContain("your own organization");
    });

    // THE DEPARTURE FROM visit-goals, which returns 409 here.
    it("writes a ward-wide profile for a ward council member with no organization", async () => {
      await actAs(fixtures, "wardCouncilMember");

      const { status, body } = await callPost({
        memberIds: [youthId],
        activityName: `Council debate ${fixtures.runId}`,
        activityType: "academic",
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.orgId).toBeNull();
      expect(await storedOrgId(profile.id)).toBeNull();
    });

    it("shows that profile back to its author immediately", async () => {
      // The talks-d hole from the outside: the INSERT succeeding proves nothing on its own.
      await actAs(fixtures, "wardCouncilMember");

      const { body } = await callGet();
      const profiles = body.profiles as ProfileBody[];

      expect(
        profiles.some((profile) => profile.activityName === `Council debate ${fixtures.runId}`),
      ).toBe(true);
    });

    it("lets the bishopric create for any organization in the ward", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        memberIds: [youthId],
        activityName: `Bishop for RS ${fixtures.runId}`,
        activityType: "performance",
        orgId: fixtures.reliefSocietyId,
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.orgId).toBe(fixtures.reliefSocietyId);
    });

    it("lets the bishopric create a ward-wide profile by omitting the organization", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        memberIds: [youthId],
        activityName: `Bishop ward-wide ${fixtures.runId}`,
        activityType: "community",
      });

      expect(status).toBe(201);
      const profile = profileFrom(body);
      created.push(profile.id);

      expect(profile.orgId).toBeNull();
    });

    // A SENTENCE, NOT A CONSTRAINT VIOLATION. The composite foreign key would answer "insert or
    // update on table violates foreign key constraint", which nobody can act on.
    it("returns 404 for an organization from another ward", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        memberIds: [youthId],
        activityName: `Cross ward ${fixtures.runId}`,
        activityType: "sport",
        orgId: wardBOrganizationId,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
    });

    it("refuses an org secretary, who may read but not manage", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPost({
        memberIds: [youthId],
        activityName: `Secretary ${fixtures.runId}`,
        activityType: "sport",
      });

      expect(status).toBe(403);
    });

    it("refuses a member from another ward", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPost({
        memberIds: [wardBYouthId],
        activityName: `Ward B youth ${fixtures.runId}`,
        activityType: "sport",
      });

      // RLS refuses the insert rather than writing a profile naming a member nobody here can see.
      expect(status).toBe(500);
    });

    it("writes an audit row for every created profile", async () => {
      const before = await countAuditRows("youth_activity_profile_created");

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callPost({
        memberIds: [youthId],
        activityName: `Audited ${fixtures.runId}`,
        activityType: "sport",
      });

      expect(status).toBe(201);
      created.push(profileFrom(body).id);

      expect(await countAuditRows("youth_activity_profile_created")).toBe(before + 1);
    });
  });

  describe("updating", () => {
    let ownProfileId: string;

    beforeAll(async () => {
      await actAs(fixtures, "eqPresident");
      const { body } = await callPost({
        memberIds: [youthId],
        activityName: `Editable ${fixtures.runId}`,
        activityType: "sport",
      });
      ownProfileId = profileFrom(body).id;
      created.push(ownProfileId);
    });

    it("saves a change to the author's own organization's profile", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(ownProfileId, {
        activityName: `Renamed ${fixtures.runId}`,
        seasonSchedule: "November to February",
      });

      expect(status).toBe(200);
      expect(await storedName(ownProfileId)).toBe(`Renamed ${fixtures.runId}`);
    });

    // The policy decides WHICH, not a branch in the route (CLAUDE.md rule 2). The 404 is the
    // route turning a zero-row update into an answer.
    it("returns 404 rather than editing another organization's profile", async () => {
      const before = await storedName(rsProfileId);
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatch(rsProfileId, {
        activityName: `Hijacked ${fixtures.runId}`,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("another organization");
      expect(await storedName(rsProfileId)).toBe(before);
    });

    it("refuses an empty patch with a sentence", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatch(ownProfileId, {});

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Nothing was changed.");
    });

    it("refuses an id that is not a uuid", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch("not-a-uuid", { activityName: "Anything" });

      expect(status).toBe(400);
    });

    it("writes an audit row on a successful update", async () => {
      const before = await countAuditRows("youth_activity_profile_updated");

      await actAs(fixtures, "eqPresident");
      const { status } = await callPatch(ownProfileId, { activityType: "community" });

      expect(status).toBe(200);
      expect(await countAuditRows("youth_activity_profile_updated")).toBe(before + 1);
    });
  });

  describe("deleting", () => {
    it("removes the author's own profile and audits it", async () => {
      await actAs(fixtures, "eqPresident");
      const { body } = await callPost({
        memberIds: [youthId],
        activityName: `Removable ${fixtures.runId}`,
        activityType: "sport",
      });
      const profileId = profileFrom(body).id;

      const before = await countAuditRows("youth_activity_profile_deleted");
      const { status } = await callDelete(profileId);

      expect(status).toBe(200);
      expect(await storedName(profileId)).toBeNull();
      expect(await countAuditRows("youth_activity_profile_deleted")).toBe(before + 1);
    });

    it("returns 404 rather than removing another organization's profile", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callDelete(rsProfileId);

      expect(status).toBe(404);
      expect(await storedName(rsProfileId)).not.toBeNull();
    });

    it("refuses an org secretary", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callDelete(rsProfileId);

      expect(status).toBe(403);
    });
  });

  // =========================================================================
  // ITER-031 — A REMOVE THAT CANNOT DESTROY AN ACCOUNT
  // =========================================================================
  // Migration 009 cascades youth_activity_profiles → activity_events → {activity_attendees,
  // activity_logs → activity_private_notes}, so one DELETE used to take a season of games, every
  // sign-up, every follow-up and the private notes CLAUDE.md rule 5 calls private forever. A
  // confirm dialog was added first and can be clicked through; this is the protection.
  describe("refusing to delete a profile that carries follow-ups", () => {
    let withFollowUpId: string;
    let withEventsOnlyId: string;
    let emptyId: string;
    let followUpEventId: string;

    // Seeded with the SERVICE client, which bypasses RLS — the honest way to build a state where
    // one organization's leader has written about another organization's activity. Doing it
    // through the API would need the very policy this state is arranged to defeat.
    beforeAll(async () => {
      const { data: profiles, error: profileError } = await fixtures.service
        .from("youth_activity_profiles")
        .insert([
          {
            // THE DIVERGENCE, SEEDED. `org_id` is the Relief Society and `entered_by` is the
            // Elders Quorum president — the state a reorganisation leaves behind, and the only
            // one in which a leader may delete an activity whose follow-ups are hidden from them.
            // 054d's DELETE admits them through `entered_by`; 057c's SELECT does not mention it.
            ward_id: wardId,
            org_id: fixtures.reliefSocietyId,
            activity_name: `Reassigned with follow-up ${fixtures.runId}`,
            activity_type: "sport",
            entered_by: fixtures.user("eqPresident").id,
          },
          {
            ward_id: wardId,
            org_id: fixtures.eldersQuorumId,
            activity_name: `EQ events only ${fixtures.runId}`,
            activity_type: "sport",
          },
          {
            ward_id: wardId,
            org_id: fixtures.eldersQuorumId,
            activity_name: `EQ empty ${fixtures.runId}`,
            activity_type: "sport",
          },
        ])
        .select("id, activity_name");
      if (profileError) throw new Error(profileError.message);

      const byName = (fragment: string) =>
        profiles!.find((row) => row.activity_name.includes(fragment))!.id;

      withFollowUpId = byName("Reassigned with follow-up");
      withEventsOnlyId = byName("events only");
      emptyId = byName("empty");
      created.push(withFollowUpId, withEventsOnlyId, emptyId);

      const { data: events, error: eventError } = await fixtures.service
        .from("activity_events")
        .insert([
          {
            ward_id: wardId,
            profile_id: withFollowUpId,
            title: `Game with a follow-up ${fixtures.runId}`,
            event_type: "home",
            event_date: "2026-12-04T02:30:00Z",
            status: "upcoming",
          },
          {
            ward_id: wardId,
            profile_id: withEventsOnlyId,
            title: `Game nobody wrote about ${fixtures.runId}`,
            event_type: "home",
            event_date: "2026-12-05T02:30:00Z",
            status: "upcoming",
          },
        ])
        .select("id, profile_id");
      if (eventError) throw new Error(eventError.message);

      followUpEventId = events!.find((row) => row.profile_id === withFollowUpId)!.id;

      // WRITTEN BY THE RELIEF SOCIETY PRESIDENT, on the Relief Society's activity — the one the
      // Elders Quorum president entered and may therefore still delete. 057c scopes the read by
      // the EVENT's organization, so this row is invisible to them, which is precisely why the
      // count is an RPC rather than an ordinary query.
      const { error: logError } = await fixtures.service.from("activity_logs").insert({
        ward_id: wardId,
        event_id: followUpEventId,
        logged_by: fixtures.user("rsPresident").id,
        shared_notes: `He played well and seemed happier ${fixtures.runId}`,
      });
      if (logError) throw new Error(logError.message);
    }, 180_000);

    // THE PROOF THAT THE `security definer` COUNTER IS NECESSARY RATHER THAN TIDY. If this ever
    // starts returning the row, the refusal below could have been an ordinary query and this whole
    // arrangement is over-built — and if it returns nothing while the delete succeeds, the
    // follow-up was destroyed by somebody who could not even read it.
    it("hides that follow-up from the leader who may nonetheless delete the activity", async () => {
      const eqClient = await asRole(fixtures, "eqPresident");

      const { data, error } = await eqClient
        .from("activity_logs")
        .select("id")
        .eq("event_id", followUpEventId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    // THE ASSERTION THE WHOLE ITEM EXISTS FOR.
    it("refuses with 409 and destroys nothing", async () => {
      const auditBefore = await countAuditRows("youth_activity_profile_deleted");
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callDelete(withFollowUpId);

      expect(status).toBe(409);

      // THE SENTENCE NAMES THE ALTERNATIVE — visits-f's empty-bulk-replace precedent. A refusal
      // that leaves somebody with no way forward is a dead end.
      expect(errorMessage(body)).toContain("Close it instead");

      // NEITHER THE COUNT NOR ANY CONTENT IS DISCLOSED. The deleter may not be entitled to know
      // whose follow-ups those are or how many (CLAUDE.md rule 5).
      expect(errorMessage(body)).not.toContain("1");
      expect(errorMessage(body)).not.toContain(fixtures.runId);

      // RE-READ WITH THE SERVICE CLIENT — the profile, its event AND its log.
      expect(await storedName(withFollowUpId)).not.toBeNull();

      const { data: events } = await fixtures.service
        .from("activity_events")
        .select("id")
        .eq("profile_id", withFollowUpId);
      expect((events ?? []).length).toBe(1);

      const { data: logs } = await fixtures.service
        .from("activity_logs")
        .select("id")
        .eq("event_id", followUpEventId);
      expect((logs ?? []).length).toBe(1);

      // NO AUDIT ROW FOR A REFUSED WRITE. A refusal is not a mutation, which scenario 049's walk
      // established; a row here would make the audit log disagree with that.
      expect(await countAuditRows("youth_activity_profile_deleted")).toBe(auditBefore);
    });

    // CLOSE IS ADVICE, NOT A LOCK. Only a WRITTEN ACCOUNT is protected — that is the thing nobody
    // can reconstruct. An activity full of imported fixtures and no follow-ups still deletes.
    it("still deletes an activity that has events but no follow-ups", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callDelete(withEventsOnlyId);

      expect(status).toBe(200);
      expect(await storedName(withEventsOnlyId)).toBeNull();
    });

    // THE AUDIT ROW NOW RECORDS WHAT WAS LOST. Three bare ids was the other half of ITER-031's
    // defect: a reader could not tell a mistyped activity removed the same afternoon from a season
    // of fixtures.
    it("deletes an empty activity and records its name and event count", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callDelete(emptyId);
      expect(status).toBe(200);

      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", wardId)
        .eq("action", "youth_activity_profile_deleted")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);

      const detail = data?.detail as { activityName?: string; eventCount?: number } | null;

      expect(detail?.activityName).toBe(`EQ empty ${fixtures.runId}`);
      expect(detail?.eventCount).toBe(0);
    });
  });
});
