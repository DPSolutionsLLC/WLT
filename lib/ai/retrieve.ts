import type { SupabaseClient } from "@supabase/supabase-js";
import { embedQuery } from "@/lib/ai/embed";
import { getActiveAiSettings } from "@/lib/ai/queries";
import type { RetrievedChunk } from "@/lib/ai/systemPrompt";
import { todayDateOnly } from "@/lib/knowledge/conferenceMetadata";
import { listSavedFilters } from "@/lib/knowledge/filterQueries";
import { isUnfilteredScope, mergeConferenceScope } from "@/lib/knowledge/filterResolution";
import { splitLabelPrefix } from "@/lib/knowledge/queries";
import { newRunId, recordSuggestions } from "@/lib/knowledge/suggestionLog";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MAX_SEARCH_RESULTS, SIMILARITY_FLOOR } from "@/lib/validation/knowledge";
import type { Database } from "@/types/database";
import type { AiSettings, ConferenceScope } from "@/types/domain";

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

// `documentId` rides along for the suggestion log (ITER-012's telemetry) and is not part of what
// buildSystemPrompt reads. It is on the chunk rather than tracked separately because the set of
// documents that got SUGGESTED is exactly the set that survived the floor, and deriving it from
// anything else would eventually disagree.
export type ScoredChunk = RetrievedChunk & { similarity: number; documentId: string };

// The empty scope. Every axis null means every axis unfiltered, which is exactly what retrieval
// did before `ai-d` — the state a ward that has never opened the scope panel must stay in, and
// what the Retrieval Tester passes when somebody unticks "search using the ward's scope".
export const UNFILTERED_SCOPE: ConferenceScope = {
  since: null,
  speakerRoles: null,
  speakers: null,
};

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
//
// A NARROW SCOPE DOES NOT LOWER THIS FLOOR, and that is deliberate. If a ward scopes to one
// speaker in one year, most queries will correctly return [] and the prompt will omit layer 3.
// That is the floor working, not the scope failing — the alternative is quoting the least-bad
// passage in a corpus that had nothing relevant, which reads as authoritative to the model.
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

export type RetrieveOptions = {
  limit?: number;
  client?: SupabaseClient<Database>;
  // Settings the caller ALREADY LOADED, so it does not pay for a second read of a row in memory.
  settings?: AiSettings | null;
  // A per-request override of the ward's saved scope. Pass UNFILTERED_SCOPE to search everything.
  filters?: ConferenceScope;
  // A label for the suggestion log. Not the query and not the prompt — only which feature asked.
  module?: string;
};

// WHERE THE WARD'S SCOPE COMES FROM, in order of precedence:
//
//   1. options.filters   — a per-request override. Today only the Retrieval Tester's
//                          "search everything" toggle uses it.
//   2. options.settings  — settings the caller already loaded. `ai-c`'s topic route fetches
//                          getActiveAiSettings in parallel with three other queries; passing it
//                          here avoids a second round trip for a row that is already in memory.
//   3. a fresh load      — correct, just one query slower. This is what makes the whole change
//                          non-breaking: a caller that passes nothing still gets ward scoping.
//   4. the empty scope   — no settings row at all, or a settings row with no scope.
//
// THE SCOPE ARRIVES ON ITS OWN, WHICH IS WHY `ai-c` NEEDED NO EDIT. If you find yourself adding a
// filters argument to a feature route to make scoping work, stop — it is supposed to arrive here.
//
// A caller who cannot READ the settings (a non-bishopric role, since `ai_settings` is
// bishopric-only under RLS) falls back to the empty scope and retrieves the full corpus. That is
// the safe direction to be wrong in: the scope is a preference, not a security boundary, and
// widening shows the ward more of its own material — never less, and never another ward's.
async function resolveScope(
  wardId: string,
  supabase: SupabaseClient<Database>,
  options: RetrieveOptions | undefined,
): Promise<ConferenceScope> {
  if (options?.filters) return options.filters;

  const settings =
    options?.settings !== undefined
      ? options.settings
      : await getActiveAiSettings(wardId, supabase);

  const scopeSettings = settings?.conferencePreferences?.scope ?? null;
  if (!scopeSettings) return UNFILTERED_SCOPE;

  // Only read the saved filters when the scope actually names some. A ward using the recency
  // select and the role checkboxes alone should not pay for a query it cannot use.
  const savedFilters =
    scopeSettings.savedFilterIds.length > 0 ? await listSavedFilters(wardId, supabase) : [];

  return mergeConferenceScope(scopeSettings, savedFilters, todayDateOnly());
}

// AN UNFILTERED AXIS IS OMITTED, NOT SENT AS NULL, and the two are identical here: migration 033
// declares all three parameters `default null`, so a key PostgREST never sends arrives as null
// anyway. Omitting is what the generated types describe — they render a defaulted parameter as
// optional rather than nullable — so this keeps the call honest instead of casting past it.
//
// An empty array is never produced by mergeConferenceScope, and must not be: `= any ('{}')`
// matches NOTHING, which would narrow the corpus to zero while reading as "no restriction".
function scopeArguments(scope: ConferenceScope): {
  filter_since?: string;
  filter_speaker_roles?: string[];
  filter_speakers?: string[];
} {
  return {
    ...(scope.since === null ? {} : { filter_since: scope.since }),
    ...(scope.speakerRoles === null
      ? {}
      : { filter_speaker_roles: [...scope.speakerRoles] }),
    ...(scope.speakers === null ? {} : { filter_speakers: [...scope.speakers] }),
  };
}

export async function retrieveChunks(
  query: string,
  wardId: string,
  options?: RetrieveOptions,
): Promise<ScoredChunk[]> {
  const limit = clampMatchCount(options?.limit);
  const supabase = options?.client ?? (await createServerSupabaseClient());

  const scope = await resolveScope(wardId, supabase, options);

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
    // THE FILTER APPLIES TO CONFERENCE TALKS AND TO NOTHING ELSE. Migration 033's predicate, not
    // this call, is what guarantees the standard works survive a recency filter — read it before
    // changing anything here.
    ...scopeArguments(scope),
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
      documentId: row.document_id,
    };
  });

  const kept = applySimilarityFloor(scored, limit);

  // RECORDED AFTER THE FLOOR, so the log holds what was actually USED rather than what was
  // fetched. Over-fetching is an implementation detail of applySimilarityFloor; a document that
  // ranked in the top 16 and then failed the floor was never suggested to anybody, and counting
  // it would inflate every ITER-012 percentage.
  //
  // recordSuggestions CANNOT THROW — it catches and logs its own failures, and the comment there
  // explains why swallowing is correct in that one place. It is still awaited, so the write
  // completes before a serverless function can be frozen mid-flight.
  await recordSuggestions(
    wardId,
    {
      runId: newRunId(),
      module: options?.module ?? "unknown",
      documentIds: [...new Set(kept.map((chunk) => chunk.documentId))],
    },
    supabase,
  );

  // The match count and top similarity, NEVER THE QUERY TEXT. A bishop's search terms can name
  // a specific member or describe a situation that member would not want written down.
  //
  // WHETHER a scope was applied, never WHAT it was. A speaker's name in a log line is a small
  // thing on its own; the habit of putting retrieval parameters into logs is not.
  console.info(
    `Knowledge retrieval: ${kept.length} of ${scored.length} passages cleared the floor` +
      `${scored.length > 0 ? `, top similarity ${scored[0].similarity.toFixed(3)}` : ""}` +
      `${isUnfilteredScope(scope) ? "" : ", conference scope applied"}`,
  );

  // RETURNING NOTHING IS A LEGITIMATE RESULT AND MUST NOT THROW. A ward with no documents, or a
  // query nothing matches, gets []; buildSystemPrompt omits layer 3 and the model answers from
  // the ward's settings alone. That is the designed behaviour, not a degraded one — and it is
  // also what a deliberately narrow scope will produce on most queries.
  return kept;
}
