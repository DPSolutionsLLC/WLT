---
id: youth-b-ics-import
type: feature
iter: null
commits: ["ba86121"]
date: 2026-08-28
files:
  - supabase/migrations/055_activity_event_source.sql
  - lib/ward/wardTimezone.ts
  - lib/youth/ics/limits.ts
  - lib/youth/ics/resolveInstant.ts
  - lib/youth/ics/occurrence.ts
  - lib/youth/ics/parseIcs.ts
  - lib/youth/ics/importRequest.ts
  - lib/youth/ics/buildImportPreview.ts
  - lib/youth/ics/applyImport.ts
  - lib/validation/youthImport.ts
  - lib/youth/queries.ts
  - app/api/youth/calendars/import/preview/route.ts
  - app/api/youth/calendars/import/route.ts
  - app/(app)/youth/import/page.tsx
  - app/(app)/youth/import/IcsImportWizard.tsx
  - app/(app)/youth/import/IcsPreviewStep.tsx
  - app/(app)/youth/EventList.tsx
  - app/(app)/youth/page.tsx
  - components/youth/IcsProblemList.tsx
  - testing/infrastructure/seedUtils.ts
related:
  - youth-a-profiles-and-events
  - roster-c-csv-import
  - talks-d-reliability-goals
  - calendar-a-rules-and-api
  - visits-b-progress-dashboard
---

## What was done

Phase 8 slice B of four: uploading a school or league `.ics` file against one activity profile,
previewing exactly what it will create, and confirming — with a re-import next month adding only
what is new. One new dependency, `ical.js@2.2.1` (MPL-2.0, the first non-MIT/Apache package here),
and deliberately **no** timezone library: `lib/youth/ics/resolveInstant.ts` does the zone
arithmetic in about twenty lines of `Intl`, on the same reasoning that made
`lib/roster/csv/parseCsv.ts` a hand-written RFC 4180 parser.

Migration 055 adds `all_day`, `source_uid` and `source_recurrence_id`, and the unique index that
makes re-import idempotent **in the database** rather than in TypeScript. `wards.settings.timezone`
gains its first reader in the whole repo, having been seeded since Foundation B with two migrations
referring to it in comments and nothing reading it.

## Key decisions

- **`ICAL.Time.toJSDate()` is called nowhere in this slice.** It resolves a floating time — and any
  unregistered `TZID` — against the *process's* zone, which is `America/Denver` on the dev machine
  and UTC on Vercel. That is a bug which passes every local test and ships wrong, and it is exactly
  the failure `08-youth-activities.md` names ("a game showing at the wrong hour makes the whole
  feature useless"). So `parseIcs.ts` carries a wall clock and a zone **name** separately, and
  `resolveInstant.ts` is the single pure place they become an instant. It takes **two**
  offset-correction passes, because one is wrong for one hour twice a year.
- **A floating time is read in the ward's zone and the preview says so per event; an all-day entry
  is stored at ward midnight and marked.** Refusing floating times was rejected — school feeds
  publish them routinely, and refusing would leave manual entry as the only path. `all_day` exists
  because without it every tournament weekend renders "12:00am", which on that screen is
  indistinguishable from the off-by-N-hours bug the slice is most likely to produce; the marker is
  what keeps a real bug legible.
- **An event absent from a re-imported file is LEFT ALONE.** No deletes and no status writes, ever.
  A feed that briefly publishes a short file must not cancel a season, and a re-import must never
  destroy what a leader typed, corrected, or cancelled by hand. `status` and `event_type` are never
  touched on a matched row, so slice C's home/away correction will survive every future import.
  *The trap avoided:* "absent from the file" is computed within the window the file itself covers,
  never against all time — recurrence is expanded only ~12 months ahead, so over all time every
  past game would qualify.
- **One match key, not two.** `08-youth-activities.md` said "match on `UID` where present, else
  title + date"; two rules is two code paths that can disagree, so a `VEVENT` with no `UID` gets a
  deterministic synthesised one (`wlt-synth-…`) and the key is always
  `(calendar_id, source_uid, source_recurrence_id)`.
- **`nulls not distinct` on the unique index is load-bearing, and was proved so.** Without it two
  rows with a null `source_recurrence_id` would not conflict — the `talks-d` hole in a new place —
  and every one-off game would duplicate on re-import. The partial `where` is equally load-bearing
  in the other direction: without it every hand-entered row (null on both columns) would collide
  with every other, and a ward could enter exactly one manual event ever. Both were verified by
  attempting the inserts directly, not assumed.
- **A server-only module reachable from a client component costs ~505KB and breaks nothing.**
  `IcsPreviewStep` imports a value from `buildImportPreview`, which reached `parseIcs` → `ical.js`.
  The prediction was a build failure; measured, Next 16 shims `node:crypto` and the build succeeds
  either way — `.next/static` simply grows from 2,083,281 to 2,600,417 bytes. `occurrence.ts` now
  holds the pure types and `occurrenceInstant`, and its header records the numbers **and** that no
  check in this repo would catch the regression.
- **`parseWardTimezone` refuses a bare offset that `Intl` accepts.** `-07:00` is a valid
  `timeZone` to `Intl.DateTimeFormat`, and a fixed offset has no daylight saving — so a ward
  configured that way would see every summer game an hour out with nothing saying why. Found by
  writing the table-driven test, not by reasoning.

## What walking it found

Three defects, all copy rather than correctness, all fixed the same day and re-verified in the
browser:

1. **An all-day entry was told it carried no time zone** — the note rendered directly beneath the
   words "all day". Fixed at the boundary in `toPreviewEvent` rather than at the render site, so a
   second reader of `usedWardZone` cannot bring the sentence back elsewhere. Guarded by a **pair**
   of tests, so the fix cannot become "delete the feature".
2. **`1/2/2027`** — a bare `toLocaleDateString()` in the client, beside a dozen dates reading
   `Sat, 2 Jan 2027`, on the one screen whose entire job is that dates are unambiguous. Moved to
   the server so every date on the page goes through one function.
3. **"1 events updated"** on the result screen, while the preview and the confirm button both
   pluralised correctly — so the one screen that got it wrong was the one a leader reads last.

Also confirmed live: **`roster-c`'s file-changed retro reproduced exactly.** Editing the `.ics` on
disk between preview and confirm produced `net::ERR_UPLOAD_FILE_CHANGED` surfaced as a bare
`TypeError: Failed to fetch` — the request never reached the server, so the `fileHash` check never
got to answer, and `describeRequestFailure()` re-reading one byte of the `File` is the only reason
the user sees the right sentence instead of "check your connection".

And **`youth-a-D2` did not recur.** `/youth` was first loaded with an empty schedule, so TanStack
held a 0-event cache entry; after confirming, client-side navigation rendered 12. Re-proved in
scenario 052 with a `window` sentinel that survived the navigation: cached 12, rendered 14.

## Pattern

**A copy defect is invisible to the test suite by construction, and that is what the harness walk
is for.** All three defects here were reachable only by reading the actual screen — every one of
them had passing unit tests, a passing route test, a green build, and correct data underneath.
Two now carry regression tests; the third (pluralisation) carries a checklist line instead, which
is honest about where a sentence-level bug is actually catchable.

**Two checklist lines were also corrected rather than skipped.** "Every control at least 44×44"
could not pass on any page in this app, since `/roster`, `/roster/import` and `/youth` all use
~20px inline text links for import entry points. And scenario 051 had no line describing the
all-day entry's zone note at all — which is precisely why defect 1 had nowhere to fail.
