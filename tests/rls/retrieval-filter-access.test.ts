// @vitest-environment node
//
// Ward isolation on the two tables migration 034 adds, plus the write boundary on each.
//
// Every fixture is created with the SERVICE-ROLE client and asserted with an authenticated one
// (tests/helpers/asRole.ts). Asserting with the service client tests nothing — it bypasses RLS
// entirely, which is the single easiest way to write a suite that passes while the app leaks.
//
// Every negative assertion RE-READS with the service client rather than trusting an error. An
// RLS-denied UPDATE or DELETE is a ZERO-ROW SUCCESS, not a failure
// (plans/retros/foundation-c-services.md); only INSERT raises.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is
// deleted in afterAll and nothing assumes an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("retrieval filter access", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;
  let bishopB: SupabaseClient<Database>;
  let secretaryA: SupabaseClient<Database>;

  let wardAFilterId = "";
  let wardBFilterId = "";
  let wardADocumentId = "";

  const seedFilter = async (wardId: string, label: string, createdBy: string) => {
    const { data, error } = await fixtures.service
      .from("retrieval_filters")
      .insert({
        ward_id: wardId,
        label: `${label} ${fixtures.runId}`,
        source_phrase: "talks by prophets",
        speaker_roles: ["prophet"],
        created_by: createdBy,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed retrieval_filters: ${error.message}`);
    return data.id;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "wardSecretary", "wardBBishop"]);

    bishopA = await asRole(fixtures, "bishop");
    bishopB = await asRole(fixtures, "wardBBishop");
    secretaryA = await asRole(fixtures, "wardSecretary");

    wardAFilterId = await seedFilter(
      fixtures.wardAId,
      "Ward A prophets",
      fixtures.user("bishop").id,
    );
    wardBFilterId = await seedFilter(
      fixtures.wardBId,
      "Ward B prophets",
      fixtures.user("wardBBishop").id,
    );

    const { data, error } = await fixtures.service
      .from("knowledge_documents")
      .insert({
        ward_id: fixtures.wardAId,
        title: `Ward A talk ${fixtures.runId}`,
        type_tag: "general_conference",
        status: "active",
        speaker: "Russell M. Nelson",
        speaker_role: "prophet",
        conference_date: "2026-04-01",
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed knowledge_documents: ${error.message}`);
    wardADocumentId = data.id;

    const { error: suggestionError } = await fixtures.service
      .from("retrieval_suggestions")
      .insert({
        ward_id: fixtures.wardAId,
        run_id: crypto.randomUUID(),
        module: "topic_suggestions",
        document_id: wardADocumentId,
      });

    if (suggestionError) {
      throw new Error(`Could not seed retrieval_suggestions: ${suggestionError.message}`);
    }
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("retrieval_filters — cross-ward isolation", () => {
    it("lets ward A read its own filter", async () => {
      const { data, error } = await bishopA
        .from("retrieval_filters")
        .select("id, label")
        .eq("id", wardAFilterId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("NEVER lets ward A read ward B's filter", async () => {
      const { data, error } = await bishopA
        .from("retrieval_filters")
        .select("id")
        .eq("id", wardBFilterId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("lets ward B read its own, proving the empty result above is the policy working", async () => {
      const { data } = await bishopB
        .from("retrieval_filters")
        .select("id")
        .eq("id", wardBFilterId);

      expect(data).toHaveLength(1);
    });

    it("refuses ward A an insert into ward B", async () => {
      // INSERT is the one operation that raises rather than silently affecting zero rows.
      const { error } = await bishopA.from("retrieval_filters").insert({
        ward_id: fixtures.wardBId,
        label: `Leaked ${fixtures.runId}`,
        source_phrase: "leak",
        speaker_roles: ["prophet"],
      });

      expect(error).not.toBeNull();
    });

    it("refuses ward A a delete of ward B's filter, and the row is still there", async () => {
      await bishopA
        .from("retrieval_filters")
        .delete()
        .eq("id", wardBFilterId)
        .eq("ward_id", fixtures.wardBId);

      // RE-READ WITH THE SERVICE CLIENT. Asserting on `error` here would pass while the row was
      // gone, because an RLS-denied DELETE is a zero-row success.
      const { data } = await fixtures.service
        .from("retrieval_filters")
        .select("id")
        .eq("id", wardBFilterId)
        .maybeSingle();

      expect(data?.id).toBe(wardBFilterId);
    });
  });

  describe("retrieval_filters — the write boundary", () => {
    it("lets a non-bishopric role in the ward READ the filters", async () => {
      // SELECT is ward-scoped rather than bishopric-only, deliberately: lib/ai/retrieve.ts
      // resolves saved filters on every retrieval and runs as whoever is drafting. A scope that
      // silently stopped applying for a non-bishopric caller would be a filter that works in
      // testing and not in the app. Nothing here is private — a filter is a ward's own words
      // about its own corpus.
      const { data, error } = await secretaryA
        .from("retrieval_filters")
        .select("id")
        .eq("id", wardAFilterId);

      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("REFUSES a non-bishopric role an insert", async () => {
      const { error } = await secretaryA.from("retrieval_filters").insert({
        ward_id: fixtures.wardAId,
        label: `Secretary filter ${fixtures.runId}`,
        source_phrase: "should not save",
        speaker_roles: ["apostle"],
      });

      expect(error).not.toBeNull();
    });

    it("REFUSES a non-bishopric role a delete, and the row is still there", async () => {
      await secretaryA
        .from("retrieval_filters")
        .delete()
        .eq("id", wardAFilterId)
        .eq("ward_id", fixtures.wardAId);

      const { data } = await fixtures.service
        .from("retrieval_filters")
        .select("id")
        .eq("id", wardAFilterId)
        .maybeSingle();

      expect(data?.id).toBe(wardAFilterId);
    });

    it("has NO update policy — a filter is created and deleted, never edited", async () => {
      // Editing one silently changes what every past retrieval meant, and `source_phrase` would
      // then describe something the filter no longer does. There is no update function in
      // lib/knowledge/filterQueries.ts either; this proves the database agrees.
      await bishopA
        .from("retrieval_filters")
        .update({ label: `Renamed ${fixtures.runId}` })
        .eq("id", wardAFilterId)
        .eq("ward_id", fixtures.wardAId);

      const { data } = await fixtures.service
        .from("retrieval_filters")
        .select("label")
        .eq("id", wardAFilterId)
        .single();

      expect(data?.label).toContain("Ward A prophets");
    });
  });

  describe("retrieval_filters — the constraints", () => {
    it("refuses two filters with the same label in one ward", async () => {
      const { error } = await fixtures.service.from("retrieval_filters").insert({
        ward_id: fixtures.wardAId,
        label: `Ward A prophets ${fixtures.runId}`,
        source_phrase: "a duplicate",
        speaker_roles: ["prophet"],
      });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
    });

    it("ALLOWS the same label in a different ward", async () => {
      const { error } = await fixtures.service.from("retrieval_filters").insert({
        ward_id: fixtures.wardBId,
        label: `Ward A prophets ${fixtures.runId}`,
        source_phrase: "same words, different ward",
        speaker_roles: ["prophet"],
      });

      expect(error).toBeNull();
    });

    it("refuses a filter that narrows nothing", async () => {
      const { error } = await fixtures.service.from("retrieval_filters").insert({
        ward_id: fixtures.wardAId,
        label: `Narrows nothing ${fixtures.runId}`,
        source_phrase: "nothing at all",
      });

      expect(error).not.toBeNull();
    });

    it("refuses an EMPTY ARRAY on a filter axis", async () => {
      // `= any ('{}')` matches nothing, so a filter saved this way would silently return zero
      // documents while reading as "no restriction". The CHECK makes that unrepresentable.
      const { error } = await fixtures.service.from("retrieval_filters").insert({
        ward_id: fixtures.wardAId,
        label: `Empty array ${fixtures.runId}`,
        source_phrase: "empty",
        speaker_roles: [],
        since: "2020-01-01",
      });

      expect(error).not.toBeNull();
    });

    it("refuses a speaker_role the CHECK constraint does not permit", async () => {
      const { error } = await fixtures.service.from("knowledge_documents").insert({
        ward_id: fixtures.wardAId,
        title: `Bad role ${fixtures.runId}`,
        type_tag: "general_conference",
        speaker_role: "stake_president",
      });

      expect(error).not.toBeNull();
    });
  });

  describe("retrieval_suggestions", () => {
    it("lets ward A read its own suggestion rows", async () => {
      const { data, error } = await bishopA
        .from("retrieval_suggestions")
        .select("id")
        .eq("ward_id", fixtures.wardAId)
        .eq("document_id", wardADocumentId);

      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it("NEVER lets ward B read ward A's suggestion rows", async () => {
      const { data, error } = await bishopB
        .from("retrieval_suggestions")
        .select("id")
        .eq("document_id", wardADocumentId);

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("lets any ward member insert — retrieval runs as whoever is drafting", async () => {
      const { error } = await secretaryA.from("retrieval_suggestions").insert({
        ward_id: fixtures.wardAId,
        run_id: crypto.randomUUID(),
        module: "topic_suggestions",
        document_id: wardADocumentId,
      });

      expect(error).toBeNull();
    });

    it("refuses ward B an insert against ward A's document", async () => {
      const { error } = await bishopB.from("retrieval_suggestions").insert({
        ward_id: fixtures.wardAId,
        run_id: crypto.randomUUID(),
        module: "topic_suggestions",
        document_id: wardADocumentId,
      });

      expect(error).not.toBeNull();
    });

    it("is APPEND-ONLY — there is no update or delete policy", async () => {
      // A row that can be edited is not a log. ITER-012's percentages are only trustworthy if
      // the history behind them cannot be rewritten.
      const { data: before } = await fixtures.service
        .from("retrieval_suggestions")
        .select("id")
        .eq("ward_id", fixtures.wardAId)
        .eq("document_id", wardADocumentId);

      await bishopA
        .from("retrieval_suggestions")
        .delete()
        .eq("ward_id", fixtures.wardAId)
        .eq("document_id", wardADocumentId);

      const { data: after } = await fixtures.service
        .from("retrieval_suggestions")
        .select("id")
        .eq("ward_id", fixtures.wardAId)
        .eq("document_id", wardADocumentId);

      expect((after ?? []).length).toBe((before ?? []).length);
    });

    it("takes its document's suggestion history with it on delete", async () => {
      // The composite FK cascades. The alternative is a log referencing documents nobody can
      // look up.
      await fixtures.service
        .from("knowledge_documents")
        .delete()
        .eq("id", wardADocumentId)
        .eq("ward_id", fixtures.wardAId);

      const { data } = await fixtures.service
        .from("retrieval_suggestions")
        .select("id")
        .eq("document_id", wardADocumentId);

      expect(data).toEqual([]);
    });
  });
});
