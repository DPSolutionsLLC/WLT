import OpenAI from "openai";
import { AiRequestError } from "@/lib/ai/errors";

// SERVER-ONLY. The same guard lib/ai/client.ts and lib/supabase/service.ts use, for the same
// reason: an accidental import into a client component must fail loudly at the boundary rather
// than ship a key to a browser (CLAUDE.md rule 4).
if (typeof window !== "undefined") {
  throw new Error(
    "lib/ai/embed.ts was imported into browser code. OPENAI_API_KEY must never reach the client.",
  );
}

// DECLARED ONCE, HERE, AND IMPORTED BY BOTH PATHS. Query and documents must be embedded by the
// same model; mixing two returns confident nonsense with no error anywhere, and it is invisible
// until somebody notices retrieval has been subtly wrong for a month.
//
// There is deliberately NO model parameter on either function below. A parameter is how the two
// paths drift apart.
//
// CLAUDE.md §9: this is the second AI vendor and that is a settled decision. Changing the model
// means a migration on document_chunks.embedding and a full re-embed of the corpus.
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

// OpenAI accepts far more than this per request; 100 keeps a single failure cheap to retry and
// keeps progress reporting granular enough to watch during a 20-minute corpus load.
export const EMBEDDING_BATCH_SIZE = 100;

export type EmbeddingResult = {
  // Index-aligned with the input. A null entry is a chunk whose batch failed.
  embeddings: (number[] | null)[];
  failedIndexes: number[];
};

let cachedClient: OpenAI | null = null;

// Read explicitly rather than letting the SDK resolve it, so the failure is one a bishop can
// act on. THE MESSAGE NAMES OPENAI, NOT ANTHROPIC: the two keys fail independently, and a
// bishopric told to add the Anthropic key when the OpenAI one is missing will do the wrong
// thing and still be stuck. The key itself is never logged and never travels on a `cause`.
function getClient(): OpenAI {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new AiRequestError(
      "not_configured",
      "Document search is not set up yet. An administrator needs to add the OpenAI API key before uploads can be searched.",
    );
  }

  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

// The column is vector(1536). A wrong length is otherwise a Postgres error thousands of rows
// into a bulk insert, by which point the useful question — which model produced this — is no
// longer answerable from the failure.
function assertDimensions(embedding: readonly number[], index: number): number[] {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new AiRequestError(
      "invalid_request",
      `The embedding service returned a ${embedding.length}-dimension vector for passage ${index}, but this database stores ${EMBEDDING_DIMENSIONS}. This is a bug — nothing was saved.`,
    );
  }
  return [...embedding];
}

async function embedBatch(texts: readonly string[]): Promise<number[][]> {
  const response = await getClient().embeddings.create({
    model: EMBEDDING_MODEL,
    input: [...texts],
  });

  // The API documents that it returns data in input order, but it also returns an explicit
  // `index` on every entry. Sorting by it costs nothing and removes the assumption.
  const ordered = [...response.data].sort((left, right) => left.index - right.index);

  if (ordered.length !== texts.length) {
    throw new AiRequestError(
      "invalid_request",
      `The embedding service returned ${ordered.length} vectors for ${texts.length} passages. This is a bug — nothing was saved.`,
    );
  }

  return ordered.map((entry, index) => assertDimensions(entry.embedding, index));
}

// A FAILED BATCH MARKS ITS INDEXES AND THE RUN CONTINUES. One 429 partway through the Book of
// Mormon must not discard the 20,000 chunks that already embedded. The caller writes the failed
// chunks with a null embedding (lib/knowledge/ingest.ts), the search function excludes them, and
// the summary names them so a retry can target them — the failure is recorded, not swallowed
// (CLAUDE.md rule 7).
//
// A missing key is the one exception: it throws, because every batch would fail identically and
// grinding through 200 doomed requests to report "all of them failed" helps nobody.
export async function embedTexts(
  texts: readonly string[],
  onProgress?: (done: number, total: number) => void,
): Promise<EmbeddingResult> {
  const embeddings: (number[] | null)[] = new Array(texts.length).fill(null);
  const failedIndexes: number[] = [];

  if (texts.length === 0) return { embeddings, failedIndexes };

  // Fail fast on a missing key before spending a single request.
  getClient();

  for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);

    try {
      const vectors = await embedBatch(batch);
      for (const [offset, vector] of vectors.entries()) {
        embeddings[start + offset] = vector;
      }
    } catch (error) {
      for (let offset = 0; offset < batch.length; offset += 1) {
        failedIndexes.push(start + offset);
      }

      // Logged with the batch range and the reason. Never the text: a passage can be a member
      // note or a bishop's own writing.
      const description = error instanceof Error ? error.message : String(error);
      console.error(
        `Embedding failed for passages ${start}–${start + batch.length - 1} — ${description}`,
      );
    }

    onProgress?.(Math.min(start + batch.length, texts.length), texts.length);
  }

  return { embeddings, failedIndexes };
}

// Throws rather than returning null. A query with no vector cannot degrade gracefully into
// anything useful — there is no "search without a search term" — so the caller gets a written
// AiRequestError instead of an empty result set that looks like "nothing matched".
export async function embedQuery(text: string): Promise<number[]> {
  try {
    const [embedding] = await embedBatch([text]);
    return embedding;
  } catch (error) {
    if (error instanceof AiRequestError) throw error;

    const description = error instanceof Error ? error.message : String(error);
    console.error(`Could not embed a search query — ${description}`);

    throw new AiRequestError(
      "unavailable",
      "Could not reach the document search service. Check your connection and try again.",
    );
  }
}
