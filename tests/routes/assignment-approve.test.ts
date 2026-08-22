// @vitest-environment node
//
// POST /api/assignments/[id]/approve — the gate the whole phase rests on.
//
// Two properties matter more than any single status code here, and both are asserted by
// re-reading rows rather than by trusting the response:
//
//   1. The gate counts PEOPLE, not rows. One counselor approving three times is one approval.
//   2. Reaching the gate never moves the stage. `readyToApprove: true` is a hint for the UI to
//      offer the transition; the transition is still an explicit, separately gated request.
//
// See tests/helpers/routeClient.ts for why this needs no server. Runs over the network against
// the shared hosted project (CLAUDE.md §9).

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

const SUNDAY_DATE = "2027-05-02";

async function callApprove(assignmentId: string, body: unknown) {
  const { POST } = await import("@/app/api/assignments/[id]/approve/route");
  const request = jsonRequest(
    `http://localhost/api/assignments/${assignmentId}/approve`,
    { method: "POST", body },
  );
  return readResponse(
    await POST(request, { params: Promise.resolve({ id: assignmentId }) }),
  );
}

describe("POST /api/assignments/[id]/approve", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let memberId = "";
  let topicId = "";
  let nextSlot = 1;

  async function seedAssignment(stage: string): Promise<string> {
    const slotNumber = nextSlot;
    nextSlot += 1;

    const { data, error } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayId,
        member_id: memberId,
        assignment_type: "sacrament_talk",
        slot_number: slotNumber,
        topic_id: topicId,
        pipeline_stage: stage,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed an assignment: ${error.message}`);
    return data.id;
  }

  async function readApprovals(assignmentId: string) {
    const { data, error } = await fixtures.service
      .from("assignment_approvals")
      .select("user_id, approved, comment")
      .eq("assignment_id", assignmentId);

    if (error) throw new Error(`Could not read approvals: ${error.message}`);
    return data ?? [];
  }

  async function readStage(assignmentId: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("assignments")
      .select("pipeline_stage")
      .eq("id", assignmentId)
      .single();

    if (error) throw new Error(`Could not read the stage: ${error.message}`);
    return data.pipeline_stage;
  }

  async function auditRowCount(): Promise<number> {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);

    if (error) throw new Error(`Could not count audit rows: ${error.message}`);
    return count ?? 0;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(
      [
        "bishop",
        "counselor1",
        "counselor2",
        "wardSecretary",
        "musicCoordinator",
        "wardBBishop",
      ],
      {
        notificationTriggers: [
          {
            triggerKey: "plan_change_requested",
            defaultRoles: ["bishop", "counselor"],
          },
        ],
      },
    );

    const { data: sunday, error: sundayError } = await fixtures.service
      .from("sundays")
      .insert({
        ward_id: fixtures.wardAId,
        date: SUNDAY_DATE,
        type: "standard",
        speaking_slots: 15,
      })
      .select("id")
      .single();
    if (sundayError) {
      throw new Error(`Could not seed a Sunday: ${sundayError.message}`);
    }
    sundayId = sunday.id;

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
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("recording an approval", () => {
    it("records one decision and does not open the gate", async () => {
      const assignmentId = await seedAssignment("review");
      await actAs(fixtures, "counselor1");

      const { status, body } = await callApprove(assignmentId, { approved: true });

      expect(status).toBe(200);
      expect(body.approved).toBe(true);
      expect(body.readyToApprove).toBe(false);
      expect(body.approvedCount).toBe(1);
      expect(body.bishopricCount).toBe(3);

      expect(await readApprovals(assignmentId)).toHaveLength(1);
      expect(await readStage(assignmentId)).toBe("review");

      // CLAUDE.md rule 6. The refusal test below asserts the converse; without this one a route
      // that audited nothing at all would satisfy both.
      const { data: audit } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "assignment_approval_recorded")
        .order("created_at", { ascending: false })
        .limit(1);

      expect(audit).toHaveLength(1);
      const detail = audit![0].detail as Record<string, unknown>;
      expect(detail.assignmentId).toBe(assignmentId);
      expect(detail.approved).toBe(true);
      expect(detail.readyToApprove).toBe(false);
    });

    // The gate counts DISTINCT approving users against the bishopric roll. Three rows from one
    // counselor must never satisfy a three-person gate — migration 025's
    // assignment_approvals_one_per_user is the real boundary, and this proves it THROUGH the
    // route rather than by asserting the constraint exists.
    it("cannot be filled by one person approving repeatedly", async () => {
      const assignmentId = await seedAssignment("review");
      await actAs(fixtures, "counselor1");

      await callApprove(assignmentId, { approved: true });
      await callApprove(assignmentId, { approved: true });
      const { status, body } = await callApprove(assignmentId, { approved: true });

      expect(status).toBe(200);
      expect(body.readyToApprove).toBe(false);
      expect(body.approvedCount).toBe(1);

      // One row, not three. The upsert is keyed on (assignment_id, user_id).
      expect(await readApprovals(assignmentId)).toHaveLength(1);
      expect(await readStage(assignmentId)).toBe("review");
    });

    // Approval is never a side effect of the last decision being recorded. The stage still has
    // to be moved by an explicit transition through PATCH /api/assignments/[id], which
    // re-evaluates the gate — so a stale `readyToApprove: true` cannot approve anything.
    it("opens the gate on the third person and STILL leaves the stage at review", async () => {
      const assignmentId = await seedAssignment("review");

      await actAs(fixtures, "bishop");
      const first = await callApprove(assignmentId, { approved: true });
      expect(first.body.readyToApprove).toBe(false);

      await actAs(fixtures, "counselor1");
      const second = await callApprove(assignmentId, { approved: true });
      expect(second.body.readyToApprove).toBe(false);

      await actAs(fixtures, "counselor2");
      const third = await callApprove(assignmentId, { approved: true });

      expect(third.status).toBe(200);
      expect(third.body.readyToApprove).toBe(true);
      expect(third.body.approvedCount).toBe(3);

      expect(await readApprovals(assignmentId)).toHaveLength(3);
      expect(await readStage(assignmentId)).toBe("review");
    });
  });

  describe("requesting changes", () => {
    it("refuses a change request with no comment, in the schema's own words", async () => {
      const assignmentId = await seedAssignment("review");
      await actAs(fixtures, "counselor1");

      const { status, body } = await callApprove(assignmentId, { approved: false });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe(
        "Say what needs changing — the planner only sees this comment.",
      );
      expect(await readApprovals(assignmentId)).toHaveLength(0);
      expect(await readStage(assignmentId)).toBe("review");
    });

    it("refuses a change request whose comment is empty", async () => {
      const assignmentId = await seedAssignment("review");
      await actAs(fixtures, "counselor1");

      const { status, body } = await callApprove(assignmentId, {
        approved: false,
        comment: "",
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("Say what needs changing");
    });

    // The refuser's OWN row stays. It carries the comment saying what to change, which is the
    // only explanation the planner ever gets — clearing it with the stale approvals would
    // delete the reason along with the decisions.
    it("sends the plan back, clears the others, and keeps the refuser's own row", async () => {
      const assignmentId = await seedAssignment("review");

      await actAs(fixtures, "bishop");
      await callApprove(assignmentId, { approved: true });

      await actAs(fixtures, "counselor1");
      await callApprove(assignmentId, { approved: true });

      await actAs(fixtures, "counselor2");
      const { status, body } = await callApprove(assignmentId, {
        approved: false,
        comment: "Please pick a different topic — we had this one last month.",
      });

      expect(status).toBe(200);
      expect(body.approved).toBe(false);
      expect(body.readyToApprove).toBe(false);

      expect(await readStage(assignmentId)).toBe("plan");

      const approvals = await readApprovals(assignmentId);
      expect(approvals).toHaveLength(1);
      expect(approvals[0].user_id).toBe(fixtures.user("counselor2").id);
      expect(approvals[0].approved).toBe(false);
      expect(approvals[0].comment).toContain("different topic");
    });
  });

  describe("refusals", () => {
    // An approval on a plan that has already moved on is meaningless, and worse, it would sit in
    // the table looking like a live decision about the plan's current shape.
    it("refuses an assignment that is not at review, telling the caller to reload", async () => {
      const assignmentId = await seedAssignment("plan");
      await actAs(fixtures, "counselor1");

      const { status, body } = await callApprove(assignmentId, { approved: true });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("not waiting for approval");
      expect(errorMessage(body)).toContain("Reload");
      expect(await readApprovals(assignmentId)).toHaveLength(0);
    });

    // Both of these lack talks.approve, and assertCan runs before the assignment is read — so
    // the answer is 403 rather than a 404 that would leak whether the id exists.
    it("refuses the ward secretary and the music coordinator", async () => {
      const assignmentId = await seedAssignment("review");

      for (const handle of ["wardSecretary", "musicCoordinator"] as const) {
        await actAs(fixtures, handle);
        const { status, body } = await callApprove(assignmentId, { approved: true });

        expect(status, `${handle} was not refused`).toBe(403);
        expect(errorMessage(body)).toBe("You do not have permission to do that.");
      }

      expect(await readApprovals(assignmentId)).toHaveLength(0);
    });

    it("answers 404 for an assignment in another ward", async () => {
      const assignmentId = await seedAssignment("review");
      await actAs(fixtures, "wardBBishop");

      const { status, body } = await callApprove(assignmentId, { approved: true });

      expect(status).toBe(404);
      expect(errorMessage(body)).toBe("That assignment is not in your ward.");
      expect(await readApprovals(assignmentId)).toHaveLength(0);
    });

    it("refuses an id that is not a uuid", async () => {
      await actAs(fixtures, "counselor1");

      const { status, body } = await callApprove("not-a-uuid", { approved: true });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("That assignment id is not valid.");
    });

    it("leaves audit_log untouched on every refusal", async () => {
      const reviewAssignmentId = await seedAssignment("review");
      const planAssignmentId = await seedAssignment("plan");

      const before = await auditRowCount();

      await actAs(fixtures, "counselor1");
      await callApprove(reviewAssignmentId, { approved: false });
      await callApprove(planAssignmentId, { approved: true });
      await callApprove("not-a-uuid", { approved: true });

      await actAs(fixtures, "wardSecretary");
      await callApprove(reviewAssignmentId, { approved: true });

      await actAs(fixtures, "musicCoordinator");
      await callApprove(reviewAssignmentId, { approved: true });

      await actAs(fixtures, "wardBBishop");
      await callApprove(reviewAssignmentId, { approved: true });

      expect(await auditRowCount()).toBe(before);
    });
  });
});
