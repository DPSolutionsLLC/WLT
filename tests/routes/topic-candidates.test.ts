// @vitest-environment node
//
// PATCH /api/topic-candidates — the accept/reject boundary CLAUDE.md rule 3 rests on. This suite
// exists to prove one negative and one positive:
//
//   NOTHING reaches `topics` without an explicit accept.
//   An accept creates EXACTLY ONE topic, attributable to the person who pressed it.
//
// Every claim is checked by RE-READING with the service client, never by trusting the JSON the
// route handed back — a route can report a topic it did not write, and a route that wrote two
// would report one.
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

async function callPatch(body: unknown) {
  const { PATCH } = await import("@/app/api/topic-candidates/route");
  const request = jsonRequest("http://localhost/api/topic-candidates", {
    method: "PATCH",
    body,
  });
  return readResponse(await PATCH(request));
}

async function callGet() {
  const { GET } = await import("@/app/api/topic-candidates/route");
  return readResponse(await GET());
}

describe("PATCH /api/topic-candidates", () => {
  let fixtures: Fixtures;

  async function seedCandidate(title: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("topic_candidates")
      .insert({
        ward_id: fixtures.wardAId,
        title: `${title} ${fixtures.runId}`,
        category: "doctrinal",
        description: "seeded",
        suggested_scriptures: ["Alma 32:21"],
        status: "pending",
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed a candidate: ${error.message}`);
    return data.id;
  }

  async function countTopics(): Promise<number> {
    const { count, error } = await fixtures.service
      .from("topics")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);

    if (error) throw new Error(`Could not count topics: ${error.message}`);
    return count ?? 0;
  }

  async function readCandidate(candidateId: string) {
    const { data, error } = await fixtures.service
      .from("topic_candidates")
      .select("id, status, accepted_topic_id, reviewed_by, reviewed_at")
      .eq("id", candidateId)
      .single();

    if (error) throw new Error(`Could not re-read the candidate: ${error.message}`);
    return data;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "wardSecretary",
      "musicCoordinator",
    ]);

    await actAs(fixtures, "bishop");
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("accepts one candidate and creates exactly one topic", async () => {
    const candidateId = await seedCandidate("Ministering with Real Intent");
    const before = await countTopics();

    const { status, body } = await callPatch({ candidateId, status: "accepted" });

    expect(status).toBe(200);
    expect(await countTopics()).toBe(before + 1);

    const candidate = await readCandidate(candidateId);
    expect(candidate.status).toBe("accepted");
    expect(candidate.accepted_topic_id).not.toBeNull();
    // Rule 3 is only meaningful if the accept is attributable to a person and a moment.
    expect(candidate.reviewed_by).toBe(fixtures.user("bishop").id);
    expect(candidate.reviewed_at).not.toBeNull();

    // The topic carries `ai_generated`, so Phase 6 and the audit log both know it came from a
    // model a person then chose to keep.
    const { data: topic } = await fixtures.service
      .from("topics")
      .select("id, source, status, suggested_scriptures")
      .eq("id", candidate.accepted_topic_id ?? "")
      .single();

    expect(topic?.source).toBe("ai_generated");
    expect(topic?.status).toBe("active");
    expect(topic?.suggested_scriptures).toEqual(["Alma 32:21"]);

    expect((body.topic as Record<string, unknown>).id).toBe(candidate.accepted_topic_id);
  });

  // The claim the whole table exists for.
  it("writes NOTHING to topics when a candidate is rejected", async () => {
    const candidateId = await seedCandidate("The Gathering of Israel");
    const before = await countTopics();

    const { status, body } = await callPatch({ candidateId, status: "rejected" });

    expect(status).toBe(200);
    expect(body.topic).toBeNull();
    expect(await countTopics()).toBe(before);

    const candidate = await readCandidate(candidateId);
    expect(candidate.status).toBe("rejected");
    expect(candidate.accepted_topic_id).toBeNull();
    expect(candidate.reviewed_by).toBe(fixtures.user("bishop").id);
  });

  // Without the state check a double-tap creates the topic twice, and the second one has no
  // candidate pointing at it.
  it("refuses a second accept and does not create a second topic", async () => {
    const candidateId = await seedCandidate("Preparing for General Conference");

    const first = await callPatch({ candidateId, status: "accepted" });
    expect(first.status).toBe(200);

    const after = await countTopics();

    const second = await callPatch({ candidateId, status: "accepted" });

    expect(second.status).toBe(409);
    expect(errorMessage(second.body)).toContain("already been decided");
    expect(await countTopics()).toBe(after);
  });

  it("refuses re-deciding a rejected candidate", async () => {
    const candidateId = await seedCandidate("Already rejected");
    await callPatch({ candidateId, status: "rejected" });

    const { status } = await callPatch({ candidateId, status: "accepted" });

    expect(status).toBe(409);
  });

  // Migration 018's unique index on (ward_id, lower(title)) refuses a duplicate title. Without
  // this branch the answer is a 500 saying "please try again", for something retrying can never
  // fix — and the candidate would be left in a state the user cannot reason about.
  it("answers 409 when the suggestion duplicates a topic the ward already has, and leaves it pending", async () => {
    const title = `Faith in Jesus Christ ${fixtures.runId}`;

    const { error } = await fixtures.service.from("topics").insert({
      ward_id: fixtures.wardAId,
      title,
      category: "doctrinal",
      source: "manual",
      status: "active",
    });
    if (error) throw new Error(error.message);

    const { data: candidate, error: candidateError } = await fixtures.service
      .from("topic_candidates")
      .insert({
        ward_id: fixtures.wardAId,
        // Different casing on purpose — the index is on lower(title).
        title: title.toUpperCase(),
        category: "doctrinal",
        status: "pending",
      })
      .select("id")
      .single();
    if (candidateError) throw new Error(candidateError.message);

    const before = await countTopics();

    const { status, body } = await callPatch({
      candidateId: candidate.id,
      status: "accepted",
    });

    expect(status).toBe(409);
    expect(errorMessage(body)).toContain("already in this ward's library");
    expect(await countTopics()).toBe(before);

    // Still PENDING, so the bishopric can reject it or rename the topic they already have.
    expect((await readCandidate(candidate.id)).status).toBe("pending");
  });

  it("answers 404 for a candidate in another ward", async () => {
    const { data, error } = await fixtures.service
      .from("topic_candidates")
      .insert({
        ward_id: fixtures.wardBId,
        title: `Ward B suggestion ${fixtures.runId}`,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { status } = await callPatch({ candidateId: data.id, status: "accepted" });

    // RLS hides the row, so the route cannot tell "another ward" from "does not exist" — and
    // both mean "not yours" (plans/retros/foundation-c-services.md).
    expect(status).toBe(404);
  });

  describe("permissions", () => {
    // `topics.view` and `topics.manage` are bishopric-only in lib/auth/permissions.ts. The
    // music coordinator is the interesting negative: it holds `talks.view` and would look
    // plausible as a topic reader, and it does not hold either topics permission.
    it("refuses a ward secretary and a music coordinator", async () => {
      const candidateId = await seedCandidate("Refused for the secretary");
      const before = await countTopics();

      for (const handle of ["wardSecretary", "musicCoordinator"] as const) {
        await actAs(fixtures, handle);

        const patch = await callPatch({ candidateId, status: "accepted" });
        expect(patch.status, `${handle} was allowed to accept`).toBe(403);

        const get = await callGet();
        expect(get.status, `${handle} was allowed to read the queue`).toBe(403);
      }

      expect(await countTopics()).toBe(before);
      expect((await readCandidate(candidateId)).status).toBe("pending");

      await actAs(fixtures, "bishop");
    });

    // CLAUDE.md §7: bishopric authority is shared. A check that grants the bishop something a
    // counselor lacks is a bug, not a nicety.
    it("gives a counselor the same access as the bishop", async () => {
      const candidateId = await seedCandidate("Accepted by a counselor");

      await actAs(fixtures, "counselor1");

      const { status } = await callPatch({ candidateId, status: "accepted" });
      expect(status).toBe(200);

      expect((await readCandidate(candidateId)).reviewed_by).toBe(
        fixtures.user("counselor1").id,
      );

      await actAs(fixtures, "bishop");
    });
  });

  describe("GET /api/topic-candidates", () => {
    it("returns only pending candidates, so a reviewed one leaves the queue", async () => {
      const pending = await seedCandidate("Still waiting");
      const decided = await seedCandidate("Already handled");

      await callPatch({ candidateId: decided, status: "rejected" });

      const { status, body } = await callGet();

      expect(status).toBe(200);

      const ids = (body.candidates as Array<{ id: string }>).map((row) => row.id);

      expect(ids).toContain(pending);
      expect(ids).not.toContain(decided);
    });
  });
});
