# Plan: Notification Trigger Drift Test

**Created:** 2026-08-28
**Type:** bugfix (the scope labels it a Chore; the harness delivers no notification where one is
due, which is broken behaviour rather than tidying)
**Scope refs:** ITER-023

## Overview

The notification trigger keys are hand-maintained in **four** places, and three of them disagree.
`youth-d` updated the seed SQL and its migration and not the harness array, and the symptom was
exactly what migration 036's header warns about: flagging a follow-up **stamped `flag_sent_at`,
wrote an audit row saying `notified: true`, and delivered nothing.** `emitNotification()` looks the
key up in `notification_settings`, found no row for the harness ward, and returned silently.

Measured against the files on 2026-08-28, not counted by hand:

| Source | Keys | What it is missing |
|---|---|---|
| `supabase/seed/notification_triggers.sql` | **30** | — this is canonical |
| `SPEC.md` §Trigger Keys (v1) | **28** | `youth_activity_flagged_for_ward_council`, `youth_account_locked` |
| `NOTIFICATION_TRIGGERS` in `testing/infrastructure/seedUtils.ts` | **26** | `program_pending_approval`, `program_approved`, `program_changes_requested`, `program_distributed` |

The drift is purely additive — nothing appears in a downstream list that is absent from the seed,
and the `default_roles` agree on all 26 keys the seed and the harness share. The fourth place is a
migration per key, which is correct for every key and is not touched here.

**Real wards were never affected.** Migration 057d inserted the youth row for all eight, and
migrations 036 and 041 inserted the four program rows. The failure is confined to the harness —
which is where it is worst, because the harness is where such a failure is supposed to be caught.

### Key requirements

1. Bring `NOTIFICATION_TRIGGERS` to the canonical 30 by adding the four `program_*` keys.
2. Add the two missing keys to SPEC.md, per CLAUDE.md §1 — the specs win unless the spec is wrong,
   and here it is wrong in the direction of omission.
3. **Make the rule enforced rather than stated.** A test that diffs all three lists against each
   other and fails naming the difference in both directions. Every input is a file on disk, so it
   needs no database.
4. Update the two comments that assert the match, and scenario 031's record of the defect.

### Success criteria

- `NOTIFICATION_TRIGGERS`, the seed SQL, and SPEC.md all carry the same 30 keys.
- The new test fails loudly if any one of the three is edited without the others — verified by
  temporarily removing a key during development, not assumed.
- Scenario 031's Defect 2 is closed and its record says so.
- Scenario 035's checklist line "The bishop's notification bell has a 'The sacrament program has
  gone out' entry" becomes reachable for the first time.

## Relevant Files

- `tests/db/notification-triggers-seed.test.ts` — **create** — the three-way diff. No database.
- `testing/infrastructure/seedUtils.ts` — **modify** — add the four `program_*` keys to
  `NOTIFICATION_TRIGGERS`; rewrite the comment block that says they are deliberately left out,
  because that stops being true.
- `SPEC.md` — **modify** — add the two missing keys to §Trigger Keys (v1) with a new
  "Youth Accounts" heading.
- `supabase/seed/notification_triggers.sql` — **modify** — header comment only. It claims a match
  with SPEC.md that was false; point it at the test that now enforces it. **No key changes** — this
  file is already correct.
- `testing/scenarios/program/scenario-031-the-program-that-is-not-ready/scenario.md` — **modify** —
  the "Defect 2 from the walk is NOT fixed" paragraph becomes a record of the fix.

**Deliberately not touched:** `supabase/migrations/036_program_notifications.sql` and every other
applied migration. An applied migration is history and is never edited, even when its comment
understates the rule.

## Dependencies

- No new libraries. `node:fs` and `node:path` only, both already used by
  `tests/db/migrations.test.ts`.
- No migration. Every key already exists in the database for every real ward.
- No schema or type change. `emitNotification()` takes `triggerKey` as a plain `string` — there is
  no TypeScript union of trigger keys anywhere in the app, which is a fifth copy that does not
  exist and should not be created by this change.

## Known Pitfalls (from retro context)

- **`foundation-c-services`** — "The `notification_settings` seed is per ward and runs at seed time
  only. A ward created later — including every test fixture ward — has no trigger rows until
  something inserts them." That is the root of this entire item: the harness ward is exactly such a
  ward, and its trigger rows come from `NOTIFICATION_TRIGGERS` rather than from the seed file.
- **Migration 036's header states the rule as TWO parts** (seed file + migration). There are three,
  and four counting SPEC.md. The stated rule was correct and incomplete, which is why following it
  faithfully still produced this bug. Do not restate the two-part rule anywhere; state the enforced
  one and name the test.
- **`ai-b` / `program-e` / `youth-c` — a test that cannot fail.** This codebase has repeatedly
  shipped assertions that passed while the thing under test was dead: a timeout-based privacy test
  that passed while realtime was off, a plural bug the fixture's own design hid, checklist lines
  describing states the app cannot reach. **A regex parser that matches nothing makes
  `expect(a).toEqual(b)` pass on two empty arrays.** This is the single most likely way to ship
  this change green and useless, and Task 3 guards it explicitly.
- **`youth-c`** — `npm run build` caught what lint, typecheck and 2982 tests missed. Run it even
  though this change touches no app code.
- **`roster-c` / `visits-b`** — a rule kept in step by a comment beside the thing it governs is not
  kept in step. `NOTIFICATION_TRIGGERS` already carried "Must match
  supabase/seed/notification_triggers.sql exactly" **while being wrong by five keys.**

## Tasks

### Task 1: Add the four `program_*` keys to the harness list

**File:** `testing/infrastructure/seedUtils.ts` (modify)
**Action:** Bring `NOTIFICATION_TRIGGERS` to 30 keys and correct the comments around it.
**Details:**

- Insert a Programs block matching the seed file's roles exactly:

      { key: "program_pending_approval", defaultRoles: ["bishop", "counselor"] },
      { key: "program_approved", defaultRoles: ["bishop", "counselor", "ward_secretary"] },
      { key: "program_changes_requested", defaultRoles: ["bishop", "counselor", "ward_secretary"] },
      { key: "program_distributed", defaultRoles: ["bishop", "counselor", "ward_secretary"] },

  Place them between `youth_activity_flagged_for_ward_council` and `agenda_published`, so the array
  reads in the same order as the seed file. Order is not asserted by the test, but a reader
  diffing the two files by eye is the fallback when the test is not what catches it.
- **Rewrite the long comment above `visit_flagged_for_ward_council`.** It currently says the four
  program keys "are left alone here deliberately — adding them would change what program scenarios
  observe, which is that slice's call to make rather than this one's." That sentence becomes false.
  Replace it with a short note that the list is now enforced by
  `tests/db/notification-triggers-seed.test.ts`, and that a key added to the seed file without
  being added here fails that test rather than going silent.
- Keep the `youth_activity_flagged_for_ward_council` comment recording how it was found — that is
  the record of the failure mode and is still true.
- Do not change `seedNotificationTriggers()`. It upserts on `ward_id,trigger_key`, so re-running
  any scenario seed picks the new keys up. Its return value feeds `console.log` lines only; no
  scenario asserts a trigger count, verified by grep across `testing/`.

### Task 2: Add the two missing keys to SPEC.md

**File:** `SPEC.md` (modify)
**Action:** Bring §Trigger Keys (v1) to 30.
**Details:**

- Under `-- Youth Activities`, after `youth_followup_submitted`, add a line for
  `youth_activity_flagged_for_ward_council` with a trailing `--` comment noting it was added by
  migration 057d for a follow-up raised to the ward council.
- Add a new final section `-- Youth Accounts` holding `youth_account_locked`, matching the seed
  file's own grouping.
- Comment style: SPEC's list uses `key   -- explanation`, as `assignment_reverted` does. Match it.
  The test strips everything from `--` onward, so the comment text is free-form.
- Do not reorder or reword any existing line. The parser is tolerant, but a diff that touches only
  what changed is what makes the spec edit reviewable.

### Task 3: The three-way drift test

**File:** `tests/db/notification-triggers-seed.test.ts` (create)
**Action:** Parse all three lists from disk and compare them.
**Details:**

- Start with the `@vitest-environment node` pragma, then a header comment in the style of
  `tests/db/migrations.test.ts` explaining why the suite exists: three hand-maintained copies of
  one list, the drift is silent by construction because the only symptom is a notification that
  does not arrive, and the comment asserting the match had been wrong by five keys.
- **No database and no import from `testing/`.** Read all three as text with `readFileSync` and
  `path.resolve(process.cwd(), …)`, the pattern `migrations.test.ts` already uses.

  **This is load-bearing, and was verified rather than assumed.** Importing
  `NOTIFICATION_TRIGGERS` directly fails `npm run typecheck` with four `TS5097` errors — the
  harness uses `.ts`-extension imports under its own `nodenext` tsconfig with
  `allowImportingTsExtensions`, the root tsconfig has neither, and `tsc`'s `exclude` does not stop
  it following an import. That is also why no file in `tests/` imports from `testing/` today.

- Three parsers, each a small named function:

  - `parseSeedSqlTriggers(text)` returning `{ key, defaultRoles }[]`. Strip `--` comments to end of
    line **first** — the seed file's prose mentions `visit_flagged_for_ward_council` inside a
    comment — then match each `('key', array[…])` tuple and pull the quoted role literals out of
    the captured group. Must tolerate the `::text[]` cast, which appears on the first tuple only.
  - `parseHarnessTriggers(text)` returning `{ key, defaultRoles }[]`. Slice from
    `NOTIFICATION_TRIGGERS` to the first `];`, strip `//` comments to end of line, collapse
    newlines to spaces, then match each `{ key: "…", defaultRoles: [ … ] }` object. Collapsing
    whitespace is what makes the one multi-line entry (`org_conducting_rotation_changed`) parse the
    same as the single-line ones. Slicing to the array region *before* stripping `//` is what keeps
    the strip from damaging anything else in a 1700-line file.
  - `parseSpecTriggerKeys(text)` returning `string[]`. Slice from the `### Trigger Keys (v1)`
    heading, take the first fenced block, strip `--` comments, trim, drop empty lines. Section
    headings such as `-- Programs` become empty and fall out on their own.

- Assertions, in this order:

  1. **Each parser found its anchor key** — assert each of the three key lists contains
     `plan_submitted`. *This is the guard against the whole suite passing on three empty arrays* —
     see Known Pitfalls. An anchor is used rather than a hardcoded count of 30, so adding a key
     later does not require editing this test.
  2. **No source has a duplicate key.** Compare set size with list length for each. A duplicate
     would let a set comparison pass while the seed insert carries a redundant tuple.
  3. **The harness list matches the seed, in both directions.** Compute the keys in the seed and
     not the harness, and the reverse, and assert **each is an empty array** — two separate
     expectations, so the failure message names which direction and which keys, the way
     `migrations.test.ts` asserts on `unappliedVersions`. Never compare lengths: a length says
     nothing about which key is missing.
  4. **`default_roles` agree for every shared key.** Compare **sorted** copies — the order of a
     Postgres `text[]` is preserved but carries no meaning, and asserting order would make a
     harmless reordering a failure. Build a list of mismatches carrying the key and both role
     lists, and assert it is empty, so the message shows both sides.
  5. **SPEC.md matches the seed, in both directions.** Keys only — SPEC carries no roles, and the
     test should say so in a comment rather than leaving a reader wondering why roles are checked
     for one pair and not the other.

- Do not assert a total count anywhere. A test that must be edited every time a key is added is a
  test somebody eventually edits without thinking.

### Task 4: Correct the two comments that state the rule

**File:** `supabase/seed/notification_triggers.sql` (modify — header comment only)
**Action:** Make the header's claim enforceable rather than aspirational.
**Details:**

- The header says the keys "must match SPEC.md §Trigger Keys EXACTLY" — a true requirement that
  nothing checked, and it was false by two keys while saying so.
- Keep the requirement, add the enforcement: name `tests/db/notification-triggers-seed.test.ts` and
  say that a key added here without SPEC.md and `NOTIFICATION_TRIGGERS` fails that test.
- Update the "Thirty keys; count them against the spec if you edit" line. The count is currently
  correct, and the instruction to recount by hand is now obsolete — the test does it. Say that
  instead, and keep the note about the count having once read "twenty-eight" while the block held
  twenty-nine: it is the reason the file distrusts hand-counting.
- **Change no keys and no roles in this file.** It is the canonical list and it is already right.

### Task 5: Close scenario 031's Defect 2 in its record

**File:** `testing/scenarios/program/scenario-031-the-program-that-is-not-ready/scenario.md`
(modify)
**Action:** The walk record says the defect is unfixed. Make it say what happened.
**Details:**

- The paragraph beginning "**Defect 2 from the walk is NOT fixed**" is now stale. Rewrite it to
  record that ITER-023 added the four keys and the drift test, dated 2026-08-28, and that the
  change it asked for — "it is shared harness infrastructure … so it wants its own change rather
  than riding along in this one" — is the change that made it.
- Under "Left unwalked", the line "The notification bell itself, blocked by Defect 2" is now
  unblocked. Say so rather than deleting it; a reader wants to know it went from blocked to
  available and still has not been walked.
- Do not alter the walk's findings, tables, or judgement answers. A walk record is what was
  observed on the day.

## Testing Strategy

The new suite is the deliverable, so most of the strategy is about proving the suite itself works.

**File:** `tests/db/notification-triggers-seed.test.ts` (the only test file created)

Cases, mapping to the assertions in Task 3:

- each of the three sources parses to a non-empty list containing its anchor key
- no source contains a duplicate key
- every seed key is present in `NOTIFICATION_TRIGGERS`
- every `NOTIFICATION_TRIGGERS` key is present in the seed
- `default_roles` agree, order-insensitively, for every shared key
- every seed key is present in SPEC.md
- every SPEC.md key is present in the seed

**Prove it can fail, before believing it passes.** Run each of these by hand during development and
confirm the failure message names the offending key, then revert:

1. Delete one key from `NOTIFICATION_TRIGGERS` → the seed-vs-harness assertion fails naming it.
2. Delete one key from the seed file → the reverse direction fails naming it.
3. Change one role on one harness key → the roles assertion fails showing both lists.
4. Delete one key from SPEC.md → the SPEC assertion fails naming it.
5. **Break a regex so a parser returns an empty list** → the anchor assertion fails. This is the
   case that matters most; without it the suite passes on empty input and this whole change is
   theatre.

No RLS suite, no route test, no database. The three inputs are files.

Not covered, and deliberately: the harness array's `Role[]` typing is lost by reading the file as
text. `npm run harness:typecheck` still checks it, and a role that is not a `Role` would fail there
rather than here.

## Test Scenarios (Harness)

**No new scenario.** This change adds no user-facing behaviour and no route — it corrects a data
list and adds a file-only unit test. Seeding cannot help test a test.

There is a real harness consequence to verify, though, and it is not a new scenario but a re-run of
five existing ones:

**Scenarios 028, 029, 031, 033, 035 — re-seed and re-check the notification steps.** All five call
`seedNotificationTriggers()` (verified), so all five have been running with no `program_*` rows.
After Task 1 they will produce real notification rows where they previously observed silence.

- **Scenario 035 is the one that matters.** Its checklist line "The bishop's notification bell has a
  'The sacrament program has gone out' entry" has never been reachable. It is now, and 035 is one
  of the two walks **M4 is waiting on**.
- **Scenario 031** should be re-seeded and its send-for-approval step re-run to confirm
  `program_pending_approval` now reaches the bell. Note that the *claim* "The bishopric has been
  notified." was already removed from the UI during that walk and should stay removed — the fix
  here makes the notification arrive, it does not restore a sentence asserting that it did.

## Validation Commands

```bash
# The new suite alone, first — it is the deliverable and it needs no database
npx vitest run tests/db/notification-triggers-seed.test.ts

# Linting
npm run lint

# Type checking — app graph
npm run typecheck

# Type checking — harness graph, which is where seedUtils is actually checked
npm run harness:typecheck

# Full suite. Slow: the RLS suites run over the network against the shared hosted project
npm test

# Production build
npm run build
```

## Integration Notes

- **The harness database needs no migration and no manual fix.** `seedNotificationTriggers()`
  upserts on `ward_id,trigger_key`, so the next run of any scenario seed inserts the four new rows
  for the harness ward. Nothing has to be cleaned up first.
- **Real wards are unaffected in every direction.** They already hold all 30 rows via migrations
  036, 041 and 057d. This change touches no production data path.
- **`emitNotification()` is unchanged.** It still returns silently on a key with no row — that
  contract is deliberate ("a notification outage must not become an app outage") and is not what
  this item is fixing. What changes is that the drift which produces an unknown key is now caught
  before it reaches a ward.
- **Considered and not done: deleting the third copy instead of testing it.** `NOTIFICATION_TRIGGERS`
  could be imported from a shared module rather than hand-maintained — `seedUtils.ts` already
  imports from `lib/`. It was rejected because **the SQL copy is irreducible**: a `.sql` seed file
  cannot import a TypeScript array, so a file-diff test is required whatever happens to the harness
  copy. Given the test must exist anyway, moving harness infrastructure as well is a refactor
  outside this item's scope (CLAUDE.md §7) for no additional guarantee. If a fifth consumer ever
  appears, that is the moment to revisit.
- **Considered and not done: asserting that every seed key has a back-fill migration.** This is
  migration 036's actual warning and it is not checked by anything. It cannot be checked from files
  alone without an allowlist of the keys that predate the first ward — and an allowlist maintained
  by hand is the same defect this item exists to remove. The database is the better oracle for that
  question, and it belongs with Phase 11's notification work.
- **Documentation:** SPEC.md is updated by Task 2. No CLAUDE.md change — the rule is now enforced
  by a test, and §9 is for decisions that constrain future work rather than for chores that close
  themselves.
- **No breaking changes.** No route, component, type, policy or migration is touched.
