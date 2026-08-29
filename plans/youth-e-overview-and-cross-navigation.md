# Plan: Youth Overview and Cross-Navigation

**Created:** 2026-08-29
**Type:** feature
**Scope refs:** ITER-020 (the unblocked half)
**Structure:** Single scope

---

## Overview

Phase 8 shipped four slices and **the module's front door is wrong**. `/youth` is four jobs on
one screen (activity profiles, the venue panel, the follow-up panel, the schedule, an add-event
form) and there is no view organised around **the young person**, which is the unit the whole
module exists to serve.

This builds the youth-centred overview, makes it the front door, and adds the cross-navigation
that lets a leader move between it and the calendar.

### What is in scope

1. **`/youth` becomes the youth overview** — every young person's activity profile, searchable,
   ranked by need, each card expanding in place to that person's events with committing and
   follow-up done inline. Today's management screen moves to **`/youth/profiles`**.
2. **Sort buttons** on the overview and on the calendar, *beside* the existing filters, not
   replacing them.
3. **A second, pastoral ranking** — "nobody has been to one of Ethan's games all season" — which
   is a different question from "has a game coming up with nobody going".
4. **Committing from the calendar.** `/youth/calendar` reads `Going: Miguel Cortez` and stops;
   `AttendeeControls` is rendered on `/youth` only.
5. **Cross-navigation** — a calendar card links to its young person on the overview.
6. **The follow-up panel moves** onto the overview, and `/youth/feed` is demoted rather than
   deleted.

### What is deliberately NOT in scope

- **The event-detail view listing every youth at an event.** Blocked by **ITER-024** — an
  `activity_events` row belongs to exactly one profile, so "every youth tied to this event" has
  no answer. ITER-024 is DECIDED (Option A′: an explicit stored occasion link) but not built, and
  its own Sequencing section says the column must be planned **together with** the view that reads
  it. SPEC.md's `/youth/events/[id]/page.tsx` stays unbuilt for that reason.
- **ITER-025** (does being present earn the right to comment) and **ITER-027** (who else is in
  that gym) — both sequenced after ITER-024.
- **ITER-026** (a leader's own page). `FollowUpPanel` is half of it already and this plan moves
  that panel onto `/youth`. **When ITER-026 is built it must reuse `FollowUpPanel`, not
  re-derive the waiting list** — its scope file says so in as many words.

### Success criteria

- `/youth` opens on a list of young people, searchable, sorted by need, with a young person's
  events reachable in one tap and no page load.
- A leader can put themselves down for a game from the calendar, and the card updates without
  a reload.
- The two sorts answer two different questions, and a profile with **no signal** (no upcoming
  events; no home games played yet) sorts **last** under both rather than reading as urgent.
- No migration, no new route handler, no new dependency.
- `/youth/profiles` holds everything `/youth` holds today, unchanged in behaviour.

---

## Relevant Files

### Create

- `lib/youth/profileNeed.ts` — the two rankings as pure functions. Client-importable, types only.
- `app/(app)/youth/YouthOverview.tsx` — the new screen (client component).
- `app/(app)/youth/profiles/page.tsx` — today's `/youth`, moved.
- `tests/lib/youthProfileNeed.test.ts` — table-driven over both comparators and the no-signal cases.

### Modify

- `app/(app)/youth/page.tsx` — becomes the overview. Keeps its data fetching almost verbatim.
- `app/(app)/youth/EventList.tsx` — gains an optional `profileId` filter and a `heading` override.
- `app/(app)/youth/calendar/page.tsx` — stops building a bespoke merged projection; passes what
  `AttendeeControls` needs.
- `app/(app)/youth/calendar/ActivityCalendar.tsx` — reads the shared queries, gains a sort control,
  renders `AttendeeControls`, links each card's young person to the overview.
- `app/(app)/youth/feed/page.tsx` — one sentence describes a screen that will no longer exist.
- `app/(app)/youth/import/page.tsx`, `app/(app)/youth/import/IcsImportWizard.tsx` — two back-links
  that mean "the schedule", which is now `/youth/profiles`.
- `SPEC.md` — the component tree's `/youth/` block.

### Read but do not change

- `lib/youth/coverage.ts`, `lib/youth/followUp.ts` — the rankings compose these; neither moves.
- `lib/youth/activityOwnership.ts` — every gate this plan renders already exists here.
- `components/youth/AttendeeControls.tsx`, `components/youth/CoverageBadge.tsx`,
  `app/(app)/youth/FollowUpPanel.tsx`, `app/(app)/youth/FollowUpForm.tsx` — reused unchanged.
- `lib/auth/navigation.ts` — links `/youth` already. **No change, and adding one would be wrong.**

---

## Dependencies

**None.** No new library, no migration, no new route handler, no generated-type change.

Everything below is presentation over data `/youth` already fetches:
`listActivityProfiles`, `listActivityEvents` (both the narrow and widened views),
`listAttendeesForEvents`, `listOwnLogsForEvents`, `listWardUsers`, `readCrossOrgVisibility`.

The four client fetchers and their cache keys already exist in
`app/(app)/youth/youthQueries.ts` and are reused as they are.

---

## Known Pitfalls (from retro context)

These are not general advice. Each one is a defect this module has already shipped.

### 1. A Server Component prop never refetches — `youth-a-D2`

`ManualEventForm`'s activity list came from the server as a prop, so creating an activity left the
form beneath it saying "Add an activity first". That is why `youthQueries.ts` exists.

**Where it bites here:** `/youth/calendar` takes `events` as a **plain prop** and uses TanStack
nowhere. Adding `AttendeeControls` to it *without* moving it onto the shared queries gives a page
where "I'll go" succeeds, invalidates two keys the page does not read, and changes nothing on
screen. **This is the single most likely bug in this work.** Task 7 exists for it.

### 2. A control the policy refuses is still a bug — `visits-d`, `youth-a-D1`, `ITER-021`

Three sightings, the third inside the slice whose own plan quoted the lesson. What finally closed
it was a **pure function the screen must call**, not a rule re-derived at the call site.

**Where it bites here:** every gate is already written. Do not re-derive one.

| Control | Gate | Mirrors |
|---|---|---|
| "I'll go" / "I can't after all" | none beyond `youth_activities.view` | route writes the caller's own id |
| "Ask someone to go" | `canAssign` (bishopric), resolved on the server | absent, never present-and-refusing |
| "Say how it went" | `canLog && isFollowUpWritable() && canWriteFollowUpOn()` | migration 057c INSERT |
| "Change what you wrote" | `canLog && isFollowUpWritable() && canManageActivityLog()` | migration 058 UPDATE |
| Edit / Cancel an event | `canManage` **alone** | `activity_events` has ward-wide writes and no `org_id` |

**Which policy applies depends on which action is offered.** `EventList` already branches on
`ownLog === null` for exactly this and explains why at length — carry that code over untouched
rather than simplifying it.

### 3. A gate can make a count lie — `ITER-022`

Removing a control without revisiting the number beside it left "Waiting on your follow-up (2)"
above one usable control.

**Where it bites here:** the overview's sort and its per-card sentences must come from **one**
`ProfileNeed` per profile — the `summariseCoverage` / `summariseFollowUp` /
`describeHouseholdForVisits` rule, which this module states in three files already. A card that
sorts first because of a number it does not display is the same defect wearing a new hat.

### 4. Reuse, do not fork — `visits-c`, `youth-d`

`ReportFeed` renders both visits and youth because Phase 8 supplied a mapper and a fetcher and
changed **one string** into a prop. `app/api/visits/[id]/route.ts` has no diff at all, which is how
the extraction was shown to be safe rather than claimed to be.

**Where it bites here:** the expanded youth card is `EventList` filtered to one profile. Do **not**
write a second event card. `EventList` already carries five gates, three cache keys and the
invalidation rules; a copy of it will drift within one slice.

### 5. Absence of a signal is not a zero score — `visits-f`, `youth-c`

`visits-f` shipped a comparator whose inherited name tie-break sorted **never-visited below
recently-visited**. `youth-c` refuses to classify an unmatched location as `away`, because an
`away` event carries no coverage expectation and a wrong guess silently removes it from the model.

**Where it bites here, twice:**
- A profile with **no upcoming events** has no "nobody going" signal. It must sort **last**, not
  first, and not in the middle.
- A profile whose games have all been **away**, **cancelled**, or **`tbd`** has no *pastoral*
  signal either. Counting an away game with nobody at it as neglect manufactures alarm for the
  designed outcome. Counting a `tbd` blames a leader for a classification nobody made — and `tbd`
  is already loud on the calendar, via `needs_type`.

### 6. Copy defects are invisible to a green suite — `youth-b`, `youth-c`

`youth-b` shipped three (an all-day entry told it had no time zone; `1/2/2027` on the page about
unambiguous dates; "1 events updated"). `youth-c` shipped four more and introduced a fifth while
fixing them. Every one was reachable only by reading the real screen.

**Where it bites here:** this change **moves a page**, so several sentences elsewhere in the module
now describe a screen that no longer exists. Task 9 is a copy audit, not a link audit — reading
each sentence and deciding what it *means*, never a blanket find-and-replace.

### 7. A filter the route's schema does not carry is silently ignored — `roster-b`

Adding `?youth=` to a route that does not parse it produces a page that looks filtered and is not.
`ActivityCalendar`'s header states this and applies every filter client-side over the one fetched
list, so the list and the count beside it describe one screen.

**Where it bites here:** the overview's search and both sorts are **client-side over the loaded
list**. Do not add query parameters to `GET /api/youth/events`.

### 8. Two views must not share one cache entry — `visits-c`

A bookmark made under one filter was invisible under another until reload, because two views shared
an entry. `includePast` is part of the **key**, not an argument applied after the fetch.

**Where it bites here:** the overview computes need from the **widened** entry
(`[YOUTH_EVENTS_QUERY_KEY, true]`) — it needs past games for the pastoral ranking. `EventList`
inside an expanded card opens on the **narrow** entry. Both are seeded separately by the server, and
`EventList` already guards `initialData: includePast ? undefined : initialEvents`.

### 9. Seed the shared cache with the FULL list, filter for display

New, and a direct consequence of Task 3. `EventList`'s `initialEvents` prop **seeds a shared cache
entry** that `FollowUpPanel` and the overview also read. Passing a *pre-filtered* list as the seed
would poison that entry for every other reader on the page. The `profileId` prop filters what is
**rendered**; the seed stays whole.

### 10. A constant imported from a `"use client"` module reaches a Server Component as a function

`visits-d`'s "Log this visit" flow was completely dead because of this. `youthQueries.ts`
deliberately carries **no** `"use client"` directive so its keys stay importable between client
components, and `page.tsx` imports **components** from that directory, never a constant.

**Where it bites here:** `lib/youth/profileNeed.ts` must import **types only** — the standing
instruction `lib/youth/coverage.ts`, `lib/youth/followUp.ts`, `lib/visits/householdStatus.ts` and
`lib/goals/goalStatus.ts` all carry. One import of `lib/youth/queries.ts` pulls `next/headers` into
the browser bundle. `youth-c` recorded that **`npm run build` caught what lint, typecheck and 2982
tests missed** — run it.

### 11. `asOf` is a parameter, never a `new Date()` inside

Both existing pure modules state this. It is what makes the boundaries testable and what keeps
every row of one render judged against the same instant instead of a clock that moves down the list.

---

## Tasks

### Task 1: The two rankings, as pure functions

**File:** `lib/youth/profileNeed.ts` (create)

**Action:** One profile's standing, computed from its events. Pure, client-importable, no clock
inside.

**Imports — types and `lib/youth/coverage.ts` ONLY.** No `lib/youth/queries.ts`, no
`next/headers`, no Supabase. See Pitfall 10.

```ts
import { eventCoverage, type EventCoverageInput } from "@/lib/youth/coverage";
import { coverageRank, type CoverageState } from "@/types/domain";

export type ProfileNeedEvent = EventCoverageInput;   // { eventType, eventDate, status, attendeeCount }

export type ProfileNeed = {
  upcomingCount: number;
  // The worst coverage state among UPCOMING events. Null when there are none — which is
  // "no signal", NOT "fine". The comparator sorts it last; see Pitfall 5.
  worstUpcoming: CoverageState | null;
  // The date of the SOONEST upcoming event holding that worst state, for the tie-break and for
  // the card's sentence. Null with worstUpcoming.
  soonestNeedOn: string | null;

  // The pastoral half. "Expected" means a HOME event, in the past, not cancelled — see below.
  expectedPastCount: number;
  // The most recent expected past event that somebody actually went to. Null means nobody ever
  // has, which is the STRONGEST signal, not a missing one.
  lastAttendedOn: string | null;
  // How many expected past events in a row, counting back from the most recent, had nobody at
  // all. Zero when the most recent one was attended.
  unattendedRun: number;
};

export function profileNeed(
  events: readonly ProfileNeedEvent[],
  asOf: Date,
): ProfileNeed;
```

**Which past events carry a coverage expectation — the rule, and it is the one thing to get right
here:**

An event counts toward `expectedPastCount`, `lastAttendedOn` and `unattendedRun` only when all
three hold:

- it is in the past (`new Date(eventDate) <= asOf`),
- `status !== "cancelled"`,
- `eventType === "home"`.

**`away` and `tbd` are both excluded, for different reasons, and both must be commented.**
An away game with nobody at it is the *designed* outcome (`08-youth-activities.md` §Step 4 — which
is why `eventCoverage` returns `awareness` rather than `uncovered`), so counting it as neglect
manufactures alarm. A `tbd` event is one nobody has classified; blaming a leader for a
classification nobody made is the mirror of `youth-c`'s "an unmatched location is `tbd`, never
`away`" — and `tbd` is already loud where it belongs, as `needs_type` on the calendar.

An unreadable `eventDate` is excluded from both halves, as `eventCoverage` and `isFollowUpWritable`
both do.

**`worstUpcoming` uses `eventCoverage()`**, not a second definition of coverage. Reduce with
`coverageRank()` — lower is worse — exactly as `ActivityCalendar` reduces a day cell. Do not write
a second ordering that could disagree with `COVERAGE_STATES`.

**Also export the sentence, next to the computation** — the `summariseCoverage` /
`summariseFollowUp` rule (Pitfall 3): the words on a card and the number it sorts on must be two
renderings of one value.

```ts
// Null means NOTHING TO SAY, and the card renders nothing rather than "0 games".
// A profile with no expected past events has not been neglected; nothing has been played.
export function describeSeasonNeed(need: ProfileNeed): string | null;
```

Wording, following `talks-c`'s last-prayed nudge (render nothing rather than "Never") and
`ActivityCalendar`'s named-not-counted banner:

- `expectedPastCount === 0` → `null`
- `unattendedRun === 0` → `null` (somebody went to the most recent one; there is no story here)
- `lastAttendedOn === null` → `"Nobody has been to any of the N home games played so far."`
- otherwise → `"Nobody has been to the last N home games."`

Singular and plural both spelled out. `youth-b` shipped "1 events updated".

### Task 2: The comparators

**File:** `lib/youth/profileNeed.ts` (same file, below Task 1)

```ts
export const PROFILE_SORTS = ["needs_attention", "nobody_all_season", "name"] as const;
export type ProfileSort = (typeof PROFILE_SORTS)[number];

export const PROFILE_SORT_LABELS: Record<ProfileSort, string> = {
  needs_attention: "Nobody going yet",
  nobody_all_season: "Nobody has been in a while",
  name: "Name",
};

export type SortableProfile = { label: string; need: ProfileNeed };

export function compareProfiles(
  sort: ProfileSort,
  left: SortableProfile,
  right: SortableProfile,
): number;
```

**`needs_attention`** (the default):
1. A profile with `worstUpcoming === null` sorts **after** every profile that has one. No signal is
   not a good score (Pitfall 5).
2. `coverageRank(worstUpcoming)` ascending — `uncovered` first.
3. `soonestNeedOn` ascending — least time to fix it first.
4. `label` ascending.

**`nobody_all_season`**:
1. A profile with `expectedPastCount === 0` sorts **after** every profile that has played.
2. `unattendedRun` **descending**.
3. `lastAttendedOn` ascending, **with `null` sorting FIRST** — never attended is the strongest
   signal, not a missing one. This inversion is the `visits-f` comparator trap arriving in the
   opposite direction; write the comment and write the test.
4. `label` ascending.

**`name`**: `label` ascending, using `localeCompare`.

**The tie-break is `label` in all three and it is never the first key.** That is exactly what
`visits-f` got wrong.

### Task 3: Let `EventList` render one profile's events

**File:** `app/(app)/youth/EventList.tsx` (modify)

**Action:** Two optional props. Nothing else changes — no extraction, no restructure.

```ts
  // When set, only this profile's events are RENDERED. The three cache entries this component
  // seeds and reads stay WHOLE: `initialEvents` is a seed shared with FollowUpPanel and the
  // overview, and seeding it pre-filtered would poison that entry for every other reader on the
  // page (Pitfall 9). Filter on the way OUT, never on the way in.
  profileId?: string;
  // "Schedule" on /youth/profiles; the young person's name inside an expanded overview card.
  heading?: string;
```

Apply as one filter where the list is built:

```ts
const events = (eventsQuery.data ?? []).filter(
  (event) => profileId === undefined || event.profileId === profileId,
);
```

`eventCount()` already reads `events.length`, so the heading's count follows automatically — which
is the property to preserve, not a convenience (Pitfall 3).

The heading becomes `` `${heading ?? "Schedule"} (${eventCount(events.length, includePast)})` ``.

**The empty-state sentences must change with the filter.** "No events have been entered for any
activity yet" is false inside a card for one young person who has none. Two more strings, chosen on
`profileId === undefined`:

- filtered, upcoming: `"Nothing coming up for this activity. Show past events, or add one from the activities page."`
- filtered, widened: `"No events have been entered for this activity yet."`

Getting this wrong is precisely `youth-c`'s "a label can be correct in one place and nonsense in
another, and no type can tell the difference".

**Do not touch anything else in this file.** Every gate, every invalidation constant and every
comment stays exactly as it is.

### Task 4: The overview screen

**File:** `app/(app)/youth/YouthOverview.tsx` (create) — `"use client"`

**Action:** The searchable, sortable, expand-in-place list of young people.

**Props** (all resolved once on the server; a client component never re-derives a session value or
a permission — `AttendeeControls`' header states the rule):

```ts
export type YouthOverviewProps = {
  // Seeds [YOUTH_PROFILES_QUERY_KEY].
  initialProfiles: ActivityProfile[];
  // Seed the WIDENED entries, [.., true] — the pastoral ranking needs past games.
  initialAllEvents: ActivityEvent[];
  initialAllAttendees: Record<string, ActivityAttendee[]>;
  // Handed straight through to EventList, which seeds the NARROW entries, [.., false].
  initialUpcomingEvents: ActivityEvent[];
  initialUpcomingAttendees: Record<string, ActivityAttendee[]>;
  initialFollowUps: Record<string, ActivityLog>;
  // From ?youth= on the URL, resolved on the server. Null when absent or unknown.
  initialExpandedProfileId: string | null;
  asOf: string;
  currentUserId: string;
  currentUserRole: SessionUser["role"];
  currentUserOrgId: string | null;
  canManage: boolean;
  canLog: boolean;
  canAssign: boolean;
  assignableUsers: { id: string; label: string }[];
  crossOrgVisibility: boolean;
};
```

**Reads** — the shared entries, seeded, never a standing prop (Pitfall 1):

```ts
useQuery({ queryKey: [YOUTH_PROFILES_QUERY_KEY],       queryFn: fetchProfiles,          initialData: initialProfiles });
useQuery({ queryKey: [YOUTH_EVENTS_QUERY_KEY, true],   queryFn: () => fetchEvents(true), initialData: initialAllEvents });
useQuery({ queryKey: [YOUTH_ATTENDEES_QUERY_KEY, true],queryFn: () => fetchAttendees(true), initialData: initialAllAttendees });
```

`asOfInstant` is parsed **once**, outside the row loop (Pitfall 11) — `FollowUpPanel` and
`EventList` both carry that comment.

**One pass, then two renderings.** Build `ProfileNeed` per profile once; the sort, the badges and
the sentences all read from that single array (Pitfall 3).

**Layout, top to bottom:**

1. `<FollowUpPanel …>` — **unchanged**, moved here from `/youth`. It stays at the top for the
   reason its own comment gives: it is the one thing on the page waiting on the reader personally.
2. A search `Input` over the profile label (`memberName` + `activityName`), matched case- and
   whitespace-insensitively. Client-side over the loaded list (Pitfall 7).
3. A **sort control**. Follow `VisitProgressTable`'s precedent — a labelled `<select>` over
   `PROFILE_SORTS`, which is the shape that survives 375px. `useState<ProfileSort>("needs_attention")`.
4. The list of profile cards.

**Each card, collapsed:** the young person's name and activity; a `CoverageBadge` for
`worstUpcoming` (which renders nothing for `not_expected`, so a profile with only cancelled games
is quiet); `describeSeasonNeed()`'s sentence when it is non-null; the upcoming count.

The card is a `<button>` that toggles expansion — `min-h-11`, the tap-target size `visits-e` was
pulled up on. Use `aria-expanded` and `aria-controls`.

**Each card, expanded:** `<EventList profileId={profile.id} heading={profile.memberName} …>`
with **all** its existing props, and the **unfiltered** upcoming seeds (Pitfall 9).

**One card open at a time** (`useState<string | null>`), which is the module's existing idiom —
`FollowUpPanel`'s `openEventId` and `EventList`'s `followingUp`. It also keeps exactly one
`EventList` mounted, so there is one seeder of the narrow cache entries rather than N.

**Empty states, as sentences.** `youth-c` found that an empty state rendering nothing reads as
something that failed to load. Distinguish "no activities have been entered for this ward yet"
(with a link to `/youth/profiles` when `canManage`) from "nothing matches that search".

### Task 5: `/youth` becomes the overview

**File:** `app/(app)/youth/page.tsx` (modify)

**Action:** Keep the data fetching almost verbatim; swap what it renders.

The queries stay as they are — `listActivityProfiles`, both `listActivityEvents` views, both
attendee maps, `listOwnLogsForEvents`, `listWardUsers`, `readCrossOrgVisibility`. **This screen
needs no query the page does not already run.** Drop only `readHomeVenues` and
`listWardOrganizations`, which move with the panels that used them.

Add `searchParams`, typed explicitly — it is a Promise in Next 16, and the generated `PageProps`
helper only exists after a build (`foundation-a-scaffold`). `app/(app)/roster/page.tsx` is the
pattern to copy:

```ts
export type YouthPageProps = { searchParams: Promise<{ youth?: string }> };
```

Resolve `?youth=` against the fetched profiles on the **server** and pass
`initialExpandedProfileId`. Doing it here rather than with `useSearchParams()` avoids the Suspense
boundary that hook requires, and an id that matches no profile resolves to `null` rather than to a
card that never opens.

Keep the `can(...)` / `NotPermitted` guard exactly as it is — `can()` rather than `assertCan()`,
because a `ForbiddenError` escaping a Server Component becomes a 500 whose message Next.js strips
in production.

Header links: **Ward activity calendar**, **Activities and schedule** (`/youth/profiles`), and
**Follow-up feed** — the feed demoted to last, which is what "it stops being the thing linked
first" means.

### Task 6: The management screen moves

**File:** `app/(app)/youth/profiles/page.tsx` (create)

**Action:** Today's `/youth`, moved with **no behaviour change**: `ActivityProfileList`,
`HomeVenuePanel` (bishopric only), `EventList` (unfiltered, heading "Schedule"), the
`ManualEventForm` / not-permitted branch, and the "Import a schedule" link.

**`/youth/profiles` rather than `/youth/activities`, because SPEC.md already says so.** Its
component tree carries `/youth/page.tsx — Youth activity dashboard` and
`/youth/profiles/page.tsx — Activity profiles`; `youth-a` collapsed both onto `/youth` and this
scope is the module arriving at the shape the spec described. CLAUDE.md §1: the specs win. There is
no collision with `/api/youth/profiles` — different route trees.

The page **heading** is "Activities and schedule", not "Profiles" — a leader does not read URLs and
"profile" is our word, not theirs.

`FollowUpPanel` does **not** come to this page. It lives on the overview now, and two copies would
be two computations of one question (Pitfall 3).

Carry the file's existing comments across, including the `app/(youth)/` disambiguation block and
the "this page does not import `lib/youth/privateNotes.ts`, and must not" rule — that one is live,
not a note about the future.

### Task 7: The calendar reads the shared queries

**File:** `app/(app)/youth/calendar/ActivityCalendar.tsx` (modify)
**File:** `app/(app)/youth/calendar/page.tsx` (modify)

**Action:** This is the task Pitfall 1 is about. Do it before Task 8, not alongside it.

Today the page builds a bespoke merged `CalendarEvent[]` on the server and hands it down as a
plain prop. `AttendeeControls` invalidates `YOUTH_ATTENDEES_QUERY_KEY` and `YOUTH_EVENTS_QUERY_KEY`
— **which this page does not read** — so a control added to it would succeed and change nothing on
screen.

So `ActivityCalendar` composes its rows the way `EventList` does, from three shared queries seeded
by the server:

```ts
useQuery({ queryKey: [YOUTH_PROFILES_QUERY_KEY],        queryFn: fetchProfiles,            initialData: initialProfiles });
useQuery({ queryKey: [YOUTH_EVENTS_QUERY_KEY, false],   queryFn: () => fetchEvents(false),  initialData: initialEvents });
useQuery({ queryKey: [YOUTH_ATTENDEES_QUERY_KEY, false],queryFn: () => fetchAttendees(false), initialData: initialAttendees });
```

`CalendarEvent` stops being an exported server-built type and becomes an internal derived row —
`ActivityEvent` joined to its profile and its attendees in a `useMemo`, exactly as `EventList` does
it. `page.tsx` loses the `.map()` that built it, and the `youthOptions` label
(`` `${memberName} — ${activityName}` ``) moves into the component with the profiles.

**The page still fetches on the server** so first paint is right, and it now also fetches
`listWardUsers` for `assignableUsers` when the reader is bishopric — mapped down to `{ id, label }`
there, so the email and role never cross to the client. Copy that block from `/youth`.

**Two comments in these files now describe the opposite of the code and must be rewritten, not
deleted** (the `youth-d` rule: `lib/reports/types.ts` was amended in the same change rather than
left contradicting):

- `page.tsx`: *"ONLY THE NAMES cross to the client… this page shows no attendance controls, so it
  needs nothing to address a request with."*
- `ActivityCalendar.EventCard`: *"WHO IS GOING, WITHOUT THE CONTROLS… Showing a control here would
  mean a second copy of two permission gates, which is exactly how youth-a-D1 happened."*

The replacement records what actually resolved the concern: the controls are here now, and there is
**no second copy of any gate** — `AttendeeControls` is the one component, `canAssign` is resolved
once on the server, and the route writes the caller's own id and can write no other.

**Do not touch the zone-trap comment or `dayKey()`.** Bucketing is the reader's zone, in the
client, and that stays true.

### Task 8: Committing, sorting and linking from the calendar

**File:** `app/(app)/youth/calendar/ActivityCalendar.tsx` (modify, after Task 7)

**Three additions:**

**a. `AttendeeControls` on every card**, reused unchanged, replacing the read-only `Going:` line —
the component renders that line itself. Its gate is `youth_activities.view`, which everybody
reading this page holds.

**b. A sort control beside the four filters**, two options only:

- `"Soonest first"` (default) — the order the list already has.
- `"Needs attention first"` — `coverageRank()` ascending, then date.

**The month grids do not reorder, and say so in a comment.** A month has one order; only the card
list beneath it responds to the sort. The grids are keyed by date and built from the same `rows`,
so they are unaffected by construction — the comment is there to stop a later reader "fixing" it.

**c. Each card links its young person to the overview** — `/youth?youth=${event.profileId}` — which
is the cross-navigation half of the scope. Skip the link when `profileId` is null or the profile is
not in the list; the card already renders "An activity that is no longer listed" there, and a link
to a card that will not open is worse than none.

### Task 9: The copy and link audit

**Action:** A page moved, so several sentences elsewhere now describe a screen that does not exist.
**Read each one and decide what it means** — never a blanket find-and-replace (Pitfall 6).

| File | Line | What it says now | What to do |
|---|---|---|---|
| `app/(app)/youth/feed/page.tsx` | ~97 | *"open and change your own follow-ups from the **schedule** on the youth activities page"* | The href `/youth` is still right; **the words are not**. Follow-ups now open from a young person's card on the overview, and from the panel at the top of it. Rewrite the sentence. |
| `app/(app)/youth/feed/page.tsx` | ~50 | "Youth activities" → `/youth` | Correct as-is. Leave it. |
| `app/(app)/youth/calendar/page.tsx` | ~111 | "Back to youth activities" → `/youth` | Still the front door. Leave the href; check the words read right beside the new page. |
| `app/(app)/youth/import/page.tsx` | ~46 | back-link → `/youth` | Means "where the schedule is" → `/youth/profiles`. |
| `app/(app)/youth/import/IcsImportWizard.tsx` | ~242 | after-import link → `/youth` | Means "go and look at what you just imported" → `/youth/profiles`. |
| `lib/auth/navigation.ts` | 36 | `/youth` | **No change.** The front door did not move. |

Also re-read `/youth`'s own header paragraph. *"The teams, choirs and clubs the ward's young people
belong to, and what is coming up"* describes the page that is now `/youth/profiles`.

**File:** `SPEC.md` — update the `/youth/` component-tree block to match what now exists, and leave
`/events/[id]/page.tsx` listed as the unbuilt piece with a note naming ITER-024 as the blocker.

---

## Testing Strategy

### `tests/lib/youthProfileNeed.test.ts` (create) — the priority test

Table-driven, one fixed `asOf`, following `tests/lib/youthCoverage.test.ts` and
`tests/lib/visitCadence.test.ts`.

**`profileNeed()`:**
- `worstUpcoming` is the worst state present, not the first or the soonest.
- `soonestNeedOn` is the soonest event **holding that state**, not the soonest event overall.
- No upcoming events → `worstUpcoming: null`, `soonestNeedOn: null`, `upcomingCount: 0`.
- **An away past event with nobody at it does not count** toward `expectedPastCount`,
  `unattendedRun` or `lastAttendedOn`.
- **A `tbd` past event does not count.** Same assertion, different reason — assert both separately
  so deleting one exclusion does not leave a green suite.
- **A cancelled past event does not count**, at any distance from the clock.
- An unreadable `eventDate` is excluded from both halves.
- `unattendedRun` counts back from the most recent and **stops** at the first attended one — a
  profile attended last week but neglected all autumn has a run of 0.
- `lastAttendedOn: null` with `expectedPastCount > 0` — nobody, ever.

**`compareProfiles()`** — assert each key **independently**, so a later "tidy-up" of the comparator
goes red rather than quiet:
- `needs_attention`: a profile with no upcoming events sorts **after** one with `covered`
  upcoming. *(This is the `visits-f` trap; it is the single most valuable assertion in the file.)*
- `needs_attention`: equal worst state → soonest date first; equal date → name.
- `nobody_all_season`: `expectedPastCount === 0` sorts **after** a profile with `unattendedRun: 0`.
- `nobody_all_season`: **`lastAttendedOn: null` sorts BEFORE any date** at equal run — the
  inversion. Assert it explicitly.
- `name`: sorts by label and by nothing else — give the two profiles opposite need rankings and
  prove the need is ignored.

**`describeSeasonNeed()`:**
- `null` for `expectedPastCount === 0` and for `unattendedRun === 0` — two separate cases.
- Singular and plural for both non-null branches (four assertions). `youth-b` shipped
  "1 events updated".

### `tests/components/youth/` (optional, if the composition is worth pinning)

`tests/components/youth/CoverageBadge.test.tsx` is the precedent, and its lesson is that a
composition test must cover **every** combination rather than the three worth spelling out — that
is the only version that would have caught the bug `youth-c` actually wrote.

If one is written here, pin the pairing that Pitfall 3 is about: **the sentence a card displays and
the value it sorted on are the same `ProfileNeed`.**

### Not needed, and why

- **No route tests.** No route handler changes. `GET /api/youth/events`, `/attendees`, `/logs`,
  `/profiles` are all called exactly as they are today, with parameters they already parse.
- **No RLS tests.** No policy changes and no migration. `tests/rls/youth-activity-scope.test.ts`,
  `activity-attendees.test.ts` and `activity-logs.test.ts` already cover every table this touches.
- **No new permission tests.** Every gate rendered here already exists in
  `lib/youth/activityOwnership.ts` and is covered by `tests/lib/activityOwnership.test.ts`,
  including the deliberate-inversion test between `canWriteFollowUpOn` and
  `canManageActivityProfile`.

---

## Test Scenarios (Harness)

Two new scenarios. Both need seeding because both depend on **a season of history** — a state that
takes twenty minutes of clicking to build by hand and is wrong the moment the clock moves.

Note that scenarios **049–056 have not been walked yet** and M5 waits on them. These two are
additive; they do not replace that debt.

### Scenario 057: The young person nobody has been to see

**Tags:** `youth`, `full`, `overview`, `sorting`
**Purpose:** The two sorts answer two different questions, and the seed is built so that **the
young person at the top under one sort is not at the top under the other**. That is the whole
claim, and it cannot be made with a fixture where one profile is worst at everything. It also
proves the no-signal cases sort last rather than reading as urgent — the `visits-f` trap, which no
unit test can show a person.

**Seed data summary:**
- `youth_activity_profiles` — 5, across at least two organizations, one with `org_id` null
  (ward-wide).
- `activity_events` — ~24, arranged as:
  - **Ethan** — a full autumn of past *home* games, **none attended**, plus one upcoming game
    inside the notice window that somebody *is* going to. Top under "Nobody has been in a while",
    mid-table under "Nobody going yet".
  - **Maya** — past home games attended throughout, plus an upcoming home game inside the notice
    window with **nobody down**. Top under "Nobody going yet", bottom under the pastoral sort.
  - **Josh** — past games all `away` with nobody at them. Must read as **no signal** and sort
    **last** under the pastoral sort, not first.
  - **Sofia** — one past `tbd` game and one cancelled one, nothing else. No signal under either
    sort.
  - **Liam** — no events at all. Sorts last under both.
- `activity_attendees` — enough rows to make Maya's history attended and Ethan's empty.
- `activity_logs` — one, so the follow-up panel at the top of the page is not empty.

**Tester action:** Open `/youth`. Read the default order. Switch to "Nobody has been in a while".
Search for a name. Expand a card, put yourself down for a game, write a follow-up on a past one.

**Verification checklist:**
- [ ] The default sort puts Maya first and the sentence on her card says why.
- [ ] "Nobody has been in a while" puts Ethan first, and his card's sentence names a number of
      games that matches the seeded history.
- [ ] Josh sorts **last**, not first, under the pastoral sort — his away games are not neglect.
- [ ] Sofia's cancelled and `tbd` games produce no pastoral sentence at all.
- [ ] Liam's card renders without an error and sorts last under both.
- [ ] Search narrows the list; clearing it restores every card.
- [ ] Expanding a card shows that young person's events **and nobody else's**.
- [ ] "I'll go" inside an expanded card updates the badge on the card **without a reload**.
- [ ] Writing a follow-up removes the row from "Waiting on your follow-up" and the heading's count
      drops by one **in the same interaction**.
- [ ] Readable at 375px, in both light and dark mode.

### Scenario 058: Signing up from the calendar

**Tags:** `youth`, `smoke`, `calendar`, `attendance`
**Purpose:** `/youth/calendar` moves from static server props onto the shared query cache in this
change, which is precisely where `youth-a-D2` lives — the mutation succeeds, invalidates a key the
page does not read, and nothing on screen moves. A green suite cannot see that. Seeding gives a
calendar with several months and a known uncovered event to act on.

**Seed data summary:**
- `youth_activity_profiles` — 3, across two organizations.
- `activity_events` — ~14 spanning three months, including one home event **inside** the seven-day
  notice window with nobody down, one `away`, one `tbd`, and one cancelled.
- `activity_attendees` — 2, on events other than the uncovered one.

**Tester action:** Open `/youth/calendar` as a non-bishopric org leader. Find the uncovered event
named in the banner. Press "I'll go". Then switch the sort, use a filter, and follow the young
person's link.

**Verification checklist:**
- [ ] The card's coverage badge changes from "Nobody going" to "Covered · 1" **immediately**, with
      no reload.
- [ ] The banner at the top of the page loses that event in the same interaction, and disappears
      entirely if it was the only one.
- [ ] The uncovered **edge stripe** on the card clears with the badge.
- [ ] "I can't after all" reverses all three.
- [ ] "Ask someone to go" is **absent** for a non-bishopric reader, not present-and-refusing.
- [ ] "Needs attention first" reorders the card list and **leaves the month grids in date order**.
- [ ] The filters still work, and the count line matches the number of cards shown.
- [ ] The young person's link opens `/youth` with that card already expanded.
- [ ] An away game and a cancelled game are still visible and still marked.
- [ ] Readable at 375px, in both light and dark mode.

---

## Validation Commands

Run in this order.

```bash
# Linting
npm run lint

# Type checking
npm run typecheck

# Tests
npm run test

# Production build — NOT optional
npm run build
```

**`npm run build` is not a formality in this module.** `youth-c` recorded that it *"caught what
lint, typecheck and 2982 tests missed"* — a constant in a server-only module pulling `next/headers`
into the browser bundle. This change adds one new client-importable pure module and moves two
client components onto new pages, which is the same hazard twice. `youth-b` also measured a client
component reaching a server-only module costing **~505KB of bundle** while breaking nothing at all,
so watch the reported route sizes as well as the exit code.

Also regenerate the harness manifest after adding the scenarios:

```bash
npm run manifest
```

---

## Integration Notes

### How this connects

- **No migration, no route handler, no generated type change, no dependency.** Everything is
  presentation over data that already exists — `youth_activity_profiles.member_id → members`,
  `activity_events.profile_id → profile`, `activity_attendees.event_id → event`,
  `activity_logs.event_id → event`.
- `lib/youth/profileNeed.ts` composes `eventCoverage()` and `coverageRank()`. It does **not**
  define coverage a second time.
- **`lib/visits/cadence.ts` and `householdVisitPriority()` are deliberately NOT imported**, and
  this is worth stating because `plans/INDEX.md` suggests Phase 8 should reuse them. They express
  *"visit every household once every X"*, and a youth activity has **no cadence goal** — nothing in
  Phase 8 asks a leader how often somebody should be seen. Importing them would mean inventing a
  cadence to satisfy a reuse note. The reuse that *is* real here is `eventCoverage`, `coverageRank`
  and `COVERAGE_STATES`, and those are used.

### Breaking changes

**One URL moves.** `/youth`'s current contents become `/youth/profiles`. Nothing outside this repo
links to it — the module has not been walked by a ward yet — and Task 9 audits every internal
reference. `lib/auth/navigation.ts` is unaffected because the front door itself did not move.

### Documentation to update

- **SPEC.md** — the `/youth/` component tree (Task 9). It already described this shape; the change
  makes it true, and the entry for `/events/[id]/page.tsx` should name ITER-024 as its blocker.
- **`plans/retros/`** — a retro entry after the commit, per the project's standing practice, with
  a line added to `plans/retros/INDEX.md`.
- **CLAUDE.md §9** — worth an entry if the walk reverses a decision, as `visits-f` and
  `program-c` both did. Two candidates are already visible: the calendar's *"showing a control here
  would mean a second copy of two permission gates"* comment is being reversed with a reason, and
  SPEC.md's `/youth/profiles` split is being honoured after `youth-a` collapsed it.
- **`.iterate/BACKLOG.md`** and **`.iterate/scopes/ITER-020.md`** — Step 5 below.

### What this leaves open, deliberately

- **ITER-024 → ITER-027 → ITER-025** remain a single later body of work: the occasion link column,
  the event-detail view that reads it, and then the question of who may write a follow-up. Planning
  them together is what ITER-024's Sequencing section asks for.
- **ITER-026** (a leader's own page) is untouched, and `FollowUpPanel` — now on `/youth` — is the
  component it must reuse rather than re-derive.
- **The six clock-driven notifications** are unchanged and still Phase 11's single decision. This
  plan adds **no seventh**: both rankings are computed on read, by whoever is looking at the screen,
  which is the rule that produced `coverage.ts`, `followUp.ts`, `appointmentViewState()` and
  `householdVisitPriority()`.
