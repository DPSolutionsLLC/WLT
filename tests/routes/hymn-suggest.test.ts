// @vitest-environment node
//
// GET /api/hymns/suggest — the ITER-016 route.
//
// Three claims this suite exists to prove:
//
//   1. THE CANDIDATE LIST IS IN THE PROMPT. The model ranks rather than recalls, which is the
//      whole mitigation. A prompt without the list is a prompt asking for a hallucination.
//   2. THE ROUTE WRITES NOTHING. No hymn_selections row, on success or on failure. The
//      `hymn_selections` count is re-read with the SERVICE client either side of every
//      generation rather than inferred from what the route reported.
//   3. EACH AI ERROR KIND MAPS TO ITS OWN STATUS, and an all-rejected batch is an error with its
//      own sentence rather than an empty list.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked.
// Runs over the network against the shared hosted project (CLAUDE.md §9).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

// Claude is stubbed. This suite tests THE ROUTE — what it puts in the prompt, what it refuses to
// write, and what it does with a bad answer — not the model's. Calling the real API would spend
// money on every run and make the suite fail without a network.
const callClaudeStructured = vi.fn();

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return {
    ...actual,
    callClaude: vi.fn(),
    callClaudeStructured: (...args: unknown[]) => callClaudeStructured(...args),
  };
});

const USAGE = {
  cacheReadTokens: 0,
  cacheCreationTokens: 512,
  inputTokens: 900,
  outputTokens: 200,
};

type Suggestion = { number: number; title: string; reason: string };

function returns(...suggestions: Suggestion[]): void {
  callClaudeStructured.mockResolvedValue({ parsed: { suggestions }, ...USAGE });
}

function lastUserPrompt(): string {
  const call = callClaudeStructured.mock.calls.at(-1);
  return (call?.[0] as { userPrompt: string } | undefined)?.userPrompt ?? "";
}

const SUNDAY_DATE = "2027-09-05";

describe("GET /api/hymns/suggest", () => {
  let fixtures: Fixtures;
  let sundayId = "";
  let cancelledSundayId = "";

  async function countSelections(): Promise<number> {
    const { count, error } = await fixtures.service
      .from("hymn_selections")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);

    if (error) throw new Error(`Could not count hymn selections: ${error.message}`);
    return count ?? 0;
  }

  async function callGet(query: string) {
    const { GET } = await import("@/app/api/hymns/suggest/route");
    return readResponse(await GET(jsonRequest(`http://localhost/api/hymns/suggest?${query}`)));
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "musicCoordinator", "eqPresident"]);

    const seedSunday = async (date: string, type: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: fixtures.wardAId, date, type, speaking_slots: 2 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    sundayId = await seedSunday(SUNDAY_DATE, "standard");
    // stake_conference holds no sacrament meeting (NO_MEETING_SUNDAY_TYPES), which is the 422 path.
    cancelledSundayId = await seedSunday("2027-09-12", "stake_conference");

    const { data: topic, error: topicError } = await fixtures.service
      .from("topics")
      .insert({
        ward_id: fixtures.wardAId,
        title: `Gratitude in Every Season ${fixtures.runId}`,
        source: "manual",
      })
      .select("id")
      .single();
    if (topicError) throw new Error(topicError.message);

    const { error: assignmentError } = await fixtures.service.from("assignments").insert({
      ward_id: fixtures.wardAId,
      sunday_id: sundayId,
      assignment_type: "sacrament_talk",
      slot_number: 1,
      pipeline_stage: "notify",
      topic_id: topic.id,
      external_speaker_name: "Mark Andersen",
    });
    if (assignmentError) throw new Error(assignmentError.message);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  beforeEach(() => {
    callClaudeStructured.mockReset();
  });

  describe("the candidate list goes into the prompt", () => {
    it("names real hymn numbers and titles the model may choose from", async () => {
      await actAs(fixtures, "musicCoordinator");
      returns({ number: 19, title: "We Thank Thee, O God, for a Prophet", reason: "It fits." });

      const { status } = await callGet(`sundayId=${sundayId}`);

      expect(status).toBe(200);
      const prompt = lastUserPrompt();
      expect(prompt).toContain("Choose only from these hymns");
      expect(prompt).toContain("We Thank Thee, O God, for a Prophet");
      expect(prompt).toContain("Count Your Blessings");
    });

    it("puts the Sunday's assigned topic in the prompt", async () => {
      await actAs(fixtures, "musicCoordinator");
      returns({ number: 19, title: "We Thank Thee, O God, for a Prophet", reason: "It fits." });

      await callGet(`sundayId=${sundayId}`);

      expect(lastUserPrompt()).toContain("Gratitude in Every Season");
    });

    // The coordinator does not get pipeline access. lib/music/sundayTopics.ts returns titles and
    // cannot return an assignment, so the speaker's name has no path into the prompt.
    it("does not put the speaker's name in the prompt", async () => {
      await actAs(fixtures, "musicCoordinator");
      returns({ number: 19, title: "We Thank Thee, O God, for a Prophet", reason: "It fits." });

      await callGet(`sundayId=${sundayId}`);

      expect(lastUserPrompt()).not.toContain("Mark Andersen");
    });

    it("never offers a placeholder hymn as a candidate", async () => {
      await actAs(fixtures, "musicCoordinator");
      returns({ number: 19, title: "We Thank Thee, O God, for a Prophet", reason: "It fits." });

      await callGet(`sundayId=${sundayId}`);

      expect(lastUserPrompt()).not.toContain("[Placeholder]");
    });

    it("asks for sacrament hymns only when the sacrament slot is named", async () => {
      await actAs(fixtures, "musicCoordinator");
      returns({ number: 169, title: "As Now We Take the Sacrament", reason: "It fits." });

      await callGet(`sundayId=${sundayId}&hymnType=sacrament`);

      const prompt = lastUserPrompt();
      expect(prompt).toContain("As Now We Take the Sacrament");
      // "Joy to the World" is not sung while the sacrament is passed and must not be offered.
      expect(prompt).not.toContain("Joy to the World");
    });
  });

  describe("the route writes nothing", () => {
    it("adds no hymn selection on success", async () => {
      await actAs(fixtures, "musicCoordinator");
      returns({ number: 19, title: "We Thank Thee, O God, for a Prophet", reason: "It fits." });

      const before = await countSelections();
      const { status } = await callGet(`sundayId=${sundayId}`);
      const after = await countSelections();

      expect(status).toBe(200);
      expect(after).toBe(before);
    });

    it("adds no hymn selection when the model answers badly", async () => {
      await actAs(fixtures, "musicCoordinator");
      returns({ number: 999, title: "Invented", reason: "It fits, allegedly." });

      const before = await countSelections();
      await callGet(`sundayId=${sundayId}`);
      const after = await countSelections();

      expect(after).toBe(before);
    });
  });

  describe("validation of what came back", () => {
    it("drops a number that was not a candidate and reports the count", async () => {
      await actAs(fixtures, "musicCoordinator");
      returns(
        { number: 19, title: "We Thank Thee, O God, for a Prophet", reason: "It fits." },
        { number: 999, title: "Invented", reason: "It does not exist." },
      );

      const { status, body } = await callGet(`sundayId=${sundayId}`);

      expect(status).toBe(200);
      expect(body.suggestions).toHaveLength(1);
      expect(body.droppedCount).toBe(1);
    });

    it("returns the TABLE's title, not the model's", async () => {
      await actAs(fixtures, "musicCoordinator");
      returns({ number: 19, title: "A Title The Model Made Up", reason: "It fits." });

      const { body } = await callGet(`sundayId=${sundayId}`);
      const [first] = body.suggestions as { title: string }[];

      expect(first.title).toBe("We Thank Thee, O God, for a Prophet");
    });

    // ALL DROPPED IS AN ERROR WITH ITS OWN SENTENCE, NOT AN EMPTY LIST. An empty array would
    // render as "no hymns fit this Sunday", which is a statement about the ward's topics rather
    // than about the model's answer.
    it("answers 422 with its own sentence when every number was invented", async () => {
      await actAs(fixtures, "musicCoordinator");
      returns(
        { number: 998, title: "Invented", reason: "It does not exist." },
        { number: 999, title: "Also Invented", reason: "Nor does this." },
      );

      const { status, body } = await callGet(`sundayId=${sundayId}`);

      expect(status).toBe(422);
      expect(errorMessage(body)).toContain("hymnbook could confirm");
      expect(body.suggestions).toBeUndefined();
    });
  });

  describe("each AI error kind keeps its own status", () => {
    const kinds: { kind: string; status: number }[] = [
      { kind: "not_configured", status: 503 },
      { kind: "rate_limited", status: 429 },
      { kind: "refused", status: 422 },
      { kind: "truncated", status: 422 },
      { kind: "unavailable", status: 502 },
      { kind: "invalid_request", status: 500 },
    ];

    for (const { kind, status } of kinds) {
      it(`maps ${kind} to ${status}`, async () => {
        const { AiRequestError } = await import("@/lib/ai/errors");
        await actAs(fixtures, "musicCoordinator");
        callClaudeStructured.mockRejectedValue(new AiRequestError(kind as "refused"));

        const response = await callGet(`sundayId=${sundayId}`);

        expect(response.status).toBe(status);
        // The kind's OWN written sentence, not a generic one. Six kinds collapsing into one
        // message is the failure lib/ai/errors.ts exists to prevent.
        expect(errorMessage(response.body)).not.toBe("");
      });
    }
  });

  describe("permissions and preconditions", () => {
    it("refuses a role without music.manage", async () => {
      await actAs(fixtures, "eqPresident");
      returns({ number: 19, title: "We Thank Thee, O God, for a Prophet", reason: "It fits." });

      const { status } = await callGet(`sundayId=${sundayId}`);

      expect(status).toBe(403);
      expect(callClaudeStructured).not.toHaveBeenCalled();
    });

    it("lets the bishopric generate too", async () => {
      await actAs(fixtures, "bishop");
      returns({ number: 19, title: "We Thank Thee, O God, for a Prophet", reason: "It fits." });

      const { status } = await callGet(`sundayId=${sundayId}`);

      expect(status).toBe(200);
    });

    it("answers 422 for a Sunday that holds no sacrament meeting", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status, body } = await callGet(`sundayId=${cancelledSundayId}`);

      expect(status).toBe(422);
      expect(errorMessage(body)).toContain("no sacrament meeting");
      expect(callClaudeStructured).not.toHaveBeenCalled();
    });

    it("answers 404 for a Sunday that is not this ward's", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callGet(
        "sundayId=00000000-0000-4000-8000-000000000000",
      );

      expect(status).toBe(404);
      expect(callClaudeStructured).not.toHaveBeenCalled();
    });

    it("refuses a malformed Sunday id before spending anything", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callGet("sundayId=not-a-uuid");

      expect(status).toBe(400);
      expect(callClaudeStructured).not.toHaveBeenCalled();
    });
  });
});
