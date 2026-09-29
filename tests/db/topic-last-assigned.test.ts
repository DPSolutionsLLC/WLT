// @vitest-environment node
//
// `topics.last_assigned_at` NO LONGER MOVES — REVERSED 2026-09-29 (migration 086, user decision 1
// in plans/sacrament-topics-screen-rebuild.md). It used to be stamped when an assignment reached
// `approve`, so the topic LIBRARY could show what had been used. There is no library any more: a
// talk's topic is its words, and "what has been used" is read straight off the talks. This suite
// used to prove the stamp fired at approve; it is kept, inverted, so the reversal reads as a
// decision rather than a disappearance.
//
// Two claims:
//   1. `review` -> `approve` leaves the topic row untouched.
//   2. Approve still succeeds on a talk with no topic at all.
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

describe("topics.last_assigned_at is retired", () => {
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
        topic_title: `Topic ${fixtures.runId}`,
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

  it("does NOT stamp the topic when an assignment reaches approve", async () => {
    const topicId = await seedTopic("Not stamped at approve");
    const assignmentId = await seedAssignment(topicId, "review");

    await approveWithEveryone(assignmentId);

    const { status } = await callPatch(assignmentId, {
      action: "transition",
      to: "approve",
    });

    expect(status).toBe(200);
    expect(await readStamp(topicId)).toBeNull();
  });

  // Approve's gate is the approvals, never the topic, so a talk whose topic was cleared after review
  // still approves.
  it("approves an assignment that carries no topic at all", async () => {
    const topicId = await seedTopic("Detached before approve");
    const assignmentId = await seedAssignment(topicId, "review");

    // Clearing the topic directly, because updateAssignmentFields would also clear the
    // approvals this fixture is about to need.
    const { error } = await fixtures.service
      .from("assignments")
      .update({ topic_id: null, topic_title: null })
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
