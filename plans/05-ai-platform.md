# Phase 5 — AI Platform

The knowledge base, pgvector retrieval, AI behaviour settings, and every Claude-powered
feature in the app. Build this once, correctly, and every later AI feature is a thin route.

**Depends on:** Phase 4. **Unlocks:** Phase 6 AI features; retrofits AI into Phase 4.
**Reference:** [FEATURES.md](../FEATURES.md) §Modules 5, 6; [SPEC.md](../SPEC.md) §AI Integration.

> **Load the `claude-api` skill before writing any Claude API call in this phase.**
> Model IDs, thinking configuration, and streaming details change; do not write them
> from memory.

---

## Sub-plans

Planned 2026-08-23. This file is the phase brief; the four files below are what `/execute`
runs, **in this order**. Each is self-contained — do not load more than two at once
(CLAUDE.md §2).

| # | Plan | Ships |
|---|---|---|
| 1 | [ai-a-client-and-settings.md](ai-a-client-and-settings.md) | Claude client and typed error handling, `buildSystemPrompt` layers 1–2 with the cache breakpoint, the AI Settings panel with versioning, history, restore, and preview |
| 2 | [ai-b-knowledge-and-retrieval.md](ai-b-knowledge-and-retrieval.md) | Chunking, embedding, `match_document_chunks`, the vector index, document upload/management UI, the standard-works ingestion script — layer 3 turns on |
| 3 | [ai-c-feature-routes.md](ai-c-feature-routes.md) | `/api/topics/ai-suggest` into the accept/reject queue, `/api/assignments/[id]/ai-message` into the two existing textareas |
| 4 | [ai-d-conference-corpus-scoping.md](ai-d-conference-corpus-scoping.md) | Conference metadata columns, a filtered `match_document_chunks`, the corpus scoping panel and its AI filter resolver, the conference ingest script, and the suggestion log ITER-012 will read — **added 2026-08-23, after `ai-b`; orderable before or after `ai-c`** |

**Three decisions settled at planning time, so they are not re-litigated during execution:**

- **The standard-works corpus is a local file the operator supplies**, gitignored, in a JSON shape
  the ingestion script validates. Nothing copyrighted enters the repository, and the script is
  verified against a small sample corpus rather than only against a full load.
- **Upload accepts `.txt`, `.md`, and `.pdf`.** PDF adds one dependency — `unpdf`, zero runtime
  dependencies, serverless-safe — approved 2026-08-23.
- **The vector index is HNSW, not the ivfflat this file specifies below.** HNSW has no training
  step, so it can be created before ingestion and stays correct as rows arrive, which removes the
  "build the index afterwards" instruction rather than leaving it to be forgotten. Reasoning in
  `ai-b` Task 1.

---

## Rules That Apply to Every AI Feature

1. **Server-side only.** All Claude and OpenAI calls happen in route handlers. Neither
   key is ever prefixed `NEXT_PUBLIC_`.
2. **Nothing is auto-saved or auto-sent.** Every AI response is a draft returned to the
   user for review, edit, and explicit approval. There is no code path where generated
   text reaches a database row or another human without a click.
3. **Only retrieved excerpts go to Claude, never whole documents.** Retrieval returns
   5–8 chunks.
4. **Suggestions cite sources.** "Alma 32:21", "Elder Holland, April 2024". Instruct this
   in the system prompt and surface it in the UI.
5. **Failures are visible.** An API error shows the user what happened and offers a retry.
   Never fall back to silently returning nothing.

---

## Step 1 — Claude Client

`lib/ai/client.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';

export const anthropic = new Anthropic();  // reads ANTHROPIC_API_KEY

export const MODEL = 'claude-sonnet-5';
```

Standard call shape for this app:

```ts
const response = await anthropic.messages.create({
  model: MODEL,
  max_tokens: 4096,
  thinking: { type: 'adaptive' },
  output_config: { effort: 'medium' },   // 'high' for topic/scripture generation
  system: await buildSystemPrompt({ wardId, module, retrievedChunks }),
  messages: [{ role: 'user', content: userPrompt }],
});
```

- `max_tokens` at 4096 for messages, higher for topic batches. Stream anything above
  ~16000; these features do not need it
- Check `stop_reason` before reading `content` — handle `refusal` and `max_tokens`
- Wrap in typed error handling: rate limit → retry with backoff (the SDK does 2 by
  default); other errors → surface to the user
- Structured output where the shape matters (topic suggestions, program edits) via
  `output_config.format` with a JSON schema. Do **not** use assistant prefill — it 400s
  on current models

**Prompt caching.** The system prompt is large and stable per ward: AI settings plus
module instructions. Put a `cache_control: { type: 'ephemeral' }` breakpoint at the end of
the stable portion and keep retrieved chunks *after* it, since they vary per request.
Order matters: stable content first, volatile content last.

---

## Step 2 — System Prompt Assembly

`lib/ai/systemPrompt.ts`. Three layers, in this order:

1. **Ward AI settings** — the active `ai_settings` row: tone, doctrinal emphasis,
   scripture preferences, conference preferences, topic preferences, ward context,
   thank-you preferences. Rendered as prose, not JSON
2. **Module instructions** — a static per-module block ("You are helping draft a
   confirmation message for a sacrament meeting speaker…")
3. **Retrieved chunks** — from Step 4, with source labels, plus an instruction to cite

Layers 1 and 2 are stable → cacheable. Layer 3 varies → after the cache breakpoint.

Keep the module instructions *short and specific*. Current Claude models follow
instructions closely; a paragraph of "CRITICAL: YOU MUST" language causes over-application.
State the task and the constraints plainly, once.

---

## Step 3 — Knowledge Base

| Route | Method | Auth | Does |
|---|---|---|---|
| `/api/knowledge/upload` | POST | Bishopric | Upload, chunk, embed, store |
| `/api/knowledge/documents` | GET | Bishopric | List with status and tag |
| `/api/knowledge/documents/[id]` | PATCH | Bishopric | Activate / deactivate |
| `/api/knowledge/documents/[id]` | DELETE | Bishopric | Delete document + its chunks |

Pre-loaded at setup: the five standard works. Added later by the bishopric: conference
talks after each conference, ward theme documents, First Presidency letters.
Tags: `standard_works`, `general_conference`, `other`.

**Chunking** (`lib/ai/chunk.ts`): ~500 tokens with 50-token overlap, split on paragraph
boundaries where possible. For scripture, prefer chapter or pericope boundaries over a
fixed window — a chunk that splits mid-verse retrieves badly.

**Embedding** with OpenAI `text-embedding-3-small`, 1536 dims, matching the column type.

> Upload of the standard works is thousands of chunks and will exceed a serverless
> function timeout. Run initial ingestion as a **script or Edge Function**, not an HTTP
> route. For user uploads, cap file size and process in batches with progress feedback.
> Embed in batches of ~100 and handle partial failure by recording which chunks succeeded.

---

## Step 4 — Retrieval

`lib/ai/retrieve.ts`:

```ts
export async function retrieveChunks(
  query: string, wardId: string, limit = 6
): Promise<RetrievedChunk[]>
```

1. Embed the query with the **same model** used at ingestion
2. Cosine similarity search over `document_chunks`, joined to `knowledge_documents`
   filtered to `status = 'active'` and the ward
3. Return the top 5–8 with content and source label

Implement the search as a Postgres function so the vector comparison stays in the database:

```sql
CREATE FUNCTION match_document_chunks(
  query_embedding vector(1536), match_ward_id uuid, match_count int
) RETURNS TABLE (...) LANGUAGE sql STABLE AS $$
  SELECT c.id, c.content, d.title, d.type_tag,
         1 - (c.embedding <=> query_embedding) AS similarity
  FROM document_chunks c
  JOIN knowledge_documents d ON d.id = c.document_id
  WHERE c.ward_id = match_ward_id AND d.status = 'active'
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count
$$;
```

Add the `ivfflat` index with `vector_cosine_ops` **after** the standard works are loaded —
index quality depends on the data distribution.

Apply a similarity floor (~0.3). Returning weakly related chunks is worse than returning
none; irrelevant context degrades the output.

---

## Step 5 — AI Settings Panel

`/ai-settings`. Bishopric-only. Plain-English configuration, per FEATURES.md §Module 6.

Seven sections: Tone & Voice · Doctrinal Emphasis · Scripture Preferences · Conference
Talk Preferences · Topic Generation Preferences · Ward Context · Thank You Preferences.

| Route | Method | Does |
|---|---|---|
| `/api/ai-settings` | GET | Active settings (latest `created_at`) |
| `/api/ai-settings` | POST | Save a **new version** — never update in place |
| `/api/ai-settings/history` | GET | All versions with who saved and when |
| `/api/ai-settings/restore/[id]` | POST | Restore a version (creates a new version copying it) |
| `/api/ai-settings/preview` | POST | Run a test prompt against the *unsaved* draft settings |

**Versioning is append-only.** Every save inserts a row; the latest is active. Restore
copies an old row forward rather than deleting newer ones, so history is never lost.

**The preview panel accepts draft settings in the request body** so the bishopric can test
before committing. This is the whole point of the feature — do not make them save first.

Notify the other two bishopric members on save (`admin_setting_changed`).

---

## Step 6 — AI Feature Routes

Each of these is thin: assemble context, retrieve, call, return a draft.

| Route | Returns | Effort |
|---|---|---|
| `/api/topics/ai-suggest` | Candidate topics with scriptures and talks. **Proposals only** — bishopric accepts each into the library | `high` |
| `/api/assignments/[id]/ai-message` | A confirmation or thank-you draft. `type` param selects which | `medium` |
| `/api/hymns/suggest` | Hymn suggestions for a Sunday's topics, each with a one-line rationale (Phase 6) | `medium` |
| `/api/programs/[id]/ai-edit` | Conversational program editing (Phase 6) | `medium` |

**Confirmation message** input: speaker name, topic, suggested scriptures, suggested
conference talks, ward tone settings. Output: a message the counselor edits and approves.

**Thank-you message** input: speaker name, topic, and the bishopric's personal comments
from the APPRECIATE stage. The personal comments are the important part — they are what
makes the message not generic. Pass them prominently.

Return drafts as plain text the user edits in a textarea. Do not render AI output as
final content anywhere.

---

## Tests

| Test | Asserts |
|---|---|
| `no-client-keys.test.ts` | No `NEXT_PUBLIC_ANTHROPIC` or `NEXT_PUBLIC_OPENAI` anywhere; AI modules are not importable client-side |
| `system-prompt.test.ts` | Assembles all three layers in order; cache breakpoint sits before retrieved chunks |
| `chunking.test.ts` | Overlap correct; paragraph boundaries respected; a document shorter than one chunk yields one chunk |
| `retrieval-scoping.test.ts` | Retrieval never returns chunks from another ward or an inactive document |
| `similarity-floor.test.ts` | Weak matches are excluded |
| `ai-error-handling.test.ts` | Rate limit, refusal, and `max_tokens` each surface a distinct actionable message |
| `settings-versioning.test.ts` | Save appends; restore creates a new version; history is never destroyed |
| `no-autosave.test.ts` | No AI route writes generated content to a domain table |

The last one is the important one. Assert structurally that `/api/topics/ai-suggest`
inserts nothing into `topics`, and `/api/assignments/[id]/ai-message` does not set
`notify_message`.

---

## Definition of Done

**Closed 2026-08-24 when `ai-c` landed.** Ticked where it is true, and stated plainly where it is
not — an unticked box with a reason is worth more than a ticked one that is aspirational.

- [x] Claude client with correct model, adaptive thinking, effort, and error handling — `ai-a`,
      six distinct error kinds pinned by `tests/lib/aiErrorHandling.test.ts`
- [x] System prompt assembles all three layers with a correct cache breakpoint — `ai-a`. The
      breakpoint sits on the LAST STABLE block with retrieved chunks after it
- [ ] Standard works ingested via script; chunk count and embedding coverage verified — **the
      script ships and is tested; the ingest RUN is an operational step, not a code deliverable.**
      `npm run knowledge:ingest` works under plain Node (`ai-b`) and scenario 023 walks the
      result. Whether a given database has been ingested is a fact about that database
- [x] Document upload, list, activate/deactivate, delete all work — `ai-b`, walked as scenario 022
- [x] Retrieval returns ward-scoped, active-only, similarity-floored chunks — `ai-b`, with
      `tests/rls/retrieval-scoping.test.ts` and `tests/lib/similarityFloor.test.ts` behind it
- [x] AI settings panel with all seven sections, versioning, history, restore, and preview —
      `ai-a`, walked as scenario 020
- [x] Topic suggestions land in an accept/reject queue, never the library directly — `ai-c`.
      `tests/routes/ai-suggest.test.ts` counts `topics` rows either side of a generation,
      including one that fails
- [x] Confirmation and thank-you drafting wired into the Phase 4 pipeline — `ai-c`, into the two
      textareas `buildConfirmationMessage` and `buildThankYouMessage` already filled. Neither
      route writes a column; approving is still the only thing that saves
- [x] Suggestions cite sources — `CITATION_INSTRUCTION` is composed into every module block, and
      a topic candidate carries scripture references and talk citations as checkable strings
- [x] Keys never reach the browser — `lib/ai/client.ts` and `lib/ai/embed.ts` both throw at
      import time in a browser, asserted by `tests/lib/aiClientKeys.test.ts`. The phase's tests
      are **seventeen** files, not the eight this plan estimated — the four `ai-c` added took the
      count past it

---

## Pitfalls

- **Ingesting the standard works through an HTTP route.** It will time out. Use a script
  or a long-running Edge Function.
- **Embedding-model mismatch.** Query and documents must use the same model. Mixing them
  produces retrieval that looks like it works and quietly returns noise.
- **Cache breakpoint after the chunks.** Retrieved chunks change per request; anything
  after the breakpoint invalidates it. Stable content first, always. Verify with
  `usage.cache_read_input_tokens` — if it stays zero across identical-prefix calls,
  something volatile is above the breakpoint.
- **Sending whole documents.** Both a cost problem and a quality problem. Retrieval
  exists precisely to avoid it.
- **Over-prescriptive prompts.** Current models follow instructions closely; step-by-step
  scripts and emphatic ALL-CAPS directives degrade output. State the goal and constraints.
- **Silent AI failure.** A `catch` returning an empty draft looks like the model produced
  nothing. Distinguish the error cases and say which one happened.
- **Treating AI output as authoritative.** This app generates doctrinal and pastoral
  content. Human review is a product requirement, not a safety net. Never build a path
  that skips it.
