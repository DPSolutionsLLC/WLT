# Plan: Youth Activities — Home/Away, Attendees, Coverage and the Calendar

**Created:** 2026-08-28
**Type:** feature
**Phase:** 8, slice C of four. The specification is [08-youth-activities.md](08-youth-activities.md)
Steps 3, 4 and 7; this file is the slice.

---

## Overview

Slice A gave the module its profiles and hand-entered events. Slice B gave it a schedule
imported from a school's `.ics`. Both left the same hole: **an event sits on a list and nobody
is going to it.** This slice closes that.

Three things, and the third only means something because of the first two:

1. **Home / away classification.** Every event is `home`, `away` or `tbd`. A location matching
   one of the ward's own venues classifies as `home` on the way in; everything else stays `tbd`
   for a person to resolve with one tap.
2. **Attendees.** Anyone with `youth_activities.view` self-adds to an event. The bishopric
   assigns somebody else. Both write `activity_attendees`, which has never held a row.
3. **Coverage, computed on read.** A home event that is upcoming, not cancelled, and has no
   attendee is *uncovered* — loudly so inside the notice window. An away event is awareness
   only. This is a pure function of `(event_type, event_date, status, attendee count, asOf)`,
   exactly as migration 054c promised when it removed `covered`/`uncovered` from the column.

Plus the screen the three of them exist for: **`/youth/calendar`**, the full ward calendar,
filterable by youth, organization, activity type and home/away, where an uncovered home event
inside the notice window is impossible to miss.

### Success criteria

- A leader opens `/youth/calendar`, sees every organization's events, and can tell in one glance
  which ones nobody is going to.
- A leader taps "I'll go" on a home game and the event stops reading uncovered — for everybody,
  not only for them.
- A bishopric member assigns a ward council member, who is notified.
- An imported game at the ward's own high school arrives classified `home` without anybody
  touching it; a game at an away school arrives `tbd` and says so.
- Re-importing that same feed changes **no** classification anybody corrected by hand.
- A cancelled event never reads as unattended, at any distance from the clock.

### Four decisions taken with the user before planning

1. **`completed` is dropped from `activity_events.status`** (migration 056). It was handed to
   this slice by 054c's own header, on the argument that removed `covered`: an event in the past
   is completed by the clock, and a stored value the clock decides goes stale. Follow-up state is
   `activity_logs`' business in slice D. **Verified against the hosted database before writing
   this plan:** 14 event rows, tallying `upcoming/tbd` 12, `upcoming/away` 1, `cancelled/tbd` 1.
   Zero hold `completed`, and no code path writes it — `grep` finds the string only in a comment
   in `lib/youth/queries.ts`. So this is not expand-and-contract and **must not** get an entry in
   `HELD_BACK_UNTIL_DEPLOYED`, on 054's own reasoning.
2. **The home-venue list gets an editor in this slice**, following the `crossOrgVisibility`
   precedent from `visits-c` rather than the `wardTimezone` precedent from `youth-b`. The
   difference is that a timezone has a defensible fallback and a venue list does not: with no
   editor, auto-classification is inert in every real ward and the feature is a column nobody
   fills in.
3. **Assigning somebody else is bishopric-only**, as `08-youth-activities.md` §Step 4 specifies.
   Self-adding needs only `youth_activities.view`.
4. **A cancelled event stays inside the "upcoming" count on `/youth`** — the heading is not
   touched by this slice — *because a cancelled game can be reinstated*. What must be true is
   that **it never registers as unattended once it is past.** That is a rule in `coverage.ts`,
   asserted in both directions, and it is the reason `cancelled` is tested before the clock is
   consulted rather than after.

---

## Relevant Files

### Create

- `supabase/migrations/056_activity_attendees_and_status.sql` — drop `completed`; unique
  `(event_id, user_id)`; replace `activity_attendees`' three ward-wide write policies; index.
- `lib/ward/homeVenues.ts` — read, parse and write `wards.settings.home_venues`.
- `lib/youth/classifyLocation.ts` — pure. Location text + venue list → `home` or `tbd`.
- `lib/youth/coverage.ts` — pure. The coverage state of one event, client-importable.
- `lib/youth/attendees.ts` — server-only reads and writes over `activity_attendees`.
- `app/api/ward-settings/home-venues/route.ts` — GET (`youth_activities.view`) / PUT (bishopric).
- `app/api/youth/events/[id]/attend/route.ts` — POST / DELETE, self only.
- `app/api/youth/events/[id]/assign/route.ts` — POST / DELETE, bishopric only.
- `app/(app)/youth/HomeVenuePanel.tsx` — bishopric-only editor for the venue list.
- `app/(app)/youth/calendar/page.tsx` — the ward activity calendar.
- `app/(app)/youth/calendar/ActivityCalendar.tsx` — filters, list/grid switch, client.
- `components/youth/CoverageBadge.tsx` — one badge, shared by `/youth` and `/youth/calendar`.
- `components/youth/AttendeeControls.tsx` — "I'll go" / "I can't after all" / assign.
- `components/youth/ActivityMonthGrid.tsx` — the `md:` month grid.

### Modify

- `types/domain.ts` — narrow `EVENT_STATUSES`; add `COVERAGE_STATES`, labels, tones, rank.
- `lib/validation/youth.ts` — `eventType` becomes optional on create; add the assign schema.
- `lib/validation/ward.ts` *(or wherever `crossOrgVisibilitySchema` lives — it is currently in
  `lib/validation/visit.ts`; put `homeVenuesSchema` beside it there rather than inventing a file)*.
- `lib/youth/queries.ts` — `createActivityEvent` takes a resolved `eventType`; add an
  attendee-count read for a set of events.
- `lib/youth/ics/buildImportPreview.ts` — classify each **new** occurrence, surface it in the
  preview.
- `lib/youth/ics/applyImport.ts` — write the classification on insert **only**.
- `app/api/youth/events/route.ts` — resolve `eventType` through the classifier when absent.
- `app/(app)/youth/page.tsx` — hand down coverage, attendees and the venue panel.
- `app/(app)/youth/EventList.tsx` — coverage badge, who is going, attend/assign controls.
- `app/(app)/youth/ManualEventForm.tsx` — a "Decide from the location" option.
- `app/(app)/youth/youthQueries.ts` — the attendee cache key and what a mutation invalidates.
- `testing/infrastructure/seedUtils.ts` — `createActivityAttendee`, and home venues on the ward.

---

## Dependencies

**No new packages.** Everything here is arithmetic over data already in the database.

Existing things this slice must **import rather than re-derive**:

- `lib/ward/crossOrgVisibility.ts` — the exact shape `homeVenues.ts` copies, including the
  merge-don't-replace rule on `wards.settings`.
- `lib/calendar/dates.ts` — `daysInMonth`, `leadingBlankDays` for the month grid.
- `lib/notifications/emitNotification.ts` — `{ wardId, triggerKey, title, body, recipientUserIds }`.
- `lib/audit/writeAuditLog.ts` — every new route writes one.
- `app/(app)/youth/youthQueries.ts` — the shared cache keys, which already exist because not
  having them was defect `youth-a-D2`.

---

## Known Pitfalls (from retro context)

- **`youth-a` / `visits-d` — a control offered where the API refuses.** Twice now. Both slices
  shipped Edit and Remove on work the caller could not change; RLS refused it safely and a leader
  was still invited through a locked door. This slice adds **three** new controls (attend,
  unassign, assign) with **two** different permission gates, so it is the highest-risk surface yet.
  `lib/youth/activityOwnership.ts` is the pattern; every control below names which gate decides it.
- **`youth-a-D2` / `visits-b` — a Server Component prop never refetches.** Attendee counts are
  about to become a second thing on `/youth` that a mutation changes. They go in
  `youthQueries.ts` with the other two keys, and attending invalidates the events key as well,
  because the coverage badge on the card is derived from both.
- **`talks-d` — SQL's `null = null` is NULL, not true.** `activity_attendees.assigned_by` is
  nullable and means "self-added". No policy may compare against it. The policies below compare
  `user_id`, which is `not null`.
- **`youth-b` — an index needs `nulls not distinct` only when a key column is nullable.**
  Migration 055's did. This one's does **not**: `event_id` and `user_id` are both `not null`, so
  the plain unique is correct. Say so in the migration, or the next reader will assume it was
  forgotten.
- **`youth-b` — `ICAL.Time.toJSDate()` is called nowhere,** and this slice must not be the one
  that reintroduces it. Classification touches `buildImportPreview.ts`; it reads `location` text
  and nothing about time.
- **`youth-b` — three copy defects with a green suite.** Pluralisation, an ambiguous date format,
  and a sentence that contradicted the row above it. Every count and every empty state below gets
  read on the actual screen, and the checklist lines are written to fail.
- **`visits-f` / CLAUDE.md — a rule must be uniformly evaluable.** The "an organization claims
  households only if it has a visit goal" rule is only safe because every reader can evaluate it.
  Coverage has the same property and it is load-bearing: see Task 1's note on why
  `activity_attendees_ward_select` stays exactly as migration 019 wrote it.
- **`roster-b` — a filter the schema does not carry is silently ignored,** with no error. Every
  filter on `/youth/calendar` is applied client-side over one fetched list, which sidesteps this
  entirely; do not add query parameters the route does not parse.
- **`calendar-a` — a `+` concatenation in a Supabase select list widens the type to `string`**
  and degrades every row to untyped. One string literal, one line.
- **`visits-d` — a constant imported from a `"use client"` module reaches a Server Component as a
  function, not a string.** `COVERAGE_STATES` and friends go in `types/domain.ts`;
  `coverage.ts` imports types and nothing else, so both sides may import it.

---

## Tasks

### Task 1: Migration 056

**File:** `supabase/migrations/056_activity_attendees_and_status.sql` (create)
**Action:** Drop `completed`; make an attendee row unique per person per event; narrow the
attendee write policies.

**Details:**

Header must record the row counts this plan verified (14 events, 0 attendees, 0 logs) and that
they were read with the service client **before** the file was written — 054's header does exactly
this and it is what makes "applies immediately" a checked claim rather than a hope.

**056a — `status` loses `completed`.**

```sql
alter table activity_events drop constraint activity_events_status_check;
alter table activity_events
  add constraint activity_events_status_check
    check (status in ('upcoming', 'cancelled'));
```

Comment must carry: 054c handed this question here by name; the answer is the same argument that
removed `covered` — an event in the past is completed by the clock. Slice D records follow-up on
`activity_logs`, which is where a person's account of what happened belongs. Zero rows hold the
value and no code writes it, so this applies immediately and gets **no** `HELD_BACK_UNTIL_DEPLOYED`
entry.

**056b — one attendee row per person per event.**

```sql
create unique index activity_attendees_event_user_idx
  on activity_attendees (event_id, user_id);
```

Comment: **no `nulls not distinct` here, deliberately.** Migration 055 needed it because
`source_recurrence_id` is nullable and two nulls would not conflict. Both columns here are
`not null`, so the plain unique is exact. Stating the contrast is what stops the next reader
"fixing" one of the two indexes to match the other.

Without this, tapping "I'll go" twice — on a slow phone, which is the whole context this module
runs in — writes two rows, and every coverage count reads two people going where one is.

**056c — the write policies.**

Migration 019 generated four ward-wide policies for `activity_attendees` in a loop. Replace the
three write policies. **`activity_attendees_ward_select` IS LEFT EXACTLY AS IT IS**, and the
comment must say why in full:

> Coverage is computed from an attendee COUNT. If one reader could see attendee rows another
> could not, the same event would read *covered* to one leader and *uncovered* to another, from
> the same data, at the same instant. CLAUDE.md records that trap under the all-organizations
> unclaimed rule: a rule that is not uniformly evaluable is not a rule. This is the same
> read-wide/write-narrow contrast migration 054 drew for profiles, and here the read half is
> load-bearing rather than merely convenient.

```sql
drop policy activity_attendees_ward_insert on activity_attendees;
drop policy activity_attendees_ward_update on activity_attendees;
drop policy activity_attendees_ward_delete on activity_attendees;

create policy activity_attendees_insert on activity_attendees
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or user_id = auth.uid())
  );

create policy activity_attendees_update on activity_attendees
  for update to authenticated
  using      (ward_id = current_ward_id() and (is_bishopric() or user_id = auth.uid()))
  with check (ward_id = current_ward_id() and (is_bishopric() or user_id = auth.uid()));

create policy activity_attendees_delete on activity_attendees
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or user_id = auth.uid()));
```

Comment: the predicate is `user_id`, never `assigned_by`. `assigned_by` is null on a self-add,
and a policy comparing against it would be the `talks-d` hole in a third place. `assigned_by` is
a **record of how the row came to exist**, written by the route, and no policy reads it.

`update` is narrowed now even though nothing in this slice writes it: slice D sets
`confirmed_attendance`, and leaving a ward-wide UPDATE in place would let anybody confirm
somebody else's attendance. Narrowing it here costs one policy and closes that before it opens.

**056d — index.** Naming follows `018_indexes.sql`; leads with `ward_id`.

```sql
create index activity_attendees_event_idx on activity_attendees (ward_id, event_id);
```

---

### Task 2: Domain types

**File:** `types/domain.ts` (modify)
**Action:** Narrow `EVENT_STATUSES`; add the coverage vocabulary.

**Details:**

Narrow, and drop the label with it:

```ts
export const EVENT_STATUSES = ["upcoming", "cancelled"] as const;

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  upcoming: "Upcoming",
  cancelled: "Cancelled",
};
```

Replace the existing comment on the constant to record that 054c's open question is now
answered here, and that `updateActivityEventSchema` narrows automatically because it reads
`z.enum(EVENT_STATUSES)` — which is the point of spelling enums this way.

Add, **in the order that is the rank**, mirroring `VISIT_PRIORITY_BANDS`:

```ts
export const COVERAGE_STATES = [
  "uncovered",     // home, upcoming, inside the notice window, nobody going
  "needs_type",    // still tbd — nobody can even be asked
  "unassigned",    // home, upcoming, beyond the window, nobody going yet
  "covered",       // home, upcoming, at least one person going
  "awareness",     // away — no coverage expectation, by design
  "not_expected",  // cancelled, or already past
] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];
```

A comment must justify the two non-obvious placements:

- **`needs_type` outranks `unassigned`.** An event nobody has classified cannot be covered *or*
  dismissed — it is a decision that has not been made, and it blocks every other decision behind
  it. That is the same reasoning that put `never_visited` above `overdue`.
- **`awareness` is not a failure.** An away game with nobody going is the designed outcome
  (`08-youth-activities.md` §Step 4), so it ranks below `covered` rather than beside `uncovered`.
  Rendering it in a warning tone would train leaders to ignore the tone.

Add `COVERAGE_STATE_LABELS` (a `Record`, so a state added later must be labelled deliberately —
the rule `ACTIVITY_TYPE_LABELS` already states) and `COVERAGE_STATE_TONES` reusing the existing
tone scale. Suggested wording, to be read on a phone in a hurry:

| State | Label | Tone |
|---|---|---|
| `uncovered` | "Nobody going" | the strongest warning tone in the scale |
| `needs_type` | "Home or away?" | amber |
| `unassigned` | "Nobody yet" | amber, quieter |
| `covered` | "Covered" | positive |
| `awareness` | "Away — awareness only" | neutral |
| `not_expected` | "" (renders nothing) | — |

`not_expected` rendering **nothing** is deliberate and matches `talks-c`'s last-prayed nudge,
which renders nothing rather than "Never": a badge on a cancelled game saying "not expected" is
noise on the one row that already explains itself.

Add `coverageRank(state)` reading the index in `COVERAGE_STATES`, the way `priorityRank()` does.

---

### Task 3: The home-venue setting

**File:** `lib/ward/homeVenues.ts` (create)
**Action:** Read, parse and write `wards.settings.home_venues`. Copy `crossOrgVisibility.ts`'s
structure exactly.

**Details:**

```ts
export const FALLBACK_HOME_VENUES: readonly string[] = [];
export const MAX_HOME_VENUES = 40;
export const MAX_HOME_VENUE_LENGTH = 120;

export function parseHomeVenues(settings: unknown): string[]
export async function readHomeVenues(wardId: string, client?): Promise<string[]>
export async function writeHomeVenues(wardId: string, venues: string[], client?): Promise<string[]>
```

Rules, each of which has a reason worth writing down:

- **The fallback is the empty array, and that is the closed direction.** With no venues
  configured every event lands `tbd` — visible, loud, and waiting for a person. The open
  direction would be guessing, and a wrong `home` guess means nobody is asked to attend a game
  somebody should have attended.
- **A malformed value warns and falls back**, never throws. House rule for every `wards.settings`
  reader (`parseCrossOrgVisibility`, `parseWardTimezone`, `parseDefaultSpeakingSlots`). A bad
  setting must not take `/youth` down.
- **Non-string entries are dropped individually rather than failing the whole list**, with one
  warning naming the value. A ward that hand-edited its settings keeps the venues that are
  readable.
- **`writeHomeVenues` MERGES into the existing settings object.** A wholesale write here would
  silently delete `role_access`, `timezone` and `cross_org_visibility`. Both existing writers
  carry this warning verbatim; this one must too.
- **Entries are trimmed and lower-cased on write, and de-duplicated.** The classifier then does
  no normalising of the venue side at all, which keeps the two halves of the comparison from
  drifting.

**File:** `lib/validation/visit.ts` (modify) — add `homeVenuesSchema` beside
`crossOrgVisibilitySchema`, since that is where the ward-settings schemas already live. An array
of trimmed non-empty strings, `.max(MAX_HOME_VENUES)`, each `.max(MAX_HOME_VENUE_LENGTH)`.
*(If a reviewer prefers these move to a `lib/validation/ward.ts`, that is a separate change —
do not do it here.)*

---

### Task 4: The classifier

**File:** `lib/youth/classifyLocation.ts` (create)
**Action:** A pure function from location text and the ward's venues to an `EventType`.

**Details:**

```ts
export function classifyEventLocation(
  location: string | null | undefined,
  homeVenues: readonly string[],
): EventType
```

**It returns `home` or `tbd`. It never returns `away`,** and the comment must argue this at
length because it is the decision a future reader is most likely to reverse:

> Absence of a match is not evidence of an away game. "Lincoln HS Gymnasium", "Lincoln High —
> auxiliary gym" and a typo all fail to match a venue list containing "lincoln high school", and
> every one of them is a home game. Classifying an unmatched location as `away` would silently
> remove it from the coverage model, which is the one outcome this module exists to prevent —
> nobody is asked, nobody notices, and there is no badge saying so. An unmatched location becomes
> `tbd`, which is loud, ranks second overall, and asks a person for the one fact only a person
> has. `away` is always a human's word.

Matching is deliberately boring: lower-case the location, collapse internal whitespace, and test
`includes()` for each venue (already lower-cased and trimmed by `writeHomeVenues`). No fuzzy
matching, no Levenshtein, no tokeniser. A near-miss that a clever matcher would catch is exactly
the case where a person should be asked, and a clever matcher that is wrong is worse than a dumb
one that abstains.

`null`, `undefined` and whitespace-only all return `tbd` before the loop.

An empty venue list returns `tbd` for everything, with no special case — the loop simply does not
run. Do not add a guard that means something different.

---

### Task 5: Coverage, computed

**File:** `lib/youth/coverage.ts` (create)
**Action:** The pure coverage function, importable from both a Server Component and a client one.

**Details:**

Header must carry the same three paragraphs `appointmentStatus.ts` and `householdStatus.ts` do,
because the same three constraints apply:

- **Computed, never stored.** Migration 054c removed `covered`/`uncovered` for this. Nothing in
  this project refreshes anything — no `pg_cron`, no `supabase/functions/`, no `vercel.json`
  crons.
- **Client-importable.** `CoverageBadge` renders it and `ActivityCalendar` sorts by it. One
  import of `lib/youth/queries.ts` would pull `next/headers` into the client bundle. This file
  imports types and nothing else — **keep it that way.**
- **`asOf` is a parameter, never `new Date()` inside.** That is what makes both boundaries
  testable, and it is what keeps every row of one render judged against the same instant instead
  of against a clock that moves down the list. `/youth` already resolves one `asOf` per render
  and hands it down; do the same here.

```ts
export const COVERAGE_NOTICE_DAYS = 7;

export type EventCoverageInput = {
  eventType: EventType;
  eventDate: string;
  status: EventStatus;
  attendeeCount: number;
};

export type EventCoverage = {
  state: CoverageState;
  // Null when the event is past or cancelled — there is nothing to count down to. Fractional,
  // so a card can say "tomorrow" rather than rounding 20 hours to 0 days.
  daysUntil: number | null;
  attendeeCount: number;
};

export function eventCoverage(
  event: EventCoverageInput,
  asOf: Date,
  noticeDays: number = COVERAGE_NOTICE_DAYS,
): EventCoverage
```

**Branch order is load-bearing and must be written in this order:**

1. `status === "cancelled"` → `not_expected`. **Before the clock is consulted.** This is the
   user's rule from the planning conversation: a cancelled game may be reinstated, so it stays in
   the schedule and inside the "upcoming" count — but it must never register as unattended, at any
   distance from the clock. A cancelled game three days out is not uncovered, and a cancelled game
   three days past is not a failure anybody should be shown.
2. `eventDate` in the past → `not_expected`. You cannot cover a game that has happened. Whether
   anybody *did* is slice D's question, and it is answered by `activity_logs`, not by this
   function.
3. `eventType === "away"` → `awareness`. No coverage expectation, by design.
4. `eventType === "tbd"` → `needs_type`.
5. `attendeeCount > 0` → `covered`.
6. `daysUntil <= noticeDays` → `uncovered`, else `unassigned`.

Write a comment on step 2 saying that "past" is the *start* instant, not an end — this schema has
no duration column, so a game that started an hour ago reads `not_expected` while it is still
being played. That is correct for the question this function answers ("does somebody still need
to be asked?") and would be wrong for a question slice D might ask; naming it here stops the next
reader treating it as a bug.

`noticeDays` is a parameter with a default rather than a bare constant read inside, so a test can
pin the boundary from both sides and a future ward-configurable window costs one argument.

Also export `summariseCoverage(coverages): Record<CoverageState, number>` for the count strip at
the top of `/youth/calendar`. It is here rather than in the page so the number in the strip and
the badges beneath it cannot disagree — the `describeHouseholdForVisits()` lesson from `visits-f`.

---

### Task 6: Attendee data access

**File:** `lib/youth/attendees.ts` (create)
**Action:** Server-only reads and writes over `activity_attendees`.

**Details:**

Header: server-only (imports `createServerSupabaseClient`). **Never selects from
`activity_private_notes` and never imports the module that will** — the sentence
`lib/youth/queries.ts` and `lib/visits/participants.ts` both carry, for CLAUDE.md rule 5.

```ts
export type ActivityAttendee = {
  id: string;
  eventId: string;
  userId: string;
  displayName: string;
  // Null means the person added themselves. A name here means somebody asked them, and the
  // card says which — "assigned by Bishop Reyes" reads differently from "volunteered", and a
  // leader deciding whether to step in needs the difference.
  assignedBy: string | null;
  assignedByName: string | null;
};

export async function listAttendeesForEvents(wardId, eventIds: string[], client?)
  : Promise<Map<string, ActivityAttendee[]>>
export async function addAttendee(wardId, { eventId, userId, assignedBy }, client?)
  : Promise<ActivityAttendee | null>
export async function removeAttendee(wardId, eventId, userId, client?): Promise<boolean>
```

- `listAttendeesForEvents` takes **an array** and returns a Map. One query for a whole screen,
  not one per card — `MonthGrid`'s header records the same rule ("a grid that fetches per cell is
  six round trips to draw one month"). Returns an empty Map for an empty array **without
  querying**, since `.in("event_id", [])` is a round trip to learn nothing.
- Select columns: **one string literal on one line**, with two named embeds on `users` —
  `activity_attendees_user_id_ward_id_fkey` and `activity_attendees_assigned_by_ward_id_fkey`.
  Naming them is required: there are two foreign keys from this table to `users`, so an inferred
  embed is ambiguous, and `visits-d` recorded the same trap.
- **Only id and name from `users`.** Not an email, not a phone, not a role. A `visit_participants`
  rule that applies unchanged.
- A join that came back empty renders `"Someone"`, the way `mapParticipantRow` does — a deleted
  user must not silently erase the fact that somebody was going.
- `addAttendee` translates the unique-violation error (`23505`) into a `null` return, which the
  route turns into a friendly "You are already down for this one." **Not an error** — a double
  tap on a phone is the ordinary case, not a fault.
- `removeAttendee` returns whether a row went. **An RLS-denied DELETE is a zero-row success, not
  an error** (CLAUDE.md §8) — so a `false` here means refused, and the route must say so rather
  than reporting success.

**File:** `lib/youth/queries.ts` (modify)

- `createActivityEvent` takes the already-resolved `eventType` from its caller rather than
  reading a schema default, so exactly one place decides classification (Task 8).

---

### Task 7: Validation

**File:** `lib/validation/youth.ts` (modify)

- **`createActivityEventSchema.eventType` becomes `.optional()`, dropping `.default("tbd")`.**
  This is the change that makes classification possible: with a default, the route cannot tell
  "the leader left it alone" from "the leader deliberately chose Not yet known", so it would have
  to override an explicit human choice to classify anything. Absent means *decide from the
  location*; present means *a person decided*. Add a comment saying exactly that, because the
  default looks like a safe thing to restore.
- Add:

```ts
export const assignAttendeeSchema = z.object({
  userId: z.uuid("Choose who is going."),
});
```

  No `eventId` — it is the route parameter. No `assignedBy` — it comes from the session, the rule
  the file's own header already states for `wardId` and `enteredBy`.
- The self-add route needs **no body schema**: the only two facts are the event (a route
  parameter) and the person (the session). A schema for an empty body would be a schema for
  nothing.
- `updateActivityEventSchema` needs no edit — it reads `z.enum(EVENT_STATUSES)` and narrows with
  Task 2.

---

### Task 8: Classification on the way in

**Files:** `app/api/youth/events/route.ts`, `lib/youth/ics/buildImportPreview.ts`,
`lib/youth/ics/applyImport.ts` (all modify)

**Details:**

**Manual entry.** In `POST /api/youth/events`, after the profile check:

```ts
const eventType = input.eventType ?? classifyEventLocation(input.location, await readHomeVenues(user.wardId, supabase));
```

The audit detail already records `eventType`; add whether it was chosen or classified, so the
audit row can answer "why is this marked home?" without a reader guessing.

**Import preview.** `buildImportPreview` classifies each occurrence it is about to **create** and
carries the result on the preview row, so the leader reads *"Lincoln High School gym — Home"*
before confirming rather than discovering it afterwards. This is the same promise the timezone
note makes on that screen, and it is why the venue editor had to ship in this slice.

**Import apply — the guarantee that must not break.** `applyImport` writes `event_type` on an
**insert only**. On a matched row it is still never written, exactly as `youth-b` decided:

> `status` and `event_type` are never touched on a matched row, so a hand-cancelled game and
> slice C's future home/away correction both survive.

That sentence was written **about this slice**, in advance. The preview must therefore say, for a
matched row, that its home/away setting is being left alone — otherwise a leader who corrected a
classification last month has no way to know it survived, and the guarantee is invisible.

`buildImportPreview` is imported by `IcsPreviewStep`, a client component. `classifyLocation.ts`
is pure and imports only a type, so this adds nothing to the bundle — but check the number
`occurrence.ts`'s header records, since that file exists because of exactly this hazard.

---

### Task 9: The attend route

**File:** `app/api/youth/events/[id]/attend/route.ts` (create)
**Action:** POST — I'm going. DELETE — I'm not, after all.

**Details:**

- Gate: `assertCan(user, "youth_activities.view", roleAccess)`. **`view`, not `manage`** —
  `08-youth-activities.md` §Step 4 says "anyone self-adds", and an org secretary who holds `view`
  and `log` but not `manage` is exactly the sort of person who turns up to a basketball game. The
  route writes `user_id = user.id` and never reads a user id from the body, so `view` is not a
  widening: the only row you can create is your own.
- `getActivityEvent` first; 404 with "That event is not in your ward." if absent — the pattern the
  sibling routes already use, and the reason is the same: a foreign-key violation is not a
  sentence anybody can act on.
- `assignedBy: null` on a self-add. That null is the record of how the row came to exist.
- A `null` from `addAttendee` (unique violation) → **200 with a plain sentence**, not a 409.
  Being already down for an event is the state the caller wanted.
- DELETE removes only `user_id = user.id`. A `false` return is a refusal, surfaced as such.
- Audit both, `module: "youth_activities"`, actions `youth_activity_attend` and
  `youth_activity_unattend`.
- **No notification on a self-add.** A season has twenty games; one notification per volunteer is
  the digest-spam pitfall arriving by another door, and the events route already refused it once
  on the same reasoning.

---

### Task 10: The assign route

**File:** `app/api/youth/events/[id]/assign/route.ts` (create)
**Action:** POST — assign somebody. DELETE — unassign them.

**Details:**

- Gate: **bishopric only**, per `08-youth-activities.md` §Step 4 and the user's decision. Use the
  same shape `/youth`'s page uses to compute `isBishopric` —
  `(BISHOPRIC_ROLES as readonly string[]).includes(user.role)` — plus
  `assertCan(user, "youth_activities.manage", roleAccess)` first, so a ward whose `role_access`
  override removed the module still refuses. Return 403 with a sentence naming the rule: "Asking
  somebody else to attend is a bishopric decision. You can add yourself to any event."
- Body: `assignAttendeeSchema`. Verify the named user is in this ward and active before inserting,
  through the caller's own client — a user in another ward simply is not there.
- `assignedBy: user.id`.
- **Emit `youth_support_assigned`** with `recipientUserIds: [assignedUserId]`. Explicit
  recipients, not the trigger's `default_roles`: the seeded default reaches every org president
  in the ward, and this concerns exactly one person. `notifyOrgLeadership`'s header records that
  reasoning for a neighbouring case.
  Body text names the youth, the activity, the event and when — "Assigned" with no subject is a
  notification that costs a tap to understand.
- **`youth_event_uncovered` is NOT emitted here or anywhere.** It is one of the things that fires
  from nothing and it belongs to Phase 11's single decision about a mechanism, alongside
  `visit_overdue`, `refresh_goal_status()`, the Monday away-digest and ICS re-sync. That is
  **five**, and CLAUDE.md already counts them; do not add a sixth by inventing a trigger here.
- DELETE takes `?userId=`, bishopric only, and is how an assignment is withdrawn. Audit both.

---

### Task 11: The home-venue route and panel

**Files:** `app/api/ward-settings/home-venues/route.ts`, `app/(app)/youth/HomeVenuePanel.tsx`
(create)

**Details:**

Route copies `app/api/ward-settings/cross-org-visibility/route.ts` structure exactly, including
the audit-then-notify order and the session resolved **outside** the try block (catching
`requireSessionUser`'s redirect turns it into a 500).

- GET: `youth_activities.view`. Everybody who reads the calendar benefits from knowing which
  venues count as home — "why is this marked away?" should be answerable on the page.
- PUT: bishopric. `assertCan(user, "youth_activities.manage", …)` and the bishopric role check,
  same shape as Task 10. Notify the other two bishopric members via `notifyOtherBishopric` —
  shared admin authority is a product requirement (CLAUDE.md §7), and this setting changes how
  every future import classifies.
- Audit with the before and after lists, not just "changed".

Panel: bishopric-only, on `/youth`, collapsed by default. A textarea, one venue per line, is the
right control — a repeating add/remove row list is four times the code for a list a ward edits
twice a year. Say what it does in a sentence a leader can act on: *"Events at these places are
marked Home automatically when a schedule is imported. Everything else waits for somebody to
say."* Show the count. **Changing the list does not reclassify existing events** — say so on the
panel, because a leader who adds their school and sees nothing change will otherwise assume it is
broken. (Reclassifying in bulk is a real feature and it is not this slice; if it is wanted, it is
its own scope with its own confirm.)

---

### Task 12: `/youth` grows coverage

**Files:** `app/(app)/youth/page.tsx`, `EventList.tsx`, `ManualEventForm.tsx`,
`youthQueries.ts` (modify); `components/youth/CoverageBadge.tsx`,
`components/youth/AttendeeControls.tsx` (create)

**Details:**

`page.tsx`: after `listActivityEvents`, one `listAttendeesForEvents` over the returned ids and one
`readHomeVenues`. The existing single `asOf` is handed to `eventCoverage` — do not create a
second clock.

`CoverageBadge` takes `{ coverage }` and renders the label and tone from `types/domain.ts`, and
**nothing for `not_expected`**. It is a component rather than inline markup because
`/youth/calendar` renders the same badge, and two copies would drift the moment a label is
retuned — `program-b`'s one-diff-panel-shared-by-two-flows decision, and `visits-c`'s instruction
to parameterise rather than fork.

`AttendeeControls`:

- "I'll go" / "I can't after all" — shown to **everybody**, since the gate is `view`.
- "Ask someone to go" — shown **only to the bishopric**, opening `MemberPicker`'s sibling for
  users… *note:* `MemberPicker` picks **members**, and an attendee is a **user**. Do not force it.
  Use the plain select the admin pages already use for a user list, and say in a comment that
  members and users are unrelated rows in this schema — `lib/visits/participants.ts`'s header
  states this and it is the single most common wrong assumption in this codebase.
- Who is going renders as names, with "· asked by ⟨name⟩" where `assignedBy` is set.
- **This is where `youth-a-D1` and `visits-d` happened twice.** Every control here is decided by
  the same gate the route enforces, and the bishopric-only control is **absent** for everybody
  else rather than present-and-refusing. `/youth`'s page already models this for `canManage`.

`youthQueries.ts`: add `YOUTH_ATTENDEES_QUERY_KEY` and `fetchAttendees(eventIds)`; attending or
assigning invalidates **both** the attendee key and the events key, because the coverage badge is
derived from both. Add it to a named constant the way `PROFILE_MUTATION_INVALIDATES` is, with the
same header reasoning — this is the third time this module has had to learn it.

`ManualEventForm`: the home/away select gains a first option, **"Decide from the location"**,
which is the default and sends **no** `eventType`. The three explicit options remain. Beneath it,
one line: *"Chosen automatically from the location, or left for somebody to set."*

The "upcoming" count in the schedule heading is **unchanged**. Cancelled events stay inside it,
per the user's decision — they can be reinstated. Add a one-line comment recording that this was
decided rather than overlooked, since the `youth-a` retro left it open by name.

---

### Task 13: `/youth/calendar`

**Files:** `app/(app)/youth/calendar/page.tsx`,
`app/(app)/youth/calendar/ActivityCalendar.tsx`,
`components/youth/ActivityMonthGrid.tsx` (create)

**Details:**

**Gate:** `youth_activities.view`, via `can()` and `NotPermitted` — not `assertCan()`, because a
`ForbiddenError` escaping a Server Component becomes a 500 whose message Next strips in
production (`auth-b`). **Ward-wide, always.** A ward council member sees every organization's
events; that is `08-youth-activities.md` §Step 7 and FEATURES.md §Module 10, and it is what
migration 054's untouched select policy already delivers. There is no second gate here, unlike
`/visits/all-organizations` — no ward setting narrows this one.

**Reads:** events with `includePast: false`, all profiles, attendees for those events, one
`asOf`. Coverage is computed on the server and handed down as props, so the count strip and the
badges come from one computation.

**Filters** — youth, organization, activity type, home/away — are applied **client-side over the
one fetched list**. Reasons, both worth stating in the file: a filter parameter the route's schema
does not carry is silently ignored with no error (`roster-b`), and a list narrowed in the client
while a count beside it answers a different question is the same defect from the other side. One
list, one count, filtered together.

**Zones — the trap in this task.** Every card is bucketed into a day using the **reader's** zone,
in the client, so the day a card sits under always matches the time printed on it. Do **not**
bucket by the ward's zone: `EventList.formatInstant` already renders in the reader's zone, and
mixing the two puts a 11pm game under the wrong date on the grid while its own card says
otherwise — a bug that appears for a few hours a day and only for some readers. The ward's zone
(`lib/ward/wardTimezone.ts`) decides what a **floating imported time means**; it does not decide
what day a rendered card belongs to. Write this paragraph into the component.

**`components/calendar/MonthGrid.tsx` was examined and cannot be reused** — it renders six Sunday
cells and inert spacers, keyed on `Sunday` rows, which is the opposite of what this needs. What
*is* reused is `daysInMonth` and `leadingBlankDays` from `lib/calendar/dates.ts`. Record the
rejection with its reason, so the next reader does not re-open the question.

**Layout:** card list below `md:`, month grid at `md:` and up, per §Step 7. The card list is the
primary form — it is what a leader reads on a phone, and it is the one that must be right.

**The uncovered event must be impossible to miss.** A count strip at the top leads with the
`uncovered` count as a sentence, not a number in a chip: *"3 home events in the next week with
nobody going."* Zero renders as nothing at all rather than "0 uncovered" — a zero state that
announces itself trains people to skim past the strip.

Link to it from `/youth` (a text link beside "Import a schedule"), and link back. **Do not touch
`lib/auth/navigation.ts`** — `/visits/all-organizations` is reached the same way, and adding a
second youth item to the sidebar for four roles is a navigation decision this slice was not asked
to take.

---

### Task 14: Seed helpers

**File:** `testing/infrastructure/seedUtils.ts` (modify)

- `createActivityAttendee({ eventId, userId, assignedBy? })` — mirrors `createActivityEvent`'s
  shape, deterministic `testUuid` key from `attendee:${eventId}:${userId}`.
- Ward settings gain `home_venues` so a scenario can seed a configured ward. Follow how
  `cross_org_visibility` is already seeded onto `wards.settings`, merging rather than replacing.
- A comment on `createActivityAttendee` noting the unique index from 056b, so a seed that writes
  the same pair twice fails loudly rather than confusingly.

---

## Testing Strategy

Priority order per CLAUDE.md §8. Pure functions first because they are cheap and this slice is
mostly arithmetic; RLS next because it is the boundary; routes after.

### Create

| File | Asserts |
|---|---|
| `tests/lib/homeAwayClassification.test.ts` | `08-youth-activities.md`'s named test. Known home venue → `home`; unknown → `tbd`; **never `away` from any input**; empty/null/whitespace location → `tbd`; empty venue list → everything `tbd`; case and surrounding-text insensitivity; a venue that is a substring of a longer name still matches |
| `tests/lib/youthCoverage.test.ts` | The phase plan's `uncovered-detection`. Home 6 days out with no attendee → `uncovered`; **8 days out → `unassigned`, and 7 days exactly is pinned from both sides**; an away event is never `uncovered` at any distance; a covered event with one attendee; `tbd` → `needs_type`; **a cancelled event 3 days out is `not_expected`, and a cancelled event 3 days PAST is `not_expected`** — the user's rule, both directions; a past event → `not_expected`; `daysUntil` is null exactly when the state is `not_expected`; `coverageRank` orders `COVERAGE_STATES` as written |
| `tests/lib/homeVenues.test.ts` | Table-driven over `parseHomeVenues`, mirroring `wardTimezone.test.ts`: absent, null, a string, a number, an array with non-string entries (kept entries survive), over-long list. Fallback is `[]` in every failure case |
| `tests/rls/activity-attendees.test.ts` | **The highest-value suite here.** A leader inserts a row for themselves; a leader **cannot** insert one naming another user; the bishopric can; a leader deletes their own and **cannot** delete another's; the bishopric can. **Reads stay ward-wide** — an Elders Quorum president reads an attendee row on a Young Women event, which is what makes coverage uniformly evaluable. Cross-ward isolation both ways. Every refusal asserted by **re-reading the row with the service client** — an RLS-denied UPDATE/DELETE is a zero-row success, only INSERT raises |
| `tests/routes/youthAttendance.test.ts` | Self-add returns 201 and the row; **a second self-add returns 200 with a sentence, not a duplicate row**; unattend removes only your own; assign is 403 for `org_president` and 201 for `bishop`; assign emits `youth_support_assigned` to the assignee and to nobody else; a `counselor` can assign (bishopric authority is shared — never build a check that grants the bishop something a counselor lacks); an event in another ward is 404 |
| `tests/routes/homeVenues.test.ts` | GET readable by an org secretary; PUT 403 for a non-bishopric role; PUT merges rather than replacing — **assert `role_access` and `timezone` survive the write**, which is the failure the merge rule exists to prevent |
| `tests/components/youth/CoverageBadge.test.tsx` | `not_expected` renders nothing; each other state renders its label; guarded as a **pair** so the "fix" for an over-eager badge cannot become deleting the badge (the `youth-b` all-day lesson) |

### Modify

- `tests/lib/youthValidation.test.ts` — `eventType` absent is valid and yields `undefined` (not
  `"tbd"`); an explicit `"tbd"` survives; `assignAttendeeSchema`.
- `tests/lib/icsIdempotent.test.ts` — **add a case proving `event_type` is not written on a
  matched row.** A row corrected to `away` by hand, re-imported from a file whose location matches
  a home venue, stays `away`. This is `youth-b`'s guarantee and this slice is the first thing that
  could break it; without this case, nothing would notice.
- `tests/db/rls-enabled.test.ts` — no change expected; run it, since 056 replaces policies.
- Any test asserting `EVENT_STATUSES` contains `completed`.

### Not tested, deliberately

The month grid's layout. A grid that renders is a screenshot question, and scenario 054 asks a
human to look at it at 375px and at desktop width.

---

## Test Scenarios (Harness)

Both are `full`, not `smoke` — each needs a seeded state that is tedious to build by hand, which
is the criterion.

### Scenario 053: Nobody is going to Friday's game

**Tags:** `youth`, `full`, `coverage`, `permissions`
**Purpose:** Coverage is the slice's whole claim, and it is a function of the clock — which means
the seed has to place events at *specific distances* from now, and a tester cannot do that by
hand without arithmetic they will get wrong. It also walks the two permission gates that
`youth-a-D1` and `visits-d` both got wrong: a control offered where the API refuses.

**Seed data summary:**

- Ward — Harness Test Ward, `home_venues: ["lincoln high school"]`
- Users — `bishop@…`, `ym-president@…`, `rs-president@…`, `ward-council@…` (no `org_id`)
- Households/members — 2 youth: Ethan Brooks (Young Men), Ava Chen (Young Women)
- Activity profiles — 2: *Varsity basketball* (Young Men), *Concert choir* (Young Women)
- Events — 6, placed relative to seed time:
  - **home, +3 days, no attendee** → must read `uncovered`
  - **home, +3 days, one attendee (`ym-president`)** → must read `covered`
  - **home, +20 days, no attendee** → must read `unassigned`, *not* uncovered
  - **away, +3 days, no attendee** → must read awareness, never uncovered
  - **tbd, +3 days** → must read `needs_type`
  - **home, +3 days, `status: cancelled`, no attendee** → must read nothing, and **must still be
    inside the "upcoming" count on `/youth`**
- Attendees — 1

**Tester action:** Sign in as `ward-council@…`; read the coverage strip and each badge. Tap
**I'll go** on the +20-day event and watch both the badge and the strip change **without a
reload**. Tap **I can't after all**. Confirm there is **no** "Ask someone to go" control anywhere.
Sign out, sign in as `bishop@…`, assign `rs-president@…` to the +3-day uncovered event, and check
`rs-president`'s notification bell. Then **let the clock argue**: change the cancelled event's
date in Supabase to three days in the *past*, reload, and confirm it still shows no coverage
warning.

**Verification checklist:**

- [ ] The strip reads a sentence naming the uncovered count, not a bare number
- [ ] The +3-day home event with no attendee is visually the loudest thing on the page
- [ ] The +20-day home event does **not** read uncovered
- [ ] The away event carries no warning tone at any distance
- [ ] The cancelled event shows **no** coverage badge, and **is** counted in "upcoming events"
- [ ] Moving the cancelled event into the past still shows no warning — *the user's rule*
- [ ] Attending updates the badge **and** the strip with no reload
- [ ] `ward-council@…` is **not shown** an assign control — absent, not present-and-refusing
- [ ] `rs-president` receives exactly one `youth_support_assigned` notification, naming the youth,
      the activity and when
- [ ] Every control is reachable and readable at 375px

### Scenario 054: Home, away, and the ward's own gym

**Tags:** `youth`, `full`, `classification`, `import`
**Purpose:** Classification happens on the way in and is never rewritten on re-import — a
guarantee `youth-b` made *about this slice*, in advance. It can only be checked by importing,
correcting by hand, and importing again, which is three steps and a file. The scenario also
covers the venue editor, which is the reason classification works at all.

**Seed data summary:**

- Ward — Harness Test Ward, **`home_venues` empty** (so the tester configures it, which is the
  point)
- Users — `bishop@…`, `ym-president@…`
- Members / profiles — 1 youth, 1 activity (*Varsity basketball*)
- Events — **none**
- Fixture — `lincoln-basketball.ics`, reusing scenario 051's file: some games at
  `Lincoln High School gym`, some at `Roosevelt High School`

**Tester action:** Sign in as `ym-president@…` and import the file **before** any venue is
configured — every event must arrive `tbd`. Sign in as `bishop@…`, open the venue panel, add
`Lincoln High School`. Confirm the panel says existing events are not reclassified, and confirm on
`/youth` that they were not. Correct one Roosevelt game to **away** by hand and one Lincoln game
to **away** deliberately (a wrong-looking correction, on purpose). Re-import the same file.

**Verification checklist:**

- [ ] With no venues configured, the preview shows every event as "Home or away?" — not `home`,
      not `away`
- [ ] The venue panel is **absent** for `ym-president@…` and present for `bishop@…`
- [ ] Saving venues does **not** change any existing event, and the panel said so beforehand
- [ ] A **second** import of the file classifies the new Lincoln games as Home in the preview,
      before confirming
- [ ] The preview says, for rows that already exist, that their home/away setting is left alone
- [ ] After re-import, the hand-corrected Lincoln game is **still away** — the `youth-b` guarantee
- [ ] Roosevelt games are `tbd` unless a person set them, never auto-`away`
- [ ] The result screen pluralises correctly at 1 and at many (the `youth-b` copy defect)
- [ ] Dates on every screen read `Sat, 2 Jan 2027`, never `1/2/2027`

---

## Validation Commands

```bash
# Apply the migration to the linked hosted project (CLAUDE.md §9 — this is the only database)
npm run db:push

# Regenerate types after the migration
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests — the whole suite, since 056 replaces live policies
npm run test

# Production build. Lint, typecheck and tests can all pass while this fails: static generation
# runs code the dev server never does, and this slice adds two new pages.
npm run build
```

---

## Integration Notes

- **Migration 056 applies immediately**, before the code deploys. It is additive-with-tightening
  on a table holding zero rows plus a CHECK narrowing to a value nothing holds. It gets **no**
  `HELD_BACK_UNTIL_DEPLOYED` entry, and adding one would make `tests/db/migrations.test.ts` blind
  to it.
- **`EVENT_STATUSES` narrowing is a type-level breaking change** and that is the point: the
  compiler will name every site that mentions `completed`. Expect `EVENT_STATUS_LABELS`, the
  update schema (which narrows for free), and any test.
- **Slice D inherits:** `activity_attendees.confirmed_attendance`, still unwritten, now behind a
  narrowed UPDATE policy; `ACTIVITY_TYPE_TONES`, already shaped since slice A; and the answer that
  follow-up state lives on `activity_logs` rather than on `activity_events.status`.
- **Phase 11 inherits nothing new, and that matters.** `youth_event_uncovered` and the Monday
  away-digest stay uncomputed-by-anything, alongside `visit_overdue`, `refresh_goal_status()` and
  ICS re-sync. Five things, one decision, and this slice deliberately does not make a sixth.
- **`plans/INDEX.md` needs its youth-c row updated** on completion — plan link, status, and the
  scenario numbers, matching how youth-a and youth-b are recorded.
- **CLAUDE.md §9 gains an entry** for the classification decision: *an unmatched location is `tbd`,
  never `away`* — it is the kind of rule a later reader would otherwise "improve", and the cost of
  reversing it is a game nobody is asked to attend.
- **Not in this slice, recorded so it is not lost:** bulk reclassification when the venue list
  changes; `activity_events.entered_by` (raised by `youth-a`, wanted together with the unscoped
  leader-to-leader messaging feature); and a ward-configurable coverage notice window, which
  `eventCoverage`'s `noticeDays` parameter leaves one argument away.
