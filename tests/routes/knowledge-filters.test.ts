// @vitest-environment node
//
// The three saved-filter routes, called as ordinary functions. Only the Supabase client factory
// is mocked, so every query still runs against the hosted project as a genuinely authenticated
// user — a passing test here proves the RLS policy allowed the query (tests/helpers/routeClient.ts).
//
// THE RESOLVER ROUTE IS NOT CALLED HERE. It spends an Anthropic call, and what is worth asserting
// about it is that it saves nothing — which is asserted structurally below by counting
// `retrieval_filters` rows, the same way tests/routes/ai-suggest.test.ts counts `topics`.
// lib/ai/resolveFilter.ts's narrowing is covered as pure logic in tests/lib/.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const FILTERS_URL = "http://localhost/api/knowledge/filters";

describe("knowledge filter routes", () => {
  let fixtures: Fixtures;
  let label = "";

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "wardSecretary"]);
    label = `Prophets ${fixtures.runId}`;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  async function post(body: unknown) {
    const { POST } = await import("@/app/api/knowledge/filters/route");
    return readResponse(
      await POST(jsonRequest(FILTERS_URL, { method: "POST", body })),
    );
  }

  async function list() {
    const { GET } = await import("@/app/api/knowledge/filters/route");
    return readResponse(await GET());
  }

  async function remove(id: string) {
    const { DELETE } = await import("@/app/api/knowledge/filters/[id]/route");
    return readResponse(
      await DELETE(jsonRequest(`${FILTERS_URL}/${id}`, { method: "DELETE" }), {
        // `params` is a Promise in Next 16.
        params: Promise.resolve({ id }),
      }),
    );
  }

  describe("POST — saving a proposal somebody accepted", () => {
    it("saves a filter and returns 201", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await post({
        label,
        sourcePhrase: "talks by prophets",
        speakerRoles: ["prophet"],
      });

      expect(status).toBe(201);
      expect(body.filter).toMatchObject({
        label,
        sourcePhrase: "talks by prophets",
        speakerRoles: ["prophet"],
        speakers: null,
        since: null,
      });
    });

    it("keeps the phrase that produced it", async () => {
      // Six months on, three columns of enum values are something to reverse-engineer. The
      // phrase is the only durable explanation of why the filter holds what it holds.
      await actAs(fixtures, "bishop");
      const { body } = await list();

      const saved = (body.filters as { label: string; sourcePhrase: string }[]).find(
        (filter) => filter.label === label,
      );

      expect(saved?.sourcePhrase).toBe("talks by prophets");
    });

    it("REFUSES A DUPLICATE LABEL with a sentence and a 409, not a 500", async () => {
      // Two filters called the same thing in one checkbox list is a bug report waiting to
      // happen, so migration 034 refuses it — and the person who just typed that name is the one
      // who can fix it, so they get told what happened rather than "please try again", which
      // would fail identically forever.
      await actAs(fixtures, "bishop");

      const { status, body } = await post({
        label,
        sourcePhrase: "a different phrase",
        speakerRoles: ["apostle"],
      });

      expect(status).toBe(409);
      expect(body.error).toContain(label);
      expect(body.error).toContain("already exists");
    });

    it("refuses a filter that narrows nothing, with a written sentence", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await post({
        label: `Narrows nothing ${fixtures.runId}`,
        sourcePhrase: "nothing",
      });

      expect(status).toBe(400);
      expect(body.error).toContain("would not narrow anything");
    });

    it("refuses an EMPTY ARRAY on an axis", async () => {
      // `= any ('{}')` matches nothing, so this would save a filter that silently returns zero
      // documents while reading as "no restriction".
      await actAs(fixtures, "bishop");

      const { status } = await post({
        label: `Empty ${fixtures.runId}`,
        sourcePhrase: "empty",
        speakerRoles: [],
      });

      expect(status).toBe(400);
    });

    it("refuses a speaker role outside the vocabulary", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await post({
        label: `Bad role ${fixtures.runId}`,
        sourcePhrase: "stake presidents",
        speakerRoles: ["stake_president"],
      });

      expect(status).toBe(400);
    });

    it("lets a COUNSELOR save one — bishopric authority is shared", async () => {
      // CLAUDE.md §7. Never build a check that grants the bishop something a counselor lacks.
      await actAs(fixtures, "counselor1");

      const { status } = await post({
        label: `Counselor filter ${fixtures.runId}`,
        sourcePhrase: "recent talks",
        since: "2024-04-01",
      });

      expect(status).toBe(201);
    });

    it("REFUSES a ward_secretary with 403", async () => {
      // `knowledge.manage` is bishopric-only in lib/auth/permissions.ts — checked against the
      // matrix rather than assumed, because the intuitive answer is not always the right one.
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await post({
        label: `Secretary filter ${fixtures.runId}`,
        sourcePhrase: "should not save",
        speakerRoles: ["apostle"],
      });

      expect(status).toBe(403);
      expect(body.error).toBe("You do not have permission to do that.");
    });

    it("wrote nothing when it refused", async () => {
      const { data } = await fixtures.service
        .from("retrieval_filters")
        .select("id")
        .eq("ward_id", fixtures.wardAId)
        .eq("label", `Secretary filter ${fixtures.runId}`);

      expect(data).toEqual([]);
    });
  });

  describe("GET — listing", () => {
    it("returns this ward's filters to the bishop", async () => {
      await actAs(fixtures, "bishop");
      const { status, body } = await list();

      expect(status).toBe(200);
      expect(
        (body.filters as { label: string }[]).some((filter) => filter.label === label),
      ).toBe(true);
    });

    it("names who saved each one", async () => {
      await actAs(fixtures, "bishop");
      const { body } = await list();

      const saved = (body.filters as { label: string; createdByName: string | null }[]).find(
        (filter) => filter.label === label,
      );

      expect(saved?.createdByName).toBeTruthy();
    });

    it("REFUSES a ward_secretary, because knowledge.view is bishopric-only too", async () => {
      // CHECKED AGAINST THE MATRIX, NOT ASSUMED. The route asks for `knowledge.view` rather than
      // `manage` — reading which filters exist is part of reading the panel — but in
      // lib/auth/permissions.ts BOTH knowledge permissions are bishopric-only, so this is still
      // a 403. The route's choice of the weaker permission is what will matter if that ever
      // changes; the assertion records what is true today.
      await actAs(fixtures, "wardSecretary");
      const { status } = await list();

      expect(status).toBe(403);
    });
  });

  describe("DELETE", () => {
    it("404s for a filter that is not this ward's", async () => {
      // 404 rather than 403: the query is ward-scoped, so a miss means "not this ward's filter",
      // and answering 403 would confirm the id exists somewhere.
      await actAs(fixtures, "bishop");

      const { data } = await fixtures.service
        .from("retrieval_filters")
        .insert({
          ward_id: fixtures.wardBId,
          label: `Ward B filter ${fixtures.runId}`,
          source_phrase: "ward B",
          speaker_roles: ["prophet"],
        })
        .select("id")
        .single();

      const { status } = await remove(data!.id);

      expect(status).toBe(404);

      // AND THE ROW IS STILL THERE. An RLS-denied DELETE is a zero-row success, not an error, so
      // re-reading is the only thing that tells the two apart.
      const { data: after } = await fixtures.service
        .from("retrieval_filters")
        .select("id")
        .eq("id", data!.id)
        .maybeSingle();

      expect(after?.id).toBe(data!.id);
    });

    it("REFUSES a ward_secretary with 403", async () => {
      await actAs(fixtures, "wardSecretary");

      const { data } = await fixtures.service
        .from("retrieval_filters")
        .select("id")
        .eq("ward_id", fixtures.wardAId)
        .eq("label", label)
        .single();

      const { status } = await remove(data!.id);

      expect(status).toBe(403);
    });

    it("deletes the ward's own filter and does NOT touch the documents", async () => {
      await actAs(fixtures, "bishop");

      const { data: document } = await fixtures.service
        .from("knowledge_documents")
        .insert({
          ward_id: fixtures.wardAId,
          title: `Untouched ${fixtures.runId}`,
          type_tag: "general_conference",
          status: "active",
          speaker: "Russell M. Nelson",
          speaker_role: "prophet",
          conference_date: "2026-04-01",
        })
        .select("id")
        .single();

      const { data: filter } = await fixtures.service
        .from("retrieval_filters")
        .select("id")
        .eq("ward_id", fixtures.wardAId)
        .eq("label", label)
        .single();

      const { status, body } = await remove(filter!.id);

      expect(status).toBe(200);
      expect(body.deleted).toBe(true);

      const { data: gone } = await fixtures.service
        .from("retrieval_filters")
        .select("id")
        .eq("id", filter!.id)
        .maybeSingle();
      expect(gone).toBeNull();

      const { data: stillThere } = await fixtures.service
        .from("knowledge_documents")
        .select("id")
        .eq("id", document!.id)
        .maybeSingle();
      expect(stillThere?.id).toBe(document!.id);
    });

    it("404s for an id that never existed", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await remove("00000000-0000-4000-8000-00000000dead");

      expect(status).toBe(404);
    });
  });
});
