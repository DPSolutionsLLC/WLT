# Plan: Youth Cards and the Support Percentage

**Created:** 2026-08-29
**Type:** feature
**Follows:** `plans/youth-e-overview-and-cross-navigation.md` — this revises what that plan built,
after walking scenarios 057 and 058 on 2026-08-29. Execute that plan's commit first if it is still
uncommitted; this plan assumes its code is in the tree.
**Scope refs:** none — this came from a design conversation reviewing the youth-e walk, not from
`/iterate`. It continues ITER-020's intent ("buttons that sort things according to what you are
looking for") but ITER-020's own plan is already executed.

---

## Overview

`/youth` today lists **one card per activity profile**, sorted by one of three need rankings. Three
things change, all decided by the user on 2026-08-29:

1. **A card becomes a young person**, not a young person *and one activity*. `youth_activity_profiles`
   holds one row per (member, activity) with **no uniqueness on the member**, so Ethan doing
   basketball and track is two rows and today renders as two cards. Group them: one card per youth,
   with **one pill per activity**.
2. **Each pill carries a support percentage** — how often that young person's home games have
   actually been attended by a leader. This is the number the priority sort reads.
3. **Two sorts, not three** — `name` and `priority` — with an **ascending/descending toggle**.
   "Nobody going yet" and "Nobody has been in a while" both go; the second label was the one the
   user found vague, and consolidating is the point.

A fourth change comes out of the third: the percentage counts **confirmed** attendance, and the
app currently cannot record confirmation for a leader who turned up without signing up first.
Task 5 closes that, because without it the metric reports neglect that did not happen.

### The user's stated goal, which governs every trade-off here

> my ultimate goal is to make this process of tracking, committing, and following up by a leader as
> simple and easy as possible… if it is just too complicated to figure out and report in the app
> [then] we could easily end up with the app showing that an individual youth has not received
> support when they actually had it.

**The percentage measures RECORDED support, not support.** Every decision below leans toward
recording being easy and toward absence of data reading as absence of data.

### The four decisions, as settled

| Question | Decision |
|---|---|
| Card unit | **One card per young person**, a pill per activity |
| Do away games count? | **No — home games only.** An away game carries no coverage expectation by design (`08-youth-activities.md` §Step 4), and counting one manufactures alarm about a rule working correctly. This is the same exclusion `lib/youth/profileNeed.ts` already applies. |
| What counts as support? | **Confirmed attendance only.** At least one leader who said "I went". |
| Over what period? | **The whole season**, because the number exists to compare youth *within* one activity. In practice: **every event on that profile** — see Task 1's note on why there is no season boundary in the data. |

### Success criteria

- `/youth` lists each young person **once**, with a pill per activity carrying that activity's
  support percentage.
- Sorting by **priority** puts the least-supported young person first, and a young person with
  **no home games played** sorts **last** rather than reading as 0%.
- The direction toggle reverses the order **without moving the no-data group off the bottom**.
- A leader who files a follow-up saying "I went" on an event they never signed up for is counted
  as support.
- No migration, no new table, no new dependency.

### What is deliberately NOT in scope

- **ITER-024 / 025 / 027** — the occasion link, the event-detail view, and who may comment. All
  still blocked and still sequenced together.
- **ITER-026** (a leader's own page). `FollowUpPanel` stays where youth-e put it.
- **Any stored percentage.** It is computed on read, like everything else in this module.

---

## Relevant Files

### Modify

- `lib/youth/profileNeed.ts` — gains the per-activity support calculation and a youth-level
  aggregate above the existing per-profile one. **Keep the filename**; the per-profile layer is
  still needed and this is one concern at two levels.
- `app/(app)/youth/YouthOverview.tsx` — groups by member, renders pills, two sorts plus direction,
  and the expanded-card treatment.
- `app/(app)/youth/EventList.tsx` — `profileId?: string` becomes `profileIds?: readonly string[]`,
  because one card now covers several activities.
- `app/(app)/youth/FollowUpForm.tsx` — asks "Did you go?" even when the reader has no attendee row.
- `app/api/youth/logs/route.ts` — creates the attendee row when a non-attendee answers "I went".
- `tests/lib/youthProfileNeed.test.ts` — extended for the new functions.
- `tests/routes/youthLogs.test.ts` — extended for Task 5. It already covers this route; a second
  file for the same handler is the fork this project keeps refusing.
- `testing/scenarios/youth/scenario-057-the-young-person-nobody-has-been-to-see/` — seed and
  checklist both change; a youth with **two** activities is the case the current seed cannot make.

### Create

**No new source files.** The one new test goes into an existing suite — see Testing Strategy.

### Read but do not change

- `lib/youth/coverage.ts` — `eventCoverage`, `isExpectedPast`'s three exclusions. Composed, never
  redefined.
- `components/youth/CoverageBadge.tsx`, `app/(app)/youth/FollowUpPanel.tsx`,
  `components/youth/AttendeeControls.tsx` — reused unchanged.
- `lib/youth/attendees.ts` — `addAttendee` and `setConfirmedAttendance` already exist and are what
  Task 5 composes.
- `app/(app)/youth/calendar/ActivityCalendar.tsx` — **no change.** Its sort was removed on
  2026-08-29 and must not come back; a calendar has one order.

---

## Dependencies

**None.** No migration, no new library, no generated-type change, no new route.

`activity_attendees.confirmed_attendance` already exists (Foundation B, first written in `youth-d`)
and already crosses to the client on `ActivityAttendee.confirmedAttendance`. The percentage is
computed from data `/youth` already fetches.

---

## Known Pitfalls (from retro context)

Each is a defect this codebase has already shipped. Read the linked retro before the task it names.

### 1. Absence of a signal is not a zero score — `visits-f`, `youth-c`, and this module twice

`visits-f` shipped a comparator whose inherited name tie-break sorted **never-visited below
recently-visited**. Every row was individually correct and the list was useless.

**Where it bites here, and it is the single most likely bug in this work:** a young person with
**no home games played** has no percentage. If that renders as `0%` it sorts **first** under
"least supported" — and the priority list is led by the one person nobody could possibly have
supported. It must be `null`, must render as an em dash or a sentence, and must sort **last in
both directions**.

### 2. Nulls sort last in BOTH directions here — and that is the opposite of the sort it replaces

`youth-e`'s `nobody_all_season` sorted `lastAttendedOn: null` **first**, because there null meant
"nobody has ever been" — a real and strong signal.

Here `null` means **no games have been played**, which is no data at all.
`VisitProgressTable.compareNullable()` is the precedent to follow: *"A MISSING VALUE ALWAYS SORTS
LAST, in both directions. Reversing the nulls with the direction is the behaviour that makes a
table feel scrambled."*

These two rules look identical and are opposite. **Write the comment and write the test.**

### 3. A card must not display a number that is not part of the value it sorted on — the youth-e walk

Found 2026-08-29: every covered card read `Covered · 0` above an event card reading `Covered · 1`,
because `YouthOverview` had no real count to pass and filled a literal zero. Fixed by carrying the
whole event row rather than two fields of it.

**Where it bites here:** the pill's percentage, the priority sort, and any sentence on the card must
all come from **one** computed value per youth. This is the `summariseCoverage` /
`summariseFollowUp` / `describeHouseholdForVisits` rule, now stated in five places.

### 4. A gate can make a count lie — `ITER-022`

Removing a control without revisiting the number beside it left "Waiting on your follow-up (2)"
above one usable control.

**Where it bites here:** the pill count and the expanded event list must agree. A card showing
"1 of 8" must expand to a list where eight home games are findable.

### 5. A Server Component prop never refetches — `youth-a-D2`

Why `app/(app)/youth/youthQueries.ts` exists. **Where it bites here:** the percentage is derived
from the **widened** attendee entry (`[YOUTH_ATTENDEES_QUERY_KEY, true]`). Confirming attendance
invalidates that key, so a pill must move when a follow-up is saved. If it does not, the derivation
is reading a prop rather than the query.

### 6. Two views must not share one cache entry — `visits-c`

`includePast` is part of the **key**. The overview reads the widened entries; the `EventList` inside
a card opens on the narrow ones. Both are seeded separately by the server and that stays true.

### 7. Seed the shared cache with the FULL list, filter for display — `youth-e`

`EventList`'s `initialEvents` seeds an entry `FollowUpPanel` and the overview also read. The new
`profileIds` prop filters what is **rendered**; the seed stays whole.

### 8. A client-importable module must import types only — `youth-c`

`youth-c` recorded that **`npm run build` caught what lint, typecheck and 2982 tests missed** — a
constant in a server-only module pulling `next/headers` into the browser bundle, and `youth-b`
measured one costing ~505KB while breaking nothing. `lib/youth/profileNeed.ts` imports
`lib/youth/coverage.ts` and types. **Never `lib/youth/queries.ts`.** Run the build.

### 9. Copy defects are invisible to a green suite — `youth-b`, `youth-c`

`youth-b` shipped "1 events updated"; `youth-c` shipped four more and introduced a fifth while
fixing them. **Where it bites here:** singular and plural on "1 of 1 home game", the no-data pill,
and the reversal sentence in Task 5's form. Read every string on a real screen.

---

## Tasks

### Task 1: The per-activity support calculation

**File:** `lib/youth/profileNeed.ts` (modify)

**Action:** Add support arithmetic beside the existing coverage arithmetic. Pure, client-importable,
`asOf` a parameter (Pitfall 8).

```ts
export type ActivitySupport = {
  profileId: string;
  activityName: string;
  // Past home events, not cancelled — the SAME rule isExpectedPast() already applies. Reuse it.
  expectedPastCount: number;
  // Of those, how many had at least one leader who CONFIRMED they went.
  supportedCount: number;
  // supportedCount / expectedPastCount, or NULL when nothing has been played.
  // NULL IS NOT ZERO. See Pitfall 1 — this is the whole trap in this slice.
  supportedFraction: number | null;
};

export function activitySupport(
  profile: { id: string; activityName: string },
  events: readonly SupportEvent[],
  asOf: Date,
): ActivitySupport;
```

`SupportEvent` extends `ProfileNeedEvent` with what decides "supported":

```ts
export type SupportEvent = ProfileNeedEvent & {
  // TRUE only where a leader actively said "I went". A signed-up leader who never answered does
  // NOT count, and one who said "I did not go" certainly does not. Decided 2026-08-29.
  confirmedAttendeeCount: number;
};
```

**An event counts as supported when `confirmedAttendeeCount > 0`.** Nothing else.

**Which events form the denominator — reuse `isExpectedPast()` unchanged.** Past, `status !==
"cancelled"`, `eventType === "home"`, readable date. Do not write a second definition; the three
exclusions each have a different reason and they are already commented where they live.

**On "the whole season", and this needs a comment in the file.** There is no season boundary in the
schema: `youth_activity_profiles.season_schedule` is free text (`"November to February"`) and
nothing can compute against it. A profile is created per activity per season and holds that
season's events, so **every event on the profile IS the season**. That convention is what this
relies on, and it drifts only if a ward reuses one profile across years. Say so rather than implying
a boundary exists.

**Also export the sentence, beside the computation** (Pitfall 3):

```ts
// Null means NOTHING TO SAY. A young person with no home games played has not been neglected.
export function describeActivitySupport(support: ActivitySupport): string | null;
```

- `expectedPastCount === 0` → `null`
- otherwise → `"Somebody went to 1 of 3 home games."` / `"Somebody went to 3 of 8 home games."`
  Singular and plural spelled out on **both** numbers (Pitfall 9): `1 of 1 home game`.

### Task 2: The youth-level aggregate

**File:** `lib/youth/profileNeed.ts` (same file, below Task 1)

**Action:** One young person's standing across every activity they are in.

```ts
export type YouthNeed = {
  memberId: string;
  memberName: string;
  // One per profile, in activity-name order so two cards never disagree about pill order.
  activities: ActivitySupport[];
  // The LOWEST non-null fraction across their activities — the priority sort reads this.
  // NULL when no activity has played an expected game yet. Pitfall 1.
  lowestSupport: number | null;
  // Carried across every activity, so the card keeps youth-e's coverage badge.
  upcomingCount: number;
  worstUpcoming: CoverageState | null;
  worstUpcomingAttendees: number;
  soonestNeedOn: string | null;
};

export function youthNeed(
  member: { id: string; name: string },
  profiles: readonly { id: string; activityName: string }[],
  eventsByProfile: ReadonlyMap<string, readonly SupportEvent[]>,
  asOf: Date,
): YouthNeed;
```

**`lowestSupport` is the minimum of the non-null fractions.** An activity with nothing played
contributes nothing to it — it is not a zero dragging the youth to the top. If **every** activity is
null, `lowestSupport` is null and the youth sorts last.

The coverage half reuses the existing per-profile `profileNeed()` across all their profiles and
reduces with `coverageRank()`. **`worstUpcomingAttendees` must stay tied to the event
`worstUpcoming` came from** — carry the event row, do not recompute (Pitfall 3, and this is the
exact defect the walk found).

### Task 3: The two sorts

**File:** `lib/youth/profileNeed.ts` (same file)

```ts
export const YOUTH_SORTS = ["priority", "name"] as const;
export type YouthSort = (typeof YOUTH_SORTS)[number];

export const YOUTH_SORT_LABELS: Record<YouthSort, string> = {
  priority: "Priority",
  name: "Name",
};

// What each direction MEANS, in a leader's words, because "ascending" says nothing about
// a percentage. Rendered on the toggle.
export const YOUTH_SORT_DIRECTION_LABELS: Record<YouthSort, { asc: string; desc: string }> = {
  priority: { asc: "Least supported first", desc: "Most supported first" },
  name: { asc: "A to Z", desc: "Z to A" },
};

export function compareYouth(
  sort: YouthSort,
  ascending: boolean,
  left: YouthNeed,
  right: YouthNeed,
): number;
```

**`priority`:**
1. **A youth with `lowestSupport === null` sorts LAST — in BOTH directions.** Pitfall 2. This is
   `compareNullable`'s rule, and it is the deliberate opposite of the sort it replaces. Comment it.
2. `lowestSupport` ascending (least supported first), reversed by `ascending === false`.
3. `memberName` `localeCompare` — **always ascending**, never reversed. A tie-break that flips with
   the direction makes the list feel scrambled for no information gained.

**`name`:** `memberName` `localeCompare`, reversed by direction. Nothing else — give the test two
youths with opposite priorities and prove it is ignored.

**The tie-break is never the first key.** That is exactly what `visits-f` got wrong.

### Task 4: `EventList` takes several profiles

**File:** `app/(app)/youth/EventList.tsx` (modify)

**Action:** One prop changes shape. Nothing else moves.

```ts
  // When set, only these profiles' events are RENDERED. One card is now one YOUNG PERSON, who may
  // be in several activities, so this is a list where youth-e had a single id.
  //
  // The three cache entries this component seeds and reads stay WHOLE — `initialEvents` is a seed
  // shared with FollowUpPanel and YouthOverview, and seeding it pre-filtered would poison that
  // entry for every other reader on the page. Filter on the way OUT, never on the way in.
  profileIds?: readonly string[];
```

Apply as one filter where the list is built:

```ts
const events = (eventsQuery.data ?? []).filter(
  (event) =>
    profileIds === undefined ||
    (event.profileId !== null && profileIds.includes(event.profileId)),
);
```

`eventCount()` already reads `events.length`, so the heading's count follows — preserve that
(Pitfall 4). The two filtered empty-state sentences youth-e added stay as they are; they read
correctly for a person as well as for an activity. **Verify that on the screen**, do not assume it
(Pitfall 9).

**Do not touch anything else in this file.** Every gate, invalidation constant and comment stays.

### Task 5: A follow-up that says "I went" records attendance

**Files:** `app/api/youth/logs/route.ts` (modify), `app/(app)/youth/FollowUpForm.tsx` (modify)

**Action:** Close the hole that makes the percentage lie. **This task is why the metric is safe to
build**; without it, Decision 3 reports neglect that did not happen.

**The hole.** `FollowUpForm` renders "Did you go?" only when `isAttendee`, and the route only writes
`attended` when it is sent. `youth-d` decided that, reasonably: with no attendee row there was "no
such question to answer". Under the support percentage there is. So:

> A leader turns up to Ethan's game without signing up, writes a warm follow-up about it — and the
> game counts as **unsupported**, because there is no attendee row to confirm against.

That contradicts `app/api/youth/logs/route.ts` decision 5, which offers "Say how it went" to any
`youth_activities.log` holder on any past event **precisely because** the person who turned up
unplanned is the one whose account is worth having.

**The form half.** Ask "Did you go?" regardless of `isAttendee`. Keep `aria-pressed` on both
buttons in every state and the sentence naming the stored answer — `ITER-022` fixed that and
`tests/components/youth/FollowUpForm.test.tsx` pins it in both directions. When the reader has no
attendee row the unanswered sentence should say what answering will do, in a sentence, because it
now creates a row rather than updating one.

**The route half**, in `POST` and `PATCH`, after the log is known written — the existing ordering
comment explains why that ordering matters and it does not change:

```
setConfirmedAttendance() returns FALSE when there is no row to update.
  if (attended === true && !recorded) {
    await addAttendee(wardId, { eventId, userId: user.id, assignedBy: null });
    recorded = await setConfirmedAttendance(...);
  }
```

- `addAttendee` returns `null` on a unique violation, which is a benign race — re-run
  `setConfirmedAttendance` and use its result.
- `assignedBy: null` is correct and load-bearing: null means **they added themselves**, which is
  what happened. Never stamp `assignedBy` here — `youth-c` records that comparing the nullable
  `assigned_by` instead of `user_id` is the `talks-d` hole, third sighting.
- **Only on `attended === true`.** "I did not go" must never create a row: it would put somebody on
  an attendee list to record that they were absent, and the coverage badge counts that list.
- The audit detail already carries `attendanceRecorded`; add whether a row was **created**, so the
  log distinguishes confirming from joining-and-confirming.

### Task 6: The overview screen

**File:** `app/(app)/youth/YouthOverview.tsx` (modify)

**Action:** Group by youth, render pills, two sorts and a direction toggle.

**Grouping.** Build `YouthNeed[]` in the existing single `useMemo` over the widened queries. Key by
`profile.memberId`; the display name is `profile.memberName`. **One pass, then every rendering reads
it** (Pitfall 3).

The `confirmedAttendeeCount` per event comes from the widened attendee entry:
`(attendeesByEvent[event.id] ?? []).filter((a) => a.confirmedAttendance === true).length`.
**`=== true` explicitly** — `confirmedAttendance` is `boolean | null` and `null` means nobody has
said either way, which is not "did not go" and must not be counted as attendance.

**Search** matches the member name **and** any of their activity names, so `choir` still finds Maya.
Client-side over the loaded list (no query parameter — `roster-b`).

**Sort control.** A labelled `<select>` over `YOUTH_SORTS` beside a direction button showing
`YOUTH_SORT_DIRECTION_LABELS[sort][ascending ? "asc" : "desc"]`. `useState<YouthSort>("priority")`
and `useState(true)`. The direction control is a **button, not a second select** — it has two states
and a select for two states is a control asking a question it could answer.

**Each card, collapsed:**
- the young person's name
- **one pill per activity**: `{activityName} · {percentage}` — e.g. `Varsity basketball · 38%`.
  With `expectedPastCount === 0` the pill reads `{activityName} · —` and carries a `title` of
  *"No home games played yet"*. **Never `0%`** (Pitfall 1).
  Give every pill a `title` with the counts — *"Somebody went to 3 of 8 home games"* — so the
  percentage is auditable without expanding. At small N a percentage misleads and the counts are
  the honest form.
- the `CoverageBadge` for `worstUpcoming`, unchanged from youth-e, with `worstUpcomingAttendees`
- the upcoming count

**Do NOT colour the percentages.** The sort is what surfaces who needs attention, and a second
colour system beside the coverage badge would compete with the one signal that already means
something — the same reasoning that keeps `awareness` out of the warning tone.

**Each card, expanded:** `<EventList profileIds={their profile ids} heading={memberName} …>` with all
its existing props and the **unfiltered** upcoming seeds (Pitfall 7).

**The expanded card gets a left accent border** (`border-l-4 border-l-primary`) so it is obvious
where one young person's block ends and the next begins — the user's Q4 answer from the walk.
**Not alternating colours between cards:** position is not information, and this app's left edges
already carry meaning (`COVERAGE_EDGE_CLASSES` marks an uncovered event). Check on a real screen
that the outer accent does not fight the inner danger stripe; if it does, use a heavier full border
on the outer card instead.

**Empty states, as sentences.** Keep youth-e's two — "no activities have been entered for this ward
yet" (with the `/youth/profiles` link when `canManage`) versus "nothing matches that search".

### Task 7: The copy pass

**Action:** Read every string this change touches on a real screen (Pitfall 9).

| Where | Check |
|---|---|
| Pills | `1 of 1 home game`, not `1 of 1 home games`. `—` for no data, never `0%`. |
| Sort labels | "Priority" and "Name"; the direction button says *what* it does, not "ascending". |
| Count line | "5 young people shown" — youth, not activities, now that a card is a person. |
| `EventList` empty states | The two filtered sentences say "this activity"; inside a per-youth card they should read correctly for a **person**. Reword if they do not. |
| `FollowUpForm` | The unanswered sentence for a reader with no attendee row. |
| `/youth` header | The paragraph youth-e wrote still describes this page — confirm. |

---

## Testing Strategy

### `tests/lib/youthProfileNeed.test.ts` (extend) — the priority tests

Table-driven, one fixed `asOf`, following the file's existing shape.

**`activitySupport()`:**
- A confirmed attendee makes an event supported; a **signed-up-but-unanswered** one does not; an
  **"I did not go"** one does not. Three separate cases — they are three different meanings of the
  same column.
- Away, `tbd` and cancelled past events stay out of the denominator. **Assert each separately**, so
  deleting one exclusion does not leave a green suite.
- `expectedPastCount === 0` → `supportedFraction` is **`null`**, not `0`.
- An unreadable date is excluded.

**`youthNeed()`:**
- `lowestSupport` is the minimum across activities.
- An activity with nothing played **does not** pull `lowestSupport` to zero.
- Every activity null → `lowestSupport` null.
- `worstUpcomingAttendees` belongs to the event `worstUpcoming` came from, across two profiles.

**`compareYouth()`** — assert each key **independently**:
- `priority` ascending: least supported first.
- `priority` descending: most supported first.
- **`lowestSupport === null` sorts LAST in BOTH directions.** *(Pitfall 2 — the single most
  valuable assertion in the file. Assert both directions explicitly.)*
- The name tie-break does **not** reverse with the direction.
- `name` ignores priority entirely — give the two youths opposite priorities and prove it.

**`describeActivitySupport()`:** null for nothing played; singular and plural on both numbers.

### `tests/routes/youthLogs.test.ts` (extend)

**Add to the existing suite rather than creating a new file** — it already covers this handler, and
`tests/routes/youthAttendance.test.ts` covers the attend route. A third file for the same POST would
be the fork this project keeps refusing.

It already follows `tests/helpers/routeClient.ts`; read that helper's header comment for the
`vi.mock` hoisting trap if the suite needs new setup. Every query runs against the hosted project as
a real authenticated user, so a pass proves RLS allowed it — and an RLS-denied UPDATE is a zero-row
success, so **assert a refused write by re-reading the row with the service client**.

- A follow-up with `attended: true` from a leader with **no** attendee row **creates** one with
  `confirmed_attendance = true` and `assigned_by = null`. Read the row back with the service client.
- A follow-up with `attended: false` from a leader with no attendee row creates **nothing**.
- A follow-up with `attended: true` from a leader who **is** down updates in place — still one row.
- `attended` absent leaves the attendee row untouched.

### Not needed, and why

- **No RLS tests.** No policy changes and no migration. `activity_attendees` writes are already
  covered by `tests/rls/activity-attendees.test.ts`, and Task 5 writes the caller's own id, which is
  the shape migration 056c already permits.
- **No new permission tests.** No gate changes.

---

## Test Scenarios (Harness)

### Scenario 057 (rewrite the seed and the checklist)

The existing scenario gives every youth exactly one activity, which is precisely the case that
**hid** the card-per-profile problem during the youth-e walk. It has to change.

**Seed changes:**
- **Ethan** gains a **second** activity (Track and field) with its own events — the multi-activity
  card, and the case the old seed could not make.
- Attendee rows gain **`confirmedAttendance`**: some `true`, some `null` (signed up, never
  answered), some `false` (said they did not go). The three meanings must be distinguishable on
  screen, and only `true` may count.
- Keep **Josh** (all away), **Sofia** (tbd + cancelled) and **Liam** (no events) exactly as they
  are. They are the no-signal cases and they are the point.
- Percentages should be **arithmetically checkable by hand** from the seed — e.g. Ethan's basketball
  at 1 of 8, his track at 3 of 4 — so the tester can verify the pill rather than trust it.

**Verification checklist — the lines that matter:**
- [ ] Ethan appears **once**, with **two** pills.
- [ ] Each pill's percentage matches the seeded counts exactly.
- [ ] A leader who signed up and **never answered** does not count as support.
- [ ] A leader who answered **"I did not go"** does not count as support.
- [ ] Josh, Sofia and Liam show `—` on their pills, **never `0%`**.
- [ ] **Priority, least-supported first** puts the lowest percentage top and the three no-data
      youths **last**.
- [ ] **Reversing the direction** puts the highest percentage top and **leaves the three no-data
      youths last**.
- [ ] Sorting by name and reversing ignores every percentage.
- [ ] Expanding Ethan shows events from **both** activities and nobody else's.
- [ ] The expanded card is visually distinct from the ones around it.
- [ ] Filing a follow-up saying **"I went"** on an event the reader never signed up for moves that
      activity's percentage **in the same interaction**.
- [ ] Readable at 375px, both themes.

### Scenario 058

**No change.** It covers `/youth/calendar`, which this plan does not touch.

### Regenerate the manifest

```bash
npm run manifest
```

---

## Validation Commands

Run in this order.

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

**`npm run build` is not a formality in this module.** `youth-c` recorded that it *"caught what
lint, typecheck and 2982 tests missed"* — a server-only module pulled into the browser bundle — and
`youth-b` measured one costing ~505KB while breaking nothing at all. This plan touches a
client-importable pure module. Watch the reported route sizes as well as the exit code.

The full suite takes roughly **30 minutes** (RLS tests run over the network against the hosted
project). Run it in the background rather than blocking on it.

---

## Integration Notes

### How this connects

- **No migration, no route added, no dependency, no generated-type change.** Everything is
  presentation and arithmetic over data already fetched, plus one write path corrected.
- `lib/youth/profileNeed.ts` composes `eventCoverage()` and `coverageRank()`. It does **not** define
  coverage a second time.
- **The percentage is computed on read**, which is this module's standing rule and now its seventh
  instance — `coverage.ts`, `followUp.ts`, `appointmentViewState()`, `householdVisitPriority()`,
  `profileNeed()` and `goalStatus.ts` precede it. A stored percentage would go stale the moment
  nobody refreshed it, and **nothing in this project refreshes anything**: `pg_cron` is not enabled,
  `supabase/functions/` does not exist, `vercel.json` declares no crons.

### Breaking changes

**None externally.** `/youth`'s URL, `?youth=` deep link and every other route are unchanged.

**One internal contract changes:** `EventList`'s `profileId` becomes `profileIds`. `YouthOverview`
is its only caller with that prop set; `/youth/profiles` passes neither and is unaffected.

**One youth-d decision is reversed, with a reason** (Task 5): "Did you go?" was absent without an
attendee row because there was no such question to answer. There is now, and the alternative is a
metric that reports neglect that did not happen. Record it in the retro rather than leaving the two
statements to contradict each other — the `youth-d` rule, where `lib/reports/types.ts` was amended
in the same change rather than left stale.

### Documentation to update

- **`CLAUDE.md` §9** — worth an entry. Two decisions belong there: *support is confirmed attendance
  only, home games only, whole season*, and *a null percentage sorts last in both directions*, with
  the note that it is the deliberate opposite of the sort it replaced.
- **SPEC.md** — the `/youth/` component-tree entry says "every young person, searchable, ranked by
  need". Update it to say what the ranking now is.
- **`plans/retros/`** — a retro entry after the commit, with a line in `plans/retros/INDEX.md`.

### What this leaves open, deliberately

- **The percentage measures RECORDED support.** It is only as true as the reporting, and Task 5
  closes the one gap that is the app's own fault rather than the leader's. If a walk finds leaders
  still not recording, the answer is fewer taps, not a different metric.
- **ITER-024 → ITER-027 → ITER-025** remain one later body of work.
- **ITER-026** (a leader's own page) is untouched; `FollowUpPanel` is the component it must reuse.
- **No season boundary is introduced.** If a ward is ever found reusing one profile across years,
  that is when a season model is worth designing — not before.
