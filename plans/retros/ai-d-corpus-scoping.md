---
id: ai-d-corpus-scoping
type: feature
iter: ["ITER-011"]
commits: ["d96b83d"]
date: 2026-08-24
files:
  - supabase/migrations/033_knowledge_metadata.sql
  - supabase/migrations/034_retrieval_filters.sql
  - supabase/migrations/035_retrieval_filters_empty_array.sql
  - lib/knowledge/conferenceMetadata.ts
  - lib/knowledge/filterResolution.ts
  - lib/knowledge/filterQueries.ts
  - lib/knowledge/suggestionLog.ts
  - lib/ai/resolveFilter.ts
  - lib/ai/retrieve.ts
  - lib/validation/knowledge.ts
  - lib/validation/aiSettings.ts
  - app/api/knowledge/filters/route.ts
  - app/api/knowledge/filters/[id]/route.ts
  - app/api/knowledge/filters/resolve/route.ts
  - app/(app)/knowledge/ScopePanel.tsx
  - app/(app)/knowledge/FilterResolver.tsx
  - app/(app)/knowledge/UploadForm.tsx
  - app/(app)/knowledge/DocumentList.tsx
  - app/(app)/ai-settings/AiSettingsForm.tsx
  - supabase/scripts/ingestConference.ts
  - types/domain.ts
related:
  - ai-a-client-and-settings
  - ai-b-knowledge-and-retrieval
  - ai-c-feature-routes
  - foundation-b-schema
  - role-access-overrides
  - talks-c-prayers-topics
---

## What was done

Gave the bishopric a way to say **which** conference talks count as reference, without managing
them one at a time. `knowledge_documents` gained `speaker`, `speaker_role` and `conference_date`;
`match_document_chunks` gained three filter parameters that apply to `general_conference`
documents and to nothing else; a scope panel on `/knowledge` renders a live count from the same
predicate the database runs; and a resolver turns a typed phrase into a filter the user reads and
accepts before anything is stored. `retrieval_suggestions` ships written-but-unread, because
ITER-012's percentages cannot be backfilled.

**ITER-011 is closed. ITER-012 is not, and is not half-closed either.** Its scope file defines
that scope as *the display only* — `retrieval_suggestions` and its writes were always specified to
ship inside ITER-011, because suggestion history cannot be backfilled. So what this commit does for
ITER-012 is satisfy its blocking dependency: the table now exists and is being written to, and the
percentage UI can be built whenever it is wanted, over real history rather than an empty table.

## Key decisions

- **The filter applies to conference talks and to nothing else, enforced in SQL rather than in
  the caller.** A naive `conference_date >= filter_since` removes every row whose date is null —
  the entire standard works — so a ward narrowing its conference talks would silently lose the
  Book of Mormon from every suggestion, with nothing erroring. The predicate branches on
  `type_tag is distinct from 'general_conference'` first. `is distinct from` rather than `<>`,
  because `null <> 'x'` is NULL and would drop every untagged document too.
- **Four open questions in the plan were decided before any code was written**, because each
  changed the resolver's prompt or the merge rule: a calling means the one held *at the time of
  the talk* (the only reading the column can answer); everything narrows together, unioning within
  an axis and intersecting across them; the Retrieval Tester is scoped by default with a toggle;
  and the speaker field is free text with a datalist of names already ingested.
- **The scope arrives inside `retrieveChunks` rather than through a new parameter**, so `ai-c`'s
  two routes inherited ward scoping with no edit. They were touched only to pass settings they had
  already loaded and a label for the suggestion log.
- **`maxYearsOld` and `scope.sinceYears` are two different things on two different screens**, and
  both say so in words. One is prose asking the model to prefer recent talks among what it was
  given; the other is a SQL filter deciding what it can find. Shipping them without naming the
  difference would have left a bishopric with two recency controls it could not tell apart.
- **`scope` is nullable with a default of null in the Zod schema**, which is load-bearing rather
  than lazy: `lib/ai/queries.ts` parses stored rows through that schema, and a required field
  would have failed the parse on every pre-`ai-d` row and silently discarded every ward's existing
  conference preferences.

## What went wrong, and what caught it

- **Migration 034's empty-array guard shipped inert.** It used
  `array_length(speaker_roles, 1) > 0`, and `array_length` returns **NULL** on `'{}'`, not 0 — a
  CHECK constraint passes on NULL, so an empty array stored happily. That is the same
  null-propagation class the standard-works exemption exists to prevent, in the constraint written
  to prevent it. It matters because `= any ('{}')` matches nothing: such a filter would return
  zero documents while reading everywhere as "no restriction". Fixed in **035** with
  `cardinality()`, which returns a real 0. Caught by `tests/rls/retrieval-filter-access.test.ts`,
  which inserts an empty array with the service client and expects a refusal. Nothing in the app
  could reach that state — Zod and `mergeConferenceScope` both refuse it first — but a third line
  of defence that does not hold is worse than an absent one, because it is believed.
- **The plan's scenario numbers were already taken.** It reserved 024 and 025; `ai-c` landed after
  the plan was written and used both. They became **026** and **027**. Check
  `testing/scenarios/manifest.json` before numbering, every time — the plan said so and was still
  wrong about its own numbers.
- **`AiEffort` had to be widened to include `"low"`.** `ai-a` shipped `"medium" | "high"` only.
  The resolver is vocabulary-matching against a fixed enum, not a judgment about a ward, and it
  has to stay responsive under typing. The type carries a note that no drafting call may borrow it.
- **Two settings paths would have silently erased the scope.** `AiSettingsForm` rebuilds the whole
  `conference_preferences` object from draft state on save, and the restore route copies a version
  forward — neither knew about `scope`, so saving the AI settings form or restoring an old version
  would have wiped a ward's corpus scope with nothing on either screen to suggest it. Caught by
  the compiler, because the field is required on the domain type. This is CLAUDE.md rule 9 working
  in the direction it was written for.

## Still open

- **`supabase/scripts/ingestConference.ts` has never been executed.** It needs a manifest plus real
  files on disk, so neither Vitest nor the harness reaches it. It follows `ingestStandardWorks.ts`
  closely and typechecks; that is the whole of what can honestly be claimed for it.
- **The resolver route has never been executed either.** `tests/routes/knowledge-filters.test.ts`
  deliberately excludes it because it spends an Anthropic call, so
  `buildFilterResolverPrompt → callClaudeStructured → zodOutputFormat → toResolvedFilter` is
  unexercised. Scenario 027 exists to walk exactly that path. **Both scenarios recorded as
  "Not yet walked".**
- **The full suite is flaky under load against the shared hosted project.** `npm test` (113 files,
  28 minutes) failed two pre-existing RLS suites on **timeouts** —
  `ai-settings-access` (`beforeAll` hook, 478 s) and `topic-candidates` (one test, 30 s). Both pass
  in isolation in 39 seconds together. Not a defect and not caused by `ai-d`, but the failure mode
  is worth knowing: it reads as a broken suite and is network contention.
