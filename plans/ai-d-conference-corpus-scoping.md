# Plan: AI D — Conference Corpus Scoping and Suggestion Frequency

**Created:** 2026-08-23
**Type:** feature
**Structure:** Sequential — plan 4 of 4 for Phase 5 ([05-ai-platform.md](05-ai-platform.md))
**Depends on:** [ai-b-knowledge-and-retrieval.md](ai-b-knowledge-and-retrieval.md) — executed and merged.
`ai-c` may land before or after this; see **Ordering** below.
**Scopes:** [ITER-011](../.iterate/scopes/ITER-011.md), [ITER-012](../.iterate/scopes/ITER-012.md)

---

## Overview

`ai-b` shipped a corpus with exactly one lever: a document is active or it is not. That is right for
five volumes of scripture and unusable for a hundred and fifty conference talks. This plan gives the
bishopric a way to say **which** talks count as reference, without managing them one at a time.

Five pieces:

1. **Metadata** — `speaker`, `speaker_role`, and `conference_date` on `knowledge_documents`, because
   you cannot filter on what you did not store.
2. **A filtered search function** — `match_document_chunks` gains filter parameters, and the filter
   applies to conference talks **only**.
3. **The scoping panel** — one recency control, a set of speaker-role checkboxes, and the ward's
   saved custom filters, stored in `ai_settings.conference_preferences`.
4. **The filter resolver** — type "talks by prophets", see what it resolved to, accept it, and from
   then on it is a deterministic WHERE clause with no model in the loop.
5. **Conference ingest** — a human-triggered script that captures the metadata at upload time, plus
   the suggestion log that ITER-012's display will read months from now.

**Success criteria**

- A bishopric member sets "last 2 years, apostles and prophets" once, and every topic suggestion
  from then on respects it with nothing further to press.
- **Setting a recency filter does not remove the standard works from retrieval.** This is the
  failure this plan is most likely to ship, and Task 2 exists to make it unrepresentable.
- Typing "talks by President Nelson" produces a filter the user can read before accepting; typing
  "talks about the temple" is refused with an explanation that it is already how retrieval works.
- Ingesting a conference records the speaker and date for every talk without anyone typing them.
- Every retrieval writes a suggestion row, whether or not anything displays it yet.

---

## Ordering

The plan reads `ai_settings.conference_preferences` **inside `retrieveChunks`**, not through a new
parameter every caller must pass. That is deliberate: it means `ai-c`'s routes get ward scoping with
**no edit**, and this plan can land before or after `ai-c` without either one blocking the other.

The optional `filters` argument added in Task 6 is for per-request overrides — today only the
Retrieval Tester uses it. If you find yourself editing an `ai-c` route to pass filters through,
stop: the ward default is supposed to arrive on its own.

---

## Relevant Files

### Create

| File | What it does |
|---|---|
| `supabase/migrations/033_knowledge_metadata.sql` | Metadata columns, the filtered `match_document_chunks`, indexes |
| `supabase/migrations/034_retrieval_filters.sql` | `retrieval_filters` and `retrieval_suggestions` tables + RLS |
| `lib/knowledge/conferenceMetadata.ts` | **Pure.** Speaker-role vocabulary, conference-date parsing, labels |
| `lib/knowledge/filterResolution.ts` | **Pure.** The resolved-filter shape and its validity rules |
| `lib/knowledge/filterQueries.ts` | `retrieval_filters` reads and writes |
| `lib/knowledge/suggestionLog.ts` | `recordSuggestions()` — write-only in this plan |
| `lib/ai/resolveFilter.ts` | The one Claude call: phrase to proposed filter |
| `app/api/knowledge/filters/route.ts` | GET list, POST save |
| `app/api/knowledge/filters/[id]/route.ts` | DELETE |
| `app/api/knowledge/filters/resolve/route.ts` | POST — propose, never save |
| `app/(app)/knowledge/ScopePanel.tsx` | Client — recency, roles, saved filters |
| `app/(app)/knowledge/FilterResolver.tsx` | Client — the phrase box and its accept/reject |
| `supabase/scripts/ingestConference.ts` | Human-triggered conference ingest |

### Modify

| File | Change |
|---|---|
| `lib/ai/retrieve.ts` | Read ward scope; pass filters to the RPC; call `recordSuggestions()` |
| `lib/knowledge/queries.ts` | Carry the three metadata columns through reads and writes |
| `lib/validation/knowledge.ts` | Schemas for the scope panel, filter save, and resolve |
| `lib/validation/aiSettings.ts` | `conference_preferences` gains the scope shape |
| `types/domain.ts` | `SpeakerRole`, `ConferenceScope`, `ResolvedFilter`, `SavedFilter` |
| `app/(app)/knowledge/page.tsx` | Mount `ScopePanel` and `FilterResolver` |
| `app/(app)/knowledge/UploadForm.tsx` | Speaker and conference-date fields when the tag is `general_conference` |
| `app/(app)/knowledge/DocumentList.tsx` | Show speaker and conference date |
| `package.json` | `knowledge:ingest-conference` script |
| `SPEC.md` | The three new routes; the `conference_preferences` shape |

---

## Known Pitfalls (from retro context)

**`foundation-b-schema` — a missing function grant reads exactly like an RLS failure.** Task 2 must
`drop function` before recreating it with the new parameters (adding parameters with defaults creates
an *overload*, and the old three-argument call then becomes ambiguous). Dropping discards the
`grant execute` from migration 031. **Re-issue it in the same migration.** A retrieval that fails
with a permission error after this ships is almost certainly this and not a policy.

**`role-access-overrides` — `can()` takes resolved role access as a required third argument.** All
three new routes are `knowledge.manage`. Resolve once per request into a local and pass it down;
`cache()` does not dedupe it in a route handler.

**`ai-a-client-and-settings` — `router.refresh()` preserves client state.** Saving a filter and
calling `router.refresh()` will re-render the server component while `FilterResolver` keeps its old
form state, exactly as the settings form went stale after a restore. Clear the phrase box explicitly
on a successful save rather than trusting the refresh.

**`talks-c-prayers-topics` — render NOTHING rather than "Never".** This applies directly to
ITER-012: a document suggested once has no meaningful frequency, and "1 of 1 (100%)" is worse than
silence. The rule established for the last-prayed nudge is the rule here.

**`ai-b` — a weak chunk is worse than no chunk.** A filter that narrows the corpus to almost nothing
does not lower the similarity floor. If a ward scopes to one speaker in one year, most queries will
correctly return `[]` and the prompt will omit layer 3. That is working, not broken, and the UI has
to say so — see Task 8.

---

## Tasks

### Task 1: Metadata columns

**File:** `supabase/migrations/033_knowledge_metadata.sql` (create, first half)

Three nullable columns on `knowledge_documents`: `speaker text`, `speaker_role text` with a CHECK
over `prophet` / `apostle` / `seventy` / `presiding_bishopric` / `auxiliary` / `other`, and
`conference_date date`.

All three nullable, and nullable is load-bearing: every document that exists today — the standard
works included — has none of them, and must keep retrieving exactly as it does now.

`conference_date` holds the **first day of the conference month** (`2026-04-01`), not a timestamp
and not a year integer. A date sorts and compares with the same operators the rest of the schema
uses, and it survives a ward that later wants to distinguish April from October.

**`speaker_role` is the role held when the talk was given**, not the speaker's current calling. A
talk given in 2015 by a member of the Twelve who now presides is `apostle`. See **Open Questions**.

Index for the filter: `(ward_id, type_tag, conference_date desc)`.

---

### Task 2: The filtered search function

**File:** `supabase/migrations/033_knowledge_metadata.sql` (create, second half)

**This is the task most likely to ship a bug, and the bug is silent.**

A naive `d.conference_date >= filter_since` removes every document whose `conference_date` is null —
which is the entire standard works. The ward sets "last two years" to narrow their conference talks
and quietly loses the Book of Mormon from every suggestion. Nothing errors. The drafts just get
worse.

**The filter applies to `general_conference` documents and to nothing else.** Drop the three-argument
function and recreate it with `filter_since date`, `filter_speaker_roles text[]`, and
`filter_speakers text[]`, all defaulting to null. Keep migration 031's select list, join, and
`order by` byte-for-byte; the only addition is a predicate of this shape:

- `d.type_tag is distinct from 'general_conference'` — **or** —
- every non-null filter matches (`filter_since is null or d.conference_date >= filter_since`, and
  the two `= any (...)` clauses guarded the same way).

`is distinct from` rather than `<>`: a null `type_tag` is an `other` document and must pass the
filter, and `null <> 'general_conference'` evaluates to null, which fails the `or`.

Then **re-issue the grant** for the new six-argument signature to `authenticated, service_role`.

**`SECURITY INVOKER` still, for the reason migration 031 spells out.** The new parameters are more
things a caller could lie about; RLS remains the boundary. `tests/rls/retrieval-scoping.test.ts`
already asserts a foreign `match_ward_id` returns nothing — that assertion must keep passing
unchanged, and Task 11 adds the filter equivalents beside it.

---

### Task 3: The tables behind saved filters and the suggestion log

**File:** `supabase/migrations/034_retrieval_filters.sql` (create)

**`retrieval_filters`** — `id`, `ward_id`, `label`, `source_phrase`, `speaker_roles text[]`,
`speakers text[]`, `since date`, `created_by`, `created_at`. Composite `unique (id, ward_id)` and the
composite FK to `users (id, ward_id)`, matching migration 014's pattern.

`source_phrase` keeps what the user typed. Six months on, "Prophets, last 5 years" is a filter
somebody has to reverse-engineer; the phrase that produced it is the explanation.

`unique (ward_id, label)` because two filters called the same thing in one checkbox list is a bug
report waiting to happen. The route turns the constraint violation into a sentence rather than a 500.

**`retrieval_suggestions`** — `id`, `ward_id`, `run_id uuid`, `module`, `document_id`, `created_at`,
with the composite FK to `knowledge_documents (id, ward_id) on delete cascade`. Indexes on
`(ward_id, document_id, created_at desc)` and `(ward_id, run_id)`.

`run_id` is generated once per `retrieveChunks` call and shared by every document that call returned.
It is what makes "appeared in 8 of your last 20 generations" answerable — without it you can count
appearances but you cannot count the runs to divide by.

**This table stores document ids and timestamps. It never stores the query, the prompt, or the
generated text** — the same rule `ai-c` applies to its audit rows.

RLS on both: ward-scoped select for `authenticated`, insert on `retrieval_suggestions` for the
ward's own members, `knowledge.manage` roles only for writes to `retrieval_filters`. Follow the
policy shape in migration 019; do not invent a new one.

---

### Task 4: The pure metadata module

**File:** `lib/knowledge/conferenceMetadata.ts` (create)

Exports `SPEAKER_ROLES` (matching the CHECK constraint exactly — a mismatch here is a 400 nobody can
diagnose from the UI), `SPEAKER_ROLE_LABELS` as a `Record`, and:

- `parseConferenceDate(input: string): string | null` — accepts `"April 2026"`, `"2026-04"`,
  `"2026-04-01"`; returns the first of the month or null. Never throws.
- `formatConferenceDate(value: string): string` — `"April 2026"`.
- `RECENCY_OPTIONS` — the standing set, as `{ label, years }`. Two, five, ten, and "no limit".

**Recency is one axis and gets one control.** Checkboxes for "last 2 years" and "last 5 years" are
ambiguous the moment both are ticked. This is a single select; speaker roles are the checkboxes.

---

### Task 5: Filter resolution — the pure half

**File:** `lib/knowledge/filterResolution.ts` (create)

`ResolvedFilter` is a discriminated union with three arms:

- `{ kind: "filter", label, speakerRoles?, speakers?, since? }`
- `{ kind: "semantic", explanation }`
- `{ kind: "unresolvable", explanation }`

**The middle arm is the point of the feature.** The corpus can be filtered by *who spoke and when*.
It cannot be filtered by what a talk is about — that is what the vector search already does on every
single call. A user typing "talks about the temple" is asking for something they are already
getting, and building them a metadata filter from it would produce a filter that matches nothing
while looking like it works.

Also exports `isApplicable()` as a type guard and `describeFilter(filter): string`, which renders a
filter as the sentence shown before accepting. Both pure, both tested without a database or a model.

---

### Task 6: Retrieval reads the ward's scope

**File:** `lib/ai/retrieve.ts` (modify)

`retrieveChunks(query, wardId, options)` gains three optional fields on `options`: `settings`
(an already-loaded `AiSettings`), `filters` (a per-request `ConferenceScope` override), and `module`
(a label for the suggestion log, defaulting to `"unknown"`).

Resolution order: `options.filters` → `options.settings.conferencePreferences` → load the active
settings → the empty scope, which filters nothing.

**Pass `settings` when you already have it.** `ai-c`'s topic route loads `getActiveAiSettings` in
parallel already; not passing it means a second round trip for a row that is in memory. Not passing
it is still *correct*, which is what keeps this change non-breaking.

After the floor is applied, call `recordSuggestions()` with a fresh `run_id` and the distinct
document ids that survived. **The suggestion write must not be able to fail a retrieval** — a
logging table taking down topic generation is a bad trade. Catch, log server-side, continue. This is
the one place in the codebase where swallowing is correct, and the comment must say why, or a future
reader will correctly read it as a §7 violation.

`applySimilarityFloor` and `clampMatchCount` do not change.

---

### Task 7: The resolver route and its one Claude call

**Files:** `lib/ai/resolveFilter.ts`, `app/api/knowledge/filters/resolve/route.ts` (create)

POST, `knowledge.manage`. Body: `{ phrase: string }`.

Uses `callClaudeStructured` with `zodOutputFormat(resolvedFilterSchema)` and
`output_config: { effort: "low" }`. This is vocabulary-matching against a fixed enum, not a judgment
call — `low` is right, and it keeps the panel responsive.

The system prompt is **not** `buildSystemPrompt`. This call has nothing to do with the ward's tone or
doctrinal settings; it is a parser. Give it the speaker-role vocabulary, the fact that
`conference_date` is the only date available, and the instruction to return `semantic` for anything
about subject matter.

**This route saves nothing.** It returns a proposal. The user reads `describeFilter()`, then POSTs to
`/api/knowledge/filters` to accept it. Same shape as `topic_candidates`: propose, show, accept — the
CLAUDE.md rule 3 pattern, applied to a filter instead of a topic.

Audit as `retrieval_filter_resolved` with the phrase and the resulting `kind`. The phrase is the
user's own words about their own corpus, not generated content — logging it is fine, and it is what
makes a confusing result diagnosable later.

---

### Task 8: The scope panel

**File:** `app/(app)/knowledge/ScopePanel.tsx` (create)

Three regions on one card:

1. **Recency** — one select, `RECENCY_OPTIONS`, defaulting to "no limit".
2. **Speaker roles** — checkboxes, all-unchecked meaning **no restriction** rather than nothing.
   That distinction has to be on screen; an empty checkbox group that silently means "everything" is
   the same trap as an empty `WHERE ... IN ()`.
3. **Saved filters** — the ward's `retrieval_filters` as checkboxes, each with a delete control and
   its `source_phrase` as the secondary line.

Under all three, a live count: **"Currently scoped to 47 of 152 conference talks. The standard works
are always included."** That sentence is the whole feature's honesty. It is the difference between a
user who trusts the panel and one who wonders whether it did anything, and it is the only place the
standard-works exemption from Task 2 becomes visible to a human.

When the count reaches zero, say so plainly and say what it means — suggestions will fall back to
scripture only. Per the `ai-b` pitfall above, that is a legitimate state, not an error.

Saving writes to `ai_settings`. **`ai_settings` is append-only** — a scope change is a new version,
exactly like every other settings change, and it shows up in the existing version history. Do not
add an update path; `lib/ai/queries.ts` has none on purpose.

---

### Task 9: Conference ingest

**Files:** `supabase/scripts/ingestConference.ts`, `package.json` (create/modify)

    npm run knowledge:ingest-conference -- --source <dir|manifest> --ward <uuid> --conference 2026-10

**Read CLAUDE.md §9 before building any fetching half.** The decision recorded there is that
acquisition is human-triggered, and that automated bulk downloading is gated on the source's terms of
use. This script ingests **files already on disk**, plus a manifest naming speaker and role per file.
If a fetching step is added later it goes behind an explicit confirm and is a separate task, not a
flag on this one.

Reuses `lib/knowledge/ingest.ts` unchanged — parse, chunk, embed, insert. What it adds is populating
the three metadata columns, which is the entire reason this script exists rather than 35 trips
through `UploadForm`.

Same guarantees `ingestStandardWorks.ts` established: progress printed rather than silence, a refusal
on a second run naming the existing document, a malformed record failing immediately with its index
before any embedding is spent, and a non-zero exit on that failure.

**The metadata columns are worthless unless this fills them.** A conference ingested through the
generic upload path lands with three nulls and is invisible to every filter — which, per Task 2,
means it is silently *always included*. Task 10 makes that not silent.

---

### Task 10: Upload form and document list

**Files:** `app/(app)/knowledge/UploadForm.tsx`, `DocumentList.tsx` (modify)

When the type tag is `general_conference`, the form reveals speaker, role, and conference date.
Required in that branch — an unlabelled conference talk is a document no filter can reach.

`DocumentList` shows speaker and formatted conference date under the title, and badges any
`general_conference` document missing metadata as **"Not filterable"** with a link to fix it. That
badge is Task 9's silent-inclusion problem made visible.

---

### Task 11: Tests

| File | Kind | Asserts |
|---|---|---|
| `tests/lib/conferenceMetadata.test.ts` | pure | Date parsing; the role vocabulary matching the CHECK |
| `tests/lib/filterResolution.test.ts` | pure | The three outcomes; `describeFilter` sentences |
| `tests/db/retrieval-filters.test.ts` | real DB | **The scripture-survival case** |
| `tests/rls/retrieval-filter-access.test.ts` | RLS | Ward isolation on both new tables |
| `tests/routes/knowledge-filters.test.ts` | route | List, save, delete, duplicate label, 403 |

**`retrieval-filters.test.ts` is the highest-value file in this plan.** Seed one ward with a
standard-works document (null metadata) and four conference talks across two years and two roles.
Insert deterministic unit vectors with the service client exactly as `ai-b`'s scoping suite does, so
there is no OpenAI call and no flakiness. Then assert:

- a `filter_since` covering only the recent talks **still returns the standard-works chunk**;
- a `filter_speaker_roles` of `{apostle}` **still returns the standard-works chunk**;
- a conference talk outside the window does not appear;
- a conference document with **null** `speaker_role` is excluded by a role filter and included when
  there is none — the "not filterable" case behaving predictably in both directions;
- all three filters null returns exactly what migration 031's three-argument version returned.

That last assertion is the regression gate. If it fails, the rewrite in Task 2 changed *unfiltered*
behaviour, and every existing retrieval test is now testing something different.

---

## Test Scenarios (Harness)

> 022 and 023 belong to `ai-b`. Check `testing/scenarios/manifest.json` before numbering.

### Scenario 024: Scoping the corpus

**Tags:** `ai`, `knowledge`, `full`
**Purpose:** The count sentence and the standard-works exemption are the two things no unit test can
judge. A test can prove scripture survives a recency filter; only a person can tell you whether the
panel made them *believe* it would.

**Seed data summary** — one ward, bishop and `ward_secretary`; one standard-works document with ~10
chunks; 12 conference talks across four conferences and three speaker roles, with deterministic
embeddings.

**Verification checklist**
- [ ] The count sentence updates as the recency select changes, before saving
- [ ] The sentence states that the standard works are always included
- [ ] Setting "last 2 years" and running the Retrieval Tester **still returns scripture passages**
- [ ] Unchecking every speaker role means no restriction, and the panel says so
- [ ] A scope matching zero talks explains what will happen rather than reading as an error
- [ ] Saving a scope adds a row to the AI settings version history
- [ ] `ward_secretary` sees "Not permitted"
- [ ] Works at 375px and in both themes

### Scenario 025: Teaching it a filter

**Tags:** `ai`, `knowledge`, `full`
**Purpose:** The resolver's value is entirely in whether a person understands what it produced before
they accept it, and whether the "that is a search, not a filter" refusal teaches rather than blocks.

**Seed data summary** — the scenario 024 corpus, plus two filters already saved so the checkbox list
is populated and a duplicate label is reachable.

**Tester action:** As the bishop, type in turn: a speaker name, a role phrase, a subject phrase, and
something nonsensical.

**Verification checklist**
- [ ] A speaker name resolves, and the sentence shown names the speaker
- [ ] "talks by prophets" resolves to the role, not to a list of names
- [ ] **A subject phrase is refused with an explanation that retrieval already does this** — and the
      explanation is one a bishopric member would find convincing, not a validation error
- [ ] Nonsense is refused without a stack trace and without saving anything
- [ ] Accepting adds a checkbox; the phrase typed is visible on the saved filter
- [ ] A duplicate label is refused with a sentence, not a 500
- [ ] Deleting a filter removes the checkbox and does not touch the documents
- [ ] Rejecting a proposal leaves nothing behind — re-open the panel and confirm
- [ ] The phrase box clears after a successful save (see the `ai-a` pitfall)

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

`db:push` before `db:types` before everything else — `match_document_chunks` changes signature, and
`retrieve.ts` will not typecheck against the old generated type. `db:push` does **not** wipe the
hosted database; `db:reset` does. Do not run `db:reset`.

---

## Integration Notes

- **`buildSystemPrompt` does not change.** Again. It receives whatever chunks survive the filter.
- **`ai-c` does not change** — see **Ordering**. The ward scope arrives inside `retrieveChunks`.
- **ITER-012's display is not in this plan.** The `retrieval_suggestions` table and its writes are,
  because telemetry cannot be backfilled: every week without the write is a week of missing history.
  The percentage UI is a separate, cheap piece of work whenever it is wanted.
- **Handed to Phase 6:** hymn suggestions retrieve through the same function and inherit ward scoping
  with no work. Worth checking that a scope tuned for talks does not starve hymn suggestions — they
  retrieve from the same corpus.
- **Documentation:** SPEC.md gains three routes and the `conference_preferences` shape; FEATURES.md
  Module 5 gains the scoping section, and Module 6's "Conference Talk Preferences" line becomes real.

---

## Open Questions

1. **What does "talks by prophets" mean?** Talks given *while serving* as President of the Church,
   or talks by anyone who ever held that office? The schema stores role-at-time-of-talk, which
   answers the first. The second is what many users will mean. Decide before the resolver's prompt is
   written, because the prompt has to state one of them.
2. **Does a saved filter combine with the recency select by AND or OR?** AND is the safe default and
   matches "narrow the corpus". But a user who saves "President Nelson" and sets "last 2 years"
   probably means "and also his older talks". The panel must state which it does, in words.
3. **Should the scope apply to the Retrieval Tester by default?** Testing against the scope is the
   honest preview; testing against everything is more useful for deciding what the scope should be.
   A toggle is likely right, and its default is a real choice.
4. **Is `speaker` free text or a controlled list?** Free text is simpler and lets a misspelling
   create a filter matching nothing. A controlled list derived from what has been ingested is better,
   and needs a distinct-values read the panel can populate from.
