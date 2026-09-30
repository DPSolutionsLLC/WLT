// @vitest-environment node
//
// POST /api/assignments/topic-suggestions — the topic window's "Suggest topics" (Topics rebuild t5).
//
// The claim this suite exists to prove is a negative: A SUGGESTION IS NEVER STORED. Not as a topic,
// not as a candidate, not on a talk — on success or on failure (CLAUDE.md rule 3). The three tables
// are counted with the SERVICE client either side of every call rather than inferred from what the
// route reported.
//
// Claude and retrieval are stubbed: this tests the ROUTE — what it asks for, what it filters, what
// it refuses to touch — not the model, and calling the real API would spend money on every run.
// That the call itself carries adaptive thinking and no budget_tokens is proven where it is set,
// in tests/lib/aiErrorHandling.test.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AiRequestError } from "@/lib/ai/errors";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const callClaudeStructured = vi.fn();

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return {
    ...actual,
    callClaude: vi.fn(),
    callClaudeStructured: (...args: unknown[]) => callClaudeStructured(...args),
  };
});

const retrieveChunks = vi.fn();

vi.mock("@/lib/ai/retrieve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/retrieve")>("@/lib/ai/retrieve");
  return { ...actual, retrieveChunks: (...args: unknown[]) => retrieveChunks(...args) };
});

const USAGE = { cacheReadTokens: 0, cacheCreationTokens: 512, inputTokens: 900, outputTokens: 400 };

function returns(...titles: string[]): void {
  callClaudeStructured.mockResolvedValue({
    parsed: { topics: titles.map((title) => ({ title, why: "It fits the season and the ward." })) },
    ...USAGE,
  });
}

async function suggest(body: unknown) {
  const { POST } = await import("@/app/api/assignments/topic-suggestions/route");
  return readResponse(
    await POST(jsonRequest("http://localhost/api/assignments/topic-suggestions", { method: "POST", body })),
  );
}

// Sundays relative to TODAY — a history window measured from today cannot be fed by fixed dates
// (scenario 073's walk).
function sundayFromToday(weeks: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

describe("POST /api/assignments/topic-suggestions", () => {
  let fixtures: Fixtures;
  let sundayId = "";
  let wardBSundayId = "";

  async function count(table: "assignments" | "topics" | "topic_candidates"): Promise<number> {
    const { count: rows, error } = await fixtures.service
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);
    if (error) throw new Error(`Could not count ${table}: ${error.message}`);
    return rows ?? 0;
  }

  async function counts() {
    return {
      assignments: await count("assignments"),
      topics: await count("topics"),
      candidates: await count("topic_candidates"),
    };
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "musicCoordinator", "wardBBishop"]);
    const service = fixtures.service;

    const seedSunday = async (ward: string, date: string) => {
      const { data, error } = await service
        .from("sundays")
        .insert({ ward_id: ward, date, type: "standard", speaking_slots: 3 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    const pastSunday = await seedSunday(fixtures.wardAId, sundayFromToday(-6));
    const nextSunday = await seedSunday(fixtures.wardAId, sundayFromToday(3));
    sundayId = await seedSunday(fixtures.wardAId, sundayFromToday(5));
    wardBSundayId = await seedSunday(fixtures.wardBId, sundayFromToday(5));

    const { error } = await service.from("assignments").insert([
      {
        ward_id: fixtures.wardAId,
        sunday_id: pastSunday,
        assignment_type: "sacrament_talk",
        slot_number: 1,
        external_speaker_name: "Visitor One",
        topic_title: "Faith in Jesus Christ",
        pipeline_stage: "complete",
      },
      {
        ward_id: fixtures.wardAId,
        sunday_id: nextSunday,
        assignment_type: "sacrament_talk",
        slot_number: 1,
        external_speaker_name: "Visitor Two",
        topic_title: "Gratitude",
        pipeline_stage: "plan",
      },
    ]);
    if (error) throw new Error(error.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  beforeEach(() => {
    callClaudeStructured.mockReset();
    retrieveChunks.mockReset();
    retrieveChunks.mockResolvedValue([]);
  });

  it("returns fresh ideas and writes nothing but its audit row", async () => {
    returns("Ministering as the Savior did", "Faithful stewardship", "Grateful hearts", "Prayer");
    await actAs(fixtures, "bishop");
    const before = await counts();

    const { status, body } = await suggest({ sundayId, context: "something for young families" });

    expect(status).toBe(200);
    // "Faithful stewardship" resembles the recent "Faith in Jesus Christ"; "Grateful hearts" does
    // not resemble "Gratitude" by the prefix rule, so it stays.
    expect((body.suggestions as { title: string }[]).map((idea) => idea.title)).toEqual([
      "Ministering as the Savior did",
      "Grateful hearts",
      "Prayer",
    ]);
    expect(body.filteredCount).toBe(1);
    expect(await counts()).toEqual(before);
  });

  it("asks at high effort, naming the recent and the upcoming topics and the month", async () => {
    returns("Prayer");
    await actAs(fixtures, "bishop");

    await suggest({ sundayId, context: null });

    const [params] = callClaudeStructured.mock.calls[0] as [{ effort: string; userPrompt: string }];
    expect(params.effort).toBe("high");
    expect(params.userPrompt).toContain("Faith in Jesus Christ");
    expect(params.userPrompt).toContain("Already planned for coming Sundays:\n\nGratitude");
    expect(params.userPrompt).toMatch(/for a Sunday in [A-Z][a-z]+ \d{4}\./);
  });

  it("skips ideas it already offered, for More suggestions", async () => {
    returns("Prayer", "Covenants");
    await actAs(fixtures, "bishop");

    const { body } = await suggest({ sundayId, alreadyOffered: ["Prayer"] });

    expect((body.suggestions as { title: string }[]).map((idea) => idea.title)).toEqual([
      "Covenants",
    ]);
  });

  it("writes an audit row with counts and no words", async () => {
    returns("Covenants");
    await actAs(fixtures, "bishop");

    await suggest({ sundayId, context: "youth conference" });

    const { data } = await fixtures.service
      .from("audit_log")
      .select("detail")
      .eq("ward_id", fixtures.wardAId)
      .eq("action", "topic_ideas_suggested")
      .order("created_at", { ascending: false })
      .limit(1);
    const detail = data![0].detail as Record<string, unknown>;
    expect(detail).toMatchObject({ sundayId, returned: 1, kept: 1, steered: true });
    expect(JSON.stringify(detail)).not.toContain("Covenants");
    expect(JSON.stringify(detail)).not.toContain("youth conference");
  });

  it("answers an AI failure with its own sentence, and writes nothing", async () => {
    callClaudeStructured.mockRejectedValue(new AiRequestError("rate_limited"));
    await actAs(fixtures, "bishop");
    const before = await counts();

    const { status, body } = await suggest({ sundayId });

    expect(status).toBe(429);
    expect(errorMessage(body)).toBe(
      "The AI service is busy. Wait a moment and try again — nothing was lost.",
    );
    expect(await counts()).toEqual(before);
  });

  // music_coordinator holds talks.view and not talks.plan. The request is otherwise valid.
  it("refuses somebody who cannot plan talks", async () => {
    await actAs(fixtures, "musicCoordinator");

    const { status } = await suggest({ sundayId });

    expect(status).toBe(403);
    expect(callClaudeStructured).not.toHaveBeenCalled();
  });

  it("answers 404 for a Sunday in another ward, before calling Claude", async () => {
    await actAs(fixtures, "bishop");

    const { status } = await suggest({ sundayId: wardBSundayId });

    expect(status).toBe(404);
    expect(callClaudeStructured).not.toHaveBeenCalled();
  });
});
