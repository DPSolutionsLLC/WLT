# Plan: Sacrament References over pgvector (P4 module 1, slice `c`)

**Created:** 2026-09-23
**Type:** feature
**Module-map row:** [prototype/module-map.md](prototype/module-map.md) §2.1 behaviours 1 and 2 (the References half of the finalize chain)
**Phase file:** [P4-module-reskins.md](P4-module-reskins.md) §1 — "Build the prototype's *UI* over WLT's *retrieval*"

## Overview

The prototype puts a **References** pill on every Sunday of the Sacrament calendar, directly after
Topics. Tapping it opens a modal with one section per talk that has a topic. In each section the
conductor searches for scriptures and conference talks, taps a result to attach it to that talk,
or types one in by hand. The day's references are then **finalized**, or **explicitly skipped**
("not giving references this round"). Either decision satisfies the gate that Talks finalize will
check in slice `f` (P5).

The prototype's search is keyword matching over uploaded text, because it has no backend. WLT
already has semantic retrieval (`retrieveChunks`, pgvector, HNSW, the ward's conference scope and
the similarity floor). This slice is the prototype's **UI** over WLT's **retrieval**.

### Decided with the user before planning (2026-09-23)

1. **The editor is a modal on the `/sacrament` hub**, opened from the References pill. This follows
   the prototype's own navigation (`HomeCalendar` → `ReferencesModal`, `prototype/WLT.jsx` ~5571 and
   ~5853). It is not a section on `/assignments/[sunday_id]` and not a new page.
2. **A topic change un-finalizes References.** A reference was chosen for a topic. Once that topic
   moves, "these references are ready" is no longer true. The reference **rows are kept**
   (decisions.md §1.1) and a **skip** decision survives, because "not giving references this
   round" has nothing to do with what the topics are.

### Key requirements

- Per-Sunday state: **open**, **finalized** or **skipped**. The three are distinct recorded states,
  and `skipped` is **not** an empty list (module-map §2.1 item 2).
- References attach to a **talk**, meaning an `assignments` row, never to a slot index.
- Semantic search runs server-side through `retrieveChunks`. The ward's saved conference scope
  applies automatically, and this is WLT's equivalent of the prototype's `conferenceTalkRange`
  setting, so **no new setting is added**.
- Search results are real citations drawn from the ward's own corpus, and a human taps each one to
  add it. **Nothing is generated**, and nothing reaches a row without that tap (rule 3).
- Manual entry is always available alongside search.
- Adding or removing a reference un-finalizes the day. Adding one also clears a skip.
- Finalizing requires at least one reference. Skipping requires none.
- The prototype label is `Refs N` / `Refs: skipped`. The pill carries the same attached checkmark
  as Topics.
- Bishopric-only writes (`talks.plan`). Anyone holding `talks.view` can open the modal read-only.

### Success criteria

- A bishopric member can open References from any Sunday with speaking slots, search, add, remove,
  type a reference, finalize, skip and undo, all at 375px and in both themes.
- The pill reads `Refs 0` (empty) → `Refs 3` (partial) → `Refs 3 ✓` (complete) → `Refs: skipped`
  (complete).
- Changing a finalized Sunday's topic (or adding a talk, or changing `speaking_slots`) returns
  References from finalized to open, and leaves a skip alone.
- A music coordinator sees the pill and can read the modal, with no controls. An org president
  cannot read `talk_references` at all.
- Lint, typecheck, tests and `npm run build` all pass. `explicitTimeZone.test.ts` stays green.

### Deliberately NOT in this slice

- **The Talks-finalize gate itself.** Talks finalize and to-dos are slice `f`, and they wait on P5.
  This slice records the state that gate will read and builds nothing that reads it.
- **Showing references on `/assignments/[sunday_id]` or in the programme.** Slice `f` carries them
  into the to-do.
- **Offering `topics.suggested_scriptures` as quick-add chips.** It would be cheap and useful, but
  it is a WLT addition the prototype does not have. Raise it at the walk.
- **Keyword search.** The module map says WLT can do better than keyword matching, and that is this
  slice's whole point.

## Relevant Files

**Create**
- `supabase/migrations/079_talk_references.sql`: the `talk_references` table, two `sundays`
  columns, a CHECK, RLS
- `lib/references/queries.ts`: server reads and writes on `talk_references`
- `lib/references/finalize.ts`: `unfinalizeReferencesIfNeeded()`, which never throws
- `lib/references/suggestions.ts`: **pure**, turns scored chunks plus document metadata into
  citable suggestions
- `lib/validation/references.ts`: Zod schemas shared by the routes and the modal
- `app/api/sundays/[id]/references/route.ts`: `GET` (the modal's data) and `POST` (add)
- `app/api/sundays/[id]/references/[referenceId]/route.ts`: `DELETE`
- `app/api/sundays/[id]/references/search/route.ts`: `POST` (semantic search)
- `app/api/sundays/[id]/references-decision/route.ts`: `PATCH` (finalize / skip / reopen)
- `components/sacrament/FinalizeToggle.tsx`: the attached checkmark, generalized (this is the
  second use)
- `components/sacrament/ReferencesPill.tsx`: a client component. The pill **button**, its
  checkmark, and the modal
- `components/sacrament/ReferencesEditor.tsx`: a client component. The modal body
- `tests/lib/referenceSuggestions.test.ts`
- `tests/rls/talk-references.test.ts`
- `tests/routes/talk-references.test.ts`
- `tests/components/sacrament/ReferencesEditor.test.tsx`
- `testing/scenarios/talks/scenario-074-references-finalize-and-skip/scenario.md` + `seed.ts`

**Modify**
- `types/database.ts`: regenerate (`npm run db:types`)
- `types/domain.ts`: `ReferenceKind`, `ReferenceSource`, `ReferencesDecision`, `TalkReference`
- `lib/calendar/queries.ts`: `Sunday` gains `referencesFinalizedAt` and `referencesSkippedAt`;
  `SUNDAY_COLUMNS` gains both; new `setReferencesDecision()` and `clearTalkShapeStamps()`
- `lib/topics/finalize.ts`: `unfinalizeTopicsIfNeeded()` clears **both** stamps (decision 2)
- `lib/sacrament/sundayStatus.ts`: a `references` pill; `SundayPill` gains `countText` and
  `spokenCount`; a required `references` input
- `components/sacrament/StatusPill.tsx`: renders `countText`/`spokenCount`; uses `FinalizeToggle`
- `components/sacrament/FinalizeTopicsButton.tsx`: becomes a thin wrapper over `FinalizeToggle`
- `components/sacrament/SundayCard.tsx`: renders `ReferencesPill` for the `references` key
- `app/(app)/sacrament/page.tsx`: loads reference counts and passes the new input plus
  `canPlanTalks`
- `tests/lib/sacramentSundayStatus.test.ts`, `tests/components/sacrament/SundayCard.test.tsx`: new
  pill
- `tests/lib/topicsFinalize.test.ts`: helper docs and assertions (see Task 13)
- `SPEC.md`: schema and API routes. `plans/prototype/module-map.md` §2.1 and
  `plans/P4-module-reskins.md` §1: mark slice `c` built

## Dependencies

- **No new libraries.**
- Reuse: `retrieveChunks` + `MAX_SEARCH_RESULTS` (`lib/ai/retrieve.ts`,
  `lib/validation/knowledge.ts`); `formatConferenceDate` (`lib/knowledge/conferenceMetadata.ts`);
  `speakerDisplayName` (`components/assignments/SpeakerLine.tsx`); `Modal`, `Pill`, `Button`,
  `Input`, `Chip`, `FormError` (`components/ui/*`); `writeAuditLog`; `assertCan`/`resolveRoleAccess`;
  `readJsonBody`/`respondToRouteError`; `requireSessionUser`.
- **An `OPENAI_API_KEY`** is already required by retrieval. Search fails with a sentence if it is
  missing (the `embedQuery` error path already does this).
- **Migration 079 is purely additive**, so it applies before the deploy and gets **no**
  `HELD_BACK_UNTIL_DEPLOYED` entry. See 078's header for the reasoning.

## Known Pitfalls (from retro context)

- **sacrament-topics-finalize-and-history**: the checkmark must be **attached** to its pill. One
  segmented control: gap 0, the seam is the pill's right border, heights pinned. A free-standing
  circle is the defect the walk found. `FinalizeToggle` must preserve that exact geometry, and
  `FinalizeTopicsButton`'s current classes are the reference implementation.
- **sacrament-topics-finalize-and-history**: the un-finalize rule is about **what** changed, never
  **who** moved. Decision 2 reuses `topicShapeChanged()` and the three existing call sites
  unchanged, so pipeline transitions still clear nothing.
- **sacrament-topics-finalize-and-history**: `SundayStatusInput` fields are **required**, so the
  compiler enumerates callers (ITER-005). Do the same for `references`.
- **p4-sacrament-a-hub-and-reskin**: every interactive pill needs a **44px tap target** (`min-h-11`
  on the interactive element) while the visible pill stays badge-height. The References pill is a
  `<button>`, not an `<a>`, and it needs the same treatment.
- **p4-sacrament-a-hub-and-reskin**: the card is a stretched link (`after:absolute after:inset-0`).
  The pill row is `relative z-10`, and the References button must sit inside that row, or a click
  lands on the programme link instead.
- **ward-callings-model / migration 078 header**: **no `created_by` column** on `talk_references`.
  A composite `(user, ward_id)` key fails a cross-ward leader as a 500 (migration 069). The audit
  row records who.
- **ward-callings-model**: every write of an id the server did not resolve itself must be checked.
  `assignmentId` arrives in a request body, so the add route verifies it is a talk **on that
  Sunday in this ward** before inserting. The composite FK proves the ward, not the Sunday.
- **foundation-c-services**: an RLS-denied DELETE/UPDATE is a **zero-row success**. Check the
  returned rows, never `error` alone.
- **p3-shell-and-tile-dashboard**: `.insert().select()` applies the **SELECT** policy to RETURNING.
  The SELECT policy here (`can_view_talks()`) admits every writer (bishopric ⊂ talks.view), so
  RETURNING is safe. Say so in the migration header so a later narrowing does not break inserts.
- **ai-b-knowledge-and-retrieval**: a scripture chunk label reads `Alma 32:1–25 (part 2 of 3)`.
  Strip the `(part n of m)` suffix for a citation and dedupe what collapses together. The harness's
  **hand-written unit vectors match no real query**, so the scenario must use a genuinely embedded
  document or its search checks cannot fail.
- **roster-b-picker-and-orgs**: `lib/sacrament/sundayStatus.ts` must keep importing **only**
  `@/types/domain` and the pure date helpers. It is now imported by a client component tree
  (`SundayCard` → `ReferencesPill` receives a `SundayPill`), and only `npm run build` catches a
  `next/headers` leak. Put the new types in `types/domain.ts`, never in a `queries.ts`.
- **youth-g-occasions-and-event-detail**: a `<select>` in a flex row overflows at 375px because a
  flex item's `min-width: auto` refuses to shrink. The manual-entry row needs `min-w-0` on the
  input and a wrapping layout.
- **calendar-a-rules-and-api**: a column list is **one string literal on one line**, never `+`
  concatenation.
- **ai-c / ai-b**: **never log the query text.** A bishop's search terms can name a member.

## Tasks

### Task 1: Migration 079
**File:** `supabase/migrations/079_talk_references.sql` (create)
**Action:** Write an additive migration with a header in the style of 078's. It explains the
decisions below and states that it applies immediately (no hold-back).
**Details:**
```sql
alter table sundays
  add column references_finalized_at timestamptz,
  add column references_skipped_at   timestamptz,
  add constraint sundays_references_one_decision
    check (references_finalized_at is null or references_skipped_at is null);

create table talk_references (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,
  assignment_id uuid not null,
  kind          text not null check (kind in ('scripture', 'talk', 'other')),
  citation      text not null check (char_length(btrim(citation)) between 1 and 300),
  document_id   uuid,
  source        text not null check (source in ('search', 'manual')),
  created_at    timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (assignment_id, ward_id) references assignments (id, ward_id) on delete cascade,
  foreign key (document_id, ward_id) references knowledge_documents (id, ward_id)
    on delete set null (document_id),
  check (source = 'search' or document_id is null)
);

create index talk_references_ward_assignment_idx on talk_references (ward_id, assignment_id);

alter table talk_references enable row level security;

create policy talk_references_select on talk_references for select to authenticated
  using (ward_id = current_ward_id() and can_view_talks());
create policy talk_references_insert on talk_references for insert to authenticated
  with check (ward_id = current_ward_id() and is_bishopric());
create policy talk_references_delete on talk_references for delete to authenticated
  using (ward_id = current_ward_id() and is_bishopric());
```
Header points to cover:
- **Two timestamps, not a status column**: `closed_at`/`topics_finalized_at`'s rule. "When" is what
  a card asks, and null is how reopening works without a delete. The CHECK is what makes "finalized
  and skipped at once" unrepresentable.
- **Attached to the assignment, not to a slot number.** A slot number can move (`slotNumber` is a
  non-triggering patch field in `topicShapeChanged`), and a reference belongs to the talk.
- **No `sunday_id` copy.** The Sunday is reached through the assignment. A second copy could
  disagree with the first.
- **`on delete cascade` from assignments** is safe because no path in the app deletes an
  assignment row today (grep `lib/assignments/queries.ts`). If one is ever added, it must decide
  what happens to references, per decisions.md §1.1.
- **`on delete set null (document_id)`**: deleting a knowledge document keeps the citation text a
  person chose. Precedent: 047, 054, 059.
- **The CHECK on `source`**: a manual reference never claims a document.
- **No `created_by`**: see 078's `_by` section and migration 069.
- **No UPDATE policy**, because there is no edit path (remove and re-add). Absence is the boundary,
  as with `access_requests`.
- **The SELECT policy admits every writer** (`is_bishopric()` ⊂ `can_view_talks()`), which is why
  `.insert().select()` works. P3's defect is the warning.
- **`sundays` columns need no policy change.** 019 lets the ward update `sundays`, and the route's
  `assertCan(user, "talks.plan")` is the role boundary. This is the same split 078 documents for
  `topics.manage`.

Apply with `npm run db:push`, then `npm run db:types`.

### Task 2: Domain types
**File:** `types/domain.ts` (modify)
**Details:**
```ts
export const REFERENCE_KINDS = ["scripture", "talk", "other"] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export const REFERENCE_KIND_LABELS: Record<ReferenceKind, string> = {
  scripture: "Scripture", talk: "Talk", other: "Document",
};
export const MANUAL_REFERENCE_KINDS = ["scripture", "talk"] as const;
export const REFERENCE_SOURCES = ["search", "manual"] as const;
export type ReferenceSource = (typeof REFERENCE_SOURCES)[number];
export type ReferencesDecision = "finalized" | "skipped" | null;
export type TalkReference = {
  id: string; assignmentId: string; kind: ReferenceKind; citation: string;
  documentId: string | null; source: ReferenceSource; createdAt: string;
};
```
`MANUAL_REFERENCE_KINDS` follows the prototype's manual `<select>`, which offers Scripture and Talk
only. `other` arrives from search alone (a ward-uploaded letter or handbook excerpt).

### Task 3: Sunday reads and the two new writes
**File:** `lib/calendar/queries.ts` (modify)
**Details:**
- Add `references_finalized_at` and `references_skipped_at` to the row type, to `SUNDAY_COLUMNS`
  (one literal, one line) and to `mapSundayRow` → `referencesFinalizedAt`, `referencesSkippedAt`.
- Export a pure helper next to the type:
  `export function referencesDecisionOf(sunday: Pick<Sunday, "referencesFinalizedAt" | "referencesSkippedAt">): ReferencesDecision`.
  It is the only place the two columns become one value.
- `setReferencesDecision(wardId, sundayId, decision: ReferencesDecision, client?)` → `Sunday | null`.
  Model it on `setTopicsFinalized`: read first, return early if already in that state, then write
  **both** columns in one UPDATE: `finalized` → `{finalized_at: now, skipped_at: null}`; `skipped`
  → the reverse; `null` → both null. A zero-row result returns null.
- `clearTalkShapeStamps(wardId, sundayId, client?)` → `Sunday | null`. Clears
  `topics_finalized_at` **and** `references_finalized_at` in one UPDATE, and **never touches
  `references_skipped_at`**. Return `before` untouched when both are already null (one SELECT, no
  UPDATE, which keeps the existing "costs one SELECT in the ordinary case" promise).

### Task 4: Topic changes clear References too (decision 2)
**File:** `lib/topics/finalize.ts` (modify)
**Action:** `unfinalizeTopicsIfNeeded()` calls `clearTalkShapeStamps()` instead of
`setTopicsFinalized(..., false)`. Keep the export name (three routes and a source-reading test
depend on it; renaming is out of scope) and update the header. It now clears **every stamp that
says the day's talks are settled**, meaning topics and, since slice `c`, references. A skip
survives because it is not a claim about the topics.
**Why not a second helper at the three sites:** one UPDATE gives `PATCH /api/sundays/[id]` one
honest returned row. Two sequential helpers would each return a Sunday, and the route would have to
pick one.
`setTopicsFinalized` stays for the explicit checkmark, where un-finalizing topics by hand must
**not** clear references. Nothing about the topics changed.

### Task 5: Reference queries
**File:** `lib/references/queries.ts` (create)
**Details:** Server-only, using the same `resolveClient` idiom as `lib/calendar/queries.ts`. Every
query filters `.eq("ward_id", wardId)`. Column list as one literal.
- `listReferencesForAssignments(wardId, assignmentIds, client?)` → `TalkReference[]`, ordered by
  `created_at`. Return `[]` for an empty id list without querying.
- `countReferencesByAssignment(wardId, assignmentIds, client?)` → `Map<string, number>`. The hub
  calls this with the month's assignment ids and groups by Sunday **in memory** through the
  assignment → Sunday map it already holds. No embed.
- `countReferencesForSunday(wardId, assignmentIds, client?)` → `number`. Used by the finalize
  guard.
- `addReference(wardId, input, client?)` → `TalkReference`. It throws on error with context in the
  log and **no citation text** in it.
- `removeReference(wardId, referenceId, client?)` → `{ assignmentId } | null`, deleting with
  `.select("assignment_id")`. Null means zero rows, meaning not found or refused.
- `getReference(wardId, referenceId, client?)` → `TalkReference | null`.

### Task 6: Un-finalize on add and remove
**File:** `lib/references/finalize.ts` (create)
**Details:** `unfinalizeReferencesIfNeeded(wardId, sundayId, { clearSkip }, client?)` →
`Sunday | null`. **Never throws.** It uses the same contract as `unfinalizeTopicsIfNeeded`: it logs
with context and returns null. The rule:
- Add → `{ clearSkip: true }`. A reference contradicts "not giving references this round". **This
  departs from the prototype**, which leaves a skip standing and renders `Refs: skipped` over
  references. Say so in the header.
- Remove → `{ clearSkip: false }`. Removing leftovers from a skipped Sunday must not quietly
  undo the skip.
- Implement it via `setReferencesDecision(..., null)` when finalized (or skipped with
  `clearSkip`), and otherwise return the Sunday unchanged.

### Task 7: The pure suggestion mapper
**File:** `lib/references/suggestions.ts` (create)
**Action:** Pure: no imports beyond `@/types/domain` and `@/lib/knowledge/conferenceMetadata`'s
pure formatter (verify `formatConferenceDate` is pure before importing it, and inline the format
if it is not).
**Details:**
```ts
export type SuggestionDocument = {
  id: string; title: string; typeTag: string | null;
  speaker: string | null; conferenceDate: string | null;
};
export type SuggestionChunk = { documentId: string; sourceLabel: string; content: string; similarity: number };
export type ReferenceSuggestion = {
  kind: ReferenceKind; citation: string; documentId: string;
  snippet: string; similarity: number;
};
export function toReferenceSuggestions(
  chunks: readonly SuggestionChunk[], documents: readonly SuggestionDocument[],
): ReferenceSuggestion[];
```
Rules, each one a test:
- `general_conference` → **one suggestion per document** (its best chunk). Citation
  `${title} — ${speaker}, ${formatConferenceDate(conferenceDate)}`, dropping whichever of
  speaker/date is null. A talk is a citable unit (prototype build note
  §references-pill-and-modal).
- `standard_works` → one per **distinct citation**. Citation = the chunk's own label: strip the
  leading `${title} — ` from `sourceLabel`, then strip a trailing ` (part n of m)`. If no label
  remains, fall back to the title. Keep the best similarity.
- Anything else → one per document, citation = title, kind `other`.
- A chunk whose document is missing from `documents` is **dropped**, not guessed at.
- Snippet: whitespace-collapsed content, cut to ~160 characters on a word boundary with an
  ellipsis.
- Output is sorted by similarity, descending. The input order is not trusted.

### Task 8: Validation
**File:** `lib/validation/references.ts` (create)
**Details:** Zod 4, with messages as sentences, following `lib/validation/knowledge.ts`.
- `addReferenceSchema`: `assignmentId` uuid; `kind` enum; `citation` trimmed 1–300;
  `source` enum; `documentId` uuid optional. A `.refine`: `source === "manual"` ⇒ no
  `documentId`, and `kind` ∈ `MANUAL_REFERENCE_KINDS`.
- `referencesDecisionSchema`: `{ decision: z.enum(["finalized","skipped"]).nullable() }`.
- `referenceSearchSchema`: `{ assignmentId: uuid, query: trimmed 1..MAX_SEARCH_QUERY }`. Reuse the
  constant from `lib/validation/knowledge.ts`. `assignmentId` is validated so the search is
  provably about one of this Sunday's talks, although the search itself only needs the query.
- Export `MAX_CITATION = 300`, so the form's `maxLength` and the schema are one number.

### Task 9: Routes
All four follow `app/api/sundays/[id]/topics-finalized/route.ts`: `requireSessionUser()` **outside**
the try, `resolveRoleAccess` once, `assertCan`, a uuid-parsed `params` (a Promise in Next 16),
`respondToRouteError` with **no query or citation text** in `detail`, and a header comment on the
why.

**A shared first step for every route:** load the Sunday (`getSunday`) and its assignments
(`listAssignments(wardId, { sundayId })`). 404 with `"That Sunday is not on your ward's calendar."`
if the Sunday is absent.

**`app/api/sundays/[id]/references/route.ts`**
- `GET` (`talks.view`) → `{ decision, talks, references, canEdit }`. `talks` holds the Sunday's
  assignments **with a topic**, ordered by `slotNumber`: `{ assignmentId, slotNumber, topicTitle,
  speakerName }`. Resolve topic titles with `listTopicOptions` and speaker names with
  `speakerDisplayName` + member names, the way `/assignments/[sunday_id]/page.tsx` does. Read that
  page first and reuse its lookups. `references` comes from `listReferencesForAssignments` over
  **those** ids. `canEdit` = `can(user, "talks.plan", roleAccess)`.
- `POST` (`talks.plan`): validate → **verify `assignmentId` is one of this Sunday's assignments
  and has a topic**, else 400 `"That talk is not on this Sunday."` (this is the subject-column check;
  see pitfalls) → `addReference` → `unfinalizeReferencesIfNeeded(..., { clearSkip: true })` →
  audit `talk_reference_added`, module `talks`, detail `{ sundayId, assignmentId, referenceId,
  kind, source }` (**no citation**, as it can be free text) → 201 `{ reference, decision }`.

**`app/api/sundays/[id]/references/[referenceId]/route.ts`**
- `DELETE` (`talks.plan`): `getReference`, and confirm its `assignmentId` is on this Sunday (else
  404) → `removeReference`, where null means 404 → `unfinalizeReferencesIfNeeded(..., { clearSkip:
  false })` → audit `talk_reference_removed` → 200 `{ decision }`.

**`app/api/sundays/[id]/references-decision/route.ts`**
- `PATCH` (`talks.plan`): parse → if `finalized` and `countReferencesForSunday === 0`, respond
  **409** `"Add at least one reference, or skip references for this Sunday."` (refuse and name the
  alternative) → `setReferencesDecision` → audit `sunday_references_finalized` /
  `sunday_references_skipped` / `sunday_references_reopened` (three actions, not one with a
  boolean; see the topics route's reasoning) → 200 `{ decision }`.
- It is its own route rather than a field on `PATCH /api/sundays/[id]`: that route asserts
  `calendar.manage` and calls the un-finalize helper, and the topics route's header explains why
  both matter.

**`app/api/sundays/[id]/references/search/route.ts`**
- `POST` (`talks.plan`, because it spends an embedding call): parse → confirm `assignmentId` is on
  this Sunday → `retrieveChunks(query, wardId, { client, limit: MAX_SEARCH_RESULTS, module:
  "references" })`. **No `filters`**, so the ward's saved scope applies. Then read
  `knowledge_documents` (`id, title, type_tag, speaker, conference_date`) for the distinct
  `documentId`s, adding a small `listDocumentMetadata(wardId, ids, client)` to
  `lib/knowledge/queries.ts` (it is already the home of `DOCUMENT_COLUMNS`) →
  `toReferenceSuggestions` → 200 `{ suggestions }`.
- **No audit row** (a read). **Never log the query.** An empty result is a 200 with `[]`, not an
  error (retrieve.ts's own rule).
- Header note: these are passages from the ward's own corpus that a person chooses between. There
  is no generated text anywhere in the path, so rule 3's approval step is the tap that adds one.

### Task 10: The pill model
**File:** `lib/sacrament/sundayStatus.ts` (modify)
**Details:**
- `SundayPillKey` gains `"references"`. Pill order: **topics, references, talks, prayer, music**
  (prototype order). It is emitted only inside `talkPills`, so a Sunday with zero slots has none.
- `SundayStatusInput` gains **required**
  `references: { count: number; decision: ReferencesDecision }`.
- `SundayPill` gains `countText: string` (visible, e.g. `2/3`, `3`, `skipped`) and `spokenCount:
  string` (for the aria-label, e.g. `2 of 3`, `3 chosen`, `skipped`). Every existing pill fills
  them from filled/total, so nothing else changes visibly.
- The references pill: label `Refs`. Status is `complete` when the decision is non-null, `partial`
  when count > 0, otherwise `empty`. `filled` = count, `total` = count (it is not a fraction).
  `countText` = `skipped` when skipped, else `String(count)`. `finalized` = `decision !== null`,
  which is a **boolean**, so the checkmark renders.
- Update the file header's "THE PROTOTYPE ADDS THREE MORE LATER" paragraph: References is now
  built, and Talks/Prayers remain.
- `sundayPillHrefs` returns `Record<Exclude<SundayPillKey, "references">, string>` and exports that
  key type as `SundayPillLinkKey`. **The References pill has no href**, because it opens a modal.
  A fake href would be the broken-link bug P3 closed.

### Task 11: Generalize the attached checkmark
**Files:** `components/sacrament/FinalizeToggle.tsx` (create),
`components/sacrament/FinalizeTopicsButton.tsx` (modify)
**Details:** Move the body of `FinalizeTopicsButton` into
`FinalizeToggle({ url, pressedBody, unpressedBody, pressed, disabled?, disabledReason?, ariaLabel,
variant })`. It must keep the **exact** pill-variant geometry and classes (h-11 w-11 button, the
22px attached tab with `rounded-l-none rounded-r-full border-l-0`), the optimistic `pressed`,
`router.refresh()` on success, and the inline error text. Add `disabled` + `disabledReason`
(rendered as `title` **and** as visually hidden text, because a tooltip alone is not accessible).
`FinalizeTopicsButton` becomes a wrapper passing the topics URL and `{ finalized }`. Its props do
not change, so its callers (`StatusPill`, `TopicsFinalizedPanel`) are untouched. This is
decisions.md §1.7's "the second time it is needed".

### Task 12: The hub UI
**Files:** `components/sacrament/StatusPill.tsx`, `components/sacrament/SundayCard.tsx` (modify);
`components/sacrament/ReferencesPill.tsx`, `components/sacrament/ReferencesEditor.tsx` (create);
`app/(app)/sacrament/page.tsx` (modify)

- **`StatusPill`** renders `{pill.label} {pill.countText}` and aria-label
  `${pill.label}, ${pill.spokenCount} — ${sundayLabel}`. The `hrefs` prop type becomes
  `SundayPillLinkKey`.
- **`SundayCard`** gains `canPlanTalks: boolean`. In the pill map, `pill.key === "references"`
  renders `<ReferencesPill>`, and every other key keeps `StatusPill`. Both stay inside the existing
  `relative z-10` list.
- **`ReferencesPill`** (`"use client"`) renders a `<button type="button">` with `min-h-11`,
  wrapping the same `Pill` + `STATUS_TONES`. Export `STATUS_TONES` from `StatusPill.tsx` rather than
  copying it. Beside it, when `canPlanTalks`, it renders a `FinalizeToggle` against
  `/api/sundays/[id]/references-decision`:
  - pressed = `pill.finalized`
  - body when un-pressing: `{ decision: null }`. This covers both un-finalize and un-skip, as in
    the prototype's toggle.
  - body when pressing: `{ decision: "finalized" }`
  - disabled when unpressed with count 0, with the reason `"Add a reference or skip first"`
  - aria-label `References are ready — ${sundayLabel}`

  It holds `isOpen` and renders `<Modal title={`References — ${sundayLabel}`}>` with
  `<ReferencesEditor sundayId=… onChanged={() => router.refresh()} />` **only while open**, so a
  closed modal fetches nothing.
- **`ReferencesEditor`** (`"use client"`) fetches `GET /api/sundays/[id]/references` on mount. Use
  TanStack Query if `app/(app)/prayers/PrayerBoard.tsx` shows the local idiom, and match that file.
  It shows loading, error (with retry) and data states. Copy, adapted from the prototype:
  - Intro: *"Searches your ward's scriptures and conference talks by meaning. Nothing is chosen
    for you: tap a result to add it, or type a reference yourself."*
  - No talks with topics: *"No topics yet. Add them on this Sunday's page first."* with a link to
    `/assignments/${sundayId}`.
  - For each talk: a heading `Talk {slotNumber}: {topicTitle}`, then the speaker line (muted), then
    the list of added references (a `Chip` with the kind label, the citation, and a **Remove**
    button when `canEdit`). When `canEdit`: a search `Input` prefilled with the topic title, plus a
    **Search** button. **Do not search on every keystroke**, because each search is an embedding
    call. Results appear under `Scriptures` / `Conference talks` / `Other documents`, each a
    tappable row (a button, min-h-11) with the citation, an italic snippet, and **Added** in place
    of the tap target when that citation is already on the talk (compare trimmed, case-insensitive).
    An empty result reads *"Nothing in your ward's library matched closely enough. Try other words,
    or type one in."* Last comes the manual row: a `<select>` of `MANUAL_REFERENCE_KINDS` + `Input`
    (`maxLength={MAX_CITATION}`, `min-w-0`) + **Add**, where Enter adds too. The row wraps at 375px.
  - Footer: a checkbox *"Not giving references this round — skip this Sunday"*, disabled while
    finalized. When finalized: *"✓ Finalized — N reference(s) ready."* + **Undo**. When skipped:
    *"Skipped for this Sunday — nothing to finalize."* Otherwise: **Finalize references**, disabled
    at 0. Pluralize with the inline `count === 1 ? … : …` idiom (ai-b's walk defect).
  - Without `canEdit`: the references list is read-only, with no search, no manual row and no
    footer controls, plus a single muted line reading the decision.
  - After every successful mutation: refetch the editor's data **and** call `onChanged()`, so the
    hub pill and checkmark update behind the modal. Errors show inline via `FormError`, using the
    server's sentence.
- **`app/(app)/sacrament/page.tsx`**: after assignments load, call `countReferencesByAssignment`
  with the month's assignment ids (add it to the existing `Promise.all` if the ids are available.
  They are not until assignments return, so run it straight after). Group the counts by Sunday via
  each assignment's `sundayId`. Pass `references: { count, decision: referencesDecisionOf(sunday) }`
  into `sundayPills`. Pass `canPlanTalks = can(user, "talks.plan", roleAccess)` to each card.

### Task 13: Tests
See Testing Strategy. Keep `tests/lib/topicsFinalize.test.ts`'s source-reading assertions
unchanged, because the three routes still call `unfinalizeTopicsIfNeeded(`. Add a comment line
there noting that the helper now also clears references (decision 2).

### Task 14: Docs
- `SPEC.md`: the `talk_references` table, the two `sundays` columns, and the four routes.
- `plans/prototype/module-map.md` §2.1: under "Built so far", record slice `c` (behaviour 1, plus
  behaviour 2's References link), the two user decisions, and the one deviation (add clears a skip).
- `plans/P4-module-reskins.md` §1: move `c` from remaining to shipped. Module 1 then has `d` and `e`
  left.

## Testing Strategy

**`tests/lib/referenceSuggestions.test.ts`** (pure, no network)
- One conference talk with three chunks → one suggestion, the best similarity, citation
  `Title — Speaker, April 2025`.
- A null speaker or null date → the citation omits it cleanly (no dangling `, `).
- Scripture `Book of Mormon — Alma 32:1–25 (part 2 of 3)` → citation `Alma 32:1–25`; two parts of
  the same range → **one** suggestion.
- A scripture chunk with no label → the title.
- `other` → kind `other`, citation = title.
- A chunk with no matching document → dropped.
- Unsorted input → output sorted by similarity, descending.
- Snippet → ≤ ~161 chars, word boundary, ellipsis, whitespace collapsed.

**`tests/lib/sacramentSundayStatus.test.ts`** (extend)
- Pill order `topics, references, talks, prayer, music`.
- No references pill at `speakingSlots: 0`.
- `{count:0, decision:null}` → empty, `countText "0"`, `finalized false`.
- `{count:2, null}` → partial, `"2"`.
- `{count:2, "finalized"}` → complete, finalized true.
- `{count:0, "skipped"}` → complete, `countText "skipped"`, finalized true.
- `sundayPillHrefs` has **no** `references` key.
- Every existing pill's `countText` is `filled/total`.

**`tests/rls/talk-references.test.ts`** (hosted, `seedFixtures`, cleanup in `afterAll`)
- The bishop inserts/reads/deletes in ward A.
- The ward B bishop reads zero rows and cannot insert against a ward A assignment.
- `music_coordinator` reads but cannot insert or delete (re-read the row with the service client:
  a refused DELETE is a zero-row success).
- `org_president` reads zero.
- An insert pointing at another ward's assignment is refused.
- Deleting a knowledge document leaves the reference with `document_id = null` and its citation
  intact.
- `sundays` rejects both stamps set at once (CHECK).

**`tests/routes/talk-references.test.ts`** (routeClient pattern, CLAUDE.md §8)
- `GET` as bishop → talks with topics only, in slot order.
- `GET` as music_coordinator → 200 with `canEdit: false`.
- `GET` as org_president → 403.
- `POST` add → 201. A finalized Sunday becomes open, and a skipped Sunday becomes open. Check that
  an audit row exists with no citation in its detail.
- `POST` with an assignment from another Sunday → 400. With a talk that has no topic → 400.
- `DELETE` → finalized becomes open, and skipped **stays** skipped.
- `DELETE` of a reference on another Sunday's talk via this Sunday's URL → 404.
- `PATCH` decision `finalized` at 0 references → 409, with the row re-read and unchanged.
  `finalized` with references → 200. `skipped` → clears finalized. `null` → both null.
- music_coordinator `POST`/`DELETE`/`PATCH` → 403.
- **Decision 2:** `PATCH /api/assignments/[id]` changing `topicId` on a finalized-references
  Sunday → `references_finalized_at` null. The same on a **skipped** Sunday → still skipped. A
  pipeline transition → unchanged. `PATCH /api/sundays/[id]/topics-finalized` `false` →
  references **unchanged**.
- Search: mock `@/lib/ai/embed` as `tests/routes/ai-suggest.test.ts` does. 403 for
  music_coordinator, 400 for an empty query, 200 with `suggestions` an array, and a thrown embed
  error → an error response with a sentence.

**`tests/components/sacrament/ReferencesEditor.test.tsx`** (jsdom, fetch stubbed)
- It renders a section per talk with a topic.
- With no talks → the empty state, linking to `/assignments/[id]`.
- Read-only (`canEdit: false`) → no Search, no Add, no Remove, no footer controls.
- Finalize is disabled at 0. The skip checkbox is disabled while finalized.
- An already-added citation shows **Added**.
- Singular/plural in the finalized line.

**`tests/components/sacrament/SundayCard.test.tsx`** (extend)
- The References pill is a `<button>`, not an `<a>`, and every other pill is still an `<a>` to its
  href.
- The checkmark is present only with `canPlanTalks`.

## Test Scenarios (Harness)

### Scenario 074: References, finalize and skip
**Tags:** talks, sacrament, references, ai, full, finalize, permissions
**Purpose:** Checks the hand-off a test cannot see. Does the modal read as a place to *choose*
references (not a place where they were chosen for you)? Does the attached checkmark read as
belonging to its pill? Do topic changes quietly return a finalized Sunday to open while leaving a
skip alone? Seeding helps because you need Sundays already in each of the three states, and one
where both stamps are set.
**Seed data summary:**
- Users: `bishop`, `counselor1`, `music` (music_coordinator: `talks.view`, not `talks.plan`).
- Sundays: four **relative to today** (next four Sundays), not fixed dates. The recency lesson from
  scenario 073's walk applies, because the hub opens on the current month.
  - **A**: 3 slots, topics finalized, 2 references on talk 1 and 0 on talk 2, references
    **finalized**.
  - **B**: 2 slots, topics set, references **skipped**, 0 references.
  - **C**: 3 slots, topics set, references open, 1 manual reference.
  - **D**: fast Sunday, 0 slots.
- Talk references seeded with `source: "manual"`, because a manual row is the only kind that needs
  no document.
- **No knowledge corpus is seeded.** The seed's hand-written vectors match no real query
  (ai-b retro). Step 1 of the scenario uploads one short real document (a conference-talk text
  and a scripture chapter) through `/knowledge`, which embeds it for real.

**Tester action:** as `bishop`, upload the documents. Open Sunday C's References and search the
prefilled topic, add a result, type a manual one, remove one, and finalize. Open A and change a
topic on `/assignments/[A]`. Check B after the same change. As `music`, open A.

**Verification checklist:**
- [ ] D shows **no** Refs pill. A–C show `Refs` directly after `Topics`.
- [ ] A reads `Refs 2` with a filled, **attached** checkmark. B reads `Refs: skipped` with a filled
      checkmark. C reads `Refs 1` (amber/partial) with an empty checkmark.
- [ ] Tapping C's Refs pill opens the modal, and does **not** open the programme.
- [ ] The search results name real citations from the uploaded documents, grouped under
      Scriptures / Conference talks. A scripture citation carries no "(part n of m)".
- [ ] Tapping a result adds it, and the row then reads **Added**. The pill behind the modal reads
      `Refs 2` without a reload.
- [ ] A manual reference with the kind `Talk` shows the `Talk` chip.
- [ ] **Finalize references** turns C's checkmark filled. **Undo** turns it back.
- [ ] Changing a topic on A's Sunday page → A's Refs checkmark is **empty** again and its 2
      references are **still listed** in the modal.
- [ ] Changing a topic on B → B still reads `Refs: skipped`.
- [ ] Un-finalizing A's **Topics** by its checkmark does **not** change A's Refs checkmark.
- [ ] At 375px the modal is full height and scrolls. The manual row wraps without horizontal scroll.
      Dark mode is legible.
- [ ] As `music`: the pill is present, the modal lists references with no Search/Add/Remove/footer
      controls, and there is no checkmark.
- [ ] Judgement: does the intro sentence make it clear nothing was generated? Would a bishop want
      `topics.suggested_scriptures` offered as one-tap chips here? (This one feeds the next slice.
      It is not a defect.)

## Validation Commands
```bash
npm run db:push
npm run db:types
npm run lint
npm run typecheck
npm run test
npm run harness:typecheck
npm run build
```

## Integration Notes

- **Migration 079 is additive** and applies before the deploy. Every existing Sunday reads
  "references open", which is honest, since nobody has decided. There is no backfill.
- **Behavioural change to an existing helper:** `unfinalizeTopicsIfNeeded` now also clears
  `references_finalized_at`. The three call sites are untouched. Its header must say so, because the
  name no longer tells the whole story (a rename was considered and not done, per the boundaries
  rule).
- **`sundayPillHrefs`'s return type narrows.** Callers other than the hub (grep for it) must still
  compile.
- **Slice `f` reads this.** `referencesDecisionOf(sunday) !== null` is the gate for Talks
  finalize, and `listReferencesForAssignments` supplies the references its to-do carries. Record
  both in the P4 slice note so `f` does not re-derive them.
- **The search spends one OpenAI embedding per press of Search** and writes a `suggestion_log` row
  under module `references` (ITER-012 telemetry picks it up for free).
- **Docs:** SPEC.md, module-map §2.1, and P4 §1 (Task 14).
