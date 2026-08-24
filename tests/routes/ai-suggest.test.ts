// @vitest-environment node
//
// POST /api/topics/ai-suggest — Phase 5's NO-AUTOSAVE test, on the generation side.
//
// The claim this suite exists to prove is a negative:
//
//   A GENERATION NEVER ADDS A ROW TO `topics`. Not on success, not on failure, not ever.
//
// Everything it produces lands in `topic_candidates` as `pending`, and PATCH
// /api/topic-candidates is the only path from there into the library (CLAUDE.md rule 3). The
// `topics` count is re-read with the SERVICE client either side of every generation rather than
// inferred from what the route reported — a route can report a row it did not write, and a route
// that wrote two would report one.
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

// Claude is stubbed. This suite is testing THE ROUTE's behaviour — what it filters, what it
// inserts, and above all what it refuses to touch — not the model's. Calling the real API would
// spend money on every run and make the suite fail without a network.
const callClaudeStructured = vi.fn();

vi.mock("@/lib/ai/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/client")>("@/lib/ai/client");
  return {
    ...actual,
    callClaude: vi.fn(),
    callClaudeStructured: (...args: unknown[]) => callClaudeStructured(...args),
  };
});

// Stubbed so no OpenAI call happens in CI. Retrieval's own behaviour is covered by
// tests/lib/similarityFloor.test.ts and tests/rls/retrieval-scoping.test.ts.
const retrieveChunks = vi.fn();

vi.mock("@/lib/ai/retrieve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/retrieve")>("@/lib/ai/retrieve");
  return {
    ...actual,
    retrieveChunks: (...args: unknown[]) => retrieveChunks(...args),
  };
});

const USAGE = {
  cacheReadTokens: 0,
  cacheCreationTokens: 512,
  inputTokens: 900,
  outputTokens: 400,
};

type Suggestion = {
  title: string;
  category: string;
  description: string;
  suggestedScriptures: string[];
  suggestedTalks: { speaker: string; title: string; conference: string }[];
};

function suggestion(title: string, overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    title,
    category: "doctrinal",
    description: "What this topic asks a congregation to consider, at reasonable length.",
    suggestedScriptures: ["Mosiah 18:8-9"],
    suggestedTalks: [
      { speaker: "Elder Holland", title: "A Talk", conference: "April 2024" },
    ],
    ...overrides,
  };
}

function returns(...topics: Suggestion[]): void {
  callClaudeStructured.mockResolvedValue({ parsed: { topics }, ...USAGE });
}

async function callPost(body: unknown) {
  const { POST } = await import("@/app/api/topics/ai-suggest/route");
  const request = jsonRequest("http://localhost/api/topics/ai-suggest", {
    method: "POST",
    body,
  });
  return readResponse(await POST(request));
}

describe("POST /api/topics/ai-suggest", () => {
  let fixtures: Fixtures;

  // Every title carries the run id, so two runs against the shared project cannot collide on
  // migration 018's unique index (CLAUDE.md §9).
  function unique(title: string): string {
    return `${title} ${fixtures.runId}`;
  }

  async function countTopics(): Promise<number> {
    const { count, error } = await fixtures.service
      .from("topics")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);

    if (error) throw new Error(`Could not count topics: ${error.message}`);
    return count ?? 0;
  }

  async function readCandidates() {
    const { data, error } = await fixtures.service
      .from("topic_candidates")
      .select("id, title, status, accepted_topic_id, reviewed_by, reviewed_at, suggested_talks")
      .eq("ward_id", fixtures.wardAId);

    if (error) throw new Error(`Could not read candidates: ${error.message}`);
    return data;
  }

  async function seedTopic(title: string, status: "active" | "archived" = "active") {
    const { error } = await fixtures.service.from("topics").insert({
      ward_id: fixtures.wardAId,
      title,
      category: "doctrinal",
      source: "manual",
      status,
    });

    if (error) throw new Error(`Could not seed a topic: ${error.message}`);
  }

  async function seedCandidate(title: string) {
    const { error } = await fixtures.service.from("topic_candidates").insert({
      ward_id: fixtures.wardAId,
      title,
      category: "doctrinal",
      status: "pending",
    });

    if (error) throw new Error(`Could not seed a candidate: ${error.message}`);
  }

  async function clearCandidates(): Promise<void> {
    const { error } = await fixtures.service
      .from("topic_candidates")
      .delete()
      .eq("ward_id", fixtures.wardAId);

    if (error) throw new Error(`Could not clear candidates: ${error.message}`);
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "wardSecretary"]);
    await actAs(fixtures, "bishop");
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  beforeEach(() => {
    callClaudeStructured.mockReset();
    retrieveChunks.mockReset();
    retrieveChunks.mockResolvedValue([
      { content: "And now, as ye are desirous to come into the fold of God…", sourceLabel: "Book of Mormon — Mosiah 18", similarity: 0.71 },
    ]);
  });

  it("inserts a pending candidate for each suggestion and adds nothing to the library", async () => {
    await clearCandidates();
    const before = await countTopics();

    returns(
      suggestion(unique("Bearing One Another's Burdens")),
      suggestion(unique("Ministering With Real Intent")),
    );

    const { status, body } = await callPost({ count: 2 });

    expect(status).toBe(201);
    expect(Array.isArray(body.candidates)).toBe(true);
    expect((body.candidates as unknown[]).length).toBe(2);

    // THE ASSERTION THIS WHOLE SUITE IS FOR.
    expect(await countTopics()).toBe(before);

    const rows = await readCandidates();
    expect(rows).toHaveLength(2);

    for (const row of rows) {
      // Rule 3 is only meaningful if a generated row arrives unreviewed. The
      // topic_candidates_review_pair CHECK enforces the trio, so a mistake here would be a
      // constraint violation rather than a silent auto-accept — this proves it never gets there.
      expect(row.status).toBe("pending");
      expect(row.reviewed_by).toBeNull();
      expect(row.reviewed_at).toBeNull();
      expect(row.accepted_topic_id).toBeNull();
    }
  });

  // The three-part talk object is flattened before insert, because suggested_talks stores
  // strings and mapCandidateRow drops anything else. Written through unchanged, the citation
  // would vanish between the insert and the screen with no error anywhere.
  it("stores a talk citation as one readable string", async () => {
    await clearCandidates();

    returns(
      suggestion(unique("Charity Never Faileth"), {
        suggestedTalks: [
          {
            speaker: "Elder Jeffrey R. Holland",
            title: "The Greatest Possession",
            conference: "April 2024",
          },
        ],
      }),
    );

    await callPost({ count: 1 });

    const rows = await readCandidates();
    expect(rows[0].suggested_talks).toEqual([
      'Elder Jeffrey R. Holland, "The Greatest Possession", April 2024',
    ]);
  });

  it("filters a suggestion whose title matches an existing topic, whatever the casing", async () => {
    await clearCandidates();
    const title = unique("Temple Worship");
    await seedTopic(title);

    const before = await countTopics();
    returns(suggestion(title.toUpperCase()), suggestion(unique("Something Genuinely New")));

    const { status, body } = await callPost({ count: 2 });

    expect(status).toBe(201);
    expect(body.filteredCount).toBe(1);
    expect((body.candidates as unknown[]).length).toBe(1);
    expect(await countTopics()).toBe(before);

    const rows = await readCandidates();
    expect(rows.map((row) => row.title)).toEqual([unique("Something Genuinely New")]);
  });

  // Migration 018's unique index is on (ward_id, lower(title)) and does not care about status,
  // so an archived title would 409 at ACCEPT time — after somebody had read it and wanted it.
  it("filters a suggestion matching an archived topic", async () => {
    await clearCandidates();
    const title = unique("Christmas Devotional");
    await seedTopic(title, "archived");

    returns(suggestion(title));

    const { status, body } = await callPost({ count: 1 });

    expect(status).toBe(200);
    expect(body.filteredCount).toBe(1);
    expect(await readCandidates()).toHaveLength(0);
  });

  it("filters a suggestion matching a candidate already waiting in the queue", async () => {
    await clearCandidates();
    const title = unique("Already Suggested");
    await seedCandidate(title);

    returns(suggestion(title));

    const { status, body } = await callPost({ count: 1 });

    expect(status).toBe(200);
    expect(body.filteredCount).toBe(1);
    // The seeded one, and nothing new beside it.
    expect(await readCandidates()).toHaveLength(1);
  });

  // "Every suggestion was something you already have" is a real answer, and the UI says so.
  // A 500 here would tell the bishopric the feature is broken when it worked correctly.
  it("returns 200 with an empty list when everything was filtered", async () => {
    await clearCandidates();
    const title = unique("All Of It Duplicated");
    await seedTopic(title);

    returns(suggestion(title));

    const { status, body } = await callPost({ count: 1 });

    expect(status).toBe(200);
    expect(body.candidates).toEqual([]);
    expect(body.filteredCount).toBe(1);
    expect(body.returnedCount).toBe(1);
  });

  it("maps a rate limit to 429 and leaves the queue untouched", async () => {
    await clearCandidates();
    const before = await countTopics();

    const { AiRequestError } = await import("@/lib/ai/errors");
    callClaudeStructured.mockRejectedValue(new AiRequestError("rate_limited"));

    const { status, body } = await callPost({ count: 3 });

    expect(status).toBe(429);
    expect(errorMessage(body)).toContain("busy");
    expect(await readCandidates()).toHaveLength(0);
    expect(await countTopics()).toBe(before);
  });

  it("maps a refusal to 422 and writes nothing", async () => {
    await clearCandidates();

    const { AiRequestError } = await import("@/lib/ai/errors");
    callClaudeStructured.mockRejectedValue(new AiRequestError("refused"));

    const { status, body } = await callPost({ count: 3 });

    expect(status).toBe(422);
    expect(errorMessage(body)).toContain("declined");
    expect(await readCandidates()).toHaveLength(0);
  });

  it("skips retrieval when the ward has given it no signal at all", async () => {
    await clearCandidates();
    returns(suggestion(unique("No Signal Topic")));

    await callPost({ count: 1 });

    // No seed, no ai_settings on a freshly seeded ward. Embedding the empty string would return
    // the corpus's arbitrary nearest neighbours dressed up as relevant material.
    expect(retrieveChunks).not.toHaveBeenCalled();
  });

  it("retrieves against the seed when one is given", async () => {
    await clearCandidates();
    returns(suggestion(unique("Seeded Topic")));

    await callPost({ count: 1, seed: "something for fast Sunday" });

    expect(retrieveChunks).toHaveBeenCalledTimes(1);
    expect(retrieveChunks.mock.calls[0][0]).toContain("something for fast Sunday");
  });

  it("passes the requested count and the ward's existing titles into the prompt", async () => {
    await clearCandidates();
    const existing = unique("A Title Already Held");
    await seedTopic(existing);

    returns(suggestion(unique("Fresh Idea")));

    await callPost({ count: 4 });

    const prompt = callClaudeStructured.mock.calls[0][0].userPrompt as string;
    expect(prompt).toContain("Suggest 4 sacrament meeting talk topics");
    expect(prompt).toContain(existing);
  });

  // `topics.manage` is bishopric-only in lib/auth/permissions.ts — checked against the matrix
  // rather than assumed (CLAUDE.md §8).
  it("refuses a ward secretary with 403 and makes no vendor call", async () => {
    await clearCandidates();
    await actAs(fixtures, "wardSecretary");
    returns(suggestion(unique("Never Reached")));

    const { status } = await callPost({ count: 1 });

    expect(status).toBe(403);
    expect(callClaudeStructured).not.toHaveBeenCalled();
    expect(await readCandidates()).toHaveLength(0);

    await actAs(fixtures, "bishop");
  });

  // Shared bishopric authority (CLAUDE.md §7): a counselor holds exactly what the bishop holds.
  it("allows a counselor", async () => {
    await clearCandidates();
    await actAs(fixtures, "counselor1");
    returns(suggestion(unique("A Counselor's Request")));

    const { status } = await callPost({ count: 1 });

    expect(status).toBe(201);

    await actAs(fixtures, "bishop");
  });

  it("refuses a count above the cap before spending anything", async () => {
    await clearCandidates();
    returns(suggestion(unique("Too Many")));

    const { status, body } = await callPost({ count: 25 });

    expect(status).toBe(400);
    expect(errorMessage(body)).toContain("10");
    expect(callClaudeStructured).not.toHaveBeenCalled();
  });
});
