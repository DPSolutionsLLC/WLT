// @vitest-environment node
//
// The list, patch and delete routes, following the CLAUDE.md §8 pattern: only the Supabase
// client factory is mocked, so every query still runs against the hosted project as a genuinely
// authenticated user and a passing test proves the RLS policy allowed it.
//
// THE UPLOAD ROUTE IS DELIBERATELY NOT TESTED HERE, AND THAT IS NOT AN OVERSIGHT. It needs a
// multipart `File`, a real Storage bucket, and either a live OpenAI call on every run or a mock
// deep enough that it proves nothing. Scenario 022 walks it in a browser with four real
// fixtures — a .txt, a .md, a text PDF and a scanned one — which is the only place the
// scanned-PDF refusal can honestly be judged.
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

const BASE_URL = "http://localhost/api/knowledge/documents";

// `knowledge.view` and `knowledge.manage` are bishopric-only in lib/auth/permissions.ts —
// checked there rather than assumed, per CLAUDE.md §8. `ward_secretary` holds neither, which is
// not the intuitive answer for a role that holds calendar.manage.
const REFUSED_HANDLE = "wardSecretary";

describe("knowledge document routes", () => {
  let fixtures: Fixtures;

  let wardADocumentId = "";
  let wardBDocumentId = "";

  const seedDocument = async (wardId: string, title: string, chunkCount: number) => {
    const { data, error } = await fixtures.service
      .from("knowledge_documents")
      .insert({
        ward_id: wardId,
        title: `${title} ${fixtures.runId}`,
        type_tag: "general_conference",
        status: "active",
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed knowledge_documents: ${error.message}`);

    if (chunkCount > 0) {
      const { error: chunkError } = await fixtures.service.from("document_chunks").insert(
        Array.from({ length: chunkCount }, (_, index) => ({
          ward_id: wardId,
          document_id: data.id,
          content: `Passage ${index} of ${title} ${fixtures.runId}`,
          // Left unembedded: these tests are about the routes, and an embedding would need
          // either a network call or 1536 hand-written numbers per row for no gain here. The
          // embedded/total split is asserted below precisely because they are null.
          embedding: null,
          chunk_index: index,
        })),
      );
      if (chunkError) throw new Error(`Could not seed document_chunks: ${chunkError.message}`);
    }

    return data.id;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "wardSecretary", "wardBBishop"]);

    wardADocumentId = await seedDocument(fixtures.wardAId, "Ward A talk", 3);
    wardBDocumentId = await seedDocument(fixtures.wardBId, "Ward B talk", 2);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("GET /api/knowledge/documents", () => {
    it("lists the ward's documents with both counts", async () => {
      await actAs(fixtures, "bishop");
      const { GET } = await import("@/app/api/knowledge/documents/route");

      const { status, body } = await readResponse(await GET());

      expect(status).toBe(200);

      const documents = body.documents as Array<Record<string, unknown>>;
      const own = documents.find((document) => document.id === wardADocumentId);

      expect(own).toBeDefined();
      // TWO NUMBERS. This is how a partial embedding failure reaches a human instead of
      // becoming quietly worse retrieval.
      expect(own?.chunkCount).toBe(3);
      expect(own?.embeddedCount).toBe(0);
    });

    it("does not list another ward's documents", async () => {
      await actAs(fixtures, "bishop");
      const { GET } = await import("@/app/api/knowledge/documents/route");

      const { body } = await readResponse(await GET());
      const documents = body.documents as Array<Record<string, unknown>>;

      expect(documents.some((document) => document.id === wardBDocumentId)).toBe(false);
    });

    it("grants a counselor the same access as the bishop", async () => {
      // Bishopric admin authority is shared (CLAUDE.md §7). Never build a check that grants the
      // bishop something a counselor lacks.
      await actAs(fixtures, "counselor1");
      const { GET } = await import("@/app/api/knowledge/documents/route");

      const { status } = await readResponse(await GET());

      expect(status).toBe(200);
    });

    it("refuses a ward secretary with 403", async () => {
      await actAs(fixtures, REFUSED_HANDLE);
      const { GET } = await import("@/app/api/knowledge/documents/route");

      const { status, body } = await readResponse(await GET());

      expect(status).toBe(403);
      expect(errorMessage(body)).toContain("permission");
    });
  });

  describe("PATCH /api/knowledge/documents/[id]", () => {
    it("deactivates and reactivates a document", async () => {
      await actAs(fixtures, "bishop");
      const { PATCH } = await import("@/app/api/knowledge/documents/[id]/route");

      const deactivated = await readResponse(
        await PATCH(
          jsonRequest(`${BASE_URL}/${wardADocumentId}`, {
            method: "PATCH",
            body: { status: "inactive" },
          }),
          { params: Promise.resolve({ id: wardADocumentId }) },
        ),
      );

      expect(deactivated.status).toBe(200);

      // Re-read with the service client rather than trusting the JSON the route handed back:
      // a route can report a row it did not write.
      const { data: after } = await fixtures.service
        .from("knowledge_documents")
        .select("status")
        .eq("id", wardADocumentId)
        .single();
      expect(after?.status).toBe("inactive");

      const reactivated = await readResponse(
        await PATCH(
          jsonRequest(`${BASE_URL}/${wardADocumentId}`, {
            method: "PATCH",
            body: { status: "active" },
          }),
          { params: Promise.resolve({ id: wardADocumentId }) },
        ),
      );

      expect(reactivated.status).toBe(200);
    });

    it("rejects a status the schema does not allow", async () => {
      await actAs(fixtures, "bishop");
      const { PATCH } = await import("@/app/api/knowledge/documents/[id]/route");

      const { status } = await readResponse(
        await PATCH(
          jsonRequest(`${BASE_URL}/${wardADocumentId}`, {
            method: "PATCH",
            body: { status: "archived" },
          }),
          { params: Promise.resolve({ id: wardADocumentId }) },
        ),
      );

      expect(status).toBe(400);
    });

    it("returns 404 for another ward's document, and leaves it untouched", async () => {
      await actAs(fixtures, "bishop");
      const { PATCH } = await import("@/app/api/knowledge/documents/[id]/route");

      const { status } = await readResponse(
        await PATCH(
          jsonRequest(`${BASE_URL}/${wardBDocumentId}`, {
            method: "PATCH",
            body: { status: "inactive" },
          }),
          { params: Promise.resolve({ id: wardBDocumentId }) },
        ),
      );

      // 404, not 403: answering 403 would confirm that the id exists somewhere.
      expect(status).toBe(404);

      const { data } = await fixtures.service
        .from("knowledge_documents")
        .select("status")
        .eq("id", wardBDocumentId)
        .single();
      expect(data?.status).toBe("active");
    });

    it("refuses a ward secretary with 403", async () => {
      await actAs(fixtures, REFUSED_HANDLE);
      const { PATCH } = await import("@/app/api/knowledge/documents/[id]/route");

      const { status } = await readResponse(
        await PATCH(
          jsonRequest(`${BASE_URL}/${wardADocumentId}`, {
            method: "PATCH",
            body: { status: "inactive" },
          }),
          { params: Promise.resolve({ id: wardADocumentId }) },
        ),
      );

      expect(status).toBe(403);
    });
  });

  describe("DELETE /api/knowledge/documents/[id]", () => {
    it("returns 404 for another ward's document, and the row survives", async () => {
      await actAs(fixtures, "bishop");
      const { DELETE } = await import("@/app/api/knowledge/documents/[id]/route");

      const { status } = await readResponse(
        await DELETE(jsonRequest(`${BASE_URL}/${wardBDocumentId}`, { method: "DELETE" }), {
          params: Promise.resolve({ id: wardBDocumentId }),
        }),
      );

      expect(status).toBe(404);

      const { data } = await fixtures.service
        .from("knowledge_documents")
        .select("id")
        .eq("id", wardBDocumentId)
        .maybeSingle();
      expect(data?.id).toBe(wardBDocumentId);
    });

    it("refuses a ward secretary, and the document is still there", async () => {
      await actAs(fixtures, REFUSED_HANDLE);
      const { DELETE } = await import("@/app/api/knowledge/documents/[id]/route");

      const { status } = await readResponse(
        await DELETE(jsonRequest(`${BASE_URL}/${wardADocumentId}`, { method: "DELETE" }), {
          params: Promise.resolve({ id: wardADocumentId }),
        }),
      );

      expect(status).toBe(403);

      // A refused DELETE is a zero-row success under RLS, so the proof is the re-read rather
      // than the status code (plans/retros/foundation-c-services.md).
      const { data } = await fixtures.service
        .from("knowledge_documents")
        .select("id")
        .eq("id", wardADocumentId)
        .maybeSingle();
      expect(data?.id).toBe(wardADocumentId);
    });

    it("deletes the document and CASCADES its passages", async () => {
      const doomedId = await seedDocument(fixtures.wardAId, "Doomed talk", 4);

      await actAs(fixtures, "bishop");
      const { DELETE } = await import("@/app/api/knowledge/documents/[id]/route");

      const { status, body } = await readResponse(
        await DELETE(jsonRequest(`${BASE_URL}/${doomedId}`, { method: "DELETE" }), {
          params: Promise.resolve({ id: doomedId }),
        }),
      );

      expect(status).toBe(200);
      // The count is returned so the confirm dialog and the audit row can both name it.
      expect(body.chunkCount).toBe(4);

      const { data: document } = await fixtures.service
        .from("knowledge_documents")
        .select("id")
        .eq("id", doomedId)
        .maybeSingle();
      expect(document).toBeNull();

      // The cascade is declared on document_chunks' composite FK (migration 014). An orphaned
      // chunk is a retrieval problem — text still being returned from a document the bishopric
      // believe they deleted — so it is proved rather than assumed.
      const { count } = await fixtures.service
        .from("document_chunks")
        .select("id", { count: "exact", head: true })
        .eq("document_id", doomedId);
      expect(count).toBe(0);
    });

    it("writes an audit row naming what went with it", async () => {
      const doomedId = await seedDocument(fixtures.wardAId, "Audited talk", 2);

      await actAs(fixtures, "bishop");
      const { DELETE } = await import("@/app/api/knowledge/documents/[id]/route");

      await DELETE(jsonRequest(`${BASE_URL}/${doomedId}`, { method: "DELETE" }), {
        params: Promise.resolve({ id: doomedId }),
      });

      // CLAUDE.md rule 6: every mutation writes an audit row.
      const { data } = await fixtures.service
        .from("audit_log")
        .select("action, detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "knowledge_document_deleted")
        .order("created_at", { ascending: false })
        .limit(5);

      const entry = (data ?? []).find(
        (row) => (row.detail as Record<string, unknown> | null)?.documentId === doomedId,
      );

      expect(entry).toBeDefined();
      expect((entry?.detail as Record<string, unknown>).chunkCount).toBe(2);
    });
  });
});
