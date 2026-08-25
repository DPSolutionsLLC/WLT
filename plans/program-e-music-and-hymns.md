# Plan: Program E — Music Coordination and Hymn Selection

**Created:** 2026-08-24
**Type:** feature
**Structure:** Sequential — plan 5 of 5 for Phase 6 ([06-program-music.md](06-program-music.md))
**Depends on:** `program-a` (the draft reads hymn selections). `program-b`, `program-c` and
`program-d` are independent of this plan and must not wait for it.

> ## ✅ GATE CLEARED BY DECISION — 2026-08-25
>
> This plan used to open with a ⛔ BLOCKED notice: the hymnbook is not seeded,
> `supabase/seed/hymns.sql` holds **42 of 341** hymns, and its own header forbids padding the gap:
>
> > *The full list MUST be sourced from an authoritative source before
> > `plans/06-program-music.md` ships hymn selection. Until then, treat an empty lookup as "not
> > seeded yet", not as "no such hymn". **Do not pad this file with plausible-looking entries.***
>
> **An authoritative source is still not available**, and the warning above still stands. What
> changed is that the user decided (2026-08-25) how to build against the gap without breaking it:
>
> **Fill the 299 missing numbers with rows nobody could mistake for real hymns**, and record which
> is which in a new `hymns.source` column. A placeholder is titled `[Placeholder] Hymn 43` —
> obviously synthetic, believable by no one. No plausible-looking entry is ever written, so the
> seed file's instruction is honoured rather than waived.
>
> **This is a build-and-test measure, not a shipping one.** A ward must not print a programme from
> a placeholder, and Task 0 below makes that visible rather than merely documented. When the real
> hymnbook arrives, `npm run hymns:reset` clears every placeholder — leaving the 42 verified rows
> untouched — and `npm run hymns:import` loads the approved data.
>
> **Task 0 is still the gate.** Every other task depends on 341 searchable rows existing. It is no
> longer blocked on the user, but it must be built first.

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

## Task 0 — The Gate (build this first; everything else depends on it)

**Files:** `supabase/migrations/042_hymn_source.sql`, `lib/music/hymnSource.ts`,
`supabase/scripts/hymns.ts`, `supabase/seed/hymns.sql`, `package.json`,
`tests/lib/hymnSource.test.ts`

**Migration number: 042.** 039 went to `program-c`, 040 and 041 to `program-d`. Check
`supabase/migrations/` before writing the file — the digits before the first underscore are the
version `supabase db push` reads, and a duplicate is a collision. Three plans in a row have had to
correct this.

### 1. The provenance column

```sql
alter table hymns add column source text not null default 'authoritative';
alter table hymns alter column source drop default;
alter table hymns add constraint hymns_source_check
  check (source in ('authoritative', 'placeholder'));
```

**Add the default, then drop it.** `ADD COLUMN ... DEFAULT` backfills the existing 42 rows as
`authoritative`, which is correct — they were hand-verified. Dropping it afterwards forces every
future insert to state what it is; left in place, a placeholder insert that forgot `source` would
be silently recorded as authoritative, and that is the one direction this column must never be
wrong in.

Comment the column with what each value means and how to clear placeholders. Update
`supabase/seed/hymns.sql` to set `source` explicitly on its 42 rows — the column is NOT NULL with
no default, so the seed fails loudly otherwise, which is the intended behaviour.

### 2. `lib/music/hymnSource.ts` — the pure half

- `HYMN_SOURCES = ['authoritative', 'placeholder']`, `HYMNBOOK_SIZE = 341`.
- `placeholderTitle(n)` returns `[Placeholder] Hymn <n>`. **Do not make these look like real
  titles.** The ugliness is the safety property: this codebase prefers safe-by-construction over
  safe-by-a-flag-somebody-notices, the same instinct as `program-c` omitting fields from
  `PublicProgram` rather than nulling them. If one reaches a printed programme, it is obvious.
- `isPlaceholderTitle(title)` for the UI flag and for the reset script's sanity check.
- `buildPlaceholderRows(existingNumbers)` returns rows for every number in 1..341 **not** already
  present. Takes the existing numbers rather than querying, so it stays pure and testable, and it
  never overwrites — running it twice is harmless and it cannot clobber the 42 verified rows.
  **Give placeholders no topic tags.** A synthetic tag makes topic search *look* populated while
  returning meaningless results, which is worse for testing than an honestly empty result.
- `parseHymnImport(text)` returns `{ rows, problems }`. Accepts **JSON or CSV**, decided by content
  rather than file extension — an export renamed by hand is not a reason to refuse it. Reuse
  `parseCsvText` from `lib/roster/csv/parseCsv.ts`: it is `roster-c`'s hand-written RFC 4180 parser
  and **imports nothing**, which is exactly what lets a plain-Node script use it.
  - Carry the parser's own `problems` through as well as the validation ones. A caller that saw
    only the validation problems would report a clean import of a partly unreadable file.
  - Use the parser's `rowNumbers`, not an index: blank records are dropped, so an index names the
    wrong line after the first one.
  - Report every bad row and still load the good ones — `roster-c`'s rule: a file is normally 99%
    fine, and refusing all of it means somebody hand-edits a spreadsheet in the dark.
  - **Refuse a row whose title is itself a placeholder.** Importing one would write an unverifiable
    title under the `authoritative` label, which is the exact confusion the column exists to prevent.

### 3. `supabase/scripts/hymns.ts` — the CLI

Follow `supabase/scripts/ingestStandardWorks.ts`: service-role client, env through
`testing/infrastructure/envLoader.ts`, and the `--import ./supabase/scripts/register.mjs` hook in
the npm script so plain Node understands the `@/*` alias.

| Script | Does |
|---|---|
| `npm run hymns:placeholders` | Inserts a placeholder for every number 1..341 not already present. Reports how many added, how many skipped. |
| `npm run hymns:reset` | Deletes **`where source = 'placeholder'` only**. Reports the count. |
| `npm run hymns:import -- <file>` | Parses, prints problems, upserts `on conflict (number) do update`, marks rows `authoritative`. Reports added / updated / refused. |

**`reset` deliberately has no `--all`.** Deleting the 42 verified rows is not something anybody
should be one flag away from, and a short import file would otherwise leave the ward with *fewer*
hymns than it started with.

### 4. Make a placeholder visible wherever a hymn is shown

A column nobody sees is a column that stops being true. Search results, the coordinator's selection
card and `program-b`'s hymn fields should all mark an unverified row — and `MeetingOrderPanel`
(the printed PDF, `program-d`) is the one that matters most. **Decide during the walk whether the
PDF should refuse to print a placeholder outright.**

### 5. Verify

`select source, count(*) from hymns group by source` gives 42 authoritative and 299 placeholder.
Spot-check that hymn 2 is still `The Spirit of God` and `authoritative`, and that hymn 43 is a
placeholder.

### When the real hymnbook arrives

1. **Copyright posture — check before fetching anything.** Hymn text is published by Intellectual
   Reserve, and CLAUDE.md §9 records the equivalent caution for conference talks: read the terms of
   use and `robots.txt` first, and look for a sanctioned bulk or export source. **Numbers and titles
   are a much lighter case than full lyrics** — this plan stores only `number`, `title` and
   `topic_tags`, and never stores or displays hymn text. Say that explicitly when raising it; it is
   likely the difference between a blocked plan and an easy yes.
2. `npm run hymns:reset`, then `npm run hymns:import -- <file>`.
3. Record where the data came from, in a migration comment or a note. The next person to doubt a
   number needs to know.

---

## Relevant Files

### Create

| File | What it does |
|---|---|
| `supabase/migrations/042_hymn_source.sql` | The `hymns.source` provenance column (Task 0) |
| `lib/music/hymnSource.ts` | Placeholder rules and import parsing, pure (Task 0) |
| `supabase/scripts/hymns.ts` | `hymns:placeholders`, `hymns:reset`, `hymns:import` (Task 0) |
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
| `supabase/migrations/043_music_write_scope.sql` | Narrows selection writes below ward-wide |

### Modify

| File | What changes |
|---|---|
| `lib/program/gather.ts` | Reads through `lib/music/queries.ts` instead of inline. **Keep `readProgramRenderSettings`** — `program-d` added it after this plan was written; only the `hymn_selections` / `musical_numbers` readers go |
| `supabase/seed/hymns.sql` | Its 42 rows set `source` explicitly (Task 0) |
| `package.json` | The three `hymns:*` scripts (Task 0) |
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

**File:** `supabase/migrations/043_music_write_scope.sql` (create)

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
| `tests/rls/music-access.test.ts` | Ward isolation on selections; `hymns` readable by all; post-043 an `org_secretary` cannot insert a selection |
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
