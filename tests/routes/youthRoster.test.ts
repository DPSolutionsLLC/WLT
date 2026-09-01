// @vitest-environment node
//
// POST /api/youth/profiles/[id]/roster, and PATCH + DELETE on /api/youth/roster/[id] — putting a
// young person on a team, recording that they left, and taking them off.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. THE PERMISSION IS `youth_activities.manage` AND NOTHING NARROWER. `activity_roster` carries
//    ward-wide policies on all four verbs (migration 062f), so a cross-organization write is
//    permitted ON PURPOSE — there is a case below asserting it SUCCEEDS, so a future narrowing
//    breaks a test rather than silently removing the feature (youth-g's pattern).
//
//    The 403 fixture is `org_secretary`, which holds `youth_activities.view` and `.log` but NOT
//    `.manage`. That was read out of lib/auth/permissions.ts rather than guessed — the plan warns
//    that this matrix is not always the intuitive answer.
//
// 2. A DUPLICATE IS A SENTENCE, NOT A CONSTRAINT VIOLATION. Migration 062a's unique index stops a
//    double tap doubling a young person in every denominator on /youth; what the leader is told
//    is "they are already on this activity", which is a fact they can act on (CLAUDE.md rule 7).
//
// 3. A BACKWARDS WINDOW IS REFUSED **AGAINST THE STORED ROW**, not just against the body. A patch
//    setting only `endedOn` against a stored `startedOn` is the ordinary case — a leader recording
//    that somebody left — and it is exactly the shape that could otherwise write a window
//    containing nothing, which silently zeroes a percentage with no explanation anywhere.
//
// 4. THE DELETE IS UNCONDITIONAL, AND WHAT SURVIVES IT IS ASSERTED. Unlike youth-h's `Remove` on
//    an activity, this destroys nothing a person WROTE: follow-ups and private notes hang off
//    EVENTS. The test proves the follow-up is still there afterwards.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const ROSTER_URL = "http://localhost/api/youth/profiles/x/roster";

type RosterBody = {
  rosterId: string;
  profileId: string;
  memberId: string;
  memberName: string;
  startedOn: string | null;
  endedOn: string | null;
};

describe("youth activity roster routes", () => {
  let fixtures: Fixtures;
  let wardId: string;

  let youthId: string;
  let secondYouthId: string;
  let adultId: string;
  let wardBYouthId: string;

  let eqProfileId: string;
  let rsProfileId: string;
  let wardBProfileId: string;

  const callPost = async (profileId: string, body: unknown) => {
    const { POST } = await import("@/app/api/youth/profiles/[id]/roster/route");
    return readResponse(
      await POST(jsonRequest(ROSTER_URL, { method: "POST", body }), {
        params: Promise.resolve({ id: profileId }),
      }),
    );
  };

  const callPatch = async (rosterId: string, body: unknown) => {
    const { PATCH } = await import("@/app/api/youth/roster/[id]/route");
    return readResponse(
      await PATCH(
        jsonRequest(`http://localhost/api/youth/roster/${rosterId}`, {
          method: "PATCH",
          body,
        }),
        { params: Promise.resolve({ id: rosterId }) },
      ),
    );
  };

  const callDelete = async (rosterId: string) => {
    const { DELETE } = await import("@/app/api/youth/roster/[id]/route");
    return readResponse(
      await DELETE(
        jsonRequest(`http://localhost/api/youth/roster/${rosterId}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: rosterId }) },
      ),
    );
  };

  // The service client bypasses RLS, so this is the ground truth every refusal is measured
  // against — a zero-row write looks identical to a successful one from the caller's side.
  const storedRow = async (rosterId: string) => {
    const { data } = await fixtures.service
      .from("activity_roster")
      .select("id, started_on, ended_on")
      .eq("id", rosterId)
      .maybeSingle();

    return data;
  };

  const seedProfile = async (orgId: string | null, name: string): Promise<string> => {
    const { data, error } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: wardId,
        org_id: orgId,
        activity_name: `${name} ${fixtures.runId}`,
        activity_type: "sport",
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return data.id;
  };

  const countAuditRows = async (action: string): Promise<number> => {
    const { count } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("action", action);

    return count ?? 0;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
      "wardBBishop",
    ]);
    wardId = fixtures.wardAId;

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: wardId,
          first_name: "Ada",
          last_name: `Roster${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          ward_id: wardId,
          first_name: "Cal",
          last_name: `Roster2${fixtures.runId}`,
          category: "youth",
          status: "active",
        },
        {
          // NOT A YOUTH. PROFILE_MEMBER_CATEGORIES is the single answer to "which member may be on
          // a youth activity", and until youth-j the route could not refuse one — only the picker
          // filtered. This fixture is what closes that.
          ward_id: wardId,
          first_name: "Dee",
          last_name: `Adult${fixtures.runId}`,
          category: "adult",
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
      .select("id, first_name");
    if (memberError) throw new Error(memberError.message);

    youthId = members!.find((row) => row.first_name === "Ada")!.id;
    secondYouthId = members!.find((row) => row.first_name === "Cal")!.id;
    adultId = members!.find((row) => row.first_name === "Dee")!.id;
    wardBYouthId = members!.find((row) => row.first_name === "Bo")!.id;

    eqProfileId = await seedProfile(fixtures.eldersQuorumId, "EQ basketball");
    rsProfileId = await seedProfile(fixtures.reliefSocietyId, "RS choir");

    const { data: wardBProfile, error: wardBError } = await fixtures.service
      .from("youth_activity_profiles")
      .insert({
        ward_id: fixtures.wardBId,
        org_id: fixtures.wardBOrgId,
        activity_name: `Ward B track ${fixtures.runId}`,
        activity_type: "sport",
      })
      .select("id")
      .single();
    if (wardBError) throw new Error(wardBError.message);
    wardBProfileId = wardBProfile.id;
  }, 180_000);

  afterAll(async () => {
    await fixtures.cleanup();
  });

  describe("adding a young person", () => {
    it("adds them, returns the row, and writes an audit row", async () => {
      await actAs(fixtures, "eqPresident");

      const before = await countAuditRows("youth_activity_roster_added");
      const { status, body } = await callPost(eqProfileId, { memberId: youthId });

      expect(status).toBe(201);

      const member = body.member as RosterBody;
      expect(member.memberId).toBe(youthId);
      expect(member.memberName).toBe(`Ada Roster${fixtures.runId}`);
      // ABSENT DATES MEAN THE WHOLE SCHEDULE, which is the ordinary case and what keeps adding
      // somebody to one tap.
      expect(member.startedOn).toBeNull();
      expect(member.endedOn).toBeNull();

      expect(await storedRow(member.rosterId)).not.toBeNull();
      expect(await countAuditRows("youth_activity_roster_added")).toBe(before + 1);
    });

    it("records a joining date when one is given", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost(eqProfileId, {
        memberId: secondYouthId,
        startedOn: "2027-01-15",
      });

      expect(status).toBe(201);
      expect((body.member as RosterBody).startedOn).toBe("2027-01-15");
    });

    // 409 RATHER THAN A SILENT SUCCESS, and with a sentence a person can act on.
    it("answers 409 with a sentence when they are already on the roster", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost(eqProfileId, { memberId: youthId });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("already on this activity");
    });

    // ---------------------------------------------------------------------------
    // THE CROSS-ORGANIZATION WRITE **SUCCEEDS**, AND THAT IS THE DECISION
    // ---------------------------------------------------------------------------
    // Migration 062f's policies are ward-wide on all four verbs, matching `activity_events`. If a
    // later reader narrows them to `org_id = current_org_id()`, this fails — which is the point.
    it("lets an Elders Quorum president add to a Relief Society team", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPost(rsProfileId, { memberId: youthId });

      expect(status).toBe(201);
    });

    it("answers 404 for a profile in another ward", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost(wardBProfileId, { memberId: youthId });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
    });

    it("answers 404 for a member in another ward", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost(eqProfileId, { memberId: wardBYouthId });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not on your ward's roster");
    });

    // PROFILE_MEMBER_CATEGORIES HAD ONLY ONE READER UNTIL youth-j — the picker. So the route could
    // not refuse a member the picker would never have offered, and a hand-made request would have
    // put an adult on a youth activity.
    it("answers 404 for a member who is not a youth", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPost(eqProfileId, { memberId: adultId });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not on your ward's roster");

      const { data } = await fixtures.service
        .from("activity_roster")
        .select("id")
        .eq("profile_id", eqProfileId)
        .eq("member_id", adultId);

      expect(data).toEqual([]);
    });

    // `org_secretary` HOLDS `.view` AND `.log` BUT NOT `.manage`. Checked against
    // lib/auth/permissions.ts rather than guessed.
    it("refuses an org secretary with 403", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPost(eqProfileId, { memberId: secondYouthId });

      expect(status).toBe(403);
    });
  });

  describe("the window", () => {
    let rosterId: string;

    beforeAll(async () => {
      await actAs(fixtures, "eqPresident");
      const profileId = await seedProfile(fixtures.eldersQuorumId, "Window squad");
      const { body } = await callPost(profileId, {
        memberId: youthId,
        startedOn: "2027-01-10",
      });
      rosterId = (body.member as RosterBody).rosterId;
    });

    it("records a leaving date and audits BOTH dates, before and after", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatch(rosterId, { endedOn: "2027-02-15" });

      expect(status).toBe(200);
      expect((body.member as RosterBody).endedOn).toBe("2027-02-15");
      expect((await storedRow(rosterId))!.ended_on).toBe("2027-02-15");

      // "WHEN DID SHE LEAVE?" IS THE QUESTION SOMEBODY ASKS LATER, so the audit row carries what
      // it said before as well as what it says now.
      const { data } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", wardId)
        .eq("action", "youth_activity_roster_updated")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const detail = data?.detail as Record<string, unknown> | null;
      expect(detail?.endedOnBefore).toBeNull();
      expect(detail?.endedOnAfter).toBe("2027-02-15");
      expect(detail?.startedOnBefore).toBe("2027-01-10");
    });

    // THE WAY BACK. An explicit null clears the date rather than deleting the roster row —
    // somebody who came back after all keeps their `started_on` and their place in the record.
    it("clears a leaving date with an explicit null", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(rosterId, { endedOn: null });

      expect(status).toBe(200);
      expect((await storedRow(rosterId))!.ended_on).toBeNull();
    });

    // ---------------------------------------------------------------------------
    // REFUSED AGAINST THE **STORED** ROW, WHICH THE SCHEMA ALONE CANNOT DO
    // ---------------------------------------------------------------------------
    // The body carries only `endedOn`, so updateRosterMemberSchema's own comparison never fires —
    // it sees one request, not the row. A window containing nothing would silently zero this young
    // person's percentage with nothing on any screen saying why.
    it("refuses an endedOn before the STORED startedOn, with a sentence", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPatch(rosterId, { endedOn: "2026-12-01" });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("cannot leave the team before they joined");
      expect((await storedRow(rosterId))!.ended_on).toBeNull();
    });

    it("refuses a backwards pair sent together", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(rosterId, {
        startedOn: "2027-03-01",
        endedOn: "2027-02-01",
      });

      expect(status).toBe(400);
    });

    it("refuses a date that is not a day", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(rosterId, { endedOn: "15/02/2027" });

      expect(status).toBe(400);
    });

    it("refuses an empty patch", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPatch(rosterId, {});

      expect(status).toBe(400);
    });

    it("refuses an org secretary with 403", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPatch(rosterId, { endedOn: "2027-02-15" });

      expect(status).toBe(403);
      expect((await storedRow(rosterId))!.ended_on).toBeNull();
    });
  });

  describe("removing a young person", () => {
    // ---------------------------------------------------------------------------
    // UNCONDITIONAL — AND WHAT SURVIVES IT IS THE ASSERTION
    // ---------------------------------------------------------------------------
    // youth-h narrowed `Remove` on an ACTIVITY to zero events, because deleting one cascades to
    // its games, its sign-ups, its follow-ups and the private notes rule 5 calls private forever.
    // A ROSTER ROW is different in kind: follow-ups hang off EVENTS, so there is nothing a person
    // wrote for this delete to reach. This test is what makes that a fact rather than a claim.
    it("removes the row, leaves the follow-up written on the team's event, and audits it", async () => {
      const profileId = await seedProfile(fixtures.eldersQuorumId, "Removable squad");

      await actAs(fixtures, "eqPresident");
      const { body } = await callPost(profileId, { memberId: youthId });
      const rosterId = (body.member as RosterBody).rosterId;

      const { data: event, error: eventError } = await fixtures.service
        .from("activity_events")
        .insert({
          ward_id: wardId,
          profile_id: profileId,
          title: `Removable game ${fixtures.runId}`,
          event_date: "2027-01-16T02:30:00.000Z",
          event_type: "home",
          status: "upcoming",
        })
        .select("id")
        .single();
      if (eventError) throw new Error(eventError.message);

      const { data: log, error: logError } = await fixtures.service
        .from("activity_logs")
        .insert({
          ward_id: wardId,
          event_id: event.id,
          logged_by: fixtures.user("eqPresident").id,
          shared_notes: "A good night.",
        })
        .select("id")
        .single();
      if (logError) throw new Error(logError.message);

      const before = await countAuditRows("youth_activity_roster_removed");

      await actAs(fixtures, "eqPresident");
      const { status } = await callDelete(rosterId);

      expect(status).toBe(200);
      expect(await storedRow(rosterId)).toBeNull();
      expect(await countAuditRows("youth_activity_roster_removed")).toBe(before + 1);

      // THE PASTORAL RECORD SURVIVES. This is the whole reason the delete needs no 409.
      const { data: logAfter } = await fixtures.service
        .from("activity_logs")
        .select("id")
        .eq("id", log.id)
        .maybeSingle();
      expect(logAfter?.id).toBe(log.id);

      // And so does the team's schedule.
      const { data: eventAfter } = await fixtures.service
        .from("activity_events")
        .select("id")
        .eq("id", event.id)
        .maybeSingle();
      expect(eventAfter?.id).toBe(event.id);
    });

    it("answers 404 for a roster row in another ward", async () => {
      const { data, error } = await fixtures.service
        .from("activity_roster")
        .insert({
          ward_id: fixtures.wardBId,
          profile_id: wardBProfileId,
          member_id: wardBYouthId,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await actAs(fixtures, "eqPresident");
      const { status } = await callDelete(data.id);

      expect(status).toBe(404);
      // RE-READ, never a throw: an RLS-denied DELETE is a zero-row success.
      expect(await storedRow(data.id)).not.toBeNull();
    });

    it("refuses an org secretary with 403", async () => {
      const profileId = await seedProfile(fixtures.eldersQuorumId, "Secretary squad");

      await actAs(fixtures, "eqPresident");
      const { body } = await callPost(profileId, { memberId: youthId });
      const rosterId = (body.member as RosterBody).rosterId;

      await actAs(fixtures, "eqSecretary");
      const { status } = await callDelete(rosterId);

      expect(status).toBe(403);
      expect(await storedRow(rosterId)).not.toBeNull();
    });
  });
});
