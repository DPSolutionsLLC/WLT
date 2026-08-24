// @vitest-environment node
//
// Phase 5 test **retrieval-scoping**, and the highest-value test in this plan.
//
// It goes through the REAL match_document_chunks function as a REAL authenticated user, because
// the claim being proved is about the policy, not about a WHERE clause. A ward that could
// retrieve another ward's corpus would be putting another bishopric's private documents into
// its own drafts, with a citation making them look authoritative.
//
// NO OPENAI CALL. The embeddings are hand-written unit vectors inserted with the service client:
// a chunk embedded as [1,0,0,…] and a query of [1,0,0,…] give a cosine similarity of exactly 1,
// with no network, no spend and no flakiness. What is under test is the scoping, not the model.
//
// Every negative assertion re-reads or re-queries rather than trusting an error. An RLS-denied
// read is an EMPTY RESULT, not a failure (plans/retros/foundation-c-services.md).
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is
// deleted in afterAll and nothing assumes an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

const DIMENSIONS = 1536;

// A unit vector with its 1 at `axis`. Two of these are orthogonal, so a query aligned with one
// scores 1 against it and 0 against the other — the cleanest possible separation.
function unitVector(axis: number): number[] {
  return Array.from({ length: DIMENSIONS }, (_, index) => (index === axis ? 1 : 0));
}

// pgvector's text input format is `[1,2,3]`, byte-identical to a JSON array.
function asVectorLiteral(vector: readonly number[]): string {
  return JSON.stringify(vector);
}

const WARD_A_AXIS = 0;
const WARD_A_SECOND_AXIS = 2;

describe("retrieval scoping", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;

  let wardADocumentId = "";
  let wardASecondDocumentId = "";
  let wardBDocumentId = "";

  const seedDocument = async (wardId: string, title: string) => {
    const { data, error } = await fixtures.service
      .from("knowledge_documents")
      .insert({
        ward_id: wardId,
        title: `${title} ${fixtures.runId}`,
        type_tag: "other",
        status: "active",
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed knowledge_documents: ${error.message}`);
    return data.id;
  };

  const seedChunk = async (
    wardId: string,
    documentId: string,
    content: string,
    embedding: number[] | null,
    chunkIndex = 0,
  ) => {
    const { error } = await fixtures.service.from("document_chunks").insert({
      ward_id: wardId,
      document_id: documentId,
      content,
      embedding: embedding === null ? null : asVectorLiteral(embedding),
      chunk_index: chunkIndex,
    });

    if (error) throw new Error(`Could not seed document_chunks: ${error.message}`);
  };

  const search = async (
    client: SupabaseClient<Database>,
    axis: number,
    wardId: string,
    matchCount = 10,
  ) => {
    const { data, error } = await client.rpc("match_document_chunks", {
      query_embedding: asVectorLiteral(unitVector(axis)),
      match_ward_id: wardId,
      match_count: matchCount,
    });

    if (error) throw new Error(`match_document_chunks failed: ${error.message}`);
    return data ?? [];
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "wardBBishop"]);

    bishopA = await asRole(fixtures, "bishop");
    bishopB = await asRole(fixtures, "wardBBishop");

    wardADocumentId = await seedDocument(fixtures.wardAId, "Ward A talk");
    wardASecondDocumentId = await seedDocument(fixtures.wardAId, "Ward A letter");
    wardBDocumentId = await seedDocument(fixtures.wardBId, "Ward B talk");

    await seedChunk(
      fixtures.wardAId,
      wardADocumentId,
      `WARD-A-PASSAGE-${fixtures.runId}`,
      unitVector(WARD_A_AXIS),
    );

    await seedChunk(
      fixtures.wardAId,
      wardASecondDocumentId,
      `WARD-A-SECOND-PASSAGE-${fixtures.runId}`,
      unitVector(WARD_A_SECOND_AXIS),
    );

    // Embedded on the SAME axis ward A queries with, so if scoping ever fails this chunk
    // surfaces at similarity 1 — the loudest possible failure rather than a subtle one.
    await seedChunk(
      fixtures.wardBId,
      wardBDocumentId,
      `WARD-B-PASSAGE-${fixtures.runId}`,
      unitVector(WARD_A_AXIS),
    );

    // A chunk whose embedding failed during ingest. Its text is kept on purpose
    // (lib/knowledge/ingest.ts); it must never be retrievable.
    await seedChunk(
      fixtures.wardAId,
      wardADocumentId,
      `WARD-A-UNEMBEDDED-${fixtures.runId}`,
      null,
      1,
    );
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("cross-ward isolation", () => {
    it("returns ward A's own passage to ward A at similarity 1", async () => {
      const results = await search(bishopA, WARD_A_AXIS, fixtures.wardAId);

      const own = results.find((row) => row.content.startsWith("WARD-A-PASSAGE"));
      expect(own).toBeDefined();
      expect(own?.similarity).toBeCloseTo(1, 5);
    });

    it("NEVER returns ward B's passage to ward A, even at a perfect match", async () => {
      const results = await search(bishopA, WARD_A_AXIS, fixtures.wardAId);

      expect(results.some((row) => row.content.includes("WARD-B-PASSAGE"))).toBe(false);
    });

    it("returns NOTHING when ward A asks for ward B's ward id", async () => {
      // THE ASSERTION THE `SECURITY INVOKER` DEFAULT EXISTS FOR. RLS applies inside the
      // function, so document_chunks' ward policy is the real boundary and match_ward_id is
      // only defence in depth. If somebody "optimises" this function to SECURITY DEFINER, this
      // test fails — and it is the only thing that would notice before a ward did.
      const results = await search(bishopA, WARD_A_AXIS, fixtures.wardBId);

      expect(results).toEqual([]);
    });

    it("returns ward B's passage to ward B", async () => {
      // The mirror of the isolation test: proves the empty results above are the policy working
      // rather than the fixture being broken.
      const results = await search(bishopB, WARD_A_AXIS, fixtures.wardBId);

      expect(results.some((row) => row.content.includes("WARD-B-PASSAGE"))).toBe(true);
    });
  });

  describe("unembedded passages", () => {
    it("never returns a chunk whose embedding is null, at any similarity", async () => {
      // Without the `c.embedding is not null` filter these sort FIRST, because `null <=> vector`
      // ranks ahead of every real distance. A failed chunk would become the most relevant
      // passage in the corpus for every query ever made.
      for (const axis of [WARD_A_AXIS, WARD_A_SECOND_AXIS, 500]) {
        const results = await search(bishopA, axis, fixtures.wardAId);
        expect(results.some((row) => row.content.includes("WARD-A-UNEMBEDDED"))).toBe(false);
      }
    });
  });

  describe("deactivation", () => {
    it("removes a document's passages from the very next query, with no reindex", async () => {
      const before = await search(bishopA, WARD_A_SECOND_AXIS, fixtures.wardAId);
      expect(before.some((row) => row.content.includes("WARD-A-SECOND-PASSAGE"))).toBe(true);

      const { error } = await bishopA
        .from("knowledge_documents")
        .update({ status: "inactive" })
        .eq("id", wardASecondDocumentId)
        .eq("ward_id", fixtures.wardAId);
      expect(error).toBeNull();

      // No rebuild step between these two calls. The search function filters on
      // d.status = 'active', which is why status is a column rather than this being a delete.
      const after = await search(bishopA, WARD_A_SECOND_AXIS, fixtures.wardAId);
      expect(after.some((row) => row.content.includes("WARD-A-SECOND-PASSAGE"))).toBe(false);
    });

    it("brings them back on reactivation", async () => {
      const { error } = await bishopA
        .from("knowledge_documents")
        .update({ status: "active" })
        .eq("id", wardASecondDocumentId)
        .eq("ward_id", fixtures.wardAId);
      expect(error).toBeNull();

      const results = await search(bishopA, WARD_A_SECOND_AXIS, fixtures.wardAId);
      expect(results.some((row) => row.content.includes("WARD-A-SECOND-PASSAGE"))).toBe(true);
    });
  });

  describe("the returned shape", () => {
    it("carries the document title and tag so a citation can be built", async () => {
      const results = await search(bishopA, WARD_A_AXIS, fixtures.wardAId);
      const own = results.find((row) => row.content.startsWith("WARD-A-PASSAGE"));

      // A chunk with no usable label is a citation nobody can check.
      expect(own?.title).toContain("Ward A talk");
      expect(own?.type_tag).toBe("other");
      expect(own?.document_id).toBe(wardADocumentId);
    });

    it("honours match_count", async () => {
      const results = await search(bishopA, WARD_A_AXIS, fixtures.wardAId, 1);

      expect(results).toHaveLength(1);
    });
  });

  describe("cross-ward writes", () => {
    it("refuses ward A an insert into ward B's chunks", async () => {
      // INSERT is the one operation that raises rather than silently affecting zero rows.
      const { error } = await bishopA.from("document_chunks").insert({
        ward_id: fixtures.wardBId,
        document_id: wardBDocumentId,
        content: `LEAKED-${fixtures.runId}`,
        chunk_index: 99,
      });

      expect(error).not.toBeNull();
    });

    it("refuses ward A a delete of ward B's document, and the row is still there", async () => {
      await bishopA
        .from("knowledge_documents")
        .delete()
        .eq("id", wardBDocumentId)
        .eq("ward_id", fixtures.wardBId);

      // RE-READ WITH THE SERVICE CLIENT. An RLS-denied DELETE is a zero-row success, not an
      // error, so asserting on `error` here would pass while the row was gone.
      const { data } = await fixtures.service
        .from("knowledge_documents")
        .select("id")
        .eq("id", wardBDocumentId)
        .maybeSingle();

      expect(data?.id).toBe(wardBDocumentId);
    });
  });
});
