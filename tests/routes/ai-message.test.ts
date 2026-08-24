// @vitest-environment node
//
// POST /api/assignments/[id]/ai-message — Phase 5's NO-AUTOSAVE test, on the drafting side.
//
// The claim this suite exists to prove is a negative:
//
//   DRAFTING A MESSAGE WRITES NOTHING TO `assignments`. Not notify_message, not
//   thank_you_message, not the stage — including after a draft the user then abandons.
//
// Both columns are re-read with the SERVICE client after every call rather than inferred from
// the response. The existing PATCH with an explicit approve click is still the only thing that
// saves a message (CLAUDE.md rule 3).
//
// The second claim is the one the plan exists to close: the thank-you prompt must CONTAIN the
// assignment's comment thread. `ContactStagePanel` passed `comments: []` hard-coded from talks-b
// until now, so the template had the parameter and never had the data — and without an assertion
// on the prompt itself, that gap could silently reopen.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const callClaude = vi.fn();

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return {
    ...actual,
    callClaude: (...args: unknown[]) => callClaude(...args),
    callClaudeStructured: vi.fn(),
  };
});

const retrieveChunks = vi.fn();

vi.mock("@/lib/ai/retrieve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/retrieve")>("@/lib/ai/retrieve");
  return {
    ...actual,
    retrieveChunks: (...args: unknown[]) => retrieveChunks(...args),
  };
});

const DRAFT = "Hello Sarah, thank you for the talk you gave.";

const CLAUDE_RESULT = {
  text: DRAFT,
  cacheReadTokens: 0,
  cacheCreationTokens: 400,
  inputTokens: 800,
  outputTokens: 60,
};

const SUNDAY_DATE = "2027-05-02";

// `params` is a Promise in Next 16. Every call in this suite goes through here, so there is no
// second way to get it wrong (plans/retros/route-tests-and-realtime.md).
async function callPost(assignmentId: string, body: unknown) {
  const { POST } = await import("@/app/api/assignments/[id]/ai-message/route");
  const request = jsonRequest(
    `http://localhost/api/assignments/${assignmentId}/ai-message`,
    { method: "POST", body },
  );
  return readResponse(
    await POST(request, { params: Promise.resolve({ id: assignmentId }) }),
  );
}

describe("POST /api/assignments/[id]/ai-message", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let wardBSundayId = "";
  let memberId = "";
  let topicId = "";

  let confirmId = "";
  let appreciateWithCommentsId = "";
  let appreciateNoCommentsId = "";
  let waivedId = "";
  let wardBAssignmentId = "";

  let nextSlot = 1;

  const COMMENTS = [
    "He talked about his mission and the room went completely quiet.",
    "The story about his grandmother landed with the youth.",
    "Ran slightly long but nobody minded.",
  ];

  async function seedAssignment(seed: {
    stage: string;
    speaker: "member" | "external";
    waived?: boolean;
  }): Promise<string> {
    const slotNumber = nextSlot;
    nextSlot += 1;

    const { data, error } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayId,
        member_id: seed.speaker === "member" ? memberId : null,
        external_speaker_name: seed.speaker === "external" ? "President Visitor" : null,
        external_speaker_title: seed.speaker === "external" ? "President" : null,
        assignment_type: "sacrament_talk",
        slot_number: slotNumber,
        slot_length_minutes: 12,
        topic_id: topicId,
        pipeline_stage: seed.stage,
        contact_waived_at: seed.waived ? new Date().toISOString() : null,
        contact_waived_by: seed.waived ? fixtures.user("bishop").id : null,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed an assignment: ${error.message}`);
    return data.id;
  }

  // The two columns this route must never touch, plus the stage.
  async function readMessages(assignmentId: string) {
    const { data, error } = await fixtures.service
      .from("assignments")
      .select("notify_message, thank_you_message, pipeline_stage")
      .eq("id", assignmentId)
      .single();

    if (error) throw new Error(`Could not re-read the assignment: ${error.message}`);
    return data;
  }

  function lastPrompt(): string {
    const call = callClaude.mock.calls.at(-1);
    return (call?.[0] as { userPrompt: string } | undefined)?.userPrompt ?? "";
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "musicCoordinator",
      "wardBBishop",
    ]);

    const seedSunday = async (wardId: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: wardId, date: SUNDAY_DATE, type: "standard", speaking_slots: 15 })
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
        first_name: "Sarah",
        last_name: `Fixture${fixtures.runId}`,
        category: "adult",
      })
      .select("id")
      .single();
    if (memberError) throw new Error(`Could not seed a member: ${memberError.message}`);
    memberId = member.id;

    const { data: topic, error: topicError } = await fixtures.service
      .from("topics")
      .insert({
        ward_id: fixtures.wardAId,
        title: `Bearing One Another's Burdens ${fixtures.runId}`,
        source: "manual",
        suggested_scriptures: ["Mosiah 18:8-9"],
      })
      .select("id")
      .single();
    if (topicError) throw new Error(`Could not seed a topic: ${topicError.message}`);
    topicId = topic.id;

    confirmId = await seedAssignment({ stage: "confirm", speaker: "member" });
    appreciateWithCommentsId = await seedAssignment({
      stage: "appreciate",
      speaker: "member",
    });
    appreciateNoCommentsId = await seedAssignment({
      stage: "appreciate",
      speaker: "member",
    });
    waivedId = await seedAssignment({
      stage: "confirm",
      speaker: "external",
      waived: true,
    });

    const { error: commentError } = await fixtures.service
      .from("assignment_comments")
      .insert(
        COMMENTS.map((comment) => ({
          ward_id: fixtures.wardAId,
          assignment_id: appreciateWithCommentsId,
          user_id: fixtures.user("bishop").id,
          comment,
          level: "assignment",
        })),
      );
    if (commentError) {
      throw new Error(`Could not seed the comment thread: ${commentError.message}`);
    }

    const { data: wardB, error: wardBError } = await fixtures.service
      .from("assignments")
      .insert({
        ward_id: fixtures.wardBId,
        sunday_id: wardBSundayId,
        assignment_type: "sacrament_talk",
        slot_number: 1,
        pipeline_stage: "confirm",
      })
      .select("id")
      .single();
    if (wardBError) {
      throw new Error(`Could not seed ward B's assignment: ${wardBError.message}`);
    }
    wardBAssignmentId = wardB.id;

    await actAs(fixtures, "bishop");
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  beforeEach(() => {
    callClaude.mockReset();
    callClaude.mockResolvedValue(CLAUDE_RESULT);
    retrieveChunks.mockReset();
    retrieveChunks.mockResolvedValue([]);
  });

  it("returns a confirmation draft and leaves notify_message null", async () => {
    await actAs(fixtures, "counselor1");

    const { status, body } = await callPost(confirmId, { type: "confirmation" });

    expect(status).toBe(200);
    expect(body.draft).toBe(DRAFT);

    // THE ASSERTION THIS WHOLE SUITE IS FOR.
    const row = await readMessages(confirmId);
    expect(row.notify_message).toBeNull();
    expect(row.thank_you_message).toBeNull();
    expect(row.pipeline_stage).toBe("confirm");
  });

  // The abandonment case, spelled out separately: a draft the user never approved must leave the
  // row exactly as a draft they never asked for would.
  it("still writes nothing after a second draft the user abandons", async () => {
    await actAs(fixtures, "counselor1");

    await callPost(confirmId, { type: "confirmation" });
    await callPost(confirmId, { type: "confirmation" });

    const row = await readMessages(confirmId);
    expect(row.notify_message).toBeNull();
    expect(row.pipeline_stage).toBe("confirm");
  });

  it("returns a thank-you draft and leaves thank_you_message null", async () => {
    await actAs(fixtures, "counselor1");

    const { status } = await callPost(appreciateWithCommentsId, { type: "thank_you" });

    expect(status).toBe(200);

    const row = await readMessages(appreciateWithCommentsId);
    expect(row.thank_you_message).toBeNull();
    expect(row.notify_message).toBeNull();
    expect(row.pipeline_stage).toBe("appreciate");
  });

  // THE GAP THIS PLAN EXISTS TO CLOSE. Without an assertion on the prompt itself, the thread
  // could quietly stop reaching Claude and every thank-you would go back to being generic —
  // with every other test in this file still passing.
  it("puts every bishopric comment into the thank-you prompt", async () => {
    await actAs(fixtures, "counselor1");

    await callPost(appreciateWithCommentsId, { type: "thank_you" });

    const prompt = lastPrompt();
    for (const comment of COMMENTS) {
      expect(prompt).toContain(comment);
    }
  });

  // A thank-you built from nothing is a form letter, and by the appreciate stage somebody has
  // almost certainly thanked the speaker in person already. Refused BEFORE the vendor call, so an
  // unwanted draft costs nothing.
  //
  // buildThankYouPrompt keeps its own no-comments branch — covered in
  // tests/lib/messageDraftPrompts.test.ts — because a caller that bypasses this route must still
  // not produce a message that invents what was said.
  it("refuses a thank-you with 409 when nobody commented, and makes no vendor call", async () => {
    await actAs(fixtures, "counselor1");

    const { status, body } = await callPost(appreciateNoCommentsId, { type: "thank_you" });

    expect(status).toBe(409);
    expect(errorMessage(body)).toContain("nothing specific to write");
    expect(callClaude).not.toHaveBeenCalled();

    const row = await readMessages(appreciateNoCommentsId);
    expect(row.thank_you_message).toBeNull();
    expect(row.pipeline_stage).toBe("appreciate");
  });

  // A confirmation has its own inputs and does not depend on the thread at all, so the refusal
  // above must not leak across to it.
  it("still drafts a confirmation for an assignment with no comments", async () => {
    await actAs(fixtures, "counselor1");

    const { status } = await callPost(confirmId, { type: "confirmation" });

    expect(status).toBe(200);
    expect(callClaude).toHaveBeenCalledTimes(1);
  });

  it("names the topic, the date and the length in a confirmation prompt", async () => {
    await actAs(fixtures, "counselor1");

    await callPost(confirmId, { type: "confirmation" });

    const prompt = lastPrompt();
    expect(prompt).toContain("Bearing One Another's Burdens");
    expect(prompt).toContain("Sunday, May 2");
    expect(prompt).toContain("12 minutes");
    expect(prompt).toContain("Sarah");
    // From the topic's own suggested_scriptures, which talks-b recorded as missing.
    expect(prompt).toContain("Mosiah 18:8-9");
  });

  // A confirmation naming a scripture the speaker can prepare from is better with the corpus
  // behind it; a thank-you for a talk that already happened is about what the bishopric
  // observed, and retrieved doctrine makes it preachy.
  it("retrieves for a confirmation and not for a thank-you", async () => {
    await actAs(fixtures, "counselor1");

    await callPost(confirmId, { type: "confirmation" });
    expect(retrieveChunks).toHaveBeenCalledTimes(1);

    retrieveChunks.mockClear();

    await callPost(appreciateWithCommentsId, { type: "thank_you" });
    expect(retrieveChunks).not.toHaveBeenCalled();
  });

  // ITER-004: a waived speaker's contact stages are not outstanding work, and the panel says so
  // three inches away. Refused BEFORE any spend.
  it("refuses a waived assignment with 409 and makes no vendor call", async () => {
    await actAs(fixtures, "counselor1");

    const { status, body } = await callPost(waivedId, { type: "confirmation" });

    expect(status).toBe(409);
    expect(errorMessage(body)).toContain("invited outside the ward");
    expect(callClaude).not.toHaveBeenCalled();
  });

  it("answers 404 for another ward's assignment", async () => {
    await actAs(fixtures, "counselor1");

    const { status, body } = await callPost(wardBAssignmentId, { type: "confirmation" });

    expect(status).toBe(404);
    expect(errorMessage(body)).toContain("not in your ward");
    expect(callClaude).not.toHaveBeenCalled();
  });

  // CLAUDE.md §8 names this fixture as the one whose permissions are not the intuitive answer:
  // music_coordinator HOLDS `talks.view` and can see the Sunday, but holds neither `talks.plan`
  // nor `talks.confirm`. Checked against lib/auth/permissions.ts rather than guessed.
  it("refuses a music coordinator on both types", async () => {
    await actAs(fixtures, "musicCoordinator");

    const confirmation = await callPost(confirmId, { type: "confirmation" });
    expect(confirmation.status).toBe(403);

    const thankYou = await callPost(appreciateWithCommentsId, { type: "thank_you" });
    expect(thankYou.status).toBe(403);

    expect(callClaude).not.toHaveBeenCalled();

    await actAs(fixtures, "counselor1");
  });

  it("maps a refusal to 422 and leaves both columns null", async () => {
    await actAs(fixtures, "counselor1");

    const { AiRequestError } = await import("@/lib/ai/errors");
    callClaude.mockRejectedValue(new AiRequestError("refused"));

    const { status, body } = await callPost(confirmId, { type: "confirmation" });

    expect(status).toBe(422);
    expect(errorMessage(body)).toContain("declined");

    const row = await readMessages(confirmId);
    expect(row.notify_message).toBeNull();
    expect(row.thank_you_message).toBeNull();
  });

  it("maps a missing API key to 503 with a sentence naming it", async () => {
    await actAs(fixtures, "counselor1");

    const { AiRequestError } = await import("@/lib/ai/errors");
    callClaude.mockRejectedValue(new AiRequestError("not_configured"));

    const { status, body } = await callPost(confirmId, { type: "confirmation" });

    expect(status).toBe(503);
    expect(errorMessage(body)).toContain("API key");
  });

  it("refuses a body naming a type that does not exist", async () => {
    await actAs(fixtures, "counselor1");

    const { status } = await callPost(confirmId, { type: "reminder" });

    expect(status).toBe(400);
    expect(callClaude).not.toHaveBeenCalled();
  });
});
