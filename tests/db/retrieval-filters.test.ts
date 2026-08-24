// @vitest-environment node
//
// THE HIGHEST-VALUE TEST IN THIS PLAN.
//
// It proves the one failure `ai-d` is most likely to ship, and that failure is SILENT: a ward
// sets "last two years" to narrow its conference talks and quietly loses the Book of Mormon from
// every suggestion it ever makes again. Nothing errors. No other test fails. The drafts just get
// worse, slowly, and nobody connects it to a checkbox somebody ticked months earlier.
//
// It goes through the REAL match_document_chunks as a REAL authenticated user, because the claim
// is about the SQL predicate in migration 033, not about a TypeScript function that mirrors it.
// tests/lib/filterResolution.test.ts covers the mirror; this covers the thing itself, and the two
// existing side by side is what makes the scope panel's count sentence trustworthy.
//
// NO OPENAI CALL. The embeddings are hand-written unit vectors inserted with the service client,
// exactly as tests/rls/retrieval-scoping.test.ts does: a chunk embedded as [1,0,0,…] and a query
// of [1,0,0,…] give a cosine similarity of exactly 1, with no network, no spend and no flakiness.
// What is under test is the filter, not the model.
//
// Runs over the network against the shared hosted project (CLAUDE.md §9): every fixture is
// deleted in afterAll and nothing assumes an empty table.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";
import type { SpeakerRole } from "@/types/domain";

const DIMENSIONS = 1536;

// EVERY CHUNK SITS ON THE SAME AXIS, which is the opposite of what the scoping suite does and is
// deliberate. There, orthogonal vectors proved documents could be told apart; here, every
// document is a PERFECT match for the query, so the ONLY thing that can remove one from the
// results is the filter under test. A talk that disappears did so because of the predicate, not
// because it ranked poorly.
const SHARED_AXIS = 0;

function unitVector(axis: number): number[] {
  return Array.from({ length: DIMENSIONS }, (_, index) => (index === axis ? 1 : 0));
}

// pgvector's text input format is `[1,2,3]`, byte-identical to a JSON array.
function asVectorLiteral(vector: readonly number[]): string {
  return JSON.stringify(vector);
}

type FilterArguments = {
  filter_since?: string;
  filter_speaker_roles?: string[];
  filter_speakers?: string[];
};

describe("retrieval filters", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;

  // Marks every seeded passage so a shared hosted database's other rows cannot be mistaken for
  // these. Assertions match on the marker, never on a bare count of everything returned.
  let marker = "";

  const seedDocument = async (options: {
    title: string;
    typeTag: "standard_works" | "general_conference" | "other";
    speaker?: string | null;
    speakerRole?: SpeakerRole | null;
    conferenceDate?: string | null;
  }) => {
    const { data, error } = await fixtures.service
      .from("knowledge_documents")
      .insert({
        ward_id: fixtures.wardAId,
        title: `${options.title} ${fixtures.runId}`,
        type_tag: options.typeTag,
        status: "active",
        speaker: options.speaker ?? null,
        speaker_role: options.speakerRole ?? null,
        conference_date: options.conferenceDate ?? null,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed knowledge_documents: ${error.message}`);

    const { error: chunkError } = await fixtures.service.from("document_chunks").insert({
      ward_id: fixtures.wardAId,
      document_id: data.id,
      content: `${marker}-${options.title.replace(/\s+/g, "-").toUpperCase()}`,
      embedding: asVectorLiteral(unitVector(SHARED_AXIS)),
      chunk_index: 0,
    });

    if (chunkError) throw new Error(`Could not seed document_chunks: ${chunkError.message}`);

    return data.id;
  };

  // Returns the seeded passages this query surfaced, by their marker suffix.
  //
  // An unfiltered axis is OMITTED rather than sent as null, matching lib/ai/retrieve.ts. Migration
  // 033 declares all three parameters `default null`, so a key PostgREST never sends arrives as
  // null anyway — and the generated types describe a defaulted parameter as optional rather than
  // nullable, so this is the shape that typechecks without a cast.
  const search = async (filters: FilterArguments = {}) => {
    const { data, error } = await bishop.rpc("match_document_chunks", {
      query_embedding: asVectorLiteral(unitVector(SHARED_AXIS)),
      match_ward_id: fixtures.wardAId,
      match_count: 50,
      ...filters,
    });

    if (error) throw new Error(`match_document_chunks failed: ${error.message}`);

    return (data ?? [])
      .filter((row) => row.content.startsWith(marker))
      .map((row) => row.content.slice(marker.length + 1))
      .sort();
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop"]);
    bishop = await asRole(fixtures, "bishop");
    marker = `AID-${fixtures.runId}`;

    // The standard works: NULL metadata, and the whole point of the exemption.
    await seedDocument({ title: "Book of Mormon", typeTag: "standard_works" });

    // A stake letter: also null metadata, also exempt. Proves the exemption is about the TAG,
    // not about "documents that happen to have no speaker".
    await seedDocument({ title: "Stake letter", typeTag: "other" });

    // Four conference talks across two years and two roles.
    await seedDocument({
      title: "Recent prophet",
      typeTag: "general_conference",
      speaker: "Russell M. Nelson",
      speakerRole: "prophet",
      conferenceDate: "2026-04-01",
    });
    await seedDocument({
      title: "Recent apostle",
      typeTag: "general_conference",
      speaker: "Dallin H. Oaks",
      speakerRole: "apostle",
      conferenceDate: "2026-04-01",
    });
    await seedDocument({
      title: "Old prophet",
      typeTag: "general_conference",
      speaker: "Russell M. Nelson",
      speakerRole: "prophet",
      conferenceDate: "2019-10-01",
    });
    await seedDocument({
      title: "Old apostle",
      typeTag: "general_conference",
      speaker: "Dallin H. Oaks",
      speakerRole: "apostle",
      conferenceDate: "2019-10-01",
    });

    // A conference talk somebody uploaded without metadata. Per migration 033 it is unreachable
    // by any filter, which means it is silently ALWAYS INCLUDED when nothing is filtered and
    // always excluded once anything is. Both directions are asserted below.
    await seedDocument({ title: "Unlabelled talk", typeTag: "general_conference" });
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  // ---------------------------------------------------------------------------------------------
  // THE REGRESSION GATE
  // ---------------------------------------------------------------------------------------------
  describe("with no filters at all", () => {
    it("returns exactly what migration 031's three-argument version returned", () => {
      // IF THIS FAILS, THE REWRITE IN MIGRATION 033 CHANGED UNFILTERED BEHAVIOUR — and every
      // existing retrieval test in this repo is now testing something different from what the
      // app does. Read the predicate before touching anything else.
      return expect(search()).resolves.toEqual([
        "BOOK-OF-MORMON",
        "OLD-APOSTLE",
        "OLD-PROPHET",
        "RECENT-APOSTLE",
        "RECENT-PROPHET",
        "STAKE-LETTER",
        "UNLABELLED-TALK",
      ]);
    });

    it("is callable with the three new arguments omitted entirely", async () => {
      // They default to null. A caller written before ai-d — or a psql session — must keep
      // working, which is what the defaults are for.
      const { error } = await bishop.rpc("match_document_chunks", {
        query_embedding: asVectorLiteral(unitVector(SHARED_AXIS)),
        match_ward_id: fixtures.wardAId,
        match_count: 5,
      });

      expect(error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------
  // THE SCRIPTURE-SURVIVAL CASE — the reason this file exists
  // ---------------------------------------------------------------------------------------------
  describe("the standard-works exemption", () => {
    it("a recency filter STILL RETURNS the standard-works chunk", async () => {
      const results = await search({ filter_since: "2025-01-01" });

      expect(results).toContain("BOOK-OF-MORMON");
      // And it genuinely narrowed the conference talks, so the assertion above is not passing
      // because the filter did nothing at all.
      expect(results).not.toContain("OLD-PROPHET");
    });

    it("a speaker-role filter STILL RETURNS the standard-works chunk", async () => {
      const results = await search({ filter_speaker_roles: ["apostle"] });

      expect(results).toContain("BOOK-OF-MORMON");
      expect(results).not.toContain("RECENT-PROPHET");
    });

    it("a speaker filter STILL RETURNS the standard-works chunk", async () => {
      const results = await search({ filter_speakers: ["Dallin H. Oaks"] });

      expect(results).toContain("BOOK-OF-MORMON");
      expect(results).not.toContain("RECENT-PROPHET");
    });

    it("all three filters at once STILL RETURN the standard-works chunk", async () => {
      const results = await search({
        filter_since: "2026-01-01",
        filter_speaker_roles: ["apostle"],
        filter_speakers: ["Dallin H. Oaks"],
      });

      expect(results).toContain("BOOK-OF-MORMON");
      expect(results).toEqual(["BOOK-OF-MORMON", "RECENT-APOSTLE", "STAKE-LETTER"]);
    });

    it("exempts an 'other' document as well — the exemption is about the TAG", async () => {
      const results = await search({ filter_since: "2026-01-01" });

      expect(results).toContain("STAKE-LETTER");
    });

    it("exempts a NULL type_tag, which `is distinct from` is there for", async () => {
      // `null <> 'general_conference'` evaluates to NULL, not true. With a plain `<>` this
      // document would vanish the moment any filter was set — the same class of bug as the null
      // conference_date, one column over.
      const { data, error } = await fixtures.service
        .from("knowledge_documents")
        .insert({
          ward_id: fixtures.wardAId,
          title: `Untagged ${fixtures.runId}`,
          type_tag: null,
          status: "active",
        })
        .select("id")
        .single();
      expect(error).toBeNull();

      await fixtures.service.from("document_chunks").insert({
        ward_id: fixtures.wardAId,
        document_id: data!.id,
        content: `${marker}-UNTAGGED`,
        embedding: asVectorLiteral(unitVector(SHARED_AXIS)),
        chunk_index: 0,
      });

      const results = await search({
        filter_since: "2026-01-01",
        filter_speaker_roles: ["apostle"],
      });

      expect(results).toContain("UNTAGGED");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The filters doing what they say
  // ---------------------------------------------------------------------------------------------
  describe("recency", () => {
    it("drops a conference talk outside the window", async () => {
      const results = await search({ filter_since: "2025-01-01" });

      expect(results).toContain("RECENT-PROPHET");
      expect(results).toContain("RECENT-APOSTLE");
      expect(results).not.toContain("OLD-PROPHET");
      expect(results).not.toContain("OLD-APOSTLE");
    });

    it("includes a talk exactly on the boundary", async () => {
      // `>=`, not `>`. A boundary that excludes its own named value is the kind of thing nobody
      // notices until a conference is mysteriously missing.
      const results = await search({ filter_since: "2026-04-01" });

      expect(results).toContain("RECENT-PROPHET");
    });
  });

  describe("speaker roles", () => {
    it("keeps only the roles named", async () => {
      const results = await search({ filter_speaker_roles: ["apostle"] });

      expect(results).toContain("RECENT-APOSTLE");
      expect(results).toContain("OLD-APOSTLE");
      expect(results).not.toContain("RECENT-PROPHET");
    });

    it("UNIONS within the array — two roles mean either", async () => {
      const results = await search({ filter_speaker_roles: ["apostle", "prophet"] });

      expect(results).toContain("RECENT-APOSTLE");
      expect(results).toContain("RECENT-PROPHET");
    });
  });

  describe("speakers", () => {
    it("keeps only the speakers named", async () => {
      const results = await search({ filter_speakers: ["Russell M. Nelson"] });

      expect(results).toContain("RECENT-PROPHET");
      expect(results).toContain("OLD-PROPHET");
      expect(results).not.toContain("RECENT-APOSTLE");
    });
  });

  describe("axes combine with AND", () => {
    it("narrows on role and period together", async () => {
      const results = await search({
        filter_since: "2025-01-01",
        filter_speaker_roles: ["apostle"],
      });

      expect(results).toContain("RECENT-APOSTLE");
      expect(results).not.toContain("OLD-APOSTLE");
      expect(results).not.toContain("RECENT-PROPHET");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The "not filterable" document, in both directions
  // ---------------------------------------------------------------------------------------------
  describe("a conference talk with null metadata", () => {
    it("is INCLUDED when there is no filter", async () => {
      expect(await search()).toContain("UNLABELLED-TALK");
    });

    it("is EXCLUDED by a role filter, because null satisfies no `= any`", async () => {
      expect(await search({ filter_speaker_roles: ["apostle"] })).not.toContain(
        "UNLABELLED-TALK",
      );
    });

    it("is EXCLUDED by a recency filter, because null satisfies no `>=`", async () => {
      // The asymmetry with the test above is exactly why DocumentList badges this document
      // "Not filterable": always in for an unscoped ward, always out for a scoped one, and
      // neither behaviour is guessable from the screen without the badge.
      expect(await search({ filter_since: "2000-01-01" })).not.toContain("UNLABELLED-TALK");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The empty-array trap
  // ---------------------------------------------------------------------------------------------
  describe("an empty array is not the same as null", () => {
    it("matches NO conference talk, which is why nothing may ever send one", async () => {
      // `= any ('{}')` is false for every row. This is the shape mergeConferenceScope,
      // filterSaveSchema and migration 034's CHECK constraints all exist to make unrepresentable
      // — a filter saved this way would silently return zero talks while reading, in every UI
      // that showed it, as "no restriction on this axis".
      const results = await search({ filter_speaker_roles: [] });

      expect(results).not.toContain("RECENT-PROPHET");
      expect(results).not.toContain("RECENT-APOSTLE");
      // The exemption still holds, which is the one mercy in this state.
      expect(results).toContain("BOOK-OF-MORMON");
    });
  });

  // ---------------------------------------------------------------------------------------------
  // Migration 031's guarantees, unchanged
  // ---------------------------------------------------------------------------------------------
  describe("what the rewrite must not have changed", () => {
    it("still excludes an inactive document", async () => {
      const { data } = await fixtures.service
        .from("knowledge_documents")
        .select("id")
        .eq("ward_id", fixtures.wardAId)
        .eq("title", `Old prophet ${fixtures.runId}`)
        .single();

      await fixtures.service
        .from("knowledge_documents")
        .update({ status: "inactive" })
        .eq("id", data!.id);

      expect(await search()).not.toContain("OLD-PROPHET");

      await fixtures.service
        .from("knowledge_documents")
        .update({ status: "active" })
        .eq("id", data!.id);

      expect(await search()).toContain("OLD-PROPHET");
    });

    it("still returns NOTHING for another ward's ward id", async () => {
      // THE ASSERTION THE `SECURITY INVOKER` DEFAULT EXISTS FOR, restated here because
      // migration 033 dropped and recreated the function. RLS inside the function is the real
      // boundary; the three new parameters are three more things a caller could lie about,
      // which makes this matter more rather than less.
      const { data, error } = await bishop.rpc("match_document_chunks", {
        query_embedding: asVectorLiteral(unitVector(SHARED_AXIS)),
        match_ward_id: fixtures.wardBId,
        match_count: 50,
      });

      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  });
});
