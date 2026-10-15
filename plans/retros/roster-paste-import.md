---
id: roster-paste-import
type: feature
iter: [ITER-040]
commits: ["d20c367"]
date: 2026-10-14
files:
  - supabase/migrations/090_roster_paste_import.sql
  - lib/roster/paste/parsePastedReport.ts
  - lib/roster/paste/reportColumns.ts
  - lib/roster/paste/normalizeReportRow.ts
  - lib/roster/paste/buildRosterDiff.ts
  - lib/roster/paste/loadRosterForDiff.ts
  - lib/roster/paste/pasteRequest.ts
  - lib/roster/paste/applyRosterPaste.ts
  - lib/roster/ageGroup.ts
  - lib/validation/rosterPaste.ts
  - lib/validation/roster.ts
  - lib/roster/queries.ts
  - lib/calendar/dates.ts
  - app/api/roster/import/route.ts
  - app/api/roster/import/preview/route.ts
  - app/(app)/roster/import/page.tsx
  - app/(app)/roster/import/PasteImport.tsx
  - app/(app)/roster/import/ReviewChecklist.tsx
  - app/(app)/roster/member/[id]/page.tsx
  - components/roster/ImportProblemList.tsx
  - supabase/scripts/fillTestRosterFields.ts
  - testing/infrastructure/seedUtils.ts
related:
  - roster-c-csv-import
  - roster-a-data-and-pages
---

## What was done

The roster's CSV file upload was replaced by a paste of the LCR custom ward list report. A leader
copies the whole table from LCR and pastes it. The app rebuilds the table, matches columns by header
text in any order, and shows a checklist of differences against the current roster: new people,
changed people (each field before → after), household address changes, and people no longer listed.
Only ticked items are applied, in one transaction (`apply_roster_paste`, migration 090), and nothing
is ever deleted. Migration 090 also adds twelve member columns (full name, preferred name, birth
date, email, and silent callings/class/ministering fields).

## Key decisions

- **LCR's copy is not a CSV, so records are rebuilt by tab count.** Headers come one per line, and a
  callings cell with a line break splits its row across several lines with no quoting. A record is
  complete when it holds one tab fewer than there are headers. On the user's real paste this gives
  353 people, 0 problems and 204 households (checked by counts only, never printed).
- **One pure diff, recomputed on apply.** `buildRosterDiff()` takes data and returns data. The preview
  and apply routes both call it, and the apply re-parses the paste against the current roster, so the
  client sends only which ids were ticked. Ids gone by the time of apply are counted as stale, never
  guessed at.
- **Match on full name + birth date, with a legacy first + last fallback** that only matches when
  exactly one person on each side has that name. Names are split from Preferred Name at the first
  comma (the user's decision, reversing the old "never split a name" rule).
- **Absent is not blank.** A missing optional column is "not supplied" and never clears a stored
  value; the apply function writes only the keys present in each update's `set`.
- **No longer listed starts unticked and means `moved_out`.** A paste that would move out at least
  10 people and over a quarter of the ward warns and locks "Tick all" until acknowledged.
- **Found while building, fixed:** `updateMemberSchema` defaulted `status` to active on every PATCH
  (Zod 4 keeps `.default()` through `.partial()`), which would have undone a move-out. The snapshot
  read pages through members, because PostgREST stops at `max_rows` (1000) without an error and a
  cut-short snapshot would show everyone past the cut as new.
- **Birth dates display as LCR writes them** ("13 Jun 1986"), built from the date-only string by
  hand: ICU's en-GB short month for September is "Sept".

## Gaps and limits

- Three-way review ("changed in the app since the last report") is deferred to the Callings and
  Ministering modules; it needs a stored snapshot of the previous report.
- Callings, class and ministering are stored silently and never reviewed or shown.
- Households emptied by moves are left behind (visit history may hang off them) and accumulate.
- Only the text/plain clipboard flavour is read; the HTML flavour was not needed on the real paste.
- Migration 090 drops `apply_roster_import()`. Between the push and the deploy, the old build's CSV
  upload would answer 500.
- After ITER-041, import permission in the real ward is the super admin's only.

## Walk (scenario 089, 2026-10-14)

Walked by Claude in Playwright at 375px: every machine check passed with the scenario's exact
counts, read back from the database. Two defects found, both approved by the user and fixed the
same day: the checklist's Tick all / Untick all buttons and single-line row labels were 36px (now
44px), and the new-household notification joined LCR household names, which contain commas, with
commas (now semicolons). The user answered "tests pass". The tap-target fix has not been re-measured
in a browser.
