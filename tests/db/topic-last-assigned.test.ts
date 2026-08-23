// @vitest-environment node
//
// `topics.last_assigned_at` moves at exactly ONE moment: an assignment reaching `approve`. This
// suite drives the real PATCH /api/assignments/[id] route against the hosted project and
// re-reads the topic row afterwards, because the whole value of the stamp is that a bishopric
// planning next month can see what they have used — and a stamp that fires at the wrong stage is
// invisible until somebody notices a repeat.
//
// Three claims, each of which has to hold on its own:
//   1. `review` -> `approve` stamps it.
//   2. No other transition stamps it — `plan` -> `review` and `speak` -> `appreciate` prove the
//      two ends of that.
//   3. A revert does NOT un-stamp it. The topic genuinely was chosen for a Sunday.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const SUNDAY_DATE = "2027-06-06";

async function callPatch(assignmentId: string, body: unknown) {
  const { PATCH } = await import("@/app/api/assignments/[id]/route");
  const request = jsonRequest(`http://localhost/api/assignments/${assignmentId}`, {
    method: "PATCH",
    body,
  });
  return readResponse(
    await PATCH(request, { params: Promise.resolve({ id: assignmentId }) }),
  );
}

describe("topics.last_assigned_at", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let memberId = "";
  let nextSlot = 1;

  async function seedTopic(title: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("topics")
      .insert({
        ward_id: fixtures.wardAId,
        title: `${title} ${fixtures.runId}`,
        category: "doctrinal",
        source: "manual",
        status: "active",
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed a topic: ${error.message}`);
    return data.id;
  }

  async function seedAssignment(topicId: string, stage: string): Promise<string> {
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
        // `speak` -> `appreciate` needs this; harmless on the others.
        sunday_confirmed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed an assignment: ${error.message}`);
    return data.id;
  }

  // Every approval the ward's whole bishopric roll can give, so `review` -> `approve` passes its
  // gate. The gate counts PEOPLE, so this needs three genuinely different users (talks-a).
  async function approveWithEveryone(assignmentId: string): Promise<void> {
    for (const handle of ["bishop", "counselor1", "counselor2"] as const) {
      const { error } = await fixtures.service.from("assignment_approvals").insert({
        ward_id: fixtures.wardAId,
        assignment_id: assignmentId,
        user_id: fixtures.user(handle).id,
        approved: true,
      });
      if (error) throw new Error(`Could not seed an approval: ${error.message}`);
    }
  }

  async function readStamp(topicId: string): Promise<string | null> {
    const { data, error } = await fixtures.service
      .from("topics")
      .select("last_assigned_at")
      .eq("id", topicId)
      .single();

    if (error) throw new Error(`Could not re-read the topic: ${error.message}`);
    return data.last_assigned_at;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2"], {
      // emitNotification refuses an unknown trigger key with a warning and no row, and the
      // approve path emits one (talks-a).
      notificationTriggers: [
        { triggerKey: "plan_approved", defaultRoles: ["bishop", "counselor"] },
        { triggerKey: "plan_submitted", defaultRoles: ["bishop", "counselor"] },
      ],
    });

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
    if (sundayError) throw new Error(sundayError.message);
    sundayId = sunday.id;

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        first_name: "Speaker",
        last_name: `Fixture${fixtures.runId}`,
        category: "adult",
        status: "active",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(memberError.message);
    memberId = member.id;

    await actAs(fixtures, "bishop");
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("stamps the topic when an assignment reaches approve", async () => {
    const topicId = await seedTopic("Stamped at approve");
    const assignmentId = await seedAssignment(topicId, "review");

    expect(await readStamp(topicId), "seeded topic already had a stamp").toBeNull();

    await approveWithEveryone(assignmentId);

    const { status } = await callPatch(assignmentId, {
      action: "transition",
      to: "approve",
    });

    expect(status).toBe(200);
    expect(await readStamp(topicId)).not.toBeNull();
  });

  // Not at `plan`. A plan that never gets approved should not burn the topic — the bishopric
  // would stop offering something they only ever considered.
  it("does NOT stamp on plan -> review", async () => {
    const topicId = await seedTopic("Not stamped at review");
    const assignmentId = await seedAssignment(topicId, "plan");

    const { status } = await callPatch(assignmentId, {
      action: "transition",
      to: "review",
    });

    expect(status).toBe(200);
    expect(await readStamp(topicId)).toBeNull();
  });

  // Not at `complete` either. The signal is needed while the bishopric is still CHOOSING, which
  // is weeks before the talk is given — one that arrives afterwards arrives too late to be worth
  // anything (04-talks-pipeline.md).
  it("does NOT stamp on a later transition when approve was skipped in the fixture", async () => {
    const topicId = await seedTopic("Not stamped at appreciate");
    const assignmentId = await seedAssignment(topicId, "speak");

    const { status } = await callPatch(assignmentId, {
      action: "transition",
      to: "appreciate",
    });

    expect(status).toBe(200);
    expect(await readStamp(topicId)).toBeNull();
  });

  // The topic genuinely WAS chosen for a Sunday. Rolling the stamp back would re-offer a topic
  // the bishopric had just discussed, so the stamp records consideration rather than completion.
  it("leaves the stamp in place when the assignment is sent back to plan", async () => {
    const topicId = await seedTopic("Stamp survives a revert");
    const assignmentId = await seedAssignment(topicId, "review");

    await approveWithEveryone(assignmentId);

    await callPatch(assignmentId, { action: "transition", to: "approve" });

    const stamped = await readStamp(topicId);
    expect(stamped).not.toBeNull();

    const { status } = await callPatch(assignmentId, {
      action: "transition",
      to: "plan",
      reason: "The speaker is out of town that week.",
    });

    expect(status).toBe(200);
    expect(await readStamp(topicId)).toBe(stamped);
  });

  // A stamp failure must not fail the transition. There is no topic to stamp here at all, so the
  // approve has to succeed on its own — the same contract writeAuditLog has.
  it("approves an assignment that carries no topic at all", async () => {
    const topicId = await seedTopic("Detached before approve");
    const assignmentId = await seedAssignment(topicId, "review");

    // Clearing the topic directly, because updateAssignmentFields would also clear the
    // approvals this fixture is about to need.
    const { error } = await fixtures.service
      .from("assignments")
      .update({ topic_id: null })
      .eq("id", assignmentId);
    if (error) throw new Error(error.message);

    await approveWithEveryone(assignmentId);

    const { status } = await callPatch(assignmentId, {
      action: "transition",
      to: "approve",
    });

    expect(status).toBe(200);
    expect(await readStamp(topicId)).toBeNull();
  });
});
