---
id: ai-b-knowledge-and-retrieval
type: feature
iter: null
commits: []
date: 2026-08-24
files:
  - supabase/migrations/031_knowledge_search.sql
  - supabase/migrations/032_knowledge_storage.sql
  - lib/knowledge/chunk.ts
  - lib/knowledge/parseDocument.ts
  - lib/knowledge/ingest.ts
  - lib/knowledge/queries.ts
  - lib/ai/embed.ts
  - lib/ai/retrieve.ts
  - lib/validation/knowledge.ts
  - app/api/knowledge/upload/route.ts
  - app/api/knowledge/documents/route.ts
  - app/api/knowledge/documents/[id]/route.ts
  - app/api/knowledge/search/route.ts
  - app/(app)/knowledge/page.tsx
  - app/(app)/knowledge/UploadForm.tsx
  - app/(app)/knowledge/DocumentList.tsx
  - app/(app)/knowledge/RetrievalTester.tsx
  - supabase/scripts/ingestStandardWorks.ts
  - supabase/scripts/register.mjs
  - types/domain.ts
related:
  - ai-a-client-and-settings
  - foundation-c-services
  - route-tests-and-realtime
  - roster-c-csv-import
---

## What was done

Layer 3 of the system prompt turned on: the knowledge base that every later AI feature quotes from.
Documents are uploaded through the app or loaded from the command line, chunked, embedded with
OpenAI `text-embedding-3-small`, and retrieved by cosine similarity through a
`match_document_chunks` RPC behind an HNSW index. The `/knowledge` page manages the corpus and
carries a Retrieval Tester that shows a bishopric exactly what the model will receive.

Four route handlers, a 456-line queries module, a standard-works ingest script that runs under
plain Node, and two harness scenarios. 1421 tests across 102 files, lint and typecheck clean, and a
production build that resolves `/knowledge` and all four API routes.

## Key decisions

**HNSW, not ivfflat — a deliberate deviation from the phase plan.** `05-ai-platform.md` specified
ivfflat and instructed that the index be built *after* ingestion, because ivfflat trains its
centroids on the rows present at build time. HNSW needs no training step: it is correct on an empty
table and stays correct as rows arrive, with better recall at the same query cost. The plan's
"build it afterwards" step becomes unnecessary rather than forgotten — which is the real win, since
a deferred manual step is a step that eventually gets skipped. Migration 031 refuses to apply on a
database with no `hnsw` access method, so a pgvector older than 0.5.0 fails loudly at migrate time
instead of silently creating no index. The push confirmed the linked project has it.

**`JSON.stringify(embedding)` for the RPC parameter.** The plan called this the single most likely
thing to need a correction during execution. It needed none: `db:types` generated
`query_embedding: string`, confirming that pgvector's wire format over PostgREST is a string rather
than a float array. Worth remembering because the wrong guess here fails at runtime with a type
error that reads like a schema problem.

**`lib/knowledge/queries.ts` imports the server client dynamically**, alone among the queries
modules. `supabase/scripts/ingestStandardWorks.ts` runs under plain Node, where `next/headers`
cannot be imported at all — a static import would make the module unloadable from the very script
that shares its pipeline. The script also needs `supabase/scripts/register.mjs`, a ~20-line
resolver hook teaching Node the `@/*` alias. The alternative was duplicating the chunk-and-embed
pipeline for the script, which would have meant two implementations of the thing most likely to
drift.

**`unpdf` for PDF text extraction**, chosen over `pdf-parse` (unmaintained, and it reads a test
fixture from disk at import time, which breaks under bundling) and raw `pdfjs-dist` (worker
plumbing that differs between dev and Vercel). Extraction is lossy on multi-column and heavily
formatted layouts, so `parseDocument()` refuses anything under ~200 characters with a message
naming the likely cause. A scan therefore fails at upload rather than becoming a document with zero
useful passages — which is the failure that would be invisible until a bishop wondered why the AI
never quoted it.

**Partial embedding failure is reported as usable, not as failure.** A document where some passages
embedded and some did not shows both numbers ("6 passages, 5 embedded — 1 not searchable") and
stays active. Reporting total failure would invite a duplicate re-upload that fixes nothing.

## What the walkthrough found

**Scenario 022 was walked in two sessions.** The first was closed mid-step, seven minutes into the
walk, immediately after re-activating a document. The audit log settled what would otherwise have
been unknowable: the write committed at `02:52:50.948`, 1.4 seconds after the session ended. The
walk resumed against live state rather than re-seeding, which preserved three real uploads and the
embedding calls behind them. **This is the argument for auditing status changes and not just
creates and deletes** — the audit row was the only evidence that distinguished "the write landed"
from "the write was lost", and every other signal was ambiguous.

**One defect: the delete confirm read "all 1 of its passages".** The plural branch was
unconditional. It survived because scenario 022's step 8 deletes the *seeded* six-passage letter —
the one document in the fixture where the string reads correctly. Every document uploaded during
the walk chunked to exactly one passage, so a real bishopric would meet the singular case
constantly. Fixed with the codebase's existing inline `count === 1 ? … : …` idiom (about ten prior
instances; there is no shared helper and one was not introduced) and locked down by
`tests/components/knowledge/DocumentList.test.tsx`, which stubs `window.confirm` and asserts the
sentence rather than driving a browser dialog.

**The generalisable lesson: a fixture that only exercises the comfortable branch hides the
uncomfortable one.** The seeded corpus was designed to make *counts* interesting — 6 passages, 5
embedded — and that same choice made the singular case unreachable. When a fixture is built to
demonstrate a feature, check separately whether it can still reach the boundaries.

**Two checklist defects, both found by walking rather than by reading.** Scenario 022's step 8
deleted the one document with `file_url = null`, so `deleteDocument`'s `if (fileUrl)` branch — the
Storage removal — never ran; the step now deletes an uploaded document as well, and that path was
verified to leave no orphan. And "after the delete, that document's passages no longer appear in
any search" **could not fail as written**: the seeded embeddings are hand-written unit vectors that
match no English query, so every possible implementation satisfied it. Re-run against a genuinely
embedded document it became falsifiable, and passed.

**Scenario 023's volume-order check was backwards.** It required "**Book of Mormon** and **New
Testament**, in that (canonical) order". `STANDARD_WORKS` defines the canon as OT, NT, BoM, D&C,
PoGP, and the ingest script re-sorts to it deliberately rather than trusting the corpus file's
order — which the fixture exercises by listing Book of Mormon first. Read literally, the old
wording failed a correct run. The code was right; the checklist was wrong.

**Verified beyond the checklists.** Zero orphaned Storage objects after both refused uploads. The
oversize refusal is client-side and sends nothing (53 ms, no network request); the `.docx` and
blank-title refusals each cost one round trip and return 400 — all three correct, but a large
rejected `.docx` does upload its bytes before being told no. Deactivate/reactivate is a genuine
round trip at an identical score (0.405 → nothing → 0.405) with no rebuild.

**Not a defect, recorded so it is not re-reported:** the floating "N" badge that overlaps the first
document row at 375px is the Next.js dev-mode indicator (`NEXTJS-PORTAL`). It does not exist in a
production build.

## Handed forward

- **Four checks remain unwalked, deliberately.** The two `secretary` permission items were settled
  by code rather than by signing in, because a second account would put `HARNESS_TEST_PASSWORD`
  into a session transcript: `ward_secretary` holds no `knowledge.*` permission, the page returns
  `<NotPermitted>` without `knowledge.view`, and the sidebar entry is gated on the same permission.
  The two `OPENAI_API_KEY`-removed items need an edit to `.env.local`, which the permission layer
  refused and which was not worked around; the message is proven by
  `tests/lib/embedBatching.test.ts:191` but the live path still wants a human.
- **All 21 standard-works chunks are multi-part**, and every label names a full chapter range while
  carrying one slice of it (`Alma 32:1–25 (part 2 of 3)`). Splits do fall on verse boundaries and
  `(part n of m)` is honest, but no label narrows to the verses actually present. `ai-c` builds
  citations from these labels, so decide there whether a citation may point at a range wider than
  the text it accompanies.
- `npm run seed:clean` and a re-seed both drop document rows without removing objects from the
  `knowledge-documents` bucket. Two files from the 022 walk are currently orphaned in the harness
  ward's folder. Documented in scenario 022's notes; harmless, but it accumulates.
- **ITER-011** (choose which conference talks count as reference) and **ITER-012** (show how often
  a talk has been suggested) were raised alongside this work and are scoped in
  `plans/ai-d-conference-corpus-scoping.md`, added to Phase 5 as a fourth sub-plan orderable before
  or after `ai-c`.
