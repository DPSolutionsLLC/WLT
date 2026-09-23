// @vitest-environment node
//
// PATCH /api/sundays/[id]/topics-finalized, and the auto-unfinalize rule that hangs off it.
//
// ---------------------------------------------------------------------------
// THE HALF THAT NEEDS A DATABASE
// ---------------------------------------------------------------------------
// tests/lib/topicsFinalize.test.ts asserts the RULE — which patches un-finalize and which do not
// — purely, and reads the three routes' source to prove they call the helper at all. What it
// cannot see is whether the call actually CLEARS THE COLUMN, because that is a write.
//
// So this suite finalizes a Sunday and then does the things a conductor does, checking the stamp
// after each one. The sharpest assertion in the slice is the negative: advancing a speaker
// through the pipeline must leave a finalized Sunday finalized. Getting that backwards unravels a
// month of topics as speakers are contacted, and nothing anywhere would say why.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

describe("PATCH /api/sundays/[id]/topics-finalized", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let otherSundayId = "";
  let memberId = "";
  let topicId = "";
  let otherTopicId = "";
  let assignmentId = "";

  const callFinalize = async (id: string, finalized: boolean) => {
    const { PATCH } = await import("@/app/api/sundays/[id]/topics-finalized/route");

    return readResponse(
      await PATCH(
        jsonRequest(`http://localhost/api/sundays/${id}/topics-finalized`, {
          method: "PATCH",
          body: { finalized },
        }),
        { params: Promise.resolve({ id }) },
      ),
    );
  };

  const callAssignmentPatch = async (id: string, body: unknown) => {
    const { PATCH } = await import("@/app/api/assignments/[id]/route");

    return readResponse(
      await PATCH(
        jsonRequest(`http://localhost/api/assignments/${id}`, { method: "PATCH", body }),
        { params: Promise.resolve({ id }) },
      ),
    );
  };

  const readStamp = async (id: string): Promise<string | null> => {
    const { data, error } = await fixtures.service
      .from("sundays")
      .select("topics_finalized_at")
      .eq("id", id)
      .single();

    if (error) throw new Error(error.message);
    return data.topics_finalized_at;
  };

  // Finalize through the SERVICE client rather than the route, so a test about un-finalizing does
  // not depend on the route it is not testing.
  const finalizeDirectly = async (id: string) => {
    const { error } = await fixtures.service
      .from("sundays")
      .update({ topics_finalized_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new Error(error.message);
  };

  const resetAssignment = async () => {
    const { error } = await fixtures.service
      .from("assignments")
      .update({ pipeline_stage: "plan", topic_id: topicId })
      .eq("id", assignmentId);

    if (error) throw new Error(error.message);
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2", "musicCoordinator"]);

    const seedSunday = async (date: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({
          ward_id: fixtures.wardAId,
          date,
          type: "standard",
          speaking_slots: 3,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    sundayId = await seedSunday("2027-04-04");
    otherSundayId = await seedSunday("2027-04-11");

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
    if (memberError) throw new Error(memberError.message);
    memberId = member.id;

    const seedTopic = async (title: string) => {
      const { data, error } = await fixtures.service
        .from("topics")
        .insert({ ward_id: fixtures.wardAId, title, source: "manual" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    topicId = await seedTopic(`Fixture topic ${fixtures.runId}`);
    otherTopicId = await seedTopic(`Second fixture topic ${fixtures.runId}`);

    const { data: assignment, error: assignmentError } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayId,
        member_id: memberId,
        assignment_type: "sacrament_talk",
        slot_number: 1,
        topic_id: topicId,
        pipeline_stage: "plan",
      })
      .select("id")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);
    assignmentId = assignment.id;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("the happy path", () => {
    it("finalizes, and answers with the Sunday carrying its stamp", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callFinalize(sundayId, true);
      const sunday = body.sunday as { topicsFinalizedAt: string | null };

      expect(status).toBe(200);
      expect(sunday.topicsFinalizedAt).not.toBeNull();
      expect(await readStamp(sundayId)).toBe(sunday.topicsFinalizedAt);
    });

    // IDEMPOTENT, AND THE STAMP DOES NOT MOVE. This is the whole reason the rule lives in
    // setTopicsFinalized() rather than in the route: the recorded instant must stay the one
    // somebody DECIDED at, not the one they last pressed the button at — and with no
    // `topics_finalized_by` column (migration 078), that stamp plus the audit row is the entire
    // history of the decision.
    it("does not move the stamp when finalized twice", async () => {
      await actAs(fixtures, "bishop");

      const first = await readStamp(sundayId);
      expect(first).not.toBeNull();

      const { status } = await callFinalize(sundayId, true);

      expect(status).toBe(200);
      expect(await readStamp(sundayId)).toBe(first);
    });

    it("un-finalizes back to null, and is idempotent there too", async () => {
      await actAs(fixtures, "bishop");

      expect((await callFinalize(sundayId, false)).status).toBe(200);
      expect(await readStamp(sundayId)).toBeNull();

      expect((await callFinalize(sundayId, false)).status).toBe(200);
      expect(await readStamp(sundayId)).toBeNull();
    });

    it("refuses a music coordinator, who reads the signal but does not set it", async () => {
      await actAs(fixtures, "musicCoordinator");

      expect((await callFinalize(sundayId, true)).status).toBe(403);
      expect(await readStamp(sundayId)).toBeNull();
    });

    it("refuses a body that is not a boolean", async () => {
      await actAs(fixtures, "bishop");

      const { PATCH } = await import("@/app/api/sundays/[id]/topics-finalized/route");
      const { status } = await readResponse(
        await PATCH(
          jsonRequest(`http://localhost/api/sundays/${sundayId}/topics-finalized`, {
            method: "PATCH",
            body: { finalized: "yes" },
          }),
          { params: Promise.resolve({ id: sundayId }) },
        ),
      );

      expect(status).toBe(400);
    });

    it("writes an audit row naming which way it went", async () => {
      await actAs(fixtures, "bishop");
      await callFinalize(sundayId, true);

      const { data, error } = await fixtures.service
        .from("audit_log")
        .select("action, detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "sunday_topics_finalized")
        .order("created_at", { ascending: false })
        .limit(1);

      expect(error).toBeNull();
      expect(data?.[0]?.action).toBe("sunday_topics_finalized");
      expect((data?.[0]?.detail as { sundayId?: string })?.sundayId).toBe(sundayId);
    });
  });

  // ---------------------------------------------------------------------------
  // ⚠️ THE RULE IS ABOUT *WHAT* CHANGED, NEVER ABOUT *WHO* MOVED
  // ---------------------------------------------------------------------------
  describe("auto-unfinalize", () => {
    // BOTH DIRECTIONS. The rule names "a speaker accepting or DECLINING" as non-triggering, and a
    // decline is a BACKWARD move — so a version that cleared only on forward moves would pass half
    // of this.
    //
    // `plan -> review -> plan` rather than `review -> approve`: approving is gated on all three
    // bishopric approvals, which is scenario 012's subject and not this one's. Seeding three
    // approval rows here would make the test about the gate rather than about the stamp.
    it("SURVIVES a speaker being advanced through the pipeline, and moved back", async () => {
      await resetAssignment();
      await finalizeDirectly(sundayId);
      await actAs(fixtures, "bishop");

      expect((await callAssignmentPatch(assignmentId, {
        action: "transition",
        to: "review",
      })).status).toBe(200);

      expect(
        await readStamp(sundayId),
        "submitting a plan for review must not un-finalize a Sunday's topics",
      ).not.toBeNull();

      expect((await callAssignmentPatch(assignmentId, {
        action: "transition",
        to: "plan",
        reason: "The speaker asked for a different week",
      })).status).toBe(200);

      expect(
        await readStamp(sundayId),
        "moving a speaker BACK must not un-finalize a Sunday's topics either",
      ).not.toBeNull();
    });

    it("SURVIVES an edit that changes the speaker but not the topic", async () => {
      await resetAssignment();
      await finalizeDirectly(sundayId);
      await actAs(fixtures, "bishop");

      const { status } = await callAssignmentPatch(assignmentId, {
        action: "update",
        fields: { requestNotes: "Called on Tuesday" },
      });

      expect(status).toBe(200);
      expect(await readStamp(sundayId)).not.toBeNull();
    });

    it("CLEARS when a slot's topic changes", async () => {
      await resetAssignment();
      await finalizeDirectly(sundayId);
      await actAs(fixtures, "bishop");

      const { status } = await callAssignmentPatch(assignmentId, {
        action: "update",
        fields: { topicId: otherTopicId },
      });

      expect(status).toBe(200);
      expect(await readStamp(sundayId)).toBeNull();
    });

    it("CLEARS when a slot's topic is removed", async () => {
      await resetAssignment();
      await finalizeDirectly(sundayId);
      await actAs(fixtures, "bishop");

      const { status } = await callAssignmentPatch(assignmentId, {
        action: "update",
        fields: { topicId: null },
      });

      expect(status).toBe(200);
      expect(await readStamp(sundayId)).toBeNull();
    });

    // A NEW SLOT CHANGES WHAT THE DAY IS. A Sunday somebody finalized as three talks is not the
    // Sunday they finalized once it has four, and an empty new slot is the loudest possible
    // statement that the day is not settled.
    it("CLEARS when a new assignment is created on the Sunday", async () => {
      await finalizeDirectly(otherSundayId);
      await actAs(fixtures, "bishop");

      const { POST } = await import("@/app/api/assignments/route");
      const { status, body } = await readResponse(
        await POST(
          jsonRequest("http://localhost/api/assignments", {
            method: "POST",
            body: {
              sundayId: otherSundayId,
              assignmentType: "sacrament_talk",
              slotNumber: 1,
              topicId,
            },
          }),
        ),
      );

      expect(status).toBe(201);
      expect(await readStamp(otherSundayId)).toBeNull();

      const created = (body.assignment as { id: string }).id;
      await fixtures.service.from("assignments").delete().eq("id", created);
    });

    // THE DAY'S SHAPE CHANGED. Keyed on the SUBMITTED field rather than on the resulting count,
    // because updateSunday() can change the count as a side effect of a type change and
    // SundayEditor submits the whole form on every save.
    it("CLEARS when speaking slots change on the Sunday", async () => {
      await finalizeDirectly(otherSundayId);
      await actAs(fixtures, "bishop");

      const { PATCH } = await import("@/app/api/sundays/[id]/route");
      const { status, body } = await readResponse(
        await PATCH(
          jsonRequest(`http://localhost/api/sundays/${otherSundayId}?confirm=true`, {
            method: "PATCH",
            body: { speakingSlots: 2 },
          }),
          { params: Promise.resolve({ id: otherSundayId }) },
        ),
      );

      expect(status).toBe(200);
      expect(await readStamp(otherSundayId)).toBeNull();

      // THE RESPONSE MUST NOT STILL CLAIM IT IS FINALIZED. The route reads the Sunday before the
      // stamp is cleared, so answering with that row would hand back a state the server had
      // already changed — ITER-022's two-answers-one-fact failure, in a response body.
      expect((body.sunday as { topicsFinalizedAt: string | null }).topicsFinalizedAt).toBeNull();
    });
  });
});
