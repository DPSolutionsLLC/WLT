// @vitest-environment node
//
// The four References routes (p4-sacrament-c), and decision 2 — a topic change returns a
// finalized Sunday's References to open and leaves a skip alone.
//
// Only the client factory and the EMBEDDING call are mocked. Every query runs against the hosted
// project as a genuinely authenticated user, so a passing test proves the policy allowed it; the
// search runs the real retrieveChunks() and the real match_document_chunks RPC over a chunk whose
// vector equals the mocked query's, so it cannot pass on an empty corpus.
//
// See tests/helpers/routeClient.ts for the vi.mock hoisting trap.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AiRequestError } from "@/lib/ai/errors";
import { EMBEDDING_DIMENSIONS } from "@/lib/ai/embed";
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

// No OpenAI call in a test run. The vector returned is chosen per test.
const embedQuery = vi.fn();

vi.mock("@/lib/ai/embed", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/embed")>("@/lib/ai/embed");
  return {
    ...actual,
    embedQuery: (...args: unknown[]) => embedQuery(...args),
  };
});

function unitVector(axis: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === axis ? 1 : 0));
}

function asVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

type Decision = { references_finalized_at: string | null; references_skipped_at: string | null };

describe("References routes", () => {
  let fixtures: Fixtures;

  let sundayId = "";
  let otherSundayId = "";
  let emptySundayId = "";
  let slotOneId = "";
  let slotTwoId = "";
  let noTopicId = "";
  let otherSundayTalkId = "";
  let topicId = "";
  let otherTopicId = "";
  let documentId = "";

  const url = (id: string, suffix = "") => `http://localhost/api/sundays/${id}/references${suffix}`;

  const callGet = async (id: string) => {
    const { GET } = await import("@/app/api/sundays/[id]/references/route");
    return readResponse(await GET(jsonRequest(url(id)), { params: Promise.resolve({ id }) }));
  };

  const callAdd = async (id: string, body: unknown) => {
    const { POST } = await import("@/app/api/sundays/[id]/references/route");
    return readResponse(
      await POST(jsonRequest(url(id), { method: "POST", body }), {
        params: Promise.resolve({ id }),
      }),
    );
  };

  const callRemove = async (id: string, referenceId: string) => {
    const { DELETE } = await import("@/app/api/sundays/[id]/references/[referenceId]/route");
    return readResponse(
      await DELETE(jsonRequest(url(id, `/${referenceId}`), { method: "DELETE" }), {
        params: Promise.resolve({ id, referenceId }),
      }),
    );
  };

  const callDecide = async (id: string, decision: "finalized" | "skipped" | null) => {
    const { PATCH } = await import("@/app/api/sundays/[id]/references-decision/route");
    return readResponse(
      await PATCH(
        jsonRequest(`http://localhost/api/sundays/${id}/references-decision`, {
          method: "PATCH",
          body: { decision },
        }),
        { params: Promise.resolve({ id }) },
      ),
    );
  };

  const callSearch = async (id: string, body: unknown) => {
    const { POST } = await import("@/app/api/sundays/[id]/references/search/route");
    return readResponse(
      await POST(jsonRequest(url(id, "/search"), { method: "POST", body }), {
        params: Promise.resolve({ id }),
      }),
    );
  };

  const manual = (assignmentId: string, citation: string) => ({
    assignmentId,
    kind: "scripture",
    citation,
    source: "manual",
  });

  const readDecision = async (id: string): Promise<Decision> => {
    const { data, error } = await fixtures.service
      .from("sundays")
      .select("references_finalized_at, references_skipped_at")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  };

  // Set through the SERVICE client, so a test about what clears a decision does not depend on the
  // route that sets one.
  const setDecision = async (id: string, decision: "finalized" | "skipped" | null) => {
    const now = new Date().toISOString();
    const { error } = await fixtures.service
      .from("sundays")
      .update({
        references_finalized_at: decision === "finalized" ? now : null,
        references_skipped_at: decision === "skipped" ? now : null,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
  };

  const seedReference = async (assignmentId: string, citation: string) => {
    const { data, error } = await fixtures.service
      .from("talk_references")
      .insert({
        ward_id: fixtures.wardAId,
        assignment_id: assignmentId,
        kind: "scripture",
        citation,
        source: "manual",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id;
  };

  const referenceExists = async (referenceId: string) => {
    const { data } = await fixtures.service
      .from("talk_references")
      .select("id")
      .eq("id", referenceId)
      .maybeSingle();
    return data !== null;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "musicCoordinator", "eqPresident"]);

    const seedSunday = async (date: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: fixtures.wardAId, date, type: "standard", speaking_slots: 3 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    sundayId = await seedSunday("2027-06-06");
    otherSundayId = await seedSunday("2027-06-13");
    emptySundayId = await seedSunday("2027-06-20");

    const seedTopic = async (title: string) => {
      const { data, error } = await fixtures.service
        .from("topics")
        .insert({ ward_id: fixtures.wardAId, title, source: "manual" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    topicId = await seedTopic(`Faith ${fixtures.runId}`);
    otherTopicId = await seedTopic(`Hope ${fixtures.runId}`);

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

    const seedAssignment = async (
      sunday: string,
      slotNumber: number,
      topic: string | null,
      memberId: string | null = null,
    ) => {
      const { data, error } = await fixtures.service
        .from("assignments")
        .insert({
          ward_id: fixtures.wardAId,
          sunday_id: sunday,
          assignment_type: "sacrament_talk",
          slot_number: slotNumber,
          topic_id: topic,
          member_id: memberId,
          pipeline_stage: "plan",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    // Slot 2 is inserted FIRST, so the GET's slot ordering cannot pass by insertion order.
    slotTwoId = await seedAssignment(sundayId, 2, otherTopicId);
    slotOneId = await seedAssignment(sundayId, 1, topicId, member.id);
    noTopicId = await seedAssignment(sundayId, 3, null);
    otherSundayTalkId = await seedAssignment(otherSundayId, 1, topicId);
    // A talk WITH a topic and no references, so the 409 is about the count, not an empty Sunday.
    await seedAssignment(emptySundayId, 1, topicId);

    const { data: document, error: documentError } = await fixtures.service
      .from("knowledge_documents")
      .insert({
        ward_id: fixtures.wardAId,
        title: "The Power of Covenants",
        type_tag: "general_conference",
        speaker: "Elder Example",
        conference_date: "2025-04-01",
      })
      .select("id")
      .single();
    if (documentError) throw new Error(documentError.message);
    documentId = document.id;

    const { error: chunkError } = await fixtures.service.from("document_chunks").insert({
      ward_id: fixtures.wardAId,
      document_id: documentId,
      content: "Covenants bind us to the Savior and give us power.",
      embedding: asVectorLiteral(unitVector(7)),
      chunk_index: 0,
    });
    if (chunkError) throw new Error(chunkError.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  beforeEach(() => {
    embedQuery.mockReset();
  });

  describe("GET", () => {
    it("lists only talks with a topic, in slot order, to the bishop", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet(sundayId);
      const talks = body.talks as { assignmentId: string; topicTitle: string; speakerName: string | null }[];

      expect(status).toBe(200);
      expect(talks.map((talk) => talk.assignmentId)).toEqual([slotOneId, slotTwoId]);
      expect(talks[0].topicTitle).toBe(`Faith ${fixtures.runId}`);
      expect(talks[0].speakerName).toBe(`Speaker Fixture${fixtures.runId}`);
      expect(talks.map((talk) => talk.assignmentId)).not.toContain(noTopicId);
      expect(Array.isArray((talks[0] as { suggestedScriptures?: unknown }).suggestedScriptures)).toBe(
        true,
      );
    });

    it("lets a counselor read — the whole bishopric, whoever is conducting", async () => {
      await actAs(fixtures, "counselor1");

      expect((await callGet(sundayId)).status).toBe(200);
    });

    // Defect 074-D2, migration 080: references are the bishopric's alone.
    it("refuses a music coordinator", async () => {
      await actAs(fixtures, "musicCoordinator");

      expect((await callGet(sundayId)).status).toBe(403);
    });

    it("refuses an org president", async () => {
      await actAs(fixtures, "eqPresident");

      expect((await callGet(sundayId)).status).toBe(403);
    });
  });

  describe("POST — add", () => {
    it("adds, reopens a finalized Sunday, and audits without the citation", async () => {
      await seedReference(slotOneId, "Existing");
      await setDecision(sundayId, "finalized");
      await actAs(fixtures, "bishop");

      const citation = `Private words ${fixtures.runId}`;
      const { status, body } = await callAdd(sundayId, manual(slotOneId, citation));

      expect(status).toBe(201);
      expect(body.decision).toBeNull();
      expect((await readDecision(sundayId)).references_finalized_at).toBeNull();

      const referenceId = (body.reference as { id: string }).id;
      const { data: audit } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "talk_reference_added")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      expect((audit?.detail as { referenceId?: string }).referenceId).toBe(referenceId);
      expect(JSON.stringify(audit?.detail)).not.toContain(citation);
    });

    // A reference contradicts "not giving references this round" — the prototype's deviation.
    it("clears a skip", async () => {
      await setDecision(sundayId, "skipped");
      await actAs(fixtures, "bishop");

      const { status, body } = await callAdd(sundayId, manual(slotTwoId, "Ether 12:27"));

      expect(status).toBe(201);
      expect(body.decision).toBeNull();
      expect(await readDecision(sundayId)).toEqual({
        references_finalized_at: null,
        references_skipped_at: null,
      });
    });

    it("refuses a talk from another Sunday", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callAdd(sundayId, manual(otherSundayTalkId, "Wrong day"));

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("That talk is not on this Sunday.");
    });

    it("refuses a talk that has no topic", async () => {
      await actAs(fixtures, "bishop");

      expect((await callAdd(sundayId, manual(noTopicId, "No topic"))).status).toBe(400);
    });

    it("refuses a music coordinator", async () => {
      await actAs(fixtures, "musicCoordinator");

      expect((await callAdd(sundayId, manual(slotOneId, "Music tries"))).status).toBe(403);
    });
  });

  describe("DELETE — remove", () => {
    it("reopens a finalized Sunday", async () => {
      const referenceId = await seedReference(slotOneId, "To remove");
      await setDecision(sundayId, "finalized");
      await actAs(fixtures, "bishop");

      const { status, body } = await callRemove(sundayId, referenceId);

      expect(status).toBe(200);
      expect(body.decision).toBeNull();
      expect(await referenceExists(referenceId)).toBe(false);
    });

    it("leaves a skip standing", async () => {
      const referenceId = await seedReference(slotOneId, "Leftover");
      await setDecision(sundayId, "skipped");
      await actAs(fixtures, "bishop");

      const { status, body } = await callRemove(sundayId, referenceId);

      expect(status).toBe(200);
      expect(body.decision).toBe("skipped");
      expect((await readDecision(sundayId)).references_skipped_at).not.toBeNull();
    });

    it("answers 404 for another Sunday's reference through this Sunday's URL", async () => {
      const referenceId = await seedReference(otherSundayTalkId, "Other Sunday's");
      await actAs(fixtures, "bishop");

      expect((await callRemove(sundayId, referenceId)).status).toBe(404);
      expect(await referenceExists(referenceId)).toBe(true);
    });

    it("refuses a music coordinator", async () => {
      const referenceId = await seedReference(slotOneId, "Music cannot remove");
      await actAs(fixtures, "musicCoordinator");

      expect((await callRemove(sundayId, referenceId)).status).toBe(403);
      expect(await referenceExists(referenceId)).toBe(true);
    });
  });

  describe("PATCH — decision", () => {
    it("refuses to finalize with no references, and names the alternative", async () => {
      await setDecision(emptySundayId, null);
      await actAs(fixtures, "bishop");

      const { status, body } = await callDecide(emptySundayId, "finalized");

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("skip references");
      expect(await readDecision(emptySundayId)).toEqual({
        references_finalized_at: null,
        references_skipped_at: null,
      });
    });

    it("finalizes, then null clears it", async () => {
      await seedReference(slotOneId, "Something to finalize");
      await setDecision(sundayId, null);
      await actAs(fixtures, "bishop");

      const finalized = await callDecide(sundayId, "finalized");
      expect(finalized.status).toBe(200);
      expect(finalized.body.decision).toBe("finalized");
      expect((await readDecision(sundayId)).references_finalized_at).not.toBeNull();

      const reopened = await callDecide(sundayId, null);
      expect(reopened.status).toBe(200);
      expect(await readDecision(sundayId)).toEqual({
        references_finalized_at: null,
        references_skipped_at: null,
      });
    });

    // Defect 074-D1: "not giving references this round" over references that are listed is two
    // claims on one pill. Refused, with the way forward named, and nothing deleted.
    it("refuses to skip while references exist, and names the alternative", async () => {
      await seedReference(slotOneId, "Still here");
      await setDecision(sundayId, null);
      await actAs(fixtures, "bishop");

      const { status, body } = await callDecide(sundayId, "skipped");

      expect(status).toBe(409);
      expect(errorMessage(body)).toBe("Remove the references first to skip this Sunday.");
      expect(await readDecision(sundayId)).toEqual({
        references_finalized_at: null,
        references_skipped_at: null,
      });
    });

    it("lets a Sunday with no references be skipped", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callDecide(emptySundayId, "skipped");

      expect(status).toBe(200);
      expect(body.decision).toBe("skipped");
      await setDecision(emptySundayId, null);
    });

    it("refuses a music coordinator", async () => {
      await setDecision(sundayId, null);
      await actAs(fixtures, "musicCoordinator");

      expect((await callDecide(sundayId, "skipped")).status).toBe(403);
      expect((await readDecision(sundayId)).references_skipped_at).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // DECISION 2 — A TOPIC CHANGE UN-FINALIZES REFERENCES, AND NOTHING ELSE DOES
  // ---------------------------------------------------------------------------
  describe("decision 2", () => {
    const callAssignmentPatch = async (id: string, body: unknown) => {
      const { PATCH } = await import("@/app/api/assignments/[id]/route");
      return readResponse(
        await PATCH(jsonRequest(`http://localhost/api/assignments/${id}`, { method: "PATCH", body }), {
          params: Promise.resolve({ id }),
        }),
      );
    };

    const resetSlotOne = async () => {
      const { error } = await fixtures.service
        .from("assignments")
        .update({ pipeline_stage: "plan", topic_id: topicId })
        .eq("id", slotOneId);
      if (error) throw new Error(error.message);
    };

    it("reopens finalized References when a slot's topic changes", async () => {
      await resetSlotOne();
      await setDecision(sundayId, "finalized");
      await actAs(fixtures, "bishop");

      const { status } = await callAssignmentPatch(slotOneId, {
        action: "update",
        fields: { topicId: otherTopicId },
      });

      expect(status).toBe(200);
      expect((await readDecision(sundayId)).references_finalized_at).toBeNull();
    });

    it("leaves a skip standing when a slot's topic changes", async () => {
      await resetSlotOne();
      await setDecision(sundayId, "skipped");
      await actAs(fixtures, "bishop");

      const { status } = await callAssignmentPatch(slotOneId, {
        action: "update",
        fields: { topicId: otherTopicId },
      });

      expect(status).toBe(200);
      expect((await readDecision(sundayId)).references_skipped_at).not.toBeNull();
    });

    it("leaves finalized References alone through a pipeline transition", async () => {
      await resetSlotOne();
      await setDecision(sundayId, "finalized");
      await actAs(fixtures, "bishop");

      const { status } = await callAssignmentPatch(slotOneId, { action: "transition", to: "review" });

      expect(status).toBe(200);
      expect((await readDecision(sundayId)).references_finalized_at).not.toBeNull();
    });

    // Un-finalizing TOPICS by hand says nothing about what the topics are.
    it("leaves finalized References alone when Topics is un-finalized by hand", async () => {
      await resetSlotOne();
      const { error } = await fixtures.service
        .from("sundays")
        .update({
          topics_finalized_at: new Date().toISOString(),
          references_finalized_at: new Date().toISOString(),
          references_skipped_at: null,
        })
        .eq("id", sundayId);
      if (error) throw new Error(error.message);
      await actAs(fixtures, "bishop");

      const { PATCH } = await import("@/app/api/sundays/[id]/topics-finalized/route");
      const { status } = await readResponse(
        await PATCH(
          jsonRequest(`http://localhost/api/sundays/${sundayId}/topics-finalized`, {
            method: "PATCH",
            body: { finalized: false },
          }),
          { params: Promise.resolve({ id: sundayId }) },
        ),
      );

      expect(status).toBe(200);
      expect((await readDecision(sundayId)).references_finalized_at).not.toBeNull();
    });
  });

  describe("POST — search", () => {
    it("returns citations from the ward's own library", async () => {
      embedQuery.mockResolvedValue(unitVector(7));
      await actAs(fixtures, "bishop");

      const { status, body } = await callSearch(sundayId, {
        assignmentId: slotOneId,
        query: "covenants",
      });
      const suggestions = body.suggestions as { citation: string; documentId: string; kind: string }[];

      expect(status).toBe(200);
      expect(suggestions).toContainEqual(
        expect.objectContaining({
          kind: "talk",
          documentId,
          citation: "The Power of Covenants — Elder Example, April 2025",
        }),
      );
    });

    it("answers an empty list, not an error, when nothing clears the floor", async () => {
      embedQuery.mockResolvedValue(unitVector(900));
      await actAs(fixtures, "bishop");

      const { status, body } = await callSearch(sundayId, {
        assignmentId: slotOneId,
        query: "nothing like it",
      });

      expect(status).toBe(200);
      expect(body.suggestions).toEqual([]);
    });

    it("refuses an empty query", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await callSearch(sundayId, { assignmentId: slotOneId, query: "   " });

      expect(status).toBe(400);
      expect(embedQuery).not.toHaveBeenCalled();
    });

    it("refuses a music coordinator before spending an embedding", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callSearch(sundayId, { assignmentId: slotOneId, query: "faith" });

      expect(status).toBe(403);
      expect(embedQuery).not.toHaveBeenCalled();
    });

    it("answers a failed embedding with a sentence", async () => {
      embedQuery.mockRejectedValue(
        new AiRequestError(
          "unavailable",
          "Could not reach the document search service. Check your connection and try again.",
        ),
      );
      await actAs(fixtures, "bishop");

      const { status, body } = await callSearch(sundayId, {
        assignmentId: slotOneId,
        query: "faith",
      });

      expect(status).toBeGreaterThanOrEqual(500);
      expect(errorMessage(body)).toContain("document search service");
    });
  });
});
