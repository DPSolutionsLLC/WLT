import type { SupabaseClient } from "@supabase/supabase-js";
import { EMBEDDING_BATCH_SIZE, embedTexts } from "@/lib/ai/embed";
import {
  insertChunks,
  withLabelPrefix,
  type IngestibleChunk,
} from "@/lib/knowledge/queries";
import type { Database } from "@/types/database";

// The one parse → chunk → embed → insert path. The upload route and the standard-works script
// both call this rather than each growing their own copy — which is also what guarantees the
// number the uploader is shown and the number actually written cannot disagree. The roster-c
// preview/result count mismatch was two code paths counting the same thing differently
// (plans/retros/roster-c-csv-import.md); one shape, one count, avoided by construction.
//
// SERVER-ONLY, transitively: it imports lib/ai/embed.ts, which carries the window guard.

export type IngestSummary = {
  documentId: string;
  chunkCount: number;
  embeddedCount: number;
  failedChunkIndexes: number[];
  characterCount: number;
};

export type IngestProgress = {
  phase: "embedding" | "writing";
  done: number;
  total: number;
};

export async function ingestChunks(
  wardId: string,
  documentId: string,
  chunks: readonly IngestibleChunk[],
  client: SupabaseClient<Database>,
  onProgress?: (progress: IngestProgress) => void,
): Promise<IngestSummary> {
  if (chunks.length === 0) {
    return {
      documentId,
      chunkCount: 0,
      embeddedCount: 0,
      failedChunkIndexes: [],
      characterCount: 0,
    };
  }

  // The label is embedded ALONG WITH the text, not stripped first. "Alma 32" in the vector is
  // signal — a query for "Alma's sermon on faith" should reach it — and it is the same string
  // retrieval reads back out as a citation.
  const texts = chunks.map(withLabelPrefix);
  const characterCount = texts.reduce((sum, text) => sum + text.length, 0);

  const { embeddings, failedIndexes } = await embedTexts(texts, (done, total) => {
    onProgress?.({ phase: "embedding", done, total });
  });

  // CHUNKS WHOSE EMBEDDING FAILED ARE STILL INSERTED, with embedding = null. The column is
  // nullable (migration 014), match_document_chunks already excludes them (migration 031), and
  // the alternative — dropping them — loses the text AND hides the failure. The summary names
  // the indexes so a retry can target them instead of re-ingesting the whole document.
  const rows = chunks.map((chunk, index) => ({
    ...chunk,
    embedding: embeddings[index],
  }));

  const written = await insertChunks(wardId, documentId, rows, client);
  onProgress?.({ phase: "writing", done: written, total: rows.length });

  const embeddedCount = rows.filter((row) => row.embedding !== null).length;

  if (failedIndexes.length > 0) {
    console.warn(
      `Ingested document ${documentId} with ${failedIndexes.length} of ${rows.length} passages unembedded. ` +
        `They were saved and are excluded from search until re-embedded. ` +
        `Embedding runs in batches of ${EMBEDDING_BATCH_SIZE}, so failures come in runs.`,
    );
  }

  return {
    documentId,
    chunkCount: written,
    embeddedCount,
    failedChunkIndexes: failedIndexes,
    characterCount,
  };
}
