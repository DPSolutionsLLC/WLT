// @vitest-environment node
//
// PATCH /api/assignments/[id] — the richest route in the app: three actions, each with side
// effects that outlive the response. Every one of those side effects is asserted by RE-READING
// the row with the service client, never by trusting the JSON the route handed back.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.
// Runs over the network against the shared hosted project (CLAUDE.md §9).

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

const SUNDAY_DATE = "2027-04-04";

// `params` is a Promise in Next 16. Passing a bare object type-checks against nothing and fails
// at runtime (plans/retros/foundation-a-scaffold.md), so every call in this suite goes through
// here and there is no second way to do it.
async function callPatch(assignmentId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/assignments/[id]/route");
  const request = jsonRequest(
    `http://localhost/api/assignments/${assignmentId}`,
    { method: "PATCH", body },
  );
  return readResponse(
    await PATCH(request, { params: Promise.resolve({ id: assignmentId }) }),
  );
}

describe("PATCH /api/assignments/[id]", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let wardBSundayId = "";
  let memberId = "";
  let topicId = "";
  let wardBAssignmentId = "";

  // Slots are handed out sequentially so no two fixtures in this file collide on the Sunday.
  // The Sunday carries the maximum 15 slots for the same reason.
  let nextSlot = 1;

  type AssignmentSeed = {
    stage: string;
    speaker: "member" | "external" | "none";
    waived?: boolean;
    thankYouSentAt?: string;
  };

  async function seedAssignment(seed: AssignmentSeed): Promise<string> {
    const slotNumber = nextSlot;
    nextSlot += 1;

    const { data, error } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayId,
        member_id: seed.speaker === "member" ? memberId : null,
        external_speaker_name:
          seed.speaker === "external" ? "President Visitor" : null,
        assignment_type: "sacrament_talk",
        slot_number: slotNumber,
        topic_id: topicId,
        pipeline_stage: seed.stage,
        request_notes: "seeded",
        contact_waived_at: seed.waived ? new Date().toISOString() : null,
        contact_waived_by: seed.waived ? fixtures.user("bishop").id : null,
        thank_you_sent_at: seed.thankYouSentAt ?? null,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed an assignment: ${error.message}`);
    return data.id;
  }

  async function readAssignment(assignmentId: string) {
    const { data, error } = await fixtures.service
      .from("assignments")
      .select(
        "id, member_id, external_speaker_name, pipeline_stage, request_notes, contact_waived_at, slot_number",
      )
      .eq("id", assignmentId)
      .single();

    if (error) throw new Error(`Could not re-read the assignment: ${error.message}`);
    return data;
  }

  async function countHistory(assignmentId: string): Promise<number> {
    const { count, error } = await fixtures.service
      .from("assignment_history")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId);

    if (error) throw new Error(`Could not count history rows: ${error.message}`);
    return count ?? 0;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "counselor1", "counselor2", "wardSecretary", "wardBBishop"],
      {
        // emitNotification refuses an unknown trigger key with a warning and no row, so the
        // notification assertion below is only meaningful once this exists (talks-a).
        notificationTriggers: [
          {
            triggerKey: "plan_change_requested",
            defaultRoles: ["bishop", "counselor"],
          },
        ],
      },
    );

    const seedSunday = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({
          ward_id: wardId,
          date: SUNDAY_DATE,
          type: "standard",
          speaking_slots: 15,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Could not seed a Sunday: ${error.message}`);
      return data.id;
    };

    sundayId = await seedSunday(fixtures.wardAId);
    wardBSundayId = await seedSunday(fixtures.wardBId);

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

    const { data: wardB, error: wardBError } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: fixtures.wardBId,
        sunday_id: wardBSundayId,
        assignment_type: "sacrament_talk",
        slot_number: 1,
        pipeline_stage: "plan",
        request_notes: "ward B only",
      })
      .select("id")
      .single();
    if (wardBError) {
      throw new Error(`Could not seed ward B's assignment: ${wardBError.message}`);
    }
    wardBAssignmentId = wardB.id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe('action: "update"', () => {
    it("saves the fields it was given", async () => {
      const assignmentId = await seedAssignment({ stage: "plan", speaker: "member" });
      await actAs(fixtures, "bishop");

      const { status } = await callPatch(assignmentId, {
        action: "update",
        fields: { requestNotes: "Ask about their mission." },
      });

      expect(status).toBe(200);
      expect((await readAssignment(assignmentId)).request_notes).toBe(
        "Ask about their mission.",
      );

      // CLAUDE.md rule 6. The detail carries only the field NAMES — request_notes can hold a
      // member's circumstances and an audit row is bishopric-readable (rule 8).
      const { data: audit } = await fixtures.service
        .from("audit_log")
        .select("action, detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "assignment_updated")
        .order("created_at", { ascending: false })
        .limit(1);

      expect(audit).toHaveLength(1);
      const detail = audit![0].detail as Record<string, unknown>;
      expect(detail.assignmentId).toBe(assignmentId);
      expect(detail.changedFields).toEqual(["requestNotes"]);
      expect(JSON.stringify(audit![0])).not.toContain("Ask about their mission");
    });

    // An approval is a decision about the plan AS IT STOOD. Editing it invalidates every
    // approval on it — without this a counselor approves a plan and it changes underneath them
    // with nothing anywhere saying so.
    it("clears every existing approval, proven by re-read", async () => {
      const assignmentId = await seedAssignment({
        stage: "review",
        speaker: "member",
      });

      const { error: approvalError } = await fixtures.service
        .from("assignment_approvals")
        .insert([
          {
            ward_id: fixtures.wardAId,
            assignment_id: assignmentId,
            user_id: fixtures.user("counselor1").id,
            approved: true,
          },
          {
            ward_id: fixtures.wardAId,
            assignment_id: assignmentId,
            user_id: fixtures.user("counselor2").id,
            approved: true,
          },
        ]);
      if (approvalError) throw new Error(approvalError.message);

      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "update",
        fields: { slotLengthMinutes: 12 },
      });

      expect(status).toBe(200);
      expect(body.approvalsInvalidated).toBe(true);

      const { count } = await fixtures.service
        .from("assignment_approvals")
        .select("id", { count: "exact", head: true })
        .eq("assignment_id", assignmentId);

      expect(count).toBe(0);
    });

    it("emits plan_change_requested when it invalidated approvals", async () => {
      const assignmentId = await seedAssignment({
        stage: "review",
        speaker: "member",
      });

      const { error: approvalError } = await fixtures.service
        .from("assignment_approvals")
        .insert({
          ward_id: fixtures.wardAId,
          assignment_id: assignmentId,
          user_id: fixtures.user("counselor1").id,
          approved: true,
        });
      if (approvalError) throw new Error(approvalError.message);

      const { count: before } = await fixtures.service
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("ward_id", fixtures.wardAId)
        .eq("trigger_key", "plan_change_requested");

      await actAs(fixtures, "bishop");
      await callPatch(assignmentId, {
        action: "update",
        fields: { slotLengthMinutes: 14 },
      });

      const { count: after } = await fixtures.service
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("ward_id", fixtures.wardAId)
        .eq("trigger_key", "plan_change_requested");

      expect(after ?? 0).toBeGreaterThan(before ?? 0);
    });

    it("does not notify when there was nothing to invalidate", async () => {
      const assignmentId = await seedAssignment({ stage: "plan", speaker: "member" });

      const { count: before } = await fixtures.service
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("ward_id", fixtures.wardAId)
        .eq("trigger_key", "plan_change_requested");

      await actAs(fixtures, "bishop");
      const { status, body } = await callPatch(assignmentId, {
        action: "update",
        fields: { slotLengthMinutes: 11 },
      });

      expect(status).toBe(200);
      expect(body.approvalsInvalidated).toBe(false);

      const { count: after } = await fixtures.service
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("ward_id", fixtures.wardAId)
        .eq("trigger_key", "plan_change_requested");

      expect(after ?? 0).toBe(before ?? 0);
    });

    // The schema is a discriminated union with no `to` on the update arm, so a field update that
    // also moves the stage is unrepresentable rather than merely discouraged. This is the phase's
    // first pitfall pinned at the route.
    it("cannot move the stage as a side effect of an edit", async () => {
      const assignmentId = await seedAssignment({ stage: "plan", speaker: "member" });
      await actAs(fixtures, "bishop");

      const { status } = await callPatch(assignmentId, {
        action: "update",
        fields: { pipelineStage: "review" },
      });

      expect(status).toBe(400);
      expect((await readAssignment(assignmentId)).pipeline_stage).toBe("plan");
    });

    // The same superRefine the create schema uses, on the edit path. The
    // assignments_speaker_exactly_one CHECK would refuse this anyway; a 400 naming the conflict
    // is what stops that becoming a 500 carrying a constraint name.
    it("refuses an edit setting a member and an external speaker together", async () => {
      const assignmentId = await seedAssignment({ stage: "plan", speaker: "member" });
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "update",
        fields: {
          memberId,
          externalSpeaker: { name: "President Visitor", title: null },
        },
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe(
        "Choose a ward member or type an outside speaker's name, not both.",
      );
      expect((await readAssignment(assignmentId)).external_speaker_name).toBeNull();
    });

    it("refuses an empty field set", async () => {
      const assignmentId = await seedAssignment({ stage: "plan", speaker: "member" });
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "update",
        fields: {},
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Nothing was changed.");
    });
  });

  describe('action: "transition"', () => {
    it("refuses a skipped stage, naming the legal next one", async () => {
      const assignmentId = await seedAssignment({ stage: "plan", speaker: "member" });
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "transition",
        to: "request",
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("one stage at a time");
      expect(errorMessage(body)).toContain("The next stage after Planning is In Review.");
      expect((await readAssignment(assignmentId)).pipeline_stage).toBe("plan");
    });

    it("refuses a backward move with no reason, naming what is missing", async () => {
      const assignmentId = await seedAssignment({
        stage: "review",
        speaker: "member",
      });
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "transition",
        to: "plan",
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("Say why this is going back a stage");
      expect((await readAssignment(assignmentId)).pipeline_stage).toBe("review");
    });

    it("refuses a blank reason — whitespace is not an explanation", async () => {
      const assignmentId = await seedAssignment({
        stage: "review",
        speaker: "member",
      });
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "transition",
        to: "plan",
        reason: "   ",
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("Say why this is going back a stage");
    });

    // The plan asked for a 409 here, from canTransition's "Only the bishopric can move an
    // assignment back a stage". That branch is still UNREACHABLE through this route, but the
    // reason CHANGED with migration 038 and the history is worth keeping:
    //
    // It used to be a 404. `assignments` was in migration 019's bishopric-only policy loop, so
    // anyone who could READ an assignment was already bishopric and getAssignment() answered 404
    // to everyone else before any permission was checked. This test recorded that, and noted the
    // rule was defence in depth "for the day a ward's role_access override grants talks.plan more
    // widely".
    //
    // Migration 038 made a ward_secretary able to READ an assignment — `talks.view` had been
    // granted to three non-bishopric roles in lib/auth/permissions.ts and refused by the database
    // ever since, which program-a found when a secretary's sacrament program assembled with every
    // speaking slot silently empty.
    //
    // So the read now succeeds and the route reaches assertCan, which refuses `talks.plan`. 403,
    // not 404 — and that is strictly better: the caller is told they lack permission rather than
    // told the assignment does not exist.
    //
    // canTransition's bishopric branch stays untested here because assertCan still fires first.
    // It is tested where it is reachable, in tests/lib/pipelineTransitions.test.ts ("refuses a
    // non-bishopric actor even with a reason"), and it is still the guard for a ward whose
    // role_access override grants talks.plan more widely. Do not delete it as dead code.
    it("answers 403 to a caller who may read an assignment but not move it back", async () => {
      const assignmentId = await seedAssignment({
        stage: "review",
        speaker: "member",
      });
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callPatch(assignmentId, {
        action: "transition",
        to: "plan",
        reason: "Moving it back.",
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toBe("You do not have permission to do that.");
      expect((await readAssignment(assignmentId)).pipeline_stage).toBe("review");
    });

    // A decline. The stage move alone would leave the speaker's name in the slot, reading as
    // somebody who is still coming.
    it("clears the speaker on request -> plan and records the decline", async () => {
      const assignmentId = await seedAssignment({
        stage: "request",
        speaker: "member",
      });
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "transition",
        to: "plan",
        reason: "Brother Andersen is out of town that week.",
      });

      expect(status).toBe(200);

      // The response must not still name a speaker the server has just removed.
      expect((body.assignment as { memberId: string | null }).memberId).toBeNull();

      const row = await readAssignment(assignmentId);
      expect(row.member_id).toBeNull();
      expect(row.pipeline_stage).toBe("plan");

      const { data: history } = await fixtures.service
        .from("assignment_history")
        .select("outcome, member_id")
        .eq("assignment_id", assignmentId);

      expect(history).toHaveLength(1);
      expect(history?.[0].outcome).toBe("declined");
      expect(history?.[0].member_id).toBe(memberId);

      const { data: audit } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "assignment_stage_changed")
        .order("created_at", { ascending: false })
        .limit(1);

      expect(audit).toHaveLength(1);
      const detail = audit![0].detail as Record<string, unknown>;
      expect(detail.from).toBe("request");
      expect(detail.to).toBe("plan");
      expect(detail.declined).toBe(true);
      expect(detail.historyWritten).toBe(true);
    });

    // ITER-004, enforced by the schema rather than by everybody remembering to check:
    // assignment_history.member_id is `not null`, so an external speaker cannot have a row and
    // speaker history is not distorted by somebody who was never on the roster.
    it("writes no history row when an external speaker declines", async () => {
      const assignmentId = await seedAssignment({
        stage: "request",
        speaker: "external",
      });
      await actAs(fixtures, "bishop");

      const { status } = await callPatch(assignmentId, {
        action: "transition",
        to: "plan",
        reason: "The stake sent someone else.",
      });

      expect(status).toBe(200);

      const row = await readAssignment(assignmentId);
      expect(row.external_speaker_name).toBeNull();
      expect(row.pipeline_stage).toBe("plan");
      expect(await countHistory(assignmentId)).toBe(0);
    });

    it("writes a completed history row for a member reaching complete", async () => {
      const assignmentId = await seedAssignment({
        stage: "appreciate",
        speaker: "member",
        thankYouSentAt: new Date().toISOString(),
      });
      await actAs(fixtures, "bishop");

      const { status } = await callPatch(assignmentId, {
        action: "transition",
        to: "complete",
      });

      expect(status).toBe(200);

      const { data: history } = await fixtures.service
        .from("assignment_history")
        .select("outcome")
        .eq("assignment_id", assignmentId);

      expect(history).toHaveLength(1);
      expect(history?.[0].outcome).toBe("completed");
    });

    it("writes no history row for an external speaker reaching complete", async () => {
      const assignmentId = await seedAssignment({
        stage: "appreciate",
        speaker: "external",
        waived: true,
      });
      await actAs(fixtures, "bishop");

      const { status } = await callPatch(assignmentId, {
        action: "transition",
        to: "complete",
      });

      expect(status).toBe(200);
      expect((await readAssignment(assignmentId)).pipeline_stage).toBe("complete");
      expect(await countHistory(assignmentId)).toBe(0);
    });

    // The waiver satisfies exactly four gates and APPRECIATE is deliberately not one of them.
    // Whether the meeting happened is a fact about the MEETING, not about who spoke in it, so a
    // waived external speaker still needs somebody to confirm it took place (ITER-004).
    it("refuses speak -> appreciate with no confirmation, waiver or not", async () => {
      const assignmentId = await seedAssignment({
        stage: "speak",
        speaker: "external",
        waived: true,
      });
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "transition",
        to: "appreciate",
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("Confirm the meeting happened first.");
      expect((await readAssignment(assignmentId)).pipeline_stage).toBe("speak");
    });

    it("refuses a forward move whose gate is unmet", async () => {
      const assignmentId = await seedAssignment({
        stage: "appreciate",
        speaker: "member",
      });
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "transition",
        to: "complete",
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("Send the thank-you first.");
      expect((await readAssignment(assignmentId)).pipeline_stage).toBe("appreciate");
    });
  });

  describe('action: "waive_contact"', () => {
    // The assignments_waiver_external_only CHECK is the real boundary. Refusing here first is
    // what makes the answer an honest sentence rather than a 500 carrying a constraint name.
    it("refuses a waiver on a ward member, and says what to do instead", async () => {
      const assignmentId = await seedAssignment({
        stage: "request",
        speaker: "member",
      });
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "waive_contact",
      });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("on the ward roster");
      expect(errorMessage(body)).toContain("contact them rather than waiving it");
      expect((await readAssignment(assignmentId)).contact_waived_at).toBeNull();
    });

    // A waiver is a FACT about the assignment, not a transition. Advancing the stage is still a
    // separate, explicit request — the same separation the update action keeps.
    it("waives an external speaker without moving the stage", async () => {
      const assignmentId = await seedAssignment({
        stage: "request",
        speaker: "external",
      });
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(assignmentId, {
        action: "waive_contact",
      });

      expect(status).toBe(200);
      expect((body.assignment as { stage: string }).stage).toBe("request");

      const row = await readAssignment(assignmentId);
      expect(row.contact_waived_at).not.toBeNull();
      expect(row.pipeline_stage).toBe("request");
    });
  });

  describe("identity and scope", () => {
    it("answers 404 for an assignment in another ward", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch(wardBAssignmentId, {
        action: "update",
        fields: { requestNotes: "written from ward A" },
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toBe("That assignment is not in your ward.");

      // A denied UPDATE is a zero-row success, not an error, so the row itself is the assertion
      // that matters (plans/retros/foundation-c-services.md).
      const { data } = await fixtures.service
        .from("assignments")
        .select("request_notes")
        .eq("id", wardBAssignmentId)
        .single();

      expect(data?.request_notes).toBe("ward B only");
    });

    it("refuses an id that is not a uuid", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPatch("not-a-uuid", {
        action: "update",
        fields: { requestNotes: "nope" },
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("That assignment id is not valid.");
    });

    it("refuses an unknown action", async () => {
      const assignmentId = await seedAssignment({ stage: "plan", speaker: "member" });
      await actAs(fixtures, "bishop");

      const { status } = await callPatch(assignmentId, { action: "delete_everything" });

      expect(status).toBe(400);
    });

    // CLAUDE.md rule 6 says every MUTATION writes an audit row. The converse matters just as
    // much: a request that changed nothing must not leave a row claiming it did.
    it("leaves audit_log untouched on every refusal", async () => {
      const memberAssignmentId = await seedAssignment({
        stage: "request",
        speaker: "member",
      });
      const planAssignmentId = await seedAssignment({
        stage: "plan",
        speaker: "member",
      });

      const { count: before } = await fixtures.service
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("ward_id", fixtures.wardAId);

      await actAs(fixtures, "bishop");
      await callPatch(memberAssignmentId, { action: "waive_contact" });
      await callPatch(planAssignmentId, { action: "transition", to: "request" });
      await callPatch(planAssignmentId, { action: "update", fields: {} });
      await callPatch(planAssignmentId, {
        action: "update",
        fields: { memberId, externalSpeaker: { name: "Someone", title: null } },
      });
      await callPatch("not-a-uuid", { action: "update", fields: { requestNotes: "x" } });

      await actAs(fixtures, "wardSecretary");
      await callPatch(planAssignmentId, {
        action: "update",
        fields: { requestNotes: "should not land" },
      });

      const { count: after } = await fixtures.service
        .from("audit_log")
        .select("id", { count: "exact", head: true })
        .eq("ward_id", fixtures.wardAId);

      expect(after).toBe(before);
    });
  });
});
