import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "@/lib/ai/embed";
import type { RetrievedChunk } from "@/lib/ai/systemPrompt";
import { splitLabelPrefix } from "@/lib/knowledge/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MAX_SEARCH_RESULTS, SIMILARITY_FLOOR } from "@/lib/validation/knowledge";
import type { Database } from "@/types/database";

// What buildSystemPrompt's layer 3 consumes. `ai-a` shipped that parameter and its branch
// against an empty list; this is the first caller to pass a non-empty one.
//
// RetrievedChunk is imported FROM lib/ai/systemPrompt.ts, not redefined here and not moved.
// systemPrompt.ts is pure, so a client component can reach the type without pulling in this
// module, which is server-only through embedQuery.

export const DEFAULT_MATCH_COUNT = 6;

// Both defined in lib/validation/knowledge.ts for the same reason MAX_SEARCH_RESULTS is: the
// Retrieval Tester renders the band in the browser, and importing this module there would drag
// next/headers into the client bundle. Re-exported here because this is where a reader looks for
// anything about how retrieval scores.
export { SIMILARITY_FLOOR, describeSimilarity } from "@/lib/validation/knowledge";

// Defined in lib/validation/knowledge.ts and re-exported under the name retrieval code reads it
// by. The dependency points this way because that module is client-safe and this one is not —
// UploadForm and RetrievalTester import the schemas, and importing this file into a browser
// bundle would drag next/headers in with it.
export const MAX_MATCH_COUNT = MAX_SEARCH_RESULTS;

export type ScoredChunk = RetrievedChunk & { similarity: number };

type MatchRow = {
  chunk_id: string;
  content: string;
  document_id: string;
  title: string;
  type_tag: string | null;
  chunk_index: number | null;
  similarity: number;
};

// PURE, and exported so tests/lib/similarityFloor.test.ts needs no database.
//
// FILTER BEFORE CLAMPING, NEVER AFTER. Clamping first would take the top 6 and then drop the
// weak ones among them, so a query with 3 weak results in its top 6 returns 3 — silently
// starving the prompt of context that was available at rank 7. Filtering first returns the best
// 6 that clear the floor.
//
// An all-weak result set returns [] rather than the best of a bad lot. 05-ai-platform.md is
// explicit that weak chunks are worse than none: they read as authoritative to the model, which
// then cites them.
export function applySimilarityFloor(
  chunks: readonly ScoredChunk[],
  limit: number,
  floor: number = SIMILARITY_FLOOR,
): ScoredChunk[] {
  return chunks.filter((chunk) => chunk.similarity >= floor).slice(0, limit);
}

export function clampMatchCount(limit?: number): number {
  if (limit === undefined) return DEFAULT_MATCH_COUNT;
  return Math.max(1, Math.min(MAX_MATCH_COUNT, Math.trunc(limit)));
}

// The label is what rule 4's citations are built from. A chunk carrying one gets
// "Book of Mormon — Alma 32:21–31"; one without falls back to the document title alone, which
// is still something a reader can go and open. A chunk with no usable label at all would be a
// citation nobody can check, which is why the title is never allowed to be empty upstream.
function toSourceLabel(row: MatchRow, label: string | null): string {
  if (label === null) return row.title;
  if (label === row.title) return row.title;
  return `${row.title} — ${label}`;
}

export async function retrieveChunks(
  query: string,
  wardId: string,
  options?: { limit?: number; client?: SupabaseClient<Database> },
): Promise<ScoredChunk[]> {
  const limit = clampMatchCount(options?.limit);
  const supabase = options?.client ?? (await createServerSupabaseClient());

  const embedding = await embedQuery(query);

  // Over-fetch so the floor has something to discard. Asking for exactly `limit` and then
  // filtering is the bug applySimilarityFloor's comment describes, moved one layer down.
  const { data, error } = await supabase.rpc("match_document_chunks", {
    // pgvector's text input format is `[1,2,3]`, byte-identical to a JSON array. Sending the
    // string removes any ambiguity about how PostgREST serialises a JS number array into a
    // `vector` parameter.
    query_embedding: JSON.stringify(embedding),
    match_ward_id: wardId,
    match_count: MAX_MATCH_COUNT * 2,
  });

  if (error) {
    console.error(`Knowledge retrieval failed — ${error.message}`, { wardId });
    throw new Error(`Could not search the knowledge base: ${error.message}`);
  }

  const scored: ScoredChunk[] = ((data ?? []) as MatchRow[]).map((row) => {
    const { label, text } = splitLabelPrefix(row.content);
    return {
      content: text,
      sourceLabel: toSourceLabel(row, label),
      similarity: row.similarity,
    };
  });

  const kept = applySimilarityFloor(scored, limit);

  // The match count and top similarity, NEVER THE QUERY TEXT. A bishop's search terms can name
  // a specific member or describe a situation that member would not want written down.
  console.info(
    `Knowledge retrieval: ${kept.length} of ${scored.length} passages cleared the floor` +
      `${scored.length > 0 ? `, top similarity ${scored[0].similarity.toFixed(3)}` : ""}`,
  );

  // RETURNING NOTHING IS A LEGITIMATE RESULT AND MUST NOT THROW. A ward with no documents, or a
  // query nothing matches, gets []; buildSystemPrompt omits layer 3 and the model answers from
  // the ward's settings alone. That is the designed behaviour, not a degraded one.
  return kept;
}
