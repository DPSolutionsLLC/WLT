// @vitest-environment node
//
// GET and POST /api/assignments, called as real handlers against the hosted project. See
// tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is
// deleted in afterAll and nothing assumes an empty table.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const ROUTE = "http://localhost/api/assignments";

const FULL_SUNDAY_DATE = "2027-03-07";
const NO_SLOTS_DATE = "2027-03-14";
const RANGE = "from=2027-03-01&to=2027-03-31";

async function callGet(query: string) {
  const { GET } = await import("@/app/api/assignments/route");
  return readResponse(await GET(jsonRequest(`${ROUTE}?${query}`)));
}

async function callPost(body: unknown) {
  const { POST } = await import("@/app/api/assignments/route");
  return readResponse(await POST(jsonRequest(ROUTE, { method: "POST", body })));
}

describe("/api/assignments", () => {
  let fixtures: Fixtures;

  let fullSundayId = "";
  let noSlotsSundayId = "";
  let memberId = "";
  let topicId = "";
  let seededAssignmentId = "";

  // Counted with the SERVICE client. This is a fact-check on what the route wrote, not an RLS
  // assertion — tests/rls/assignment-access.test.ts owns that question.
  async function auditRowCount(): Promise<number> {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);

    if (error) throw new Error(`Could not count audit rows: ${error.message}`);
    return count ?? 0;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "wardSecretary",
      "musicCoordinator",
      "eqPresident",
      "wardBBishop",
    ]);

    const seedSunday = async (
      wardId: string,
      date: string,
      speakingSlots: number,
    ) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({
          ward_id: wardId,
          date,
          type: "standard",
          speaking_slots: speakingSlots,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Could not seed a Sunday: ${error.message}`);
      return data.id;
    };

    fullSundayId = await seedSunday(fixtures.wardAId, FULL_SUNDAY_DATE, 3);
    noSlotsSundayId = await seedSunday(fixtures.wardAId, NO_SLOTS_DATE, 0);

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        first_name: "Speaker",
        last_name: `Fixture${fixtures.runId}`,
        category: "adult",
      })
      .select("id")
      .single();
    if (memberError) {
      throw new Error(`Could not seed a member: ${memberError.message}`);
    }
    memberId = member.id;

    const { data: topic, error: topicError } = await fixtures.service
      .from("topics")
      .insert({
        ward_id: fixtures.wardAId,
        title: `Fixture topic ${fixtures.runId}`,
        source: "manual",
      })
      .select("id")
      .single();
    if (topicError) {
      throw new Error(`Could not seed a topic: ${topicError.message}`);
    }
    topicId = topic.id;

    const { data: assignment, error: assignmentError } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: fullSundayId,
        member_id: memberId,
        assignment_type: "sacrament_talk",
        slot_number: 1,
        topic_id: topicId,
        pipeline_stage: "plan",
      })
      .select("id")
      .single();
    if (assignmentError) {
      throw new Error(`Could not seed an assignment: ${assignmentError.message}`);
    }
    seededAssignmentId = assignment.id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("GET", () => {
    it("returns a month range with its approval counts", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet(RANGE);

      expect(status).toBe(200);
      expect(Array.isArray(body.assignments)).toBe(true);
      expect(Array.isArray(body.approvalCounts)).toBe(true);

      const ids = (body.assignments as { id: string }[]).map((row) => row.id);
      expect(ids).toContain(seededAssignmentId);

      // One count per assignment — one query for the whole month, not one per card.
      expect((body.approvalCounts as unknown[]).length).toBe(
        (body.assignments as unknown[]).length,
      );
      expect(body.approvalCounts).toContainEqual({
        assignmentId: seededAssignmentId,
        approvedCount: 0,
      });
    });

    it("scopes to one Sunday when given sundayId", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet(`sundayId=${fullSundayId}`);

      expect(status).toBe(200);

      const rows = body.assignments as { id: string; sundayId: string }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.sundayId === fullSundayId)).toBe(true);
    });

    it("returns nothing for a Sunday with no assignments", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet(`sundayId=${noSlotsSundayId}`);

      expect(status).toBe(200);
      expect(body.assignments).toEqual([]);
      expect(body.approvalCounts).toEqual([]);
    });

    // The union carries its own message precisely so this case does not answer "Invalid input".
    // A GET with no filter would otherwise read every assignment the ward has ever planned.
    it("refuses a request with neither filter, and says what it wanted", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet("");

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe(
        "Ask for one Sunday with ?sundayId=, or a range with ?from= and ?to=.",
      );
      expect(errorMessage(body)).not.toBe("Invalid input");
    });

    it("refuses a range whose end is before its start", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet("from=2027-03-31&to=2027-03-01");

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("end date must not be before");
    });

    // A wrong parameter NAME is not refused by the handler, it is simply never read — so the
    // request falls through to the range arm with no dates and the union refuses it. This pins
    // the names against the handler, which is what did not happen when a client sent `statuses`
    // to the members route (plans/retros/roster-b-picker-and-orgs.md).
    it("does not read a parameter it was never taught", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet(`sunday_id=${fullSundayId}`);

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("?sundayId=");
    });

    it("refuses a role without talks.view", async () => {
      // eqPresident, NOT musicCoordinator. music_coordinator HOLDS talks.view
      // (lib/auth/permissions.ts) so it can never demonstrate this gate — they pick hymns from
      // the speaking plan and are meant to see it.
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGet(RANGE);

      expect(status).toBe(403);
      expect(errorMessage(body)).toBe("You do not have permission to do that.");
    });

    // THIS TEST USED TO ASSERT THE OPPOSITE, and the change is the point.
    //
    // It read "lets the music coordinator in, and RLS still returns nothing", with a comment
    // saying the permission matrix and migration 019 disagreed and that this "reads like a bug
    // until you know both halves". It read like a bug because it WAS one: `talks.view` was held
    // by three roles that the database then refused, so the permission was dead.
    //
    // Nothing surfaced it until program-a, where a ward_secretary holding `program.build` built a
    // sacrament program with every speaking slot silently empty and got a 200 back. Migration 038
    // makes SELECT on `assignments` and `topics` follow the roles that hold `talks.view`.
    //
    // Writes are unchanged — see the insert assertions in tests/rls/program-access.test.ts.
    it("lets the music coordinator in, and they can now read the plan they pick hymns from", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status, body } = await callGet(RANGE);

      expect(status).toBe(200);
      expect((body.assignments as unknown[]).length).toBeGreaterThan(0);
    });

    it("never shows one ward another ward's assignments", async () => {
      await actAs(fixtures, "wardBBishop");

      const { status, body } = await callGet(`sundayId=${fullSundayId}`);

      expect(status).toBe(200);
      expect(body.assignments).toEqual([]);
    });
  });

  describe("POST", () => {
    it("creates an assignment at stage plan", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 2,
        memberId,
      });

      expect(status).toBe(201);

      const assignment = body.assignment as { id: string; stage: string };
      expect(assignment.stage).toBe("plan");

      const { data } = await fixtures.service
        .from("assignments")
        .select("id, pipeline_stage, slot_number")
        .eq("id", assignment.id)
        .single();

      expect(data?.pipeline_stage).toBe("plan");
      expect(data?.slot_number).toBe(2);

      // CLAUDE.md rule 6: every mutation writes an audit row. The refusal test below asserts
      // the converse; without this one, a route that audited nothing at all would pass both.
      const { data: audit } = await fixtures.service
        .from("audit_log")
        .select("action, module, detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "assignment_created")
        .order("created_at", { ascending: false })
        .limit(1);

      expect(audit).toHaveLength(1);
      expect(audit![0].module).toBe("talks");
      expect((audit![0].detail as Record<string, unknown>).assignmentId).toBe(
        assignment.id,
      );
    });

    it("refuses talks.view without talks.plan", async () => {
      // ward_secretary is the honest case for this gate: it HAS talks.view and lacks talks.plan,
      // so the refusal is about the write and not about seeing the module at all.
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 3,
        memberId,
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toBe("You do not have permission to do that.");
    });

    it("refuses a Sunday with no speaking slots, naming the count", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        sundayId: noSlotsSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 1,
        memberId,
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("no speaking slots");
      expect(errorMessage(body)).toContain(
        "Set its speaking slots on the calendar first",
      );
    });

    it("refuses a slot beyond the Sunday's slot count", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 9,
        memberId,
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain(FULL_SUNDAY_DATE);
      expect(errorMessage(body)).toContain("3 speaking slots");
      expect(errorMessage(body)).toContain("no slot 9");
    });

    it("refuses a slot that is already taken", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 1,
        memberId,
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("Slot 1");
      expect(errorMessage(body)).toContain("already taken");
    });

    // The honest twin of the assignments_speaker_exactly_one CHECK: a 400 the planner can read,
    // rather than a 500 carrying a constraint name.
    it("refuses a member and an external speaker together", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 3,
        memberId,
        externalSpeaker: { name: "President Visitor" },
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe(
        "Choose a ward member or type an outside speaker's name, not both.",
      );
    });

    // 404 and "not on your ward's calendar", never a 403 — the answer must not confirm that the
    // Sunday exists somewhere else.
    it("answers 404 for a Sunday in another ward", async () => {
      await actAs(fixtures, "wardBBishop");

      const { status, body } = await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 1,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toBe("That Sunday is not on your ward's calendar.");
    });

    it("answers 400 for a body that is not JSON", async () => {
      await actAs(fixtures, "bishop");

      const { POST } = await import("@/app/api/assignments/route");
      const request = new Request(ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not json",
      });

      const { status, body } = await readResponse(await POST(request));

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("The request body was not valid JSON.");
    });

    // CLAUDE.md rule 6 says every MUTATION writes an audit row. The converse matters just as
    // much: a request that changed nothing must not leave a row claiming it did.
    it("leaves audit_log untouched on every refusal", async () => {
      const before = await auditRowCount();

      await actAs(fixtures, "wardSecretary");
      await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 3,
        memberId,
      });

      await actAs(fixtures, "bishop");
      await callPost({
        sundayId: noSlotsSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 1,
        memberId,
      });
      await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 9,
        memberId,
      });
      await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 1,
        memberId,
      });
      await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 3,
        memberId,
        externalSpeaker: { name: "President Visitor" },
      });

      await actAs(fixtures, "wardBBishop");
      await callPost({
        sundayId: fullSundayId,
        assignmentType: "sacrament_talk",
        slotNumber: 1,
      });

      expect(await auditRowCount()).toBe(before);
    });
  });
});
