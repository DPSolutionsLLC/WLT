# Plan: AI B — Knowledge Base and pgvector Retrieval

**Created:** 2026-08-23
**Type:** feature
**Structure:** Sequential — plan 2 of 3 for Phase 5 ([05-ai-platform.md](05-ai-platform.md))
**Depends on:** [ai-a-client-and-settings.md](ai-a-client-and-settings.md) — must be executed and merged first
**Next:** [ai-c-feature-routes.md](ai-c-feature-routes.md)

---

## Overview

The corpus and the search over it. `ai-a` shipped `buildSystemPrompt` with a layer-3 branch tested
against an empty list; this plan fills it with real excerpts.

Four pieces: **chunking and parsing** (a document becomes ~500-token passages on sensible
boundaries), **embedding** (OpenAI `text-embedding-3-small`, 1536 dims, in batches, with partial
failure recorded rather than swallowed), **retrieval** (a Postgres function so the vector comparison
stays in the database, plus a similarity floor), and the **document management UI** the bishopric
uses to upload, tag, deactivate, and delete.

Plus the one-off **ingestion script** for the standard works, which cannot be an HTTP route — it is
tens of thousands of chunks and would blow a serverless timeout an order of magnitude over.

**Success criteria**

- A bishopric member uploads a conference talk as `.txt`, `.md`, or `.pdf`, sees it appear with a
  chunk count, and can deactivate it — after which retrieval stops returning it, immediately.
- `retrieveChunks("faith")` against a ward with the Book of Mormon loaded returns 5–8 passages with
  real source labels ("Alma 32:21–31"), none of them below the similarity floor.
- A user in ward A can never retrieve a chunk belonging to ward B, and a test proves it through RLS
  rather than through a WHERE clause.
- Ingesting the standard works completes from the command line and reports chunk count and embedding
  coverage.
- No whole document is ever sent to Claude.

---

## Relevant Files

### Create

| File | What it does |
|---|---|
| `supabase/migrations/031_knowledge_search.sql` | `match_document_chunks()` + the vector index |
| `supabase/migrations/032_knowledge_storage.sql` | Storage bucket + its policies |
| `lib/knowledge/chunk.ts` | **Pure.** Text → chunks with overlap on paragraph boundaries |
| `lib/knowledge/parseDocument.ts` | `.txt` / `.md` / `.pdf` → plain text |
| `lib/knowledge/queries.ts` | `knowledge_documents` and `document_chunks` reads and writes |
| `lib/knowledge/ingest.ts` | parse → chunk → embed → insert, shared by the route and the script |
| `lib/ai/embed.ts` | OpenAI client, batched embedding, partial-failure reporting |
| `lib/ai/retrieve.ts` | `retrieveChunks()` — the function `buildSystemPrompt` consumes |
| `lib/validation/knowledge.ts` | Zod schemas for upload, list, patch, search |
| `app/api/knowledge/upload/route.ts` | POST — multipart upload and ingest |
| `app/api/knowledge/documents/route.ts` | GET — list with status, tag, chunk count |
| `app/api/knowledge/documents/[id]/route.ts` | PATCH activate/deactivate, DELETE |
| `app/api/knowledge/search/route.ts` | POST — a bishopric-facing retrieval test |
| `app/(app)/knowledge/page.tsx` | Server page, `knowledge.view` guard |
| `app/(app)/knowledge/DocumentList.tsx` | Client — list, activate/deactivate, delete |
| `app/(app)/knowledge/UploadForm.tsx` | Client — file picker, title, tag |
| `app/(app)/knowledge/RetrievalTester.tsx` | Client — type a query, see what comes back |
| `supabase/scripts/ingestStandardWorks.ts` | The one-off bulk load |

### Modify

| File | What changes |
|---|---|
| `types/domain.ts` | `KNOWLEDGE_TYPE_TAGS`, `DOCUMENT_STATUSES`, labels, `MAX_UPLOAD_BYTES` |
| `types/database.ts` | **Regenerate** — `npm run db:types` after pushing 031 and 032 |
| `package.json` | `unpdf` dependency + a `knowledge:ingest` script |
| `.gitignore` | Ignore the local corpus directory |

---

## Dependencies

### One new dependency — approved 2026-08-23

**`unpdf@1.8.1`** — "PDF extraction and rendering across all JavaScript runtimes". **Zero runtime
dependencies**, built for serverless, bundles its own PDF.js build so there is no worker to
configure on Vercel. `npm install unpdf`.

Chosen over `pdf-parse` (unmaintained, and its module body reads a test fixture from disk at import
time, which breaks in a bundled serverless function) and over raw `pdfjs-dist` (needs worker
plumbing that differs between dev and the Vercel runtime).

> **Flag when you get here:** PDF text extraction is lossy on multi-column and heavily formatted
> layouts. A conference talk PDF usually extracts cleanly; a formatted newsletter may not. The
> upload response reports the extracted character count so the uploader can tell immediately that a
> file came back nearly empty, rather than discovering it weeks later through bad retrieval.

### Already installed

`openai@7.4.0` — present since Phase 0 and unused until now. `@supabase/supabase-js` for Storage.

### One new directory

`supabase/scripts/` — for `ingestStandardWorks.ts`. CLAUDE.md §7 says not to change the folder
structure without asking, so this is the ask: the script is a one-off database load, it belongs
beside the migrations and seeds rather than in `lib/` (nothing imports it) or in `testing/` (it is
not test infrastructure). If you would rather it live somewhere else, move it — nothing else in this
plan depends on the path except the `package.json` script line.

---

## Known Pitfalls (from retro context)

- **[talks-c-prayers-topics]** — *check the manifest before numbering.* Both the migration number
  and the scenario numbers in this plan were correct on 2026-08-23; verify `supabase/migrations/` and
  `testing/scenarios/manifest.json` before creating files. Two migrations sharing a number is a
  conflict the CLI resolves by filename order, **silently**.
- **[talks-c-prayers-topics]** — grep `018_indexes.sql` for any table this slice writes to, not just
  its `create table`. `document_chunks_ward_id_idx` and `knowledge_documents_ward_id_idx` already
  exist there; do not recreate them.
- **[foundation-b-schema]** — *Supabase no longer auto-exposes new objects to the Data API roles.*
  Migration 019 set default privileges, but **a new FUNCTION is not covered by table defaults.**
  `match_document_chunks` needs an explicit `grant execute … to authenticated`, or every RPC call
  fails with a permission error that looks like an RLS problem and is not.
- **[foundation-b-schema]** — `SET LOCAL` is a no-op outside an explicit transaction. Migration 014
  used a plain `SET search_path` to resolve the `vector` type; migrations 031 must do the same, for
  the same reason.
- **[foundation-c-services]** — an RLS-denied UPDATE or DELETE is a **zero-row success**, not an
  error. Every negative write assertion re-reads with the service client.
- **[foundation-c-services]** — a generic table parameter over all 51 tables exhausted the TypeScript
  heap on this machine (2 cores, 7.7 GB). Keep generic table names away from generic column strings
  in anything new.
- **[route-tests-and-realtime]** — `npm run db:push` needs a live CLI token; an expired one fails at
  "Initialising login role" with a bare 401. `npx supabase login` fixes it, `--debug` surfaces it.
- **[roster-c-csv-import]** — the CSV import wizard's shape is the precedent for this upload:
  a **no-write preview** followed by an explicit apply, with the preview and result counts proven to
  agree. Read `lib/roster/csv/buildImportPreview.ts` before designing the upload response; the
  count-mismatch bug it records is the same bug an upload can have.
- **[talks-c-prayers-topics]** — a bash heredoc broke on a file containing a PostgREST embedded-join
  select. Use the Write tool for TypeScript and SQL files.

---

## Tasks

### Task 1: The search function and vector index

**File:** `supabase/migrations/031_knowledge_search.sql` (create)

Open with the same `set search_path = public, extensions;` line and the same explanatory comment
migration 014 uses — the `vector` type may live in either schema.

```sql
create function match_document_chunks(
  query_embedding vector(1536),
  match_ward_id   uuid,
  match_count     int
)
returns table (
  chunk_id    uuid,
  content     text,
  document_id uuid,
  title       text,
  type_tag    text,
  chunk_index integer,
  similarity  float
)
language sql
stable
as $$
  select c.id, c.content, c.document_id, d.title, d.type_tag, c.chunk_index,
         1 - (c.embedding <=> query_embedding) as similarity
  from document_chunks c
  join knowledge_documents d on d.id = c.document_id and d.ward_id = c.ward_id
  where c.ward_id = match_ward_id
    and d.status = 'active'
    and c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count
$$;

grant execute on function match_document_chunks(vector, uuid, int) to authenticated, service_role;
```

**Four things that are not decoration:**

1. **`security invoker`** — the default for `language sql`, and it must stay the default. RLS applies
   inside the function, so `document_chunks`' ward policy is the real boundary and `match_ward_id`
   is defence in depth. Write `-- SECURITY INVOKER (default) is load-bearing` above it, because a
   later "optimisation" to `security definer` would turn the ward parameter into the *only* thing
   standing between wards.
2. **`c.embedding is not null`** — a chunk whose embedding failed (Task 4 records these rather than
   discarding them) must never sort as maximally similar. Without this it does.
3. **The join carries `and d.ward_id = c.ward_id`** — the composite key the whole schema uses.
4. **The explicit grant.** See the foundation-b pitfall above.

**The index — HNSW, not the phase plan's ivfflat.** Flagging this as a deliberate deviation:

```sql
create index document_chunks_embedding_idx
  on document_chunks using hnsw (embedding vector_cosine_ops);
```

The phase plan says ivfflat and says to create it *after* the standard works are loaded, because
ivfflat's list centroids are trained on whatever data exists at build time — an ivfflat index built
on an empty table is worthless and has to be rebuilt. **HNSW has no training step.** It can be
created before any data exists, it stays correct as rows are added, and it has better recall at the
same query cost. The "build it after ingestion" instruction becomes unnecessary rather than being
forgotten, which is the failure mode the phase plan was guarding against.

The cost is a slower build and more memory during it. At the scale here (tens of thousands of chunks
for one ward's scriptures) that is seconds, not minutes.

> **Verify before writing the migration:** run
> `select extversion from pg_extension where extname = 'vector';`
> against the linked project. HNSW needs pgvector **≥ 0.5.0**. Supabase has shipped well past that
> since 2023, but check rather than assume — if it somehow comes back older, fall back to the phase
> plan's ivfflat and put the "build after ingestion" note in the script's output.

Also add `knowledge_documents_ward_status_idx on knowledge_documents (ward_id, status)` — every
retrieval joins on exactly that pair.

---

### Task 2: Storage bucket

**File:** `supabase/migrations/032_knowledge_storage.sql` (create)

`knowledge_documents.file_url` exists and has been unused since migration 014. Create a **private**
bucket named `knowledge-documents` and policies on `storage.objects` restricting it to the
bishopric of the owning ward.

- Objects are keyed `{ward_id}/{document_id}.{ext}`, so the ward is the first path segment and a
  policy can read it with `(storage.foldername(name))[1]`.
- SELECT / INSERT / DELETE to `authenticated` where that segment equals `current_ward_id()::text`
  **and** `is_bishopric()`. Both helpers are `SECURITY DEFINER` functions from migration 019.
- No UPDATE policy. A document is replaced by deleting and re-uploading, which keeps
  `document_chunks` from silently describing a file that changed underneath them.

The original file is kept for provenance — so the bishopric can re-download what they uploaded and
so a future re-chunk has a source. **It is never read at query time.** Retrieval reads
`document_chunks`, full stop.

After both migrations: `npm run db:push`, then **`npm run db:types`**. The RPC signature only reaches
TypeScript through the generated file, and `supabase.rpc("match_document_chunks", …)` will not
typecheck until it is regenerated.

---

### Task 3: Chunking

**File:** `lib/knowledge/chunk.ts` (create)

Pure. No imports. This is the most testable thing in the plan and the easiest to get subtly wrong.

```ts
export type Chunk = { content: string; chunkIndex: number };

export const TARGET_CHUNK_TOKENS = 500;
export const CHUNK_OVERLAP_TOKENS = 50;

export function chunkText(text: string, options?: { targetTokens?: number; overlapTokens?: number }): Chunk[];
export function chunkByBoundaries(sections: readonly { label: string; text: string }[]): (Chunk & { label: string })[];
```

**Token estimation:** there is no tokenizer in this project and adding one is not worth a dependency.
Estimate at **4 characters per token** and name the constant `CHARS_PER_TOKEN_ESTIMATE` so nobody
reads `2000` as a character limit somebody chose. Comment that it is an estimate and that overshoot
is harmless here — chunk size affects retrieval granularity, not correctness.

**Algorithm for `chunkText`:**
1. Normalise line endings, collapse 3+ blank lines to 2.
2. Split on blank lines into paragraphs.
3. Accumulate paragraphs until adding the next would exceed the target; emit a chunk.
4. Carry the tail of the previous chunk — whole paragraphs summing to ≥ the overlap, or the last
   paragraph if one alone exceeds it — into the next chunk's start.
5. A **single paragraph longer than the target is split on sentence boundaries**, and only if a
   sentence alone still exceeds it is a hard character split used. A scripture chapter with no blank
   lines must not become one enormous chunk.
6. `chunkIndex` is 0-based, contiguous, and never has a gap.

**The three cases the tests exist for:**
- A document shorter than one chunk yields **exactly one** chunk, not zero and not one plus an empty
  tail.
- Overlap actually overlaps — chunk *n*'s tail text appears at the head of chunk *n+1*.
- Empty or whitespace-only input yields `[]`, not `[{ content: "" }]`. An empty chunk gets an
  embedding and then matches everything weakly forever.

`chunkByBoundaries` is what the ingestion script uses for scripture: the caller supplies
pre-split sections (a chapter, a pericope) with labels, and each becomes its own chunk — subdivided
by `chunkText` only when a section is genuinely too long. **A chunk that splits mid-verse retrieves
badly**, which is the phase plan's stated reason for this second entry point.

---

### Task 4: Embedding

**File:** `lib/ai/embed.ts` (create)

Server-only. Same `typeof window` guard as `lib/ai/client.ts`, same reason.

```ts
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
export const EMBEDDING_BATCH_SIZE = 100;

export type EmbeddingResult = {
  embeddings: (number[] | null)[];   // index-aligned with the input
  failedIndexes: number[];
};

export async function embedTexts(texts: readonly string[]): Promise<EmbeddingResult>;
export async function embedQuery(text: string): Promise<number[]>;
```

- Missing `OPENAI_API_KEY` throws `AiRequestError("not_configured", …)` from `lib/ai/errors.ts` —
  reuse `ai-a`'s type rather than inventing a second error vocabulary. The message must name
  **OpenAI**, not Anthropic; the two keys fail independently and a bishop told "add the Anthropic
  key" when the OpenAI one is missing will do the wrong thing.
- Batch at 100. **A failed batch marks those indexes as failed and the run continues** — the phase
  plan's "handle partial failure by recording which chunks succeeded". A single 429 partway through
  the Book of Mormon must not discard the 20,000 chunks that already worked.
- **Assert the returned vector length equals 1536** before returning it. The column is
  `vector(1536)`; a mismatch is otherwise a Postgres error thousands of rows into a bulk insert.
- `embedQuery` is a thin wrapper that throws when its single embedding fails, because a query with
  no vector cannot degrade gracefully into anything useful.

> **Embedding-model mismatch is the phase plan's second pitfall and it is invisible when it
> happens.** Query and documents must use the same model; mixing them returns confident nonsense.
> `EMBEDDING_MODEL` is declared **once, here**, and both paths import it. Do not accept a model
> parameter — a parameter is how they drift.

---

### Task 5: Document parsing

**File:** `lib/knowledge/parseDocument.ts` (create)

```ts
export const SUPPORTED_MIME_TYPES = { "text/plain": "txt", "text/markdown": "md", "application/pdf": "pdf" } as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type ParsedDocument = { text: string; characterCount: number; pageCount: number | null };

export async function parseDocument(file: File): Promise<ParsedDocument>;
```

- Dispatch on the **extension and the sniffed content**, not on `file.type` alone — browsers
  disagree about the MIME type of `.md`.
- PDF goes through `unpdf`: `extractText(new Uint8Array(await file.arrayBuffer()), { mergePages: true })`.
  Check the installed version's exact export and signature before writing the call; do not write it
  from memory.
- **A parse yielding under ~200 characters throws** a plain `Error` with an actionable message
  ("Only 12 characters of text could be read from this PDF. It may be a scan rather than text. Try
  uploading the text instead."). Silently ingesting an empty document creates a document row, zero
  useful chunks, and a bishopric that thinks their corpus contains something it does not.
- Markdown is ingested **as-is**, not stripped. The heading structure is signal for chunking, and
  the model reads it fine.

---

### Task 6: Document queries

**File:** `lib/knowledge/queries.ts` (create)

Server-only, the single door to both tables.

```ts
export async function listDocuments(wardId, client?): Promise<KnowledgeDocument[]>;   // + chunkCount, embeddedCount
export async function getDocument(wardId, id, client?): Promise<KnowledgeDocument | null>;
export async function createDocument(wardId, input, uploadedBy, client?): Promise<KnowledgeDocument>;
export async function insertChunks(wardId, documentId, chunks, client?): Promise<number>;
export async function setDocumentStatus(wardId, id, status, client?): Promise<KnowledgeDocument | null>;
export async function deleteDocument(wardId, id, client?): Promise<boolean>;
```

- **`chunkCount` and `embeddedCount` are separate numbers** and the UI shows both. "412 passages,
  410 embedded" is how a partial embedding failure becomes visible instead of becoming quiet bad
  retrieval. Count them with two `count: "exact", head: true` queries per document, or one grouped
  RPC if the N+1 bites — at a few dozen documents per ward it will not.
- **`insertChunks` inserts in batches of 200** and returns the number written. A single insert of
  20,000 rows exceeds the request size limit.
- `deleteDocument` deletes the `knowledge_documents` row and lets the FK cascade take the chunks —
  migration 014 declares `on delete cascade` on `document_chunks`' composite FK. Then delete the
  storage object. **Do the storage delete last and do not fail the request if it fails**; log it. An
  orphaned file is a housekeeping problem, an orphaned chunk is a retrieval problem, and only one of
  those can be fixed later.
- Order any list you index into (`.order("uploaded_at", { ascending: false })`).

---

### Task 7: The shared ingest pipeline

**File:** `lib/knowledge/ingest.ts` (create)

The route and the script must not each grow their own copy of parse → chunk → embed → insert.

```ts
export type IngestSummary = {
  documentId: string;
  chunkCount: number;
  embeddedCount: number;
  failedChunkIndexes: number[];
  characterCount: number;
};

export async function ingestChunks(
  wardId: string,
  documentId: string,
  chunks: readonly Chunk[],
  client: SupabaseClient<Database>,
  onProgress?: (done: number, total: number) => void,
): Promise<IngestSummary>;
```

- Embed in `EMBEDDING_BATCH_SIZE` groups, insert in 200-row groups, report progress.
- **Chunks whose embedding failed are still inserted, with `embedding = null`.** The column is
  nullable, the search function already excludes them, and the alternative — dropping them — loses
  the text and hides the failure. The summary names the indexes so a retry can target them.
- `IngestSummary` is what the upload route returns and what the script prints. **One shape, so the
  preview count and the result count cannot disagree** — the roster-c bug, avoided by construction
  rather than by matching two code paths.

---

### Task 8: Retrieval

**File:** `lib/ai/retrieve.ts` (create)

```ts
export const SIMILARITY_FLOOR = 0.3;
export const DEFAULT_MATCH_COUNT = 6;
export const MAX_MATCH_COUNT = 8;

export async function retrieveChunks(
  query: string,
  wardId: string,
  options?: { limit?: number; client?: SupabaseClient<Database> },
): Promise<RetrievedChunk[]>;   // the type ai-a exported from lib/ai/systemPrompt.ts
```

1. `embedQuery(query)` — the same model, via the same constant.
2. `supabase.rpc("match_document_chunks", { query_embedding, match_ward_id: wardId, match_count })`.
   **Pass the vector as `JSON.stringify(embedding)`.** pgvector's text input format is `[1,2,3]`,
   which is byte-identical to a JSON array, and sending the string removes any ambiguity about how
   PostgREST serialises a JS number array into a `vector` parameter. Verify against the hosted
   project on the first call — this is the single most likely thing in the plan to need one
   correction.
3. **Filter to `similarity >= SIMILARITY_FLOOR`, then clamp to `limit`.** Filter before clamping,
   never after.
4. Map to `{ content, sourceLabel }`. The label is the document title plus the chunk's own label
   where it has one — `"Alma 32:21–31"` for scripture, `"Elder Holland, April 2024 (part 3)"` for a
   talk. This is what rule 4's citations are built from; a chunk with no usable label is a citation
   nobody can check.
5. **Returning nothing is a legitimate result and must not throw.** A ward with no documents, or a
   query nothing matches, gets `[]`, `buildSystemPrompt` omits layer 3, and the model answers from
   the ward's settings alone. The phase plan is explicit that weak chunks are worse than none.

Log the query's match count and top similarity at `console.info`. **Never log the query text** — a
bishop's search terms can be about a specific member.

---

### Task 9: Validation schemas

**File:** `lib/validation/knowledge.ts` (create)

- `uploadMetadataSchema` — `title` 1–200, `typeTag` one of `KNOWLEDGE_TYPE_TAGS`.
- `documentPatchSchema` — `{ status: "active" | "inactive" }`. Status is the only mutable field;
  re-titling would desynchronise every source label already embedded in a draft.
- `searchRequestSchema` — `{ query: 1–500, limit: int 1–8 optional }`.

The file is validated **server-side after the multipart parse**, not by the schema — a `File` is not
something Zod should be asked to describe. Size and type are checked in the route against
`MAX_UPLOAD_BYTES` and `SUPPORTED_MIME_TYPES`, each with its own message.

---

### Task 10: Upload route

**File:** `app/api/knowledge/upload/route.ts` (create)

POST, `knowledge.manage`. **Multipart, so `readJsonBody` does not apply** — use
`await request.formData()` wrapped in its own try that throws a 400, mirroring what
`readJsonBody` does for JSON. Do not let a malformed body become a 500.

Order of operations:
1. Session outside the try; client, role access, `assertCan` inside.
2. Read `file`, `title`, `typeTag`. Validate size and MIME first — reject a 40 MB file **before**
   reading it into memory.
3. `parseDocument(file)`.
4. `createDocument(...)` → gives the id the storage key needs.
5. Upload the original to `knowledge-documents/{wardId}/{documentId}.{ext}`, store the path on
   `file_url`. A storage failure here **does** fail the request, and the document row is deleted
   before returning — a row pointing at a file that was never written is worse than no row.
6. `chunkText` → `ingestChunks`.
7. `writeAuditLog({ action: "knowledge_document_uploaded", module: "knowledge",
   detail: { documentId, typeTag, chunkCount, embeddedCount } })`.
8. Return the `IngestSummary` with 201.

**A partial embedding failure returns 201, not an error**, with `failedChunkIndexes` populated and
the UI saying so plainly. The document is genuinely usable; pretending it failed entirely would make
the bishopric re-upload and duplicate it.

Add `export const maxDuration = 60;` with a comment: a 5 MB text document is a few hundred chunks and
several embedding batches, which exceeds the default. Anything larger belongs in the script, and the
`MAX_UPLOAD_BYTES` cap is what keeps that true.

---

### Task 11: Document list and detail routes

**Files:** `app/api/knowledge/documents/route.ts`, `app/api/knowledge/documents/[id]/route.ts`

- **GET list** — `knowledge.view`. Returns `{ documents }` with counts, newest first.
- **PATCH** — `knowledge.manage`. Body `documentPatchSchema`. 404 for another ward's id.
  Audit `knowledge_document_status_changed`. **Deactivation takes effect on the next retrieval with
  no rebuild** — the search function filters `d.status = 'active'`, so there is nothing to reindex.
  Worth a comment; it is the reason status is a column rather than a delete.
- **DELETE** — `knowledge.manage`. Cascade takes the chunks; the storage object goes last and
  best-effort. Audit `knowledge_document_deleted` with the chunk count that went with it.
- `params` is a `Promise` in Next 16.

---

### Task 12: Search route

**File:** `app/api/knowledge/search/route.ts` (create)

POST, `knowledge.view`. Body `searchRequestSchema`. Returns
`{ results: [{ content, sourceLabel, similarity }] }`.

> **Deviation from SPEC.md, flag it and fix the spec.** SPEC.md §API Routes describes this as
> "Semantic search (internal use by AI routes)". It is not built for that, and no AI route calls it.
> `ai-c`'s routes import `retrieveChunks()` directly, because an in-process function call is the
> right way for server code to reach server code — an internal HTTP hop to your own app costs a
> round trip, a second auth pass, and a serverless cold start, and it can fail in ways a function
> call cannot.
>
> The route is built anyway, for a different and better reason: **it is the only way to see what the
> corpus actually returns.** When a topic suggestion cites something odd, the question is whether
> retrieval or the prompt is at fault, and this answers it in one query. Update SPEC.md to describe
> it as a bishopric-facing retrieval test.

Return the raw `similarity` here — this surface exists to be inspected. It is the one place a number
is more useful than words.

---

### Task 13: The page and its three components

**Files:** `app/(app)/knowledge/page.tsx`, `DocumentList.tsx`, `UploadForm.tsx`, `RetrievalTester.tsx`

Server page follows `app/(app)/talks/topics/page.tsx`: `can()` + `<NotPermitted detail="The
knowledge base is limited to the bishopric." />`, then `canManage` passed down.

**`UploadForm`** — file picker (`accept=".txt,.md,.pdf"`), title, tag select. On success show the
summary as a sentence: *"Added — 412 passages, 410 embedded."* When `failedChunkIndexes` is
non-empty, a warning naming the count and saying the document is usable and the missing passages can
be fixed by re-uploading. Client-side size check before the request, with the same limit constant.

**`DocumentList`** — title, tag, status, uploaded-by and date, and **both counts**. Activate /
deactivate toggle and a delete with a consequence-worded confirm: *"Deleting removes the document and
all 412 of its passages. Drafts already written are not affected."* Read-only with no controls when
`canManage` is false — not disabled controls.

**`RetrievalTester`** — a query box and the ranked results with their source labels and similarity.
Above it, one muted line: *"This is exactly what the AI receives as reference material."* That
sentence is the feature.

Empty state, which a fresh ward will see for a while: name the two ways to fill it — upload a
document, or run the standard-works script — rather than an empty table.

---

### Task 14: The standard-works ingestion script

**File:** `supabase/scripts/ingestStandardWorks.ts` (create)
**File:** `package.json` (modify) — `"knowledge:ingest": "node --disable-warning=ExperimentalWarning --experimental-strip-types supabase/scripts/ingestStandardWorks.ts"`, matching the existing `seed` script's invocation exactly.
**File:** `.gitignore` (modify) — add `/corpus/`.

**Why a script:** the phase plan's first pitfall. The standard works are tens of thousands of chunks
and hundreds of embedding batches. A serverless function times out; this does not.

**Input — a local file you supply, gitignored.** Nothing copyrighted enters the repository. The
script takes a path and a ward id:

```
npm run knowledge:ingest -- --corpus ./corpus/standard-works.json --ward <uuid>
```

Expected shape, documented in the script's header comment and in `testing/README.md`:

```json
[
  { "volume": "book_of_mormon", "book": "Alma", "chapter": 32, "verse": 21, "text": "…" }
]
```

`volume` is a `StandardWork` value. Validate the file with a Zod schema at the top of the script and
**fail on the first malformed record naming its index** — a bad record 30,000 rows in, discovered
after twenty minutes of embedding, is the worst possible time to find out.

**What it does:**
1. Read and validate; group by `volume`.
2. One `knowledge_documents` row per volume (five), `type_tag: "standard_works"`, `file_url: null`
   (there is no uploaded file), `uploaded_by: null`.
3. Group verses into **chapters**, and pass them to `chunkByBoundaries` with the label
   `"Alma 32"`. A chapter over the target length is subdivided and the label carries the verse range
   (`"Alma 32:21–31"`). **Never split mid-verse** — that is why this path exists instead of
   `chunkText`.
4. `ingestChunks` with an `onProgress` that prints `volume — 4200/6604 chunks embedded`.
5. Print a final table: volume, chunks, embedded, failed. **Exit non-zero if any volume has zero
   embedded chunks.**

**Idempotency.** Re-running must not double the corpus. Before inserting a volume, check for an
existing `standard_works` document with the same title in that ward and **refuse** with a message
naming it and telling the operator to delete it first. Not an upsert — silently replacing a corpus
somebody spent twenty minutes building is not a thing a script should decide.

Uses `createServiceSupabaseClient()` — it runs outside any session and writes for a ward whose
bishopric is not signed in. Load env through `testing/infrastructure/envLoader.ts`, which already
solves this.

**Ship and verify it against a small sample corpus.** A 200-verse JSON file exercises every path in
the script — validation, grouping, chunk labelling, batching, the summary, and the idempotency
refusal — in about ten seconds. Do not treat "the script is written" as done; the plan's
verification step is a real run against a real ward.

---

## Testing Strategy

| File | Kind | Asserts |
|---|---|---|
| `tests/lib/chunking.test.ts` | pure | Phase 5 test **chunking** |
| `tests/lib/similarityFloor.test.ts` | pure | Phase 5 test **similarity-floor** |
| `tests/lib/parseDocument.test.ts` | unit | Extension dispatch, the too-short refusal |
| `tests/lib/embedBatching.test.ts` | unit, mocked OpenAI | Batching, partial failure, dimension check |
| `tests/rls/retrieval-scoping.test.ts` | RLS, real DB | Phase 5 test **retrieval-scoping** |
| `tests/routes/knowledge-documents.test.ts` | route, real RLS | List, patch, delete, permissions |

**`chunking.test.ts`** — the three named cases (short document → one chunk; overlap actually
overlaps; empty → `[]`) plus: paragraph boundaries are preferred; a single over-long paragraph splits
on sentences; `chunkIndex` is contiguous with no gaps; `chunkByBoundaries` never merges two labelled
sections into one chunk.

**`similarityFloor.test.ts`** — extract the filter-then-clamp step into a pure exported helper in
`lib/ai/retrieve.ts` so this needs no database. Assert: 0.29 is excluded and 0.31 included; filtering
happens **before** the limit, so 8 results of which 3 are weak return 5 and not 8; an all-weak result
set returns `[]` rather than the best of a bad lot.

**`retrieval-scoping.test.ts`** — the highest-value test here, and it must go through the real
function. Seed two wards, each with a document and a handful of hand-written chunks. Rather than
calling OpenAI, **insert deterministic unit vectors directly with the service client** — a chunk
whose embedding is `[1,0,0,…]` and a query vector of `[1,0,0,…]` gives a similarity of exactly 1 with
no network call and no flakiness. Then, as an authenticated ward-A user:
- a query that matches ward B's chunk perfectly returns nothing;
- deactivating ward A's document makes its chunks disappear from the next call, with no reindex;
- a chunk with `embedding IS NULL` never appears, at any similarity;
- calling the RPC with ward B's uuid as `match_ward_id` **still** returns nothing — proving RLS, not
  the parameter, is the boundary. This assertion is the reason the function is `SECURITY INVOKER`.

**`knowledge-documents.test.ts`** — the CLAUDE.md §8 route pattern. Bishop lists, patches, deletes;
another ward's id is a 404 on both; `ward_secretary` is 403 on all three (`knowledge.*` is
bishopric-only — but check `lib/auth/permissions.ts` before asserting, per §8). Prove the delete
cascaded by re-reading `document_chunks` with the service client, and prove a refused delete left the
row present.

Upload is **not** route-tested. It needs a multipart `File`, a real Storage bucket, and either a live
OpenAI call or a mock deep enough to be meaningless. Scenario 022 covers it in a browser, which is
where it is actually worth proving. Say so in a comment on the test file rather than leaving the gap
to be read as an oversight.

---

## Test Scenarios (Harness)

> Check `testing/scenarios/manifest.json` before numbering — 022 and 023 were free on 2026-08-23.

### Scenario 022: Upload, deactivate, delete

**Tags:** `ai`, `knowledge`, `full`
**Purpose:** The upload path cannot be unit-tested end to end — it needs a real file, real Storage
and a real embedding call. Seeding gives an existing corpus so deactivation is a visible change in
retrieval rather than a status badge with nothing behind it.

**Seed data summary**
- `wards` — 1; `users` — bishop, counselor, ward_secretary
- `knowledge_documents` — 2 active (`general_conference`, `other`)
- `document_chunks` — ~20 across both, with deterministic embeddings so the tester's queries return
  predictable passages
- Fixture files in the scenario folder: a `.txt` talk, a `.md` letter, a text-based `.pdf`, and a
  **scanned image-only** `.pdf`

**Tester action:** As the bishop, upload each of the four fixtures, then use the Retrieval Tester
before and after deactivating one document, then delete it.

**Verification checklist**
- [ ] `.txt`, `.md`, and the text `.pdf` all ingest and report a plausible passage count
- [ ] The **scanned** PDF is refused with a message about it being a scan — not a document with zero
      passages
- [ ] Both counts are shown ("412 passages, 412 embedded")
- [ ] A file over 10 MB is refused **before** anything uploads
- [ ] Retrieval Tester returns passages with readable source labels and similarity scores
- [ ] Deactivating a document removes its passages from the very next query, with no rebuild step
- [ ] Reactivating brings them back
- [ ] Deleting shows the passage count in the confirm, and afterwards the passages are gone
- [ ] `ward_secretary` sees "Not permitted" at `/knowledge`
- [ ] Works at 375px and in both themes

### Scenario 023: The standard works, ingested

**Tags:** `ai`, `knowledge`, `full`, `script`
**Purpose:** The script is the one thing in Phase 5 with no automated coverage at scale, and its
failure modes (a malformed record 30,000 rows in, a double-run doubling the corpus, an embedding
batch failing silently) all only appear on a real run.

**Seed data summary** — one ward and a bishop. Plus a **sample corpus** fixture of ~200 verses
committed to the scenario folder, and the tester's own full corpus file if they have one.

**Tester action:** Run `npm run knowledge:ingest -- --corpus <sample> --ward <uuid>`, then run it
again. Then run it with a deliberately corrupted record.

**Verification checklist**
- [ ] Progress prints during the run rather than going silent
- [ ] The final table reports per-volume chunk and embedded counts
- [ ] `/knowledge` shows the volumes as documents with matching counts
- [ ] Retrieval Tester on "faith" returns scripture passages with chapter-and-verse labels
- [ ] **No label spans a partial verse**
- [ ] The second run **refuses** and names the existing document — the corpus is not doubled
- [ ] A corrupted record fails immediately, naming its index, before any embedding is spent
- [ ] The process exits non-zero on that failure

---

## Validation Commands

```bash
npm run db:push
npm run db:types
npm run lint
npm run typecheck
npm test
npm run build
```

`db:push` before `db:types` before everything else — the RPC signature does not exist in TypeScript
until it is generated, so `typecheck` will fail on `retrieve.ts` if the order is wrong. `db:push`
does **not** wipe the hosted database; `db:reset` does. Do not run `db:reset`.

---

## Integration Notes

- **`buildSystemPrompt` does not change.** `ai-a` shipped the `retrievedChunks` parameter and the
  layer-3 branch; this plan is the first caller to pass a non-empty array. If a task here seems to
  need a signature change, something has gone wrong.
- **`RetrievedChunk` is defined in `lib/ai/systemPrompt.ts`** (a pure module) and imported by
  `lib/ai/retrieve.ts`, not the other way round. A client component must be able to reach the type
  without pulling in a server-only module.
- **`NAVIGATION_ITEMS` is unchanged** — the Knowledge Base link already exists and currently 404s.
- **Handed to `ai-c`:** `retrieveChunks(query, wardId)`. `ai-c` calls it directly and never through
  `/api/knowledge/search`.
- **Handed to Phase 6:** hymn suggestions retrieve from the same corpus with no further work here.
- **Documentation:** SPEC.md §API Routes — mark the four knowledge routes built and **re-describe
  `/api/knowledge/search`** per Task 12. SPEC.md §Chunking Strategy — record the 4-chars-per-token
  estimate and the boundary-aware path for scripture. CLAUDE.md §9 — the `unpdf` dependency is a
  third-party addition worth a line, and HNSW-over-ivfflat is a decision worth recording so it is
  not re-litigated.
- **Breaking changes:** none. Two new migrations, both additive; regenerating `types/database.ts`
  adds the RPC signature and touches nothing existing.
