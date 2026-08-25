# Plan: Program E — Music Coordination and Hymn Selection

**Created:** 2026-08-24
**Type:** feature
**Structure:** Sequential — plan 5 of 5 for Phase 6 ([06-program-music.md](06-program-music.md))
**Depends on:** `program-a` (the draft reads hymn selections). `program-b`, `program-c` and
`program-d` are independent of this plan and must not wait for it.

> ## ⛔ BLOCKED — do not execute this plan yet
>
> **The hymnbook is not seeded.** `supabase/seed/hymns.sql` contains **42 of 341 hymns** behind an
> explicit instruction:
>
> > *The full list MUST be sourced from an authoritative source before
> > `plans/06-program-music.md` ships hymn selection. Until then, treat an empty lookup as "not
> > seeded yet", not as "no such hymn". **Do not pad this file with plausible-looking entries.***
>
> A wrong hymn number prints on a real program that a congregation then sings from. Task 0 below is
> the gate. **Every other task in this plan is blocked behind it**, and the gate is not something an
> executing agent can clear on its own — it needs a source the user supplies.
>
> This is why this plan is last, and why the four plans before it were written not to need it.

---

## Overview

The music coordinator's screen, hymn selection, AI-assisted hymn suggestions, and musical numbers.

The role is deliberately narrow: upcoming Sundays, the topics assigned to them, hymn search, three
selections per Sunday, and a musical number. No pipeline access, no roster, no program.

The AI half has one rule that matters more than the rest: **never ask the model to recall a hymn
number.** It will produce plausible, wrong ones — the same failure ITER-016 recorded for conference
talk citations, in a context where the error gets sung by two hundred people. The candidate list
goes *into* the prompt and every returned number is validated against the table before display.

**Success criteria**

- The coordinator sees the next several Sundays, each with its assigned topics and its current
  selections, and can tell at a glance which are missing.
- Hymn search finds by number, by title, and by topic tag.
- AI suggestions arrive with a one-line rationale each, every number is real, and accepting one is
  an explicit action.
- A hymn selection appears in the program draft the next time it is built or refreshed.
- A partially-seeded hymnbook degrades honestly: an unknown number reads as unknown, never as
  "no such hymn".

---

## Task 0 — The Gate (must clear before anything else)

**Files:** `supabase/seed/hymns.sql`, a new `supabase/migrations/04X_hymns_full.sql`

**This is a conversation with the user, not a research task for an agent.**

1. **Ask the user for the authoritative source.** A file, an export, or a URL they have confirmed is
   sanctioned for this use. The seed file's warning forbids inventing entries, and that includes
   inferring them from a model's memory.

2. **Copyright posture — check before fetching anything.** Hymn text and the hymnbook's contents are
   published by Intellectual Reserve. CLAUDE.md §9 already records the equivalent caution for
   conference talks: *"read [the site's terms of use and `robots.txt`] before building any fetching
   step, and check whether a sanctioned bulk or export source exists first."* The same applies here.
   **Numbers and titles are a much lighter case than full lyrics** — this plan needs only
   `number`, `title`, and `topic_tags`, and never stores or displays hymn text. Say that
   explicitly when raising it; it is likely the difference between a blocked plan and an easy yes.

3. **Load it as a migration, not by editing the seed.** The seed runs for new wards; existing
   databases need a migration. Follow the two-part pattern `foundation-c` established for
   notification triggers. Use `on conflict (number) do update` so the 42 existing rows are corrected
   rather than colliding.

4. **Verify the count** before proceeding: `select count(*) from hymns` should be 341, and a
   spot-check of five known number/title pairs should pass. Record the source in the migration's
   comment header — the next person to doubt a number needs to know where it came from.

**Until Task 0 clears, the honest fallback already in place stands:** an empty lookup means "not
seeded yet". `program-b` lets a secretary type a hymn number and title by hand, which is correct
behaviour for a partial hymnbook rather than a workaround.

---

## Relevant Files

### Create

| File | What it does |
|---|---|
| `supabase/migrations/04X_hymns_full.sql` | The full hymnbook (Task 0) |
| `lib/music/queries.ts` | `hymns`, `hymn_selections`, `musical_numbers` — the module `program-a`'s `gather.ts` switches to |
| `lib/music/hymnSearch.ts` | Number / title / tag matching, pure |
| `lib/music/hymnCandidates.ts` | Topic tags → the candidate list handed to Claude |
| `lib/ai/hymnSuggestions.ts` | Output schema and the user prompt |
| `lib/validation/music.ts` | Zod for the four request bodies |
| `app/api/hymns/route.ts` | `GET` — search |
| `app/api/hymns/suggest/route.ts` | `GET` — AI suggestions, validated against the table |
| `app/api/hymns/select/route.ts` | `POST` — save a selection |
| `app/api/musical-numbers/route.ts` | `POST` — log a performer and piece |
| `app/(app)/music/page.tsx` | The coordinator's screen |
| `app/(app)/music/SundayMusicCard.tsx` | One Sunday: topics, three slots, warnings |
| `app/(app)/music/HymnSearchModal.tsx` | `"use client"` — search and pick |
| `app/(app)/music/SuggestHymnsButton.tsx` | `"use client"` — the AI path |
| `supabase/migrations/04Y_music_write_scope.sql` | Narrows selection writes below ward-wide |

### Modify

| File | What changes |
|---|---|
| `lib/program/gather.ts` | Reads through `lib/music/queries.ts` instead of inline |
| `app/(app)/program/[sunday_id]/MeetingOrderForm.tsx` | Hymn fields become pickers |
| `types/domain.ts` | `HYMN_TYPES`, and `AI_MODULES` gains `hymn_suggestions` |
| `lib/ai/moduleInstructions.ts` | The `hymn_suggestions` block |
| `components/layout/Sidebar.tsx`, `lib/auth/navigation.ts` | A Music link behind `music.view` |

---

## Known Pitfalls (from retro context)

- **ITER-016 (open)** — *"Two of fifteen suggested conference talk citations were wrong and
  confirmed so… That mixture is the problem: an all-wrong batch gets noticed, a mostly-right one
  teaches the bishopric to trust the rest."* Hymn numbers are the same failure with a worse
  consequence. The mitigation here is stronger than ITER-016's because it is available: the full
  candidate set is small enough to put **in the prompt**, so the model ranks rather than recalls,
  and every returned number is checked against the table before it reaches a screen.
- **`ai-c`** — a suggestion writes nothing until a person accepts it. `topic_candidates` is the
  established shape. Hymn suggestions are lighter — they are transient and need no queue table — but
  the rule is identical: **nothing is saved by generating.**
- **`ai-b`** — the plural bug. "All 1 of its passages." Any count on the music screen needs a
  one-item and a several-item fixture.
- **`talks-c`** — an absence renders as an absence. A Sunday with no hymns chosen shows empty slots,
  not "None selected".
- **`roster-b`** — `MemberPicker`'s interface is frozen. A musical number's performer is free text
  (a visiting quartet has no member record), so do not reach for the picker at all here.
- **`calendar-c`** — the first org-scoped write boundary was enforced in **RLS**, not just the
  route. `hymn_selections` and `musical_numbers` sit in 019's ward-scoped loop today; Task 8
  narrows them the way migration 037 narrowed `programs`.

---

## Tasks

*(All of these are blocked behind Task 0.)*

### Task 1: Music data access

**File:** `lib/music/queries.ts` (create)

`listHymns`, `searchHymns`, `getHymnByNumber`, `listSelections`, `upsertSelection`,
`deleteSelection`, `getMusicalNumber`, `upsertMusicalNumber`.

- `hymns` is **the one table with no `ward_id`** (migration 006, the documented sole exception to
  CLAUDE.md rule 1). Do not add a ward filter to hymn reads, and do not "fix" it. The ward-isolation
  test's skip list has exactly one entry and must stay at one.
- `getHymnByNumber` returns `null` for an unseeded number. Callers must render that as **unknown**,
  never as "no such hymn" — the seed file's own instruction.
- Everything else is ward-scoped as normal.

### Task 2: Search

**File:** `lib/music/hymnSearch.ts` (create)

Pure matching over a hymn list: exact number, title substring (case- and accent-insensitive), and
topic tag. Rank exact-number first. Test the apostrophe case — `"Come, Listen to a Prophet's Voice"`
is already in the seed and is exactly the string that breaks naive matching.

### Task 3: `GET /api/hymns`

**File:** `app/api/hymns/route.ts` (create)

Authenticated, no specific permission — the hymnbook is a reference table, not ward data. Validate
the query string with Zod. Cap the result count.

### Task 4: Candidates and the AI route

**Files:** `lib/music/hymnCandidates.ts`, `lib/ai/hymnSuggestions.ts`,
`app/api/hymns/suggest/route.ts`, `types/domain.ts`, `lib/ai/moduleInstructions.ts`

**This is the task the plan exists to get right.**

1. Read the Sunday's assigned topics through `lib/topics/queries.ts` (`talks-c`: through the module,
   never the table).
2. `buildCandidates(topics, hymns)` matches on `hymns.topic_tags` and returns a bounded list —
   40–60 candidates, each `{ number, title, tags }`.
3. The candidate list goes **into the user prompt**. The system block instructs the model to choose
   *only* from it and to explain each choice in one line.
4. `callClaudeStructured` with `zodOutputFormat(hymnSuggestionsSchema)`, `effort: "high"` (matching
   topic generation — this is a generative ranking task).
5. **Validate every returned number against the table.** A number not in the candidate list is
   dropped, and the count of dropped suggestions is logged. If *all* are dropped, that is an error
   with its own sentence, not an empty list.
6. The route **writes nothing**. Suggestions are returned and held in client state until the
   coordinator picks one (CLAUDE.md rule 3).

Note in `moduleInstructions.ts` why the candidate list is passed rather than recalled, pointing at
ITER-016. The next person to "simplify" this by trusting the model needs to find the reason here.

### Task 5: `POST /api/hymns/select` and `/api/musical-numbers`

**Files:** `app/api/hymns/select/route.ts`, `app/api/musical-numbers/route.ts`

- `assertCan(user, "music.manage", roleAccess)` — held by `music_coordinator` **and** the bishopric.
- A selection stores `hymn_number` **and** `hymn_title`. The title is denormalised on purpose: the
  program draft is a snapshot and must survive the hymn table changing under it.
- `ai_suggested` records whether the selection began as a suggestion. This is the only place that
  flag is set, and it is what makes "how often is the AI actually right" answerable later.
- A selection for a Sunday that holds no sacrament meeting is a 422.
- Audit both. Emit no notification — nothing in the phase plan asks for one, and an unfired key is
  worse than no key (`talks-c`).

### Task 6: The music screen

**Files:** `app/(app)/music/*.tsx`

- `assertCan(user, "music.view", roleAccess)`.
- The next six Sundays that hold a meeting. Each card shows: the date, the **assigned topics**, the
  three hymn slots, and a musical number if logged.
- **Topics only — not the assignments.** The coordinator holds `talks.view` but the phase plan is
  explicit that they do not get pipeline access. Show topic titles; do not show speakers, stages, or
  contact state.
- A Sunday missing any of the three hymns is visibly marked. Correctly pluralised, with a fixture for
  one and for several (`ai-b`).
- 375px first, both themes.

### Task 7: Wiring into the program

**Files:** `lib/program/gather.ts`, `MeetingOrderForm.tsx` (modify)

- `gather.ts` drops its inline `hymn_selections` / `musical_numbers` reads and calls
  `lib/music/queries.ts`. `program-a` flagged those reads as temporary and named this as the moment.
- `MeetingOrderForm`'s hymn fields become pickers backed by `GET /api/hymns`, with free text still
  possible — a ward that sings something outside the hymnbook is a real case.
- **The snapshot rule is unchanged.** Choosing a hymn after the draft exists does not alter the
  draft; it shows up in the refresh diff. Do not add a write-through.

### Task 8: Write scope

**File:** `supabase/migrations/04Y_music_write_scope.sql` (create)

Narrow `hymn_selections` and `musical_numbers` inserts/updates/deletes to
`('bishop', 'counselor', 'music_coordinator', 'ward_secretary')` via `current_user_role()`,
following migration 037 exactly. Select stays ward-wide. Comment the deviation from 019's loop and
note that the ward's `role_access` override is honoured by `assertCan()` in the route, not here.

---

## Testing Strategy

| File | Asserts |
|---|---|
| `tests/lib/hymnSearch.test.ts` | Number, title, tag; the apostrophe title; ranking |
| `tests/lib/hymnCandidates.test.ts` | Candidates come from tags; the list is bounded; no topics yields a sensible default set |
| `tests/lib/hymnValidation.test.ts` | **A suggested number not in the table is rejected.** All-rejected is an error, not an empty list. The phase plan's named test |
| `tests/routes/hymn-suggest.test.ts` | The prompt contains the candidate list; the route writes nothing; each AI error kind maps to its own status |
| `tests/routes/hymn-select.test.ts` | `music_coordinator` 200; `org_president` 403; a no-meeting Sunday 422 |
| `tests/rls/music-access.test.ts` | Ward isolation on selections; `hymns` readable by all; post-04Y an `org_secretary` cannot insert a selection |
| `tests/db/hymn-seed.test.ts` | 341 rows; five known number/title pairs; no duplicate numbers |

---

## Test Scenarios (Harness)

### Scenario 036: Choosing hymns for a Sunday with topics

**Tags:** `music`, `ai`, `full`
**Purpose:** The coordinator's whole loop, and the ITER-016-shaped risk in a place where a person
can catch it.

**Seed data summary:** two upcoming Sundays; one with two assigned topics, one with none; one
existing opening-hymn selection so the missing-slot display has both states.

**Tester action:** Sign in as the music coordinator, ask for suggestions on the Sunday with topics,
accept one, and set the other two by search.

**Verification checklist:**
- [ ] Every suggested number is a real hymn — **check three against a physical hymnbook**
- [ ] Each suggestion has a one-line reason connecting it to a topic on that Sunday
- [ ] Generating suggestions saves nothing; navigating away loses them
- [ ] The accepted hymn is marked as AI-suggested; the searched ones are not
- [ ] The coordinator sees topics but **no speakers, stages, or pipeline detail anywhere**
- [ ] The Sunday with no topics still allows manual selection

### Scenario 037: The selection reaches the program

**Tags:** `music`, `program`, `smoke`
**Purpose:** The seam between this plan and `program-a`'s snapshot rule.

**Tester action:** As the coordinator, set the sacrament hymn on a Sunday that already has a built
program draft. Then, as the secretary, open that program.

**Verification checklist:**
- [ ] The program still shows the **old** state — the snapshot held
- [ ] Refresh offers the new hymn in the diff, with number and title
- [ ] After applying, the sacrament hymn is no longer listed as missing

---

## Validation Commands

```bash
npm run db:push
npm run db:types
npm run lint
npm run typecheck
npm run test
npm run build
```

Plus the Task 0 verification, which is not a script:

```sql
select count(*) from hymns;                        -- expect 341
select number, title from hymns where number in (2, 19, 27, 136, 301);
```

---

## Integration Notes

- **`program-a`'s `gather.ts` is the only file outside this plan that changes.** That was designed
  in from the start so this plan could be deferred indefinitely without holding up Phase 6.
- **Milestone M4 does not depend on this plan.** A ward can print a real program with hand-typed
  hymn numbers; `program-d`'s fold test is the milestone.
- **ITER-016 is adjacent but not closed here.** That scope is about *conference talk* citations in
  topic suggestions. The candidate-list-in-the-prompt technique this plan uses is the strongest
  available answer to the same class of problem, and it is worth pointing at from the ITER-016 scope
  when that work is planned — a hymn number is verifiable against a table, which is exactly the
  "deterministic verification pass" ITER-016 is looking for.
- **Breaking changes:** none, provided Task 0 uses `on conflict (number) do update` rather than a
  plain insert.
