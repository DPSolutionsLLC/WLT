# Plan: Youth B — ICS Calendar Import

**Created:** 2026-08-27
**Type:** feature
**Phase:** 8 — Youth Activity Support ([08-youth-activities.md](08-youth-activities.md)), slice B of four

---

## Overview

Phase 8 ships in four slices. **This plan covers slice B only**: uploading a school or league
`.ics` file against one activity profile, previewing exactly what it will create, and confirming.

| Slice | Covers | Status |
|---|---|---|
| youth-a | Migration 054, profiles CRUD, manual events, `/youth` | Built 2026-08-27 (`6b23fcd`) |
| **youth-b** (this plan) | ICS upload: `ical.js`, preview-then-confirm, timezones, `RRULE`, idempotent re-import, `activity_calendars` | — |
| youth-c | Home/away classification, attendees, coverage on read, `/youth/calendar` | Not planned |
| youth-d | `activity_logs`, shared/private split, ward-council flagging, report feed | Not planned |

Google Calendar sync stays **cut**, per the phase plan's own Pitfalls section
(*"Cut Google sync before cutting anything else here"*). `ACTIVITY_SOURCE_TYPES` keeps its
`google_sync` value; nothing writes it.

### What slice B delivers

A Young Men president exports the varsity basketball schedule from the school's calendar, uploads
the file against the *Varsity Basketball* activity they already created in slice A, reads a
preview that names every game **and the hour it will show at**, and confirms. Uploading the same
file again next month adds only what is new.

### Success criteria

1. A game in the file at 7:30pm local shows at 7:30pm in the app — on Vercel, whose server clock
   is UTC, and on a dev machine in `America/Denver`. The two must agree.
2. Re-importing the identical file creates nothing, updates nothing, and says so.
3. An `RRULE` with no `UNTIL` produces a bounded number of rows, not an infinite loop.
4. Nothing is written by the preview route. Nothing is written that the preview did not name.
5. Nothing a person typed, corrected, or cancelled by hand is overwritten by an import.

### Three decisions taken before planning

Put to the user on 2026-08-27 and answered, the same way `youth-a`'s four were. They are recorded
here because each changes the schema or the write path.

1. **A floating time is read in the ward's time zone.** `DTSTART:20270115T193000` carries no zone.
   `wards.settings.timezone` is seeded as `America/Denver` and **is currently read by no code in
   this repo** — this slice is its first reader. The preview shows the resolved hour and says the
   file gave no zone, so a leader sees "7:30pm" before confirming rather than after. Refusing such
   files was rejected: school feeds publish floating times routinely, and refusing would leave
   manual entry as the only path.
2. **An all-day entry is stored at ward midnight and marked `all_day`.** Migration 055 adds the
   column. Without it every tournament weekend renders "12:00am", which on this screen is
   indistinguishable from the off-by-N-hours bug this slice is most likely to produce — the marker
   is what keeps a real bug legible. Slice C needs the flag too: *"within 7 days"* is answerable
   for an all-day event, *"who covers 12:00am"* is not.
3. **An event in the app but absent from a re-imported file is LEFT ALONE**, and the preview says
   so by name. The confirm performs no deletes and no status changes. A feed that briefly
   publishes a short file must not be able to cancel a season, and a re-import must never destroy
   something a leader typed or cancelled by hand. *The trap this avoids:* recurrence is expanded
   only ~12 months ahead, so "absent from the file" is computed **within the window the file
   covers**, never against all time — otherwise every past game qualifies.

---

## Relevant Files

### Create

| File | Why |
|---|---|
| `supabase/migrations/055_activity_event_source.sql` | `all_day`, `source_uid`, `source_recurrence_id`, the idempotency index, `activity_calendars` tightening |
| `lib/ward/wardTimezone.ts` | Reads `wards.settings.timezone`; first reader of a key seeded since Foundation B |
| `lib/youth/ics/limits.ts` | File size, event count, accepted types, problem cap |
| `lib/youth/ics/parseIcs.ts` | `ical.js` → a list of raw occurrences carrying a **wall clock plus a zone name**, never an instant |
| `lib/youth/ics/resolveInstant.ts` | Wall clock + zone → UTC instant, via `Intl`. Pure, no `ical.js`, no clock |
| `lib/youth/ics/importRequest.ts` | Form-data read, file checks, SHA-256, shared by both routes |
| `lib/youth/ics/buildImportPreview.ts` | Diffs parsed occurrences against existing rows. Writes nothing |
| `lib/youth/ics/applyImport.ts` | The only module here that writes |
| `lib/validation/youthImport.ts` | Zod schemas for both routes |
| `app/api/youth/calendars/import/preview/route.ts` | Preview. No write path at all |
| `app/api/youth/calendars/import/route.ts` | Confirm |
| `app/(app)/youth/import/page.tsx` | Server Component: permission gate, profile list |
| `app/(app)/youth/import/IcsImportWizard.tsx` | Client: choose file → preview → done |
| `app/(app)/youth/import/IcsPreviewStep.tsx` | The preview table and its four counts |
| `components/youth/IcsProblemList.tsx` | Entries that will not import, with reasons |
| `tests/lib/icsTimezone.test.ts` | **Highest priority test in this slice** |
| `tests/lib/icsRecurring.test.ts` | `RRULE` expansion and its bound |
| `tests/lib/icsIdempotent.test.ts` | The diff, over a fixture imported twice |
| `tests/lib/wardTimezone.test.ts` | Setting parse and fallback |
| `tests/routes/youthCalendarImport.test.ts` | Both routes, happy path + 403 + 400 + 413 |
| `testing/scenarios/youth/scenario-051-*/` | The walkthrough |
| `testing/scenarios/youth/scenario-052-*/` | The re-import walkthrough |

### Modify

| File | Change |
|---|---|
| `package.json` | Add `ical.js` (approved for this slice by `plans/INDEX.md`, and by nothing earlier) |
| `types/database.ts` | Regenerate after migration 055 (`npm run db:types`) |
| `types/domain.ts` | Nothing new expected — `ACTIVITY_SOURCE_TYPES` and `EVENT_TYPES` already exist. Add labels only if the UI needs one that is missing |
| `lib/youth/queries.ts` | `allDay`, `sourceUid`, `sourceRecurrenceId` on `ActivityEvent` + its row type + mapper + column list; new `listActivityCalendars` / `getActivityCalendarForProfile` |
| `app/(app)/youth/EventList.tsx` | Render the `All day` marker instead of a midnight time |
| `app/(app)/youth/page.tsx` | A link to `/youth/import`, shown only under `youth_activities.manage` |
| `app/(app)/youth/youthQueries.ts` | Nothing structural — but see Task 14, the wizard must invalidate these keys |
| `tests/rls/youth-activity-scope.test.ts` | Add `activity_calendars` ward isolation |

---

## Dependencies

**One new library: `ical.js@^2.2.1`.**

- Zero runtime dependencies, ships its own TypeScript types (`dist/types/module.d.ts`), ESM with
  a CJS fallback. Verified against the npm registry on 2026-08-27.
- **Licence is MPL-2.0**, unlike the MIT/Apache dependencies already in `package.json`. MPL is
  file-level copyleft: using it unmodified as a dependency imposes nothing on this codebase. Flag
  it to the user at execution time; do not patch the package.
- `plans/INDEX.md` approves it **for this slice and no earlier one**. It is the only dependency
  this plan adds. Do not add `ical-expander`, `node-ical`, `rrule`, `luxon`, `@date-fns/tz`, or
  `ical.timezones` — see the two notes below.

**No timezone library, and no `ical.timezones.js` bundle.** Stock `ical.js` registers no zones at
all. This plan does the zone arithmetic itself in `resolveInstant.ts` using `Intl.DateTimeFormat`,
about twenty lines, for the same reason `lib/roster/csv/parseCsv.ts` is a hand-written RFC 4180
parser: it is small, it is testable, and it removes a dependency whose behaviour would otherwise
sit between the file and a correct hour.

**Existing utilities to use, not re-derive:**

- `lib/auth/session.ts` → `requireSessionUser()`
- `lib/auth/permissions.ts` → `assertCan`, `resolveRoleAccess`, `BISHOPRIC_ROLES`
- `lib/auth/routeErrors.ts` → `respondToRouteError`
- `lib/audit/writeAuditLog.ts` → `writeAuditLog()`
- `lib/youth/queries.ts` → `getActivityProfile`, `listActivityEvents`
- `app/(app)/youth/youthQueries.ts` → `YOUTH_EVENTS_QUERY_KEY`, `fetchProfiles`, `readJson`, `errorFrom`
- `lib/roster/csv/importRequest.ts` and `.../limits.ts` — **read them, copy the shape, do not
  import from them.** They are roster-typed. `capProblems` is generic and this would be its second
  user; the repo's stated rule (`plans/INDEX.md`, on `lib/visits/cadence.ts`) is to lift a shared
  helper on the **third** user, not the second. Write a youth twin and name the roster one in a
  comment.

---

## Known Pitfalls (from retro context)

| Retro | What to watch for here |
|---|---|
| `roster-c-csv-import` | **The preview and the result must not report two correct numbers that disagree.** The CSV import said "6 to update" then "3 updated" — both right, the pairing wrong. Here the risk is "12 events" in the preview and "9 created" after, because 3 already existed. Label the preview's counts with what they actually count and report the same four numbers on both screens. |
| `roster-c-csv-import` | **A fetch that throws after a file upload is more often a changed file than a dead network.** Chrome aborts with `ERR_UPLOAD_FILE_CHANGED`, surfaced as a bare `TypeError`, so the server-side hash check never gets to answer. Copy `describeRequestFailure()`'s trick: re-read one byte of the `File` to tell the two apart. |
| `roster-c-csv-import` | The server-side `fileHash` check is the second line of defence, not the first a user meets. Test it by **actually editing the file**, not by trusting the route. |
| `youth-a-profiles-and-events` (D2) | **A Server Component prop never refetches.** The wizard finishes on a different route from `/youth`; TanStack's cache survives that navigation, so a confirm that does not invalidate `YOUTH_EVENTS_QUERY_KEY` sends the user back to a schedule that does not contain what they just imported. This is the same defect twice already — `visits-b` stated the rule, `youth-a` shipped it anyway. |
| `youth-a-profiles-and-events` (D1) / `visits-d` | **A control the API refuses is still a bug — and hiding a control the API allows is the mirror mistake.** See Decision 4 below: `activity_events` and `activity_calendars` are ward-wide writable, so the import must be offered against **every** profile in the ward. Do not gate it on `canManageActivityProfile()`. |
| `youth-a-profiles-and-events` | `lib/youth/eventInstant.ts` never converts a wall clock — it appends the offset in force *at that moment*. The ICS path must be built on the same principle, and `resolveInstant.ts` is where it lives. |
| `calendar-a-rules-and-api` | A `select` column list must be **one string literal on one line**. A `+` concatenation widens the type to `string` and silently degrades every row to untyped. `ACTIVITY_EVENT_COLUMNS` gains three columns in Task 5 — keep it on one line. |
| `visits-d` / migration 047 | A composite `on delete set null` **must** carry its column list. Not relevant to 055 as written, but check any FK it touches. |
| `talks-d-reliability-goals` | SQL's `null = null` is NULL, not true. Relevant to the idempotency index: it needs `nulls not distinct` (Task 1). |
| `ai-d-corpus-scoping` | An empty-array `CHECK` shipped inert because `array_length` returns NULL on `'{}'`. Any constraint added here must be **proved to fail** on bad input, not assumed to. |
| `roster-c-csv-import` | Next 16 writes its dev log to `.next/dev/logs/next-development.log`. If a route 500s with a worker-crash wrapper, look there before debugging the code. |

---

## Design — the parts that need deciding once

### Decision 1: `toJSDate()` is never called. The wall clock and the zone stay separate until we convert.

`ICAL.Time.toJSDate()` resolves against the **process's local zone** for a floating time and for
any `TZID` that has not been registered. Locally that is `America/Denver`; on Vercel it is UTC.
That is a bug which passes every test on the dev machine and ships wrong — the exact class of
failure `08-youth-activities.md` calls out (*"A game showing at the wrong hour makes the whole
feature useless"*).

So `parseIcs.ts` returns, per occurrence:

```ts
export type IcsOccurrence = {
  uid: string;                 // synthesised if the file gave none — see Decision 3
  uidWasSynthesised: boolean;
  recurrenceId: string | null; // the occurrence's own DTSTART, ISO, for an expanded series
  summary: string;
  location: string | null;
  allDay: boolean;
  wallClock: WallClock;        // { year, month, day, hour, minute, second }
  zone: IcsZone;               // { kind: "utc" } | { kind: "named"; tzid } | { kind: "floating" }
};
```

No `Date` anywhere in that type. `resolveInstant.ts` is the single place a `WallClock` plus an
`IcsZone` becomes an instant, it is pure, and it is what `tests/lib/icsTimezone.test.ts` drives.

### Decision 2: an unresolvable `TZID` falls back to the ward zone and becomes a reported problem.

Register every `VTIMEZONE` the file defines (`ICAL.TimezoneService.register`) — most real feeds
include them. If a `TZID` is referenced and neither the file nor `Intl` can resolve it, the event
still imports, at the ward's zone, and is listed in the preview's problems with the zone name it
asked for. Silently treating it as UTC would be the wrong hour with no trace, which is worse than
a wrong hour a person was shown.

### Decision 3: one match key, so there is one code path.

`08-youth-activities.md` says *"match on `UID` where present, else title + date"*. Two rules is two
code paths that can disagree. Instead, when a `VEVENT` carries no `UID`, **synthesise a
deterministic one** — `sha256(summary + " " + dtstartRaw)`, truncated, prefixed `wlt-synth-`
— and set `uidWasSynthesised`. The match key is then always
`(calendar_id, source_uid, source_recurrence_id)`, and the fallback rule survives as a comment
explaining where the synthesised value comes from.

### Decision 4: `activity_calendars` keeps migration 019's ward-wide write policies.

Migration 054 left `activity_events` ward-wide on the grounds that an event inherits its
organization through its profile, and that a second copy of that answer could disagree with the
first. A calendar hangs off a profile in exactly the same way, and narrowing it alone would
achieve nothing anyway — the same leader could still create the events one at a time through the
route that already exists.

So: no new policy, and **the import is offered against every profile in the ward**, not only ones
the user could edit. Gating the profile select on `canManageActivityProfile()` would be `youth-a`'s
mirror mistake — hiding a control the API allows, which nobody ever notices is wrong.

*If this should ever be narrowed, the migration comes first and the UI follows it.*

### Decision 5: one ICS calendar per profile.

An import targets a **profile**. If that profile already has an `activity_calendars` row with
`source_type = 'ics_upload'`, reuse it and stamp `last_synced_at`; otherwise create one. One team
has one schedule feed, and this is what makes "re-import" mean something without asking the user
to pick which of three calendars they meant.

### Decision 6: what a re-import may and may not overwrite.

| Column | On a matched row | Why |
|---|---|---|
| `title`, `location`, `event_date`, `all_day` | **Updated** | The school moved the game. That is the whole reason to re-import |
| `status` | **Never touched** | A hand-cancelled game must stay cancelled. Decision 3 above |
| `event_type` (home/away) | **Never touched** | Slice C lets a person correct a misclassification by hand; overwriting would undo it on every re-import |
| `profile_id`, `calendar_id` | **Never touched** | An event that moved between activities is a different event (`lib/validation/youth.ts` says so already) |

### Decision 7: no notification, one audit row.

`08-youth-activities.md` lists `youth_activity_added` against the **profile**, and `youth-a` chose
no notification per event because a season has twenty of them. An import has more. One
`youth_calendar_imported` audit row carrying the counts, and nothing emitted.

---

## Tasks

### Task 1: Migration 055 — event source columns and the idempotency index

**File:** `supabase/migrations/055_activity_event_source.sql` (create)

**Action:** Add the three columns slice B needs, the unique index that makes re-import idempotent
at the database rather than in TypeScript, and tighten `activity_calendars` the way 054b tightened
the profile.

**Details:**

- **Confirm both tables are empty before writing the `NOT NULL`s**, with the service client, and
  say so in the header — this is exactly what 054's header does. If a row exists, the `NOT NULL`
  fails loudly, which is the correct answer.
- `alter table activity_events add column all_day boolean not null default false;`
- `alter table activity_events add column source_uid text;`
- `alter table activity_events add column source_recurrence_id text;`
- The idempotency index:

  ```sql
  create unique index activity_events_source_idx
    on activity_events (ward_id, calendar_id, source_uid, source_recurrence_id)
    nulls not distinct
    where calendar_id is not null and source_uid is not null;
  ```

  Two things here need their comment. **`nulls not distinct`** (PostgreSQL 15+, already relied on
  by migration 047's column list) is required because `source_recurrence_id` is null for every
  non-recurring event, and under the default `NULLS DISTINCT` two identical rows would not
  conflict — SQL's `null = null` is NULL, the `talks-d` hole in a new place. The **partial `where`**
  is what keeps hand-entered events out: they carry null `calendar_id` and null `source_uid`, and
  under `nulls not distinct` every one of them would collide with every other.
- Tighten `activity_calendars`: `profile_id` `set not null` (a calendar belonging to no activity
  is orphaned), `source_type` `set not null`.
- Index: `create index activity_calendars_profile_idx on activity_calendars (ward_id, profile_id);`
  Leads with `ward_id`, following `018_indexes.sql` and 054e.
- **No entry in `HELD_BACK_UNTIL_DEPLOYED`.** This is additive-with-tightening on empty tables and
  applies before the code deploys, exactly like 054. `tests/db/migrations.test.ts` will fail until
  it is applied, which is the intended signal.

Apply with `npm run db:push`, then regenerate types: `npm run db:types`.

---

### Task 2: `lib/ward/wardTimezone.ts` — read a setting nothing has ever read

**File:** `lib/ward/wardTimezone.ts` (create)

**Action:** Parse `wards.settings.timezone` into a validated IANA zone name, following
`parseCrossOrgVisibility()` in `lib/ward/crossOrgVisibility.ts` exactly.

**Details:**

- `export const FALLBACK_WARD_TIMEZONE = "America/Denver";` — matching `supabase/seed/ward.sql`,
  which is the only place this key has ever been written.
- `export function parseWardTimezone(settings: unknown): string` — missing, non-string, or not a
  zone `Intl` recognises ⇒ `console.warn` naming the bad value and return the fallback. Warn and
  fall back rather than throw, the house rule for every `wards.settings` reader.
- Validate with a `try { new Intl.DateTimeFormat("en-US", { timeZone: value }) } catch { … }`.
  `Intl.supportedValuesOf("timeZone")` exists on Node 22 but is a large array to scan per call.
- `export async function readWardTimezone(wardId, client?): Promise<string>` — selects
  `settings` from `wards` and runs it through the parser. Follow
  `readCrossOrgVisibility()`'s shape in `crossOrgVisibility.ts`.
- Header comment must record that **this is the first reader of a key seeded since Foundation B**,
  and that `supabase/migrations/011_tithing.sql` and `046_...sql` both refer to it in comments
  without anything reading it.

---

### Task 3: `lib/youth/ics/limits.ts`

**File:** `lib/youth/ics/limits.ts` (create)

**Action:** One module holding every cap, so the route enforcement and the wizard's copy cannot
drift — the reason `lib/roster/csv/limits.ts` exists, named in a comment.

**Details:**

```ts
export const MAX_ICS_FILE_BYTES = 1024 * 1024;      // 1MB — a season is a few hundred KB
export const MAX_ICS_EVENTS = 500;                   // after expansion, across the whole file
export const RECURRENCE_HORIZON_MONTHS = 12;         // 08-youth-activities.md §Step 2
export const MAX_OCCURRENCES_PER_SERIES = 400;       // a hard stop inside the expander
export const MAX_REPORTED_PROBLEMS = 100;
export const ACCEPTED_MIME_TYPES = ["text/calendar", "application/octet-stream", "text/plain", ""] as const;
export const ACCEPTED_FILE_EXTENSIONS = [".ics", ".ical", ".ifb"] as const;
```

- `hasAcceptedExtension(fileName)`, `formatFileSizeLimit()`, and `capProblems<Problem>()` mirroring
  the roster twin. **Comment naming `lib/roster/csv/limits.ts` and the lift-on-the-third-user rule**
  so the next person knows the duplication is deliberate and knows when it stops being.
- `MAX_OCCURRENCES_PER_SERIES` is separate from `MAX_ICS_EVENTS` on purpose: the per-series cap is
  what stops a single unbounded `RRULE` looping forever *before* the total is reachable.

---

### Task 4: `lib/youth/ics/resolveInstant.ts` — the zone arithmetic, pure

**File:** `lib/youth/ics/resolveInstant.ts` (create)

**Action:** Turn a wall clock plus a zone into a UTC instant, with no dependency on the process's
own time zone. This is the highest-risk twenty lines in the slice.

**Details:**

- Types: `WallClock = { year; month; day; hour; minute; second }` (month is 1-based — say so,
  because `Date`'s is not) and
  `IcsZone = { kind: "utc" } | { kind: "named"; tzid: string } | { kind: "floating" }`.
- `export function offsetMinutesFor(instant: Date, timeZone: string): number` — format the instant
  in `timeZone` with `Intl.DateTimeFormat(..., { timeZone, hour12: false, year, month, day, hour,
  minute, second })`, read the parts back, and subtract. This is the standard dependency-free
  technique and it is DST-correct because it asks about *that* instant.
- `export function wallClockToInstant(wall: WallClock, timeZone: string): Date` — the inverse, and
  the one that needs care. Take `Date.UTC(...)` of the wall clock as a first guess, compute the
  offset at that guess, subtract, then **recompute the offset at the corrected instant and correct
  once more**. The second pass is what makes the hour before and after a DST transition land
  correctly; a single pass is wrong for one hour twice a year, which is precisely the kind of bug
  that survives a demo.
- `export function resolveOccurrenceInstant(wall, zone, wardTimeZone): { instant: Date; usedWardZone: boolean }`
  - `utc` ⇒ `Date.UTC(...)`, never `new Date(string)`.
  - `named` ⇒ `wallClockToInstant(wall, tzid)`; if `Intl` rejects the tzid, fall back to
    `wardTimeZone` and return `usedWardZone: true` so the caller can raise a problem (Decision 2).
  - `floating` ⇒ `wallClockToInstant(wall, wardTimeZone)`, `usedWardZone: true` (Decision 1).
- For an all-day entry the caller passes `hour/minute/second = 0` and the ward zone — ward
  midnight, per Decision 2 of the pre-planning answers.
- **No `ical.js` import in this file and no `new Date()` with no arguments.** It must be drivable
  from a unit test with nothing but literals.

---

### Task 5: `lib/youth/ics/parseIcs.ts` — `ical.js`, bounded

**File:** `lib/youth/ics/parseIcs.ts` (create)

**Action:** Parse the ICS text into `IcsOccurrence[]` plus `IcsProblem[]`, expanding recurrence
within the horizon and never producing a `Date`.

**Details:**

- **Verify the `ical.js` v2 API against the installed package's own `.d.ts` before writing
  against it.** The project wiki's example (`new ICAL.Component(jCalData[1])`) is from the 1.x
  API where `parse` returned a tuple; v2 returns the jCal array directly. Read
  `node_modules/ical.js/dist/types/` and follow that, not this plan and not a blog post.
- Shape:
  1. `ICAL.parse(text)` inside a `try` — a malformed file is the uploader's problem and must
     become a sentence, never a 500.
  2. Register every `vtimezone` subcomponent with `ICAL.TimezoneService.register` before reading
     any event. **`TimezoneService` is process-global**, so registrations from one request are
     visible to the next — register under the file's own tzid, do not mutate anything else, and
     note this in a comment.
  3. For each `vevent`: read `summary`, `location`, `uid`, and the **`dtstart` property**, not
     `ICAL.Event.startDate`. Take the wall-clock fields off `ICAL.Time` (`.year`, `.month`,
     `.day`, `.hour`, `.minute`, `.second`, `.isDate`) and the zone from the property's `tzid`
     parameter plus `ICAL.Time.zone`. `isDate === true` ⇒ `allDay`.
  4. Recurrence: if the component has an `rrule`, expand with `ICAL.RecurExpansion`, stopping at
     the **first** of: `RECURRENCE_HORIZON_MONTHS` past the import instant,
     `MAX_OCCURRENCES_PER_SERIES`, or the iterator completing. `RecurExpansion` handles `EXDATE`
     and `RDATE`; the loop's own bound is what handles a rule with no `UNTIL`. Each occurrence
     gets `recurrenceId` = its own `DTSTART` rendered as a stable string.
  5. A non-recurring event gets `recurrenceId: null`.
- The horizon instant enters as a **parameter** (`asOf: Date`), never `new Date()` inside. Same
  rule `listActivityEvents` and `lib/visits/progress.ts` follow: one import judges every event
  against one instant, and the test can pin it.
- Problems (an `IcsProblem` is `{ summary: string | null; message: string }` — there are no row
  numbers in an ICS file, so do not invent one): a `VEVENT` with no `DTSTART`, an unparseable
  `RRULE`, an unresolvable `TZID`, a series that hit `MAX_OCCURRENCES_PER_SERIES`.
- Refuse with a sentence naming the likely cause when the file yields **zero** `VEVENT`s — the
  precedent is `parseDocument()` refusing a PDF under ~200 characters (CLAUDE.md §9). Suggested:
  *"That file has no events in it. Export the calendar again, or check you picked the schedule
  rather than a subscription link."*
- Stop at `MAX_ICS_EVENTS` across the whole file and report how many were dropped. A silent cap
  reads as "your file only had 500 events" (`limits.ts`'s own comment on `capProblems`).

---

### Task 6: `lib/validation/youthImport.ts`

**File:** `lib/validation/youthImport.ts` (create)

**Action:** Zod schemas for the multipart fields both routes read. Follow
`lib/validation/rosterImport.ts`.

**Details:**

- `profileIdSchema` — `z.uuid("Choose which activity this schedule belongs to.")`
- `fileHashSchema` — `z.string().regex(/^[0-9a-f]{64}$/, …)`, copied in spirit from
  `rosterImport.ts`
- No `wardId`, no `enteredBy`, no `calendarId` on any schema — all resolved from the session or
  from the profile (conventions.md §Validation, and `lib/validation/youth.ts`'s header states the
  same rule for slice A).

---

### Task 7: `lib/youth/ics/importRequest.ts` — the half both routes share

**File:** `lib/youth/ics/importRequest.ts` (create)

**Action:** Everything the preview and the confirm must do identically. It is one module for the
same reason `lib/roster/csv/importRequest.ts` is: *"the two halves of a preview-then-confirm flow
disagreeing about what the file contains is precisely the failure this exists to prevent."*

**Details:**

- `class IcsImportError extends Error { readonly status: number }` + `isIcsImportError()`, mirroring
  `ImportRequestError`.
- `readIcsFormData(request)` → `{ file, profileId, fileHash }`, with `request.formData()` wrapped in
  a `try` — a malformed multipart body is a 400, not a 500 blaming the server. Log the underlying
  reason **in the message string**, not only as an object argument: Next's dev logger renders an
  object as `{}` (`auth-b` retro).
- `assertAcceptableIcsFile(file)` — MIME (empty type accepted; browsers frequently send nothing
  for `.ics`), extension, then size. Checked **before a byte is read**: a 413 after a full upload
  is a refusal the user already paid for.
- `readIcsFile(file, asOf)` → `{ text, fileHash, occurrences, problems, occurrencesDropped }`.
  SHA-256 over the decoded text with `node:crypto` — this module is server-only and must say so.
- The `Content-Type` for `.ics` is `text/calendar`; Windows commonly sends
  `application/octet-stream` and some browsers `text/plain`. As with the CSV, MIME is a hint and
  the parse is the real guard.

---

### Task 8: `lib/youth/ics/buildImportPreview.ts` — writes nothing

**File:** `lib/youth/ics/buildImportPreview.ts` (create)

**Action:** Diff the parsed occurrences against what is already in the database and return the
four counts and the lists behind them.

**Details:**

```ts
export type IcsImportPreview = {
  calendarExists: boolean;
  lastSyncedAt: string | null;
  toCreate: PreviewEvent[];        // in the file, not in the app
  toUpdate: PreviewEventChange[];  // matched, and title/date/location/all_day differ
  unchanged: number;               // matched, nothing differs
  notInFile: PreviewEvent[];       // in the app, inside the window, absent from the file
  windowStart: string;             // ISO — the window notInFile was computed over
  windowEnd: string;
  problems: IcsProblem[];
  problemsTruncated: number;
  occurrencesDropped: number;
};
```

- `PreviewEvent` must carry the **resolved local time as a formatted string**, not only the
  instant. The single most important thing this screen does is let a leader read "Fri 15 Jan 2027,
  7:30pm" *before* confirming.
- `notInFile` is computed **only over `[windowStart, windowEnd]`** — the earliest and latest
  instants the file itself covers, intersected with the horizon. Computing it over all time would
  list every past game (pre-planning Decision 3's named trap). Rows with a null `source_uid` (hand
  entered) are excluded from `notInFile` entirely: they were never expected to be in the file.
- Reads existing events with the **caller's client** so RLS decides, filtered on
  `calendar_id = <the profile's calendar>`.
- **This module performs no insert, update, upsert or rpc, and no audit write.** State that in the
  header the way `app/api/roster/import/preview/route.ts` does — a guarantee readable off the
  imports beats one re-argued each time.
- On the count labels: `roster-c`'s lesson is that a preview number and a result number must be
  the *same* number or be labelled differently. Use the identical four keys in
  `IcsImportResult` (Task 9) so the two screens can render from one component.

---

### Task 9: `lib/youth/ics/applyImport.ts` — the only writer

**File:** `lib/youth/ics/applyImport.ts` (create)

**Action:** Create-or-reuse the calendar row, insert the new events, patch the changed ones, and
return counts in the same shape the preview used.

**Details:**

- Resolve the calendar: `select … from activity_calendars where ward_id and profile_id and
  source_type = 'ics_upload'`; insert if absent with `source_url: null` (Decision: file upload
  only in this slice — no server-side URL fetch, which would be SSRF surface for no gain the phase
  plan asks for). Stamp `last_synced_at = now()` on the way out.
- Insert new rows with `status: 'upcoming'`, `event_type: 'tbd'` (classification is slice C),
  `all_day`, `source_uid`, `source_recurrence_id`, `calendar_id`.
- Update matched rows with **`title`, `location`, `event_date`, `all_day` only** — Decision 6.
  Build the patch the way `updateActivityEvent` does, field by field, so an unset field is not
  written as null.
- **No deletes and no status writes**, ever, from this module. The absence is the feature; say so
  in the header.
- There is no `apply_roster_import` equivalent here and none is needed: an ICS import writes to one
  table plus one calendar row, where the CSV import spanned households, members, notes and org
  membership in one transaction. If a batch insert fails partway, the unique index means a re-run
  creates only what is missing — which is what "idempotent" is for. **Say this in the header**, so
  the next reader does not assume the missing transaction was an oversight.
- Returns `IcsImportResult` with `created`, `updated`, `unchanged`, `notInFile` (a count and the
  names), `problems`.

---

### Task 10: `POST /api/youth/calendars/import/preview`

**File:** `app/api/youth/calendars/import/preview/route.ts` (create)

**Action:** Permission, read the file, parse, preview. No write.

**Details:**

- `requireSessionUser()` **outside** the `try` — it redirects by throwing an internal Next error,
  and catching that turns a redirect into a 500. Every route in this repo does this; copy it.
- `assertCan(user, "youth_activities.manage", roleAccess)` — `.view` is not enough to import.
- `getActivityProfile(user.wardId, profileId, supabase)` → 404 with *"That activity is not in your
  ward."* if null, matching `POST /api/youth/events`.
- `asOf = new Date()` once, handed to both the parser and the preview builder.
- Catch `IcsImportError` first and answer with its own status and sentence; everything else to
  `respondToRouteError`.
- `export const maxDuration = 60;` if parsing a 1MB file with recurrence gets close — measure
  before adding it, and copy the justification comment style from `app/api/knowledge/upload/route.ts`.

---

### Task 11: `POST /api/youth/calendars/import`

**File:** `app/api/youth/calendars/import/route.ts` (create)

**Action:** Re-derive everything from a second upload of the same file, guarded by the hash, then
apply.

**Details:**

- Same permission and profile checks as Task 10.
- **The file is uploaded a second time and re-parsed.** Do not accept the preview's parsed events
  back from the client — a tampered confirm payload is a far more expensive problem than a second
  1MB upload (`roster-c` Decision 2, verbatim reasoning).
- Missing `fileHash` ⇒ 400 *"Preview the file before importing it."*
  Mismatched hash ⇒ 400 *"The file changed since you previewed it. Preview again."* — worded
  identically to the client's copy of the message (Task 14).
- `writeAuditLog({ action: "youth_calendar_imported", module: "youth_activities", detail: {
  profileId, calendarId, created, updated, unchanged, notInFile: <count>, problems: <count> } })`.
  Counts, not the events themselves — an audit row is not a payload dump.
- **No `emitNotification`.** Decision 7 above; put the reason in the header the way
  `app/api/youth/events/route.ts` does for its own missing notification.

---

### Task 12: `lib/youth/queries.ts` — three columns and two calendar readers

**File:** `lib/youth/queries.ts` (modify)

**Action:** Teach the existing module about the new columns and the calendar row.

**Details:**

- `ActivityEvent` gains `allDay: boolean`, `sourceUid: string | null`,
  `sourceRecurrenceId: string | null`. `ActivityEventRow` gains the snake_case three.
  `ACTIVITY_EVENT_COLUMNS` gains them — **still one string literal on one line**.
  `mapActivityEventRow` maps them. This is CLAUDE.md rule 9: the route writes a new field, the
  type learns about it in the same change, or the frontend silently drops it.
- `export type ActivityCalendar = { id; profileId; sourceType; sourceUrl; lastSyncedAt; createdAt }`
  plus `ACTIVITY_CALENDAR_COLUMNS`, a row type and a mapper, following the two that are already
  there.
- `getIcsCalendarForProfile(wardId, profileId, client?)` → `ActivityCalendar | null`.
- `createIcsCalendar(...)` and `touchCalendarSyncedAt(...)`, or fold both into
  `applyImport.ts` — either is fine, but the **SQL lives in `queries.ts`**, following how every
  other module in this repo splits data access from logic.

---

### Task 13: `EventList` learns what "all day" means

**File:** `app/(app)/youth/EventList.tsx` (modify)

**Action:** Render an all-day event as a date and the words *All day*, never as `12:00am`.

**Details:**

- A midnight time on this screen is indistinguishable from the timezone bug the whole slice exists
  to prevent. That is the entire justification for the `all_day` column and it belongs in a comment
  here, not only in the migration.
- If the row came from a calendar (`sourceUid !== null`), a quiet marker saying so is worth having
  — it tells a leader why editing it by hand may be undone by the next import. Keep it to a label;
  no new control.

---

### Task 14: The wizard

**Files:** `app/(app)/youth/import/page.tsx`, `IcsImportWizard.tsx`, `IcsPreviewStep.tsx` (create);
`components/youth/IcsProblemList.tsx` (create); `app/(app)/youth/page.tsx` (modify)

**Action:** Three steps — choose an activity and a file, read the preview, confirm — mirroring
`app/(app)/roster/import/`.

**Details:**

- `page.tsx` is a Server Component: `requireSessionUser`, `resolveRoleAccess`, then
  **`can(user, "youth_activities.manage", roleAccess)` and `NotPermitted` if false** — `can`, not
  `assertCan`, because a `ForbiddenError` escaping a Server Component becomes a 500 whose message
  Next strips in production (`auth-b` retro; `app/(app)/youth/page.tsx` already does this).
- The profile select lists **every** profile in the ward — Decision 4. It is seeded from the server
  and kept fresh through `fetchProfiles` / `YOUTH_PROFILES_QUERY_KEY` from
  `app/(app)/youth/youthQueries.ts`, not held as a bare prop. That prop is precisely defect
  `youth-a-D2`.
- The wizard holds the `File` across both requests. Step state:
  `"choose" | "preview" | "confirming" | "done"`.
- Copy `describeRequestFailure()` from `ImportWizard.tsx` — re-read one byte of the file in the
  `catch` to distinguish a changed file from a dead network. Both `catch` blocks need it.
- **On a successful confirm, invalidate `YOUTH_EVENTS_QUERY_KEY` and `YOUTH_PROFILES_QUERY_KEY`
  before navigating back to `/youth`.** TanStack's cache survives client-side navigation, so
  without this the user lands on a schedule that does not contain what they just imported. This is
  the third appearance of this bug's shape in this repo; `PROFILE_MUTATION_INVALIDATES` exists for
  exactly this reason.
- The preview screen shows **four counts, labelled by what they count**, and the result screen
  shows the same four. `roster-c`'s bug was two correct numbers that read as a contradiction; the
  defence is identical labels, not a cleverer calculation.
- The `notInFile` list is rendered as a **statement, not a warning**: *"2 events are in the app but
  not in this file. Nothing will change for these."* It must not look like an error, and it must
  not look like something the confirm is about to act on.
- Mobile-first: 375px, no horizontal overflow, 44×44 tap targets. The event table needs
  `overflow-x-auto` on its own container.
- `app/(app)/youth/page.tsx`: an *Import a schedule* link beside *Add an event*, inside the
  existing `canManage` branch.

---

## Testing Strategy

Per CLAUDE.md §8 priority order. The phase plan names three of these by filename.

### `tests/lib/icsTimezone.test.ts` — **highest priority in this slice**

Drives `parseIcs` + `resolveInstant` over ICS fixtures written inline as template literals.

- A **UTC** time (`DTSTART:20270115T023000Z`) resolves to that exact instant.
- A **TZID** time with the `VTIMEZONE` present in the file resolves correctly, asserted as an exact
  UTC instant.
- A **floating** time resolves to the ward zone, and `usedWardZone` is true.
- A **TZID the file does not define** falls back to the ward zone *and produces a problem* — assert
  both; the problem is the half that would silently go missing.
- **DST:** the same wall clock in January and July in `America/Denver` resolves to instants whose
  UTC hours differ by one. Then the 2:30am wall clock on a spring-forward date, and 1:30am on a
  fall-back date — the two hours `wallClockToInstant`'s second correction pass exists for.
- An **all-day** entry (`DTSTART;VALUE=DATE:20270116`) resolves to ward midnight with
  `allDay: true`.
- **The server-zone independence check.** Assert exact UTC instants throughout, which carries the
  guarantee on its own. Additionally set `process.env.TZ` to `Pacific/Kiritimati` (UTC+14) in one
  test and assert byte-identical output. If that proves unreliable on Windows, delete the TZ test
  and keep the exact-instant assertions — **do not** weaken the assertions to make it pass.

### `tests/lib/icsRecurring.test.ts`

- A weekly `RRULE` with `COUNT=10` yields exactly 10.
- A weekly `RRULE` with `UNTIL` respects it.
- **A weekly `RRULE` with neither** stops at the 12-month horizon and does not hang. Give this test
  an explicit short timeout so a regression fails fast instead of hitting vitest's 30s ceiling.
- `EXDATE` removes an occurrence; the count drops by one.
- A `DAILY` rule that would exceed `MAX_OCCURRENCES_PER_SERIES` stops there **and reports a
  problem** — a silent cap is the failure `limits.ts` names.
- Each occurrence carries a distinct `recurrenceId`, and they share one `uid`. This is the
  assertion that proves the match key cannot collapse a series into one row.

### `tests/lib/icsIdempotent.test.ts`

Unit-level over `buildImportPreview` with a stubbed existing-events list:

- Same file twice ⇒ `toCreate` empty, `toUpdate` empty, `unchanged` equal to the event count.
- A game moved to a new date ⇒ exactly one `toUpdate`, zero `toCreate`.
- An event removed from the file ⇒ one `notInFile`, and **`toCreate`/`toUpdate` unaffected**.
- A hand-entered event (null `source_uid`) inside the window is **not** in `notInFile`.
- A past event outside the file's window is **not** in `notInFile` — the named trap.
- A `VEVENT` with no `UID` gets a synthesised one, and the *same* synthesised one on a second
  parse of the same file.

### `tests/lib/wardTimezone.test.ts`

Table-driven over `parseWardTimezone`: valid zone, missing key, null, number, empty string,
`"Mars/Olympus"`. Each non-valid case returns the fallback and warns.

### `tests/routes/youthCalendarImport.test.ts`

Using `tests/helpers/routeClient.ts`. **Read its header comment before writing the first one** —
it documents the `vi.mock` hoisting trap, which CLAUDE.md §8 names as the most likely hour to lose.

- `// @vitest-environment node`, `seedFixtures(handles)`, `fixtures.cleanup()` in `afterAll`.
- Preview as a Young Men president: 200, correct counts, **and zero rows written** — assert by
  re-reading `activity_events` with the service client afterwards.
- Confirm: 201/200, rows exist, `last_synced_at` set, an audit row with
  `youth_calendar_imported`.
- Confirm the same file twice: the second run creates nothing. Assert by counting rows, not by
  trusting the response.
- `org_secretary` (holds `.view` and `.log`, **not** `.manage`) ⇒ 403 on both routes. **Check the
  fixture's real permissions in `lib/auth/permissions.ts` before asserting a 403** — CLAUDE.md §8
  warns that the matrix is not always the intuitive answer.
- Missing `fileHash` ⇒ 400. Mismatched `fileHash` ⇒ 400 with the "file changed" sentence.
- A file over `MAX_ICS_FILE_BYTES` ⇒ 413.
- A `.txt` of prose ⇒ 400 naming the likely cause, not a 500.
- A profile in another ward ⇒ 404.
- `params` is a Promise in Next 16 where a route takes one; these two do not, but the helper's
  note applies to anything added later.

### `tests/rls/youth-activity-scope.test.ts` (modify)

Add `activity_calendars`: a leader in ward A cannot read or write ward B's calendar rows. Reads
stay ward-wide within a ward — assert that positively too, so a later narrowing has to break a
test rather than quietly change behaviour.

**Assert a refused write by re-reading the row** with the service client. An RLS-denied UPDATE or
DELETE is a zero-row success, not an error; only INSERT raises.

---

## Test Scenarios (Harness)

### Scenario 051: A season imported from the school's calendar

**Tags:** `[youth, import, timezones, smoke]`
**Purpose:** The hour is the thing this slice most likely gets wrong, and no unit test can answer
whether the hour a leader *reads on the card* is the hour the school published. Seeding matters
because the fixture needs an activity profile and a genuine multi-timezone `.ics` file that would
take twenty minutes to build by hand.

**Seed data summary:**
- Ward — Harness Test Ward
- Users — `ym-president@harness.wardleadershiptools.test` (Young Men president)
- Households — Brooks (2201 Canyon Road)
- Members — 1 youth: Ethan Brooks, `active`, Young Men
- Activity profiles — 1: *Varsity Basketball*, Lincoln High School, owned by Young Men
- Events — **none**
- Fixture file — `lincoln-basketball.ics` committed in the scenario directory, containing: a
  `TZID=America/Denver` game with the `VTIMEZONE` present; a `Z`-suffixed UTC game; a floating-time
  game; an all-day tournament (`VALUE=DATE`); a weekly `RRULE` with `COUNT=8`; one `EXDATE`; one
  `VEVENT` with no `UID`; and one malformed `VEVENT` with no `DTSTART`.

**Tester action:** Sign in, open `/youth`, follow *Import a schedule*, choose *Ethan Brooks —
Varsity Basketball* and the fixture file, read the preview, confirm, then return to `/youth`.

**Verification checklist:**
- [ ] The preview names every game **with the day, date and hour** it will be created at — not a
      raw ISO string, and not a count alone.
- [ ] The `TZID` game, the UTC game and the floating game each show the hour a person reading the
      school's own calendar would expect. Check all three against the fixture's header comment,
      which states the intended local time for each.
- [ ] The all-day tournament reads **"All day"**, not `12:00am`.
- [ ] The recurring practice appears **8 times**, minus the one `EXDATE` — 7 rows.
- [ ] The `VEVENT` with no `DTSTART` is listed under problems with a sentence, and is **not**
      created.
- [ ] Confirming creates exactly the events the preview named. The counts on the two screens match.
- [ ] **After confirming, `/youth` shows the imported games without a reload.** This is the
      `youth-a-D2` shape and it is the checklist line most likely to fail.
- [ ] `activity_calendars` has exactly one row for this profile, `source_type = 'ics_upload'`,
      `last_synced_at` set.
- [ ] Every created row has a non-null `source_uid` and `calendar_id`. The synthesised UID starts
      `wlt-synth-`.
- [ ] An `audit_log` row with action `youth_calendar_imported` exists, carrying the counts.
- [ ] **No notification was emitted** — check `notifications` for this ward.
- [ ] Change the machine's time zone, reload, and every game still reads at the hour the school
      published it.
- [ ] No horizontal overflow at 375px; every control at least 44×44.

**Needs a human eye:**
- [ ] The preview reads as a description of what will happen, not as a table dump.
- [ ] A leader who has never seen an ICS file can tell from the screen what is about to be created.

---

### Scenario 052: The same schedule, uploaded again in March

**Tags:** `[youth, import, idempotency, full]`
**Prerequisites:** scenario 051 seeds the same ward; this one seeds it *already imported*.
**Purpose:** Proves the three things a re-import must not do — duplicate, revive, or destroy.
Seeding is what makes it cheap: the "already imported, then edited by hand" state takes several
minutes to reach through the UI and is the exact state the guarantees are about.

**Seed data summary:**
- Everything from scenario 051, **plus** the fixture already imported: 1 `activity_calendars` row,
  its events created with `source_uid` set
- One imported game **cancelled by hand** (`status = 'cancelled'`)
- One imported game whose **`event_type` was corrected to `away`**
- One event **entered by hand** (`calendar_id` null, `source_uid` null) on a date inside the
  file's window
- Fixture file — `lincoln-basketball-march.ics`: the same UIDs, with **one game moved to a new
  date**, **one game removed**, and **two new games added**

**Tester action:** Import `lincoln-basketball-march.ics` against the same activity. Read the
preview carefully before confirming.

**Verification checklist:**
- [ ] The preview reports **2 to create, 1 to update, 1 not in this file**, and the rest unchanged.
- [ ] The "not in this file" event is described as *unchanged by this import*, not as something
      about to be deleted or cancelled.
- [ ] Confirming creates exactly 2 rows. Total event count rises by 2 and by nothing else.
- [ ] The moved game has the **new** date and **the same `id`** — it was updated, not replaced.
- [ ] **The hand-cancelled game is still `cancelled`.**
- [ ] **The hand-corrected `away` game is still `away`**, not reset to `tbd`.
- [ ] **The hand-entered event is untouched** and was never listed as "not in this file".
- [ ] The removed game is still present, still `upcoming`, unchanged.
- [ ] `last_synced_at` moved forward; a second `activity_calendars` row was **not** created.
- [ ] Importing the *identical* file a third time reports 0 to create, 0 to update.
- [ ] A second `youth_calendar_imported` audit row exists with the second import's counts.

**Needs a human eye:**
- [ ] Reading only the preview, a leader can tell that nothing they did by hand is at risk.

---

## Validation Commands

```bash
# Apply the migration to the linked hosted project, then regenerate types
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck

# Tests
npm run test

# Production build
npm run build
```

Run the build. Lint, typecheck and tests can all pass while a production build fails — static
generation runs code the dev server never does, and `/youth/import` is a new route with a new
dependency in its tree.

---

## Integration Notes

- **Migration 055 applies before the code deploys**, like 054 and unlike 051. It is
  additive-with-tightening on empty tables. Do **not** add an entry to `HELD_BACK_UNTIL_DEPLOYED`
  in `tests/db/migrations.test.ts` — that allowlist exists for expand-and-contract slices and an
  entry that is not needed hides a real migration from the assertion.
- **Slice C inherits** `all_day` (its coverage model must not ask "who covers 12:00am"),
  `source_uid` (an imported event is one a person did not type, which is worth showing beside a
  home/away control), and `activity_calendars` with a real row in it. Home/away classification is
  slice C's Step 3; slice B writes `tbd` and touches `event_type` on no existing row.
- **`activity_events` still has no `entered_by` column.** `youth-a` handed that forward, paired
  with the unscoped leader-to-leader messaging feature in `plans/INDEX.md`. This slice does not
  add it — an imported event has no author, so the two questions have not become one.
- **`wards.settings.timezone` gains its first reader.** It has no editing UI. If a ward ever needs
  to change it, that is a Phase 11 admin screen, and `lib/ward/crossOrgVisibility.ts` +
  `app/api/ward-settings/cross-org-visibility/route.ts` are the pattern to follow. Note it in the
  retro rather than building it here.
- **No cron, no scheduled re-sync.** `activity_calendars.last_synced_at` records when a person last
  imported, never when a machine did. Automatic re-fetching would need `source_url`, a scheduler
  this project does not have, and would put a write path outside a human confirm — which is where
  CLAUDE.md rule 3 draws its line. This joins `youth_event_uncovered`, the Monday digest,
  `visit_overdue` and `refresh_goal_status()` as Phase 11's one decision about a mechanism; that
  makes **five**.
- **Documentation to update in the same change:** `plans/INDEX.md`'s slice table (youth-b →
  Built), and `CLAUDE.md` §9 if the floating-time and vanished-event decisions should sit beside
  the other Phase 8 decisions already recorded there. They should — they are the same kind of
  thing.
- **No change to `lib/auth/navigation.ts`.** `/youth/import` is reached from `/youth`, not from the
  sidebar.
