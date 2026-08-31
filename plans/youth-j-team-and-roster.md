# Plan: youth-j — A Team Has One Schedule and a Roster

**Created:** 2026-08-31
**Type:** feature (architecture)
**Scope refs:** ITER-033 (supersedes part of ITER-030)
**Phase:** 8, slice **`youth-j`** — the tenth
**Migrations:** 062 (applies immediately) + 063 (**held back until deploy**)

---

## Overview

There is no **team** in this app. There is only *one young person's copy of a team*.
`activity_events.profile_id` is a single foreign key, `activity_calendars.profile_id` is
`NOT NULL` (055c), and `POST /api/youth/calendars/import` takes a `profileId` — so eight players
on a twelve-game season is **eight profiles, eight imports of the same file and 96 rows for 12
real games**, with `activity_occasions` re-linking the duplicates one game at a time by hand.

This slice makes the shape the user asked for:

> Activity (Varsity Basketball) → **one** imported schedule → a **roster** of young people →
> the app derives youth × event.

**Import once. Assign each youth once. Everything after that is an exception.**

### Success criteria

1. One ICS file imported once against one activity serves every young person on its roster.
2. A young person is added to an existing activity in one action, from either `/youth` or
   `/youth/profiles`.
3. A young person can **leave mid-season** (and **join mid-season**), and their support
   percentage counts only the games inside their own window.
4. `youth_attended` moves off the event onto a **(youth, event)** row, so marking one player
   absent does not touch anybody else at the same game.
5. The absence control **reads as an exception** — absent until invoked, never a standing
   unanswered Yes/No on every card. This is the defect that surfaced ITER-033.
6. `ActivityCalendar` honours a closed season: a closed team's future games stop raising
   "Nobody going".
7. A team with **nobody on its roster yet** stays **loud**, not silently uncounted.
8. No RLS policy moves. No screen moves on the day 062 applies.

### The four decisions taken with the user before planning (2026-08-31)

| Question | Answer |
|---|---|
| The uncommitted `youth-i` work | **Commit it as-is first.** 061 is already applied, the walk record and its 27 proved checks have value, and 27 uncommitted files under this refactor is a merge hazard. This slice then supersedes it honestly, in a new migration. |
| Migration path | **Every existing profile becomes a team with a roster of exactly one, automatically.** Lossless, no screen moves, no human decision. **No merge path in this slice** — collapsing duplicates would destroy one profile's events, sign-ups and follow-ups, which is exactly what `youth-h` narrowed `Remove` to prevent and what `visits-f` refused for empty bulk replace. |
| `activity_occasions` | **Kept, untouched.** It still answers the one thing a roster cannot: a Young Men basketball game and a Young Women concert on the same evening. What changes is that "+N others at this game" reads the **roster** first and the occasion second — one list, two sources, both named. |
| Leaving mid-season | **Nullable `started_on` AND `ended_on` on the roster row**, both dates a person picks, both absent by default. Symmetric — a youth joining in January is the mirror of one leaving in February, and the denominator needs both. |

### The three questions the scope left open, answered here from the codebase

- **Q2 — does a team need an organization, or per-roster-member?** `org_id` stays on the
  **team** (today's profile), **completely unchanged**. A mixed school squad is expressed by
  `org_id = null`, which already means ward-wide and already lets everybody write (054d's
  explicit branch). Per-roster-member scoping would be a second scoping rule for a question
  already answered once, which is the thing 054d, 055c and 056c each refuse by name.
- **Q6 — what does "assign a youth to an activity" look like?** **Both directions, one route.**
  Youth-first is what the user asked for and is the primary path (an expanded card on `/youth`);
  team-first is where the schedule lives and is needed anyway to *see* a roster
  (`/youth/profiles`). Both POST to `/api/youth/profiles/[id]/roster`.
- **Q7 — JV vs Varsity from an imported calendar.** **Out of scope**, as the scope file's own
  text recommends. It is a parsing question and the standing answer in this module is that a
  person confirms (`classifyLocation.ts`).

---

## The model, precisely

### Today

```
youth_activity_profiles (member_id, activity_name, activity_type, org_id, closed_at, …)
        │  1
        ├── activity_calendars (profile_id NOT NULL)
        └── activity_events (profile_id, youth_attended, occasion_id, …)
                              └── activity_attendees (LEADERS who are going)
                              └── activity_logs → activity_private_notes
```

### After

```
youth_activity_profiles          ← now a TEAM/ACTIVITY. member_id is GONE.
        │  1
        ├── activity_roster (profile_id, member_id, started_on, ended_on)   ← NEW
        ├── activity_calendars (profile_id NOT NULL)                        unchanged
        └── activity_events (profile_id, occasion_id, …)   youth_attended GONE
                              ├── activity_event_participation
                              │       (event_id, member_id, taking_part)    ← NEW
                              ├── activity_attendees (LEADERS)              unchanged
                              └── activity_logs → activity_private_notes    unchanged
```

**`youth_activity_profiles` is NOT renamed.** 191 references across 34 source files; a rename is
churn with no gain and would bury the real change in a diff nobody can read. Its *meaning*
changes and every header comment on it says so.

### Three states, still — but now expressed by row presence

`activity_event_participation.taking_part` is **`boolean NOT NULL`**, and the third state is the
**absence of the row**:

| State | Storage | Meaning |
|---|---|---|
| `null` | **no row** | Nobody has said. The ordinary state of nearly every (youth, event) pair. |
| `true` | row, `taking_part = true` | Somebody confirmed they are taking part. |
| `false` | row, `taking_part = false` | Somebody said they are not taking part. |

This is `youth-i`'s three-state rule kept **exactly**, and it is strictly better storage for it:
the sparse-exception shape is **structural**, which is what makes success criterion 5 achievable
rather than a discipline. A nullable column on a dense join would put an unanswered question on
every pair in the ward.

**Clearing back to "nobody has said" DELETES the row**, and that is not a violation of `060a`'s
"never a delete". That rule protects a *record somebody wrote*; this row carries no account, no
text and no author's words — it is a marker, and removing it is precisely "nobody has said".
`activity_logs` and `activity_private_notes` are untouched by any of it.

**`true` is still not a no-op.** It behaves like no-row in today's arithmetic and it keeps
"confirmed present" distinguishable from "assumed present", which is what gives the control a way
back that is not the opposite claim.

### One window function, three inputs, one answer

The single most important design decision in this slice.

```
memberIsExpectedAt(membership, profileClosedAt, eventDate)
  = eventDate >= (startedOn  ?? -∞)
  ∧ eventDate <= (endedOn    ?? +∞)
  ∧ eventDate <= (closedAt   ?? +∞)
```

**"The youth left the team", "the youth joined late" and "the season was closed out" become ONE
rule at one scale.** That is what fixes the `ActivityCalendar` leak *by construction* rather than
by remembering to add a `closedAt` check to a fourth screen — the leak ITER-033 records
(verified: `ActivityCalendar.tsx` and `calendar/page.tsx` contain **no** reference to `closedAt`
at all).

`carriesCoverageExpectation()` **is not modified**. Its four exclusions stay exactly as
`youth-i` left them; only the *source* of its `youthAttended` field changes, from a column on the
event to a participation row for this (youth, event). That is ITER-033's "what survives from
`youth-i` unchanged", honoured literally.

### An empty roster stays LOUD; a closed season goes QUIET

Both produce "zero young people expected at this game", and **they must not be answered the same
way**. Getting this wrong is `youth-c`'s `away`-guess trap in a new place: a game that silently
leaves the coverage model is a game nobody is asked to attend, with no badge anywhere saying so.
The user's own flow — *import once, then assign* — means the empty-roster window is a **normal**
state that every ward passes through.

`eventYouthAttendance()` returns a discriminated result and the two cases are separate branches
with separate reasons:

```ts
type EventYouthAttendance =
  | { kind: "expected";       expected: RosterMember[]; absent: RosterMember[] }
  | { kind: "no_expectation"; reason: "season_closed" | "all_absent"; absent: RosterMember[] };
```

- **zero memberships in window, `closedAt` is null or the event is before it** → `expected` with
  an **empty** list → the calendar renders ordinary coverage → **"Nobody going" — loud**.
- **the event falls after `closedAt`** → `no_expectation`, reason `season_closed` → quiet.
- **every member in window marked `taking_part = false`** → `no_expectation`, reason
  `all_absent` → quiet.

The calendar maps `no_expectation` onto `eventCoverage()`'s existing `youthAttended: false` input
and nothing else changes in `coverage.ts`.

---

## Relevant Files

### Create

- `supabase/migrations/062_activity_roster.sql` — create both tables, backfill both, drop the
  `NOT NULL` on `member_id`, ward-wide policies, indexes.
- `supabase/migrations/063_drop_profile_member.sql` — **held back**: drop
  `youth_activity_profiles.member_id` and `activity_events.youth_attended` + its CHECK.
- `lib/youth/roster.ts` — pure, client-importable. The window function,
  `eventYouthAttendance()`, and the roster types.
- `lib/youth/rosterQueries.ts` — server data access for `activity_roster` and
  `activity_event_participation`.
- `app/api/youth/profiles/[id]/roster/route.ts` — `POST` add a young person to a team.
- `app/api/youth/roster/[id]/route.ts` — `PATCH` window dates, `DELETE` remove a row.
- `app/api/youth/events/[id]/participation/route.ts` — `PATCH` set or clear one (youth, event).
- `app/(app)/youth/RosterPanel.tsx` — the roster of one activity, with add / dates / remove.
- `app/(app)/youth/AddToActivity.tsx` — the youth-first control on an expanded `/youth` card.
- `components/youth/YouthParticipationControl.tsx` — the exception-shaped absence control.
- `tests/rls/activity-roster.test.ts`
- `tests/rls/activity-event-participation.test.ts`
- `tests/lib/youthRoster.test.ts`
- `tests/routes/youthRoster.test.ts`
- `tests/routes/youthParticipation.test.ts`
- `testing/scenarios/youth/scenario-062-one-schedule-four-players/`
- `testing/scenarios/youth/scenario-063-a-schedule-with-nobody-on-it-yet/`

### Modify

- `lib/youth/queries.ts` — `ActivityProfile` loses `memberId`/`memberName`, gains `roster`;
  `ActivityEvent` loses `youthAttended`; `ACTIVITY_PROFILE_COLUMNS` and `ACTIVITY_EVENT_COLUMNS`
  change; `createActivityProfile` writes roster rows.
- `lib/youth/profileNeed.ts` — one exported `buildSupportEvents()`; `youthNeed()` takes a member
  and their memberships rather than profiles they own.
- `lib/youth/coverage.ts` — `describeYouthAbsence()` header only (now called once per absent
  young person).
- `lib/validation/youth.ts` — `createActivityProfileSchema.memberIds`; new roster and
  participation schemas; `updateActivityEventSchema` loses `youthAttended`.
- `app/(app)/youth/YouthOverview.tsx` — group by **roster membership**, not by `profile.memberId`.
- `app/(app)/youth/ActivityProfileList.tsx` — a card is a TEAM; renders `RosterPanel`.
- `app/(app)/youth/ActivityProfileForm.tsx` — multi-select member picker.
- `app/(app)/youth/EventList.tsx` — per-youth chips and the new participation control.
- `app/(app)/youth/ManualEventForm.tsx` — activity label loses the member name.
- `app/(app)/youth/FollowUpPanel.tsx` — context label loses the member name.
- `app/(app)/youth/calendar/ActivityCalendar.tsx` — roster-derived names; honours `closedAt`.
- `app/(app)/youth/calendar/page.tsx` — pass what the calendar now needs.
- `app/(app)/youth/events/[id]/EventDetail.tsx` — roster first, occasion second.
- `app/(app)/youth/events/[id]/AddYouthToOccasion.tsx` — label without the member name.
- `app/(app)/youth/history/[member_id]/page.tsx` — closed seasons found via the roster.
- `app/(app)/youth/import/IcsImportWizard.tsx` — activity label without the member name.
- `app/(app)/youth/page.tsx`, `app/(app)/youth/profiles/page.tsx` — fetch the roster.
- `app/api/youth/profiles/route.ts` — `memberIds` on create.
- `app/api/youth/profiles/[id]/route.ts`, `.../close/route.ts` — audit detail without `memberId`.
- `app/api/youth/events/[id]/route.ts` — `youthAttended` handling removed (moved to the new route).
- `components/youth/YouthAbsenceChip.tsx` — one chip per absent young person.
- `types/database.ts` — regenerate.
- `tests/db/migrations.test.ts` — one `HELD_BACK_UNTIL_DEPLOYED` entry for `063`.
- `testing/infrastructure/seedUtils.ts` — `createActivityRoster()`,
  `createActivityParticipation()`; `createYouthActivityProfile` loses its required `memberId`.
- `tests/lib/youthProfileNeed.test.ts`, `tests/lib/youthCoverage.test.ts`,
  `tests/routes/youthEvents.test.ts`, `tests/routes/youthProfiles.test.ts`,
  `tests/rls/youth-activity-scope.test.ts`, `tests/components/youth/*` — follow the model.
- `CLAUDE.md` §9 — the decision record.
- `plans/INDEX.md` — the `youth-j` row.

---

## Dependencies

- **No new libraries.** Nothing here needs one.
- Reuses: `components/roster/MemberPicker.tsx` (already filters on
  `PROFILE_MEMBER_CATEGORIES`), `lib/audit/writeAuditLog.ts`, `lib/auth/permissions.ts`,
  `lib/youth/activityOwnership.ts`, `lib/youth/occasionDay.ts` (`wardDayBounds`),
  `tests/helpers/routeClient.ts`, `tests/helpers/seed.ts`.
- **No new notification trigger key.** Adding a young person to a team is a *setup* action; this
  module's notifications are about coverage and follow-up. `notification-trigger-drift` records
  that a new key costs three files kept in step, and this one would earn nothing.
- **Prerequisite:** commit the `youth-i` working tree first (the user's decision above). This plan
  assumes migration 061 is applied and `youth_attended` exists on `activity_events`.

---

## Known Pitfalls (from retro context)

- **`youth-h` / defect 060-D2 — a mirror of an RLS policy must copy EVERY clause.** `USING` says
  which rows you may touch, `WITH CHECK` what you may leave behind, and a failed `WITH CHECK`
  **raises** where every other refusal returns zero rows. Both new tables get **ward-wide
  policies on all four verbs**, so there is nothing new to mirror — but if a later reader narrows
  either table, `activityOwnership.ts` must gain the whole policy, not the half that reads like
  the rule.
- **`talks-d` / 054d / 055b / 056c — SQL's `null = null` is NULL, not `true`.** Any predicate or
  unique index touching a nullable column needs the explicit branch or `nulls not distinct`.
  `activity_roster`'s unique index is on two `NOT NULL` columns, so it needs neither — **state
  the contrast**, exactly as 056b states it against 055b, so nobody "fixes" one to match the other.
- **`youth-e` — carry the whole row, not three fields of it.** `ProfileNeed` carried a state and a
  date but not the *count*, and every covered card read "Covered · 0" above an event card reading
  "Covered · 1". `eventYouthAttendance()` therefore returns whole `RosterMember` objects, and the
  chip, the count and the sort all read that one value.
- **`youth-c` / `classifyLocation.ts` — an absence of evidence is never evidence.** An unmatched
  location is `tbd`, never `away`; an occasion is never inferred from a title and a date;
  `youth_attended` is never inferred. **Fourth sighting:** an empty roster is never "nobody is
  expected". See the loud/quiet split above.
- **`youth-a`-D1 / `visits-d` / `youth-d` — never offer a control the policy refuses**, and never
  hide one it would allow. Both new tables are ward-wide on all four verbs, so the roster and
  participation controls gate on `youth_activities.manage` **and nothing else** — the same
  reasoning migration 061 gives for the control it replaces.
- **`youth-c` — `npm run build` catches what lint, typecheck and 3000+ tests do not.** A constant
  or type imported from a server-only module into a client component pulls `next/headers` into the
  browser bundle. `lib/youth/roster.ts` is **pure and client-importable**; `rosterQueries.ts` is
  the server half and the split is the whole reason there are two files.
- **`visits-b` / `visits-f` / ITER-022 — one predicate, one place.** The window rule lives in
  exactly one function. The three `SupportEvent` construction sites collapse into one exported
  builder for this reason.
- **`youth-b` — the re-import guarantee.** `ImportedEventPatch` must never touch participation.
  After this slice that is **structural** (different table) rather than a discipline about a
  column list. Say so in `applyImport.ts`'s header; do not silently rely on it.
- **`roster-b` / `visits-b` / `visits-f` / `youth-g` — a count beside a filtered list is computed
  from the UNFILTERED rows.** Filter `/youth/calendar` to Ethan and "+2 others" is still the
  honest answer.
- **`calendar-a` — `*_COLUMNS` must stay ONE string literal on ONE line.** A `+` concatenation
  widens the type to `string` and silently degrades every row to untyped.
- **`foundation-a` — `params` and `searchParams` are Promises in Next 16**, typed explicitly, never
  with the generated `PageProps` helper.
- **CLAUDE.md §9 — every date formatter names its `timeZone`.** `tests/lib/explicitTimeZone.test.ts`
  reads the source and will fail on a bare `toLocaleDateString()`. A roster date is a
  **`date` column**, so it renders in **UTC** (`lib/calendar/dates.ts`), *not* the ward's zone —
  the ward's zone is for a turn-up-at `timestamptz`.

---

## Tasks

### Task 1: Migration 062 — the roster and the participation row

**File:** `supabase/migrations/062_activity_roster.sql` (create)

**Action:** Create both tables, backfill both from the columns they replace, widen `member_id`,
add ward-wide policies and indexes.

**Details:**

Header must state, in the house style of 054–061:

- **It applies immediately, before the code deploys**, and say why *exactly* rather than
  statistically: both `create table` statements and both backfills are additive; the one
  narrowing-shaped statement is `alter column member_id drop not null`, which is a **widening**
  and cannot fail on any existing row. So **no `HELD_BACK_UNTIL_DEPLOYED` entry for 062**.
- **What is missing today** — ITER-033's opening paragraph, compressed.
- **`youth_activity_profiles` is not renamed, and why.**

Structure:

```
062a  activity_roster
062b  backfill the roster from youth_activity_profiles.member_id
062c  member_id loses its NOT NULL
062d  activity_event_participation
062e  backfill participation from activity_events.youth_attended
062f  policies: ward-wide, all four, on both tables
062g  indexes
```

**062a.**

```sql
create table activity_roster (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  profile_id uuid not null,
  member_id  uuid not null,
  started_on date,
  ended_on   date,
  added_by   uuid,
  created_at timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (profile_id, ward_id) references youth_activity_profiles (id, ward_id) on delete cascade,
  foreign key (member_id,  ward_id) references members (id, ward_id) on delete cascade,
  foreign key (added_by,   ward_id) references users (id, ward_id)
);
alter table activity_roster enable row level security;

create unique index activity_roster_profile_member_idx on activity_roster (profile_id, member_id);
```

Comments that must be written, because each is a decision a later reader will otherwise undo:

- **`started_on` and `ended_on` are `date`, not `timestamptz`** — CLAUDE.md §6's rule. "She left
  the team on the 15th" is a day, not an instant, and a leader recording it in April must be able
  to name February. The comparison against a `timestamptz` `event_date` therefore resolves in the
  **ward's** zone, in `lib/youth/roster.ts`, which is the one place a wall-clock day and an
  instant meet — `resolveInstant.ts`'s rule in a second place.
- **Both nullable, and absent means the whole schedule.** The same absent-means-default idiom as
  `household_stewardships` (052), `household_visit_cadences` (050), 054a's `org_id`, 059b's
  `occasion_id` and 060a's `closed_at`. **There is no sentinel date meaning "from the start".**
  It is also what keeps setup to one tap, which is ITER-033's stated goal.
- **The unique index needs NO `nulls not distinct`, and the contrast with 055b is the point.**
  Both columns are `not null`, so the plain index is exact; 055b needed the clause only because
  `source_recurrence_id` is nullable. Stating the contrast is what stops the next reader
  "unifying" the two indexes.
- **`on delete cascade` on `member_id` is an IMPROVEMENT over what it replaces.** Today deleting a
  member cascades away their whole profile — the season, its events, its follow-ups. After this,
  it removes them from the roster and the team's schedule survives, which is what a ward that
  loses one player actually wants.
- **`added_by` mirrors `youth_activity_profiles.entered_by`** — nullable, no `on delete` clause,
  for the reason 059a gives: a leader being released must not take the roster with them.

**062b.** Backfill, one roster row per existing profile:

```sql
insert into activity_roster (ward_id, profile_id, member_id, added_by, created_at)
select ward_id, id, member_id, entered_by, created_at
from youth_activity_profiles
where member_id is not null;
```

Comment: **every existing profile becomes a team with a roster of exactly one.** Lossless, and
**no ward's screen moves on the day this applies** — a team of one computes exactly what a
per-youth profile computed. Duplicates stay duplicated; collapsing them is a human decision this
migration deliberately does not take (`visits-f`'s empty-bulk-replace precedent: refuse the
automatic destructive thing and name the alternative).

**062c.** `alter table youth_activity_profiles alter column member_id drop not null;`

Comment: **a widening, so it cannot fail.** It is what lets a team be created before anybody is on
it — the state ITER-033's own flow passes through between "import once" and "assign each youth".
The column is **dropped by 063 after the deploy**, not here, because the running build still
selects it.

**062d.**

```sql
create table activity_event_participation (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  event_id    uuid not null,
  member_id   uuid not null,
  taking_part boolean not null,
  recorded_by uuid,
  created_at  timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (event_id,    ward_id) references activity_events (id, ward_id) on delete cascade,
  foreign key (member_id,   ward_id) references members (id, ward_id) on delete cascade,
  foreign key (recorded_by, ward_id) references users (id, ward_id)
);
alter table activity_event_participation enable row level security;

create unique index activity_event_participation_event_member_idx
  on activity_event_participation (event_id, member_id);
```

Comments:

- **THREE STATES, AND THE THIRD IS THE ABSENCE OF THE ROW.** No row = nobody has said; this is
  061's rule kept exactly, on storage that makes the sparse-exception shape structural. Reproduce
  061's table of the three states.
- **`taking_part` is `NOT NULL`, and that is the CONTRAST with 061**, not a departure from it. 061
  needed a nullable column because the fact lived on a row that always existed. Here the row is
  created only when somebody answers, so a nullable column would be a second way to spell the
  same third state.
- **Clearing DELETES the row, and that is not 060a's "never a delete".** That rule protects a
  record somebody wrote. This row holds no text, no account and no author's words — it is a
  marker, and removing it is precisely "nobody has said".
- **NEVER INFERRED.** Not from an empty attendee list, not from a cancelled sibling, not from a
  missing follow-up, and — new here — **not from an empty roster**.
- **The unique index has no `nulls not distinct`** for 062a's reason; both columns are `not null`.
- **061's CHECK has no successor and needs none.** It existed because `activity_events.profile_id`
  is nullable, so "did *they* go?" had no referent on a ward-wide event. Here the referent is
  `member_id`, which is `not null` — the constraint is the column.

**062e.** Backfill participation from the column 061 added:

```sql
insert into activity_event_participation (ward_id, event_id, member_id, taking_part, created_at)
select event.ward_id, event.id, profile.member_id, event.youth_attended, event.created_at
from activity_events event
join youth_activity_profiles profile
  on profile.id = event.profile_id
 and profile.ward_id = event.ward_id
where event.youth_attended is not null
  and profile.member_id is not null;
```

Comment: **only the rows somebody actually answered.** `youth_attended is null` is "nobody has
said" and becomes **no row**, which is the same fact in the new storage. The join carries
`profile.ward_id = event.ward_id` for the reason the composite foreign keys exist: a ward filter
on one side of a join is not a ward filter on the other (060b says this).

**062f.** Ward-wide policies, all four verbs, on both tables — written out rather than looped,
following 059c.

The reasoning, which must be written down because a reader **will** assume these should be
org-scoped:

1. **They match the tables they hang off.** `activity_events`, `activity_calendars` and
   `activity_occasions` all keep migration 019's ward-wide policies and have no `org_id`, because
   the organization is answered **once, on the profile** (054d) and a second copy could disagree
   with the first. A roster row and a participation row are the same kind of thing.
2. **NO POLICY MOVES.** 061 says in as many words that writing `youth_attended` is *"an ORDINARY
   UPDATE on `activity_events`, which keeps migration 019's ward-wide write policies… the same
   boundary `Cancel` already runs under"*. Moving that fact to a table with ward-wide policies
   moves **no** boundary. Say this explicitly — it is what makes 062 purely structural.
3. **The read must be uniformly evaluable** — 056c's load-bearing rule, third sighting. The roster
   decides the **denominator** of the support percentage and the expected list on a calendar card.
   If one reader could see roster rows another could not, the same game would read covered to one
   leader and uncovered to another from the same data at the same instant.

**062g.** Indexes, each leading with `ward_id` following 018/054e/055d/056d/057e/059d:

```sql
create index activity_roster_profile_idx on activity_roster (ward_id, profile_id);
create index activity_roster_member_idx  on activity_roster (ward_id, member_id);
create index activity_event_participation_event_idx on activity_event_participation (ward_id, event_id);
```

Name what each serves: the profile index is "who is on this team" (the roster panel, the calendar
card); the member index is "which teams is this young person on" (`/youth`'s grouping and
`/youth/history/[member_id]`); the participation index is the by-event read for a whole schedule
in one query, the way `lib/youth/attendees.ts` already reads.

---

### Task 2: Migration 063 — the contract half, held back

**File:** `supabase/migrations/063_drop_profile_member.sql` (create)

**Action:** Drop `youth_activity_profiles.member_id`, and drop `activity_events.youth_attended`
with its CHECK constraint.

**Details:**

```sql
alter table youth_activity_profiles drop column member_id;

alter table activity_events drop constraint activity_events_youth_attended_needs_profile;
alter table activity_events drop column youth_attended;
```

Header must say, following the shape ITER-018's 051 set:

- **DO NOT APPLY THIS UNTIL THE NEW BUILD IS LIVE.** The running build's
  `ACTIVITY_PROFILE_COLUMNS` selects `member_id` and `ACTIVITY_EVENT_COLUMNS` selects
  `youth_attended`; dropping either underneath it makes every youth screen 400.
- Both columns' data is already in `activity_roster` and `activity_event_participation`
  (062b, 062e). **This migration destroys no fact**, it removes the second copy of two.
- The `member_id` FK carried `on delete cascade` to `members`; that cascade now lives on
  `activity_roster.member_id`, so deleting a member removes them from rosters instead of deleting
  seasons.

**Also modify `tests/db/migrations.test.ts`:** add exactly one entry, naming its pair and its
reason, in the shape the file's header requires:

```ts
const HELD_BACK_UNTIL_DEPLOYED: Record<string, string> = {
  "063":
    "youth-j's contract half. 062 backfilled activity_roster and activity_event_participation; " +
    "063 drops youth_activity_profiles.member_id and activity_events.youth_attended, both of " +
    "which the RUNNING build still selects. Apply after the new build is live, then remove " +
    "this entry — an entry that has outlived its deploy makes this test blind to 063 for ever.",
};
```

---

### Task 3: `lib/youth/roster.ts` — the pure half

**File:** `lib/youth/roster.ts` (create)

**Action:** The window rule, the event-level derivation, and the types both halves share.

**Details:**

Header: **PURE AND CLIENT-IMPORTABLE — KEEP IT THAT WAY.** `YouthOverview`, `EventList` and
`ActivityCalendar` all render this in the browser. One import of `lib/youth/queries.ts` or
`rosterQueries.ts` would pull `next/headers` into the client bundle and break the page —
`youth-c` recorded that `npm run build` caught exactly that where lint, typecheck and 2982 tests
did not. Same standing instruction `coverage.ts` and `profileNeed.ts` carry.

```ts
export type RosterMember = {
  rosterId: string;
  profileId: string;
  memberId: string;
  memberName: string;
  startedOn: string | null;   // date, "YYYY-MM-DD"
  endedOn: string | null;
};

export type EventParticipation = { memberId: string; takingPart: boolean };

export type EventYouthAttendance =
  | { kind: "expected"; expected: RosterMember[]; absent: RosterMember[] }
  | { kind: "no_expectation"; reason: "season_closed" | "all_absent"; absent: RosterMember[] };
```

**`memberIsExpectedAt(membership, profileClosedAt, eventDate, wardTimeZone): boolean`**

The one window function. Write the header as the design note above states it: **"the youth left",
"the youth joined late" and "the season was closed out" are ONE rule at one scale**, and that is
what fixes the `ActivityCalendar` leak by construction rather than by a fourth screen remembering
to check.

Mechanics, and this is the part to get right:

- `startedOn`/`endedOn` are **date** strings; `eventDate` is a **timestamptz** string;
  `profileClosedAt` is a **timestamptz** string.
- A day and an instant are compared **in the ward's zone**, using the existing
  `lib/youth/occasionDay.ts` `wardDayBounds()` — which already answers "what instants does this
  ward-day span" and is the module built for exactly this. Do **not** write a second one, and do
  **not** compare `eventDate.slice(0, 10)` to the date string: that is UTC, and it puts a 7:30pm
  Friday game on Saturday (the bug `c24d52b` fixed across seven files).
- `startedOn` is inclusive from the **start** of that ward-day; `endedOn` is inclusive to the
  **end** of that ward-day. A youth who left "on the 15th" **is** counted for a game on the 15th
  — they were still on the team that day. Assert both boundaries in the tests.
- `profileClosedAt` is an instant and compares directly. A game **after** the closing instant is
  out; one before it is in. This is exactly what `/youth/history/[member_id]` already does with
  `activitySupport(profile, events, new Date(closedAt))`, expressed once instead of twice.
- An unreadable date on either side returns `false`, matching `eventCoverage()` and
  `isFollowUpWritable()`, which both exclude one rather than throwing.

**`eventYouthAttendance(event, memberships, participation, profileClosedAt, wardTimeZone): EventYouthAttendance`**

The loud/quiet split. Order of the branches **is** the rule, exactly as `eventCoverage()`'s is:

1. `profileClosedAt !== null` and the event is after it → `{ kind: "no_expectation", reason:
   "season_closed", absent: [] }`. **Quiet.** This is the `ActivityCalendar` leak, closed.
2. `inWindow = memberships.filter(m => memberIsExpectedAt(m, profileClosedAt, event.eventDate, tz))`
3. `absent = inWindow.filter(m => participation for (m, event) is takingPart === false)`
4. `inWindow.length > 0 && absent.length === inWindow.length` → `{ kind: "no_expectation", reason:
   "all_absent", absent }`. **Quiet.**
5. otherwise → `{ kind: "expected", expected: inWindow.filter(not absent), absent }`.
   **`inWindow.length === 0` lands HERE, with an empty `expected`, and that is deliberate and
   load-bearing.** Write the whole paragraph: a team with nobody assigned yet is a **normal**
   state in ITER-033's own flow, and answering it "no expectation" would silently remove every
   game of a freshly imported season from the coverage model with no badge anywhere saying so —
   `classifyLocation.ts`'s "an unmatched location is `tbd`, never `away`", a **fourth** time.

**`youthAttendedForEvent(attendance): boolean | null`** — the adapter into
`coverage.ts`'s unchanged `EventCoverageInput`: `no_expectation` → `false`, `expected` → `null`.
One function, so no screen invents its own mapping.

**Whole `RosterMember` objects are returned, never ids or a count.** `youth-e`'s lesson: the chip,
the "+N others" line and the sort must all read the value the decision was made on.

---

### Task 4: `lib/youth/rosterQueries.ts` — the server half

**File:** `lib/youth/rosterQueries.ts` (create)

**Action:** Data access for both new tables, in `lib/youth/queries.ts`'s idiom.

**Details:**

- `const ROSTER_COLUMNS` and `const PARTICIPATION_COLUMNS` — **one string literal on one line
  each** (`calendar-a`). The roster's member embed is **named**:
  `members!activity_roster_member_id_ward_id_fkey (first_name, last_name)`.
- `listRosterForWard(wardId, client): Promise<RosterMember[]>` — every roster row in the ward, one
  query. `/youth`, `/youth/profiles` and `/youth/calendar` all need the whole set; a per-profile
  query would be one round trip per team.
- `listParticipationForEvents(wardId, eventIds, client): Promise<Map<string, EventParticipation[]>>`
  — keyed by event, short-circuiting on an empty list without a round trip, exactly as
  `lib/youth/attendees.ts` does.
- `addRosterMember(wardId, profileId, memberId, startedOn, addedBy, client)`,
  `updateRosterMember(wardId, rosterId, patch, client)`,
  `deleteRosterMember(wardId, rosterId, client)`.
- `setParticipation(wardId, eventId, memberId, takingPart, recordedBy, client)` — an **upsert** on
  the `(event_id, member_id)` unique index, so a double-tap on a slow phone writes one row
  (056b's reason for its unique index, restated).
- `clearParticipation(wardId, eventId, memberId, client)` — the delete that means "nobody has said".
- Every function takes the **caller's** session client. Nothing branches on a role (rule 2).
- A duplicate roster insert must surface as a **sentence**, not a constraint violation: catch
  PostgREST `23505` and return a discriminated `{ ok: false, reason: "already_on_roster" }` so the
  route can answer 409 with something a person can act on (rule 7).
- Apply `isPolicyRefusal()` from `lib/youth/queries.ts` on the writes, so a `42501` raise and a
  zero-row refusal both reach the caller as one sentence — defect 060-D2's other half.

---

### Task 5: `lib/youth/queries.ts` — the profile becomes a team

**File:** `lib/youth/queries.ts` (modify)

**Details:**

- `ActivityProfile`: **remove** `memberId` and `memberName`; **add**
  `roster: RosterMember[]`. Rewrite the type's header — this row is a **team/activity** now, and
  the comment must say what it used to be so a reader of `git log` is not confused.
- `ACTIVITY_PROFILE_COLUMNS`: drop `member_id` and the `members!…` embed; **keep** the
  `activity_events!…(count)` embed (it still gates `Remove`). Attach the roster in the **mapper**
  from `listRosterForWard()` rather than as a nested two-level embed — the ward-wide roster list
  is needed whole by three pages anyway, and a nested embed is harder to type. Say which and why
  in the comment.
- `ActivityEvent`: **remove** `youthAttended`; remove it from `ACTIVITY_EVENT_COLUMNS`. Leave a
  comment naming migration 062/063 and pointing at `activity_event_participation`, so the removal
  reads as a move rather than a deletion.
- `createActivityProfile()`: after inserting the profile, insert the roster rows for
  `input.memberIds`. **Not a stored procedure** — `applyImport.ts`'s reasoning applies unchanged:
  two tables, and a partial write leaves a team with a short roster, which the roster panel makes
  visible and one tap fixes. If the roster insert fails, the route must surface it rather than
  reporting success (rule 7).
- `ActivityProfileRow`: drop `member_id` and `members`. **Keep** the `activity_events: {count}[]`
  array shape and its comment about PostgREST returning an empty array.

---

### Task 6: `lib/youth/profileNeed.ts` — one builder, three callers

**File:** `lib/youth/profileNeed.ts` (modify)

**Details:**

- **`carriesCoverageExpectation()` IS NOT MODIFIED.** Add a line to its header saying its
  `youthAttended` input now arrives from a participation row rather than from a column, and that
  its four exclusions are `youth-i`'s, unchanged. This is the single most important "do not
  touch" in the slice.
- **Add `buildSupportEvents()`** — the one place a `SupportEvent[]` is constructed, replacing the
  three sites that build it today (`YouthOverview`, `history/[member_id]/page.tsx`, and the
  implicit one in the calendar):

  ```ts
  export function buildSupportEvents(
    membership: RosterMember,
    profileClosedAt: string | null,
    events: readonly ActivityEventLike[],
    attendeesByEvent: ReadonlyMap<string, readonly AttendeeLike[]>,
    participationByEvent: ReadonlyMap<string, readonly EventParticipation[]>,
    wardTimeZone: string,
  ): SupportEvent[]
  ```

  It filters to the membership window (`memberIsExpectedAt`), then maps each event to a
  `SupportEvent` whose `youthAttended` is that member's participation row or `null`, whose
  `attendeeCount` is the attendee list length, and whose `confirmedAttendeeCount` counts
  `confirmedAttendance === true` **explicitly** — keep the existing comment verbatim, it is the
  reason null is not read as "did not go".

  Header: **three construction sites becoming one is the point.** ITER-033 Q5 predicted this, and
  `youth-e`'s defect is what happens when two of them drift.

- `youthNeed()`: its `profiles` parameter becomes `memberships` —
  `readonly { membership: RosterMember; activityName: string; closedAt: string | null }[]` —
  and its `eventsByProfile` map is keyed by **profile id** still. **The running/closed partition
  stays exactly where it is**, and its whole comment block survives: filtering closed teams out
  upstream would make a young person whose every season is finished vanish from the ward, which is
  the one thing ITER-028 forbids.
- **`compareYouth()` and the null-last-in-both-directions rule are untouched.** Add a test, do not
  add a branch. An em dash and never `0%` survives unchanged.
- `YouthNeed.memberId`/`memberName` now come from the **member**, which they always semantically
  did — the change is that they no longer arrive via a profile.

---

### Task 7: `lib/youth/coverage.ts` — the chip, per young person

**File:** `lib/youth/coverage.ts` (modify)

**Details:**

- `EventCoverageInput.youthAttended` **keeps its name, its type and its required-ness.** Update
  its comment: the fact now lives on `activity_event_participation`, and on an event-level read it
  is `youthAttendedForEvent()`'s answer. **The required-ness is still the mechanism** — every
  construction site is a compile error until it supplies the field (rule 9 enforced by the type
  checker), and that is exactly what will find the sites this slice must change.
- `eventCoverage()` — **no change at all.** The `youthAttended === false` branch before the clock
  stays where it is, for the reason it is there.
- `describeYouthAbsence()` — unchanged signature, but its header gains the note that it is now
  called **once per absent young person** on an event, since an event can serve a roster. The
  tense-free wording survives and is now doing more work.

---

### Task 8: Validation schemas

**File:** `lib/validation/youth.ts` (modify)

**Details:**

- `createActivityProfileSchema`: replace `memberId: z.uuid(...)` with
  `memberIds: z.array(z.uuid("Choose which young people are on this team.")).default([])`.
  **An empty array is allowed**, with a comment saying why: ITER-033's flow is *import once, then
  assign*, so a team with no roster yet is a normal state, and it is made **loud** on the roster
  panel and on the calendar rather than refused here.
- `updateActivityProfileSchema`: unchanged. Its header still explains why `memberId` was not
  patchable; rewrite that paragraph to say the roster is now its own resource with its own routes
  and its own audit rows — the same reason, arriving at a better shape.
- `updateActivityEventSchema`: **remove `youthAttended`**, and leave a comment saying where it
  went and why (a fact about a *young person at an event*, not about the event).
- New:

  ```ts
  export const rosterDateSchema = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "…").nullable().optional();

  export const addRosterMemberSchema = z.object({
    memberId: z.uuid("Choose which young person is joining."),
    startedOn: rosterDateSchema,
  });

  export const updateRosterMemberSchema = z
    .object({ startedOn: rosterDateSchema, endedOn: rosterDateSchema })
    .superRefine(/* "Nothing was changed." when empty; ended_on before started_on is refused */);

  export const setParticipationSchema = z.object({
    memberId: z.uuid("Choose which young person this is about."),
    takingPart: z.boolean().nullable(),   // null CLEARS the row
  });
  ```

  `updateRosterMemberSchema` must refuse `endedOn < startedOn` with a sentence — a window that
  cannot contain anything would silently zero a percentage, which is the class of bug this slice
  exists to remove.

---

### Task 9: The roster routes

**Files:** `app/api/youth/profiles/[id]/roster/route.ts`,
`app/api/youth/roster/[id]/route.ts` (create)

**Details:**

Follow `app/api/youth/events/[id]/assign/route.ts` exactly: session outside the `try`,
`resolveRoleAccess` once into a local, `assertCan(user, "youth_activities.manage", roleAccess)`,
Zod at the boundary, `writeAuditLog()` on every success, `respondToRouteError()` on failure.
`params` is a **Promise**.

- **`POST /api/youth/profiles/[id]/roster`** — 404 if the profile is not in the ward; 404 if the
  member is not in the ward or is not in `PROFILE_MEMBER_CATEGORIES` (checked against the live
  roster, for 054's reason: a composite FK would otherwise answer a foreign id with a constraint
  violation nobody can act on); **409** with a sentence if they are already on the roster.
  Audit `youth_activity_roster_added`, detail `{ profileId, activityName, memberId, memberName }`.
- **`PATCH /api/youth/roster/[id]`** — the window dates. Audit
  `youth_activity_roster_updated`, detail carrying **both** dates before and after, because "when
  did she leave" is exactly the question somebody asks later.
- **`DELETE /api/youth/roster/[id]`** — **unconditional, and the reasoning must be written in the
  header.** Unlike `youth-h`'s `Remove` on a profile, this destroys **nothing a person wrote**:
  follow-ups (`activity_logs`) and private notes hang off **events**, not off a roster row, so
  they survive untouched; the only cascade is participation **markers**. Audit
  `youth_activity_roster_removed` with the member name. **The UI still offers "Left the team on…"
  as the primary control** and Remove as the mistake-fixer — the same
  primary-is-non-destructive shape `youth-h` established, arrived at for a different reason.

**No notification on any of the three** — see Dependencies.

---

### Task 10: The participation route

**File:** `app/api/youth/events/[id]/participation/route.ts` (create)

**Details:**

`PATCH`, body `setParticipationSchema`. `youth_activities.manage`, matching what migration 061
required and what `Cancel` already runs under.

- `takingPart: true | false` → upsert the row.
- `takingPart: null` → **delete** the row; this is the way back that is not the opposite claim
  (061's reversibility rule, and pressing the active answer again is what sends `null`).
- **Refuse with 400 and a sentence** if the member is not on the event's team roster at all. This
  replaces migration 061's CHECK, which existed because a ward-wide event had no referent for
  "did *they* go?". A person can act on "Ethan is not on this team" in a way they cannot act on a
  constraint violation — 061's own stated reason for refusing in the route first.
- Audit `youth_activity_participation_recorded` / `_cleared`, detail
  `{ eventId, eventTitle, memberId, memberName, takingPart }`.
- **`app/api/youth/events/[id]/route.ts`**: remove the `youthAttended` handling and its 400 branch
  and the CHECK-related comment, leaving a pointer to this route.

---

### Task 11: `/youth/profiles` — the team card and its roster

**Files:** `app/(app)/youth/RosterPanel.tsx` (create),
`app/(app)/youth/ActivityProfileList.tsx`, `app/(app)/youth/ActivityProfileForm.tsx`,
`app/(app)/youth/profiles/page.tsx` (modify)

**Details:**

- `ActivityProfileList` currently groups profiles **by young person** (`groupByMember`, lines
  ~92–110) and heads each group with `group.memberName`. That grouping **goes away**: a card is a
  **team** now, listed by activity name. This is the single largest UI change in the slice.
- The confirm strings at lines ~254 and ~288 read `"…for ${profile.memberName}"` — they must name
  the **activity** and, for Close, say how many young people it affects. Reuse
  `youth-h`'s wording; it already avoids gendered pronouns (a defect from that walk).
- **`RosterPanel`** renders inside a team card: each member's name, their window if either date is
  set ("Joined 12 Jan", "Left 3 Mar"), a `Left the team` control (date picker, defaulting to
  today), and `Remove`. Plus `Add a young person` using `MemberPicker` filtered on
  `PROFILE_MEMBER_CATEGORIES`, excluding members already on the roster.
- **An empty roster is LOUD**, in a sentence, not a blank: *"Nobody is on this team yet. Its games
  will show as needing somebody until you add the young people who play."* This is the
  presentation half of Task 3's branch 5, and the two must agree.
- All controls gate on `canManage` **only** — both new tables are ward-wide on all four verbs, so
  gating on anything narrower would hide a control the API allows (`youth-a`-D1's mirror, and
  061's stated rule for the control this replaces).
- `ActivityProfileForm`: `memberId: string | null` → `memberIds: string[]`; `MemberPicker` in
  multi-select. Keep the "add people later" path reachable by submitting with none selected.
- Roster dates render **in UTC** via `lib/calendar/dates.ts` — they are `date` columns.
  `tests/lib/explicitTimeZone.test.ts` will fail on a bare `toLocale*`.

---

### Task 12: `/youth` — grouping by membership, and the youth-first add

**Files:** `app/(app)/youth/YouthOverview.tsx`, `app/(app)/youth/page.tsx` (modify),
`app/(app)/youth/AddToActivity.tsx` (create)

**Details:**

- `YouthOverview`'s `byMember` loop (lines ~296–305) keys on `profile.memberId`. It now keys on
  **`membership.memberId`**, iterating `roster` rather than `profiles`. Every other rule in that
  memo survives and its comments must be preserved: **built from EVERY membership, closed teams
  included** — filter closed ones out here and a young person whose every season has finished
  vanishes from the ward, which ITER-028 forbids.
- Each group's entry becomes
  `{ membership, activityName, closedAt }[]`, handed to `youthNeed()`.
- `eventsByProfile` is built once from the shared event list, then `buildSupportEvents()` is
  called **per membership** — so two team-mates get two different `SupportEvent[]` from one set of
  event rows, which is the whole point of the slice.
- `profileIds` on each row (what the expanded card filters on) stays **all of them, closed
  included** — the ranking excludes a closed season, the schedule is a record and must not develop
  a hole.
- **`AddToActivity`** on an expanded card: a picker of the ward's teams this young person is not
  already on, plus "or create a new activity". POSTs to
  `/api/youth/profiles/[id]/roster`. This is the user's own words —
  *"go through each individual youth… and assign them to an activity"* — and it is one route, two
  entry points, not two implementations.
- `page.tsx` fetches `listRosterForWard` and `listParticipationForEvents` alongside the existing
  `Promise.all`, and passes them down. **The clock still enters once**, and
  `readWardTimezone` is now needed by the window function as well as by the formatters.

---

### Task 13: The calendar, the event list, and the event detail

**Files:** `app/(app)/youth/calendar/ActivityCalendar.tsx`, `.../calendar/page.tsx`,
`app/(app)/youth/EventList.tsx`, `app/(app)/youth/events/[id]/EventDetail.tsx`,
`app/(app)/youth/events/[id]/AddYouthToOccasion.tsx`,
`app/(app)/youth/ManualEventForm.tsx`, `app/(app)/youth/FollowUpPanel.tsx`,
`app/(app)/youth/import/IcsImportWizard.tsx` (modify)

**Details:**

- Every `${profile.memberName} — ${profile.activityName}` label becomes the **activity** alone
  (`ManualEventForm:63`, `IcsImportWizard:70`, `ActivityCalendar:268`,
  `AddYouthToOccasion:82`, `FollowUpPanel:134`, `EventList:563`). A team's label is its name and
  its school — the young people are on the card, not in the label.
- **`ActivityCalendar`** — the leak, closed. Each event card calls `eventYouthAttendance()` and
  passes `youthAttendedForEvent()` into `eventCoverage()`. It therefore honours `closedAt` for the
  first time, and it does so **without a `closedAt` check of its own**, which is the design.
  - The card lists the expected young people (names) and renders one `YouthAbsenceChip` per absent
    one.
  - The **ZONE TRAP** header survives intact and its invariant is unchanged: a card is bucketed
    into a day in the same zone its own time is printed in.
  - The "+N others at this game" marker now has **two sources**: other young people on this
    event's own roster (derived) and other events on the same occasion (explicit). One list, both
    named. The count is computed from the **UNFILTERED** rows — filter to Ethan and the honest
    answer is still "+2 others" (`roster-b`, restated by `visits-b`, `visits-f` and `youth-g`).
    `tests/components/youth/OccasionMarker.test.tsx` is the only place that can catch a
    regression here.
- **`EventList`** — line ~740 currently reads *"Is {memberName} taking part?"* as a standing
  unanswered fieldset on every card. **That is the defect ITER-033 was raised from.** Replace with
  `YouthParticipationControl` (Task 14).
- **`EventDetail`** — the occasion page's rows are built per **event**; they become per
  **(young person, event)**, sourced roster-first. A single event with a roster of four renders
  four rows without any occasion at all; an occasion adds rows from other activities. Its
  `worstCoverage()` call must keep receiving the **whole** `EventCoverage` (`youth-e`'s signature
  lesson, which `youth-g` restated).

---

### Task 14: The absence control, reshaped as an exception

**Files:** `components/youth/YouthParticipationControl.tsx` (create),
`components/youth/YouthAbsenceChip.tsx` (modify)

**Details:**

**This task is success criterion 5, and it is why ITER-033 exists.** The user's words on seeing
the `youth-i` screenshot: *"it appears that we are going to have to confirm every connection
between an individual youth and an event?"* It never did require that — **but a control that has
to be explained is a control that is wrong.**

- **Nothing renders by default.** A past or upcoming event card shows the expected young people as
  plain names, with **no question, no fieldset and no unselected radio anywhere.**
- One quiet disclosure per card — *"Somebody wasn't there?"* — a link-styled button, rendered only
  when `canManage` and only when the roster in window is non-empty.
- Opening it reveals one row per rostered young person with a single **"Not taking part"** action.
  Pressing it writes `takingPart: false`, collapses the disclosure and renders the chip.
- A marked young person renders `YouthAbsenceChip` **outside** the disclosure, always visible, with
  a way back that clears the row (`takingPart: null`). **Pressing the active answer clears to
  "nobody has said", never to the opposite claim** — 061's reversibility rule, kept verbatim.
- `taking_part = true` is reachable from the same row (**"They were there"**), and it is
  deliberately the quieter of the two: it changes no number today and exists so "confirmed
  present" stays distinguishable from "nobody has said".
- `YouthAbsenceChip` keeps its tone — deliberately **not** `Cancelled`'s `--warning`, because two
  different facts must not read as one (061's rule).
- **`isFollowUpWritable()` stays untouched**, and the header must say so: *the prompt stops and
  the door stays open.* A leader who turned up and found the young person absent is exactly the
  person whose account is worth having. And a follow-up already **written** still reads `logged`,
  because the branch sits after `hasLog`.

---

### Task 15: History, seeds, types, and the docs

**Files:** `app/(app)/youth/history/[member_id]/page.tsx`, `types/database.ts`,
`testing/infrastructure/seedUtils.ts`, `CLAUDE.md`, `plans/INDEX.md`,
`lib/youth/ics/applyImport.ts`, `lib/youth/ics/importRequest.ts` (modify)

**Details:**

- **History page** — `theirProfiles` (line ~72) filters `profile.memberId === memberId`; it now
  finds the member's **memberships**, then their teams, then the **closed** ones. The frozen
  number stays **recomputed against `closedAt`, never stored** — the eighth time this module
  answers that question the same way — and now runs through `buildSupportEvents()` with the
  membership window applied, so a youth who left in February gets a snapshot of *their* season,
  not the team's. The **horizon rule is unchanged** (every past home game plus the next one),
  confirmed by the user 2026-08-31 and explicitly out of scope here.
- **`applyImport.ts`** — add to its "what it never does" header: participation is now a
  **different table**, so the re-import guarantee for it is **structural** rather than a
  discipline about a column list. `ImportedEventPatch` is unchanged and still touches only
  `title`, `location`, `event_date`, `all_day`.
- **`importRequest.ts`** — no code change. `profileId` now names a **team**, which is what
  `"Choose which activity this schedule belongs to."` already said. Note it in the header so the
  absence of a change is visible as a decision.
- **`types/database.ts`** — `npm run db:types` after 062 applies. Never hand-edit.
- **`seedUtils.ts`** — `createYouthActivityProfile` loses its required `memberId` (line ~1102's
  comment inverts: a profile that names no youth is now a **team**, which is legitimate); add
  `createActivityRoster({ profileId, memberId, startedOn?, endedOn? })` and
  `createActivityParticipation({ eventId, memberId, takingPart })`; remove `youthAttended` from
  `createActivityEvent` (lines ~1199 and ~1215).
- **`CLAUDE.md` §9** — a new decision entry, in the house voice, recording: the team/roster shape
  and why `activity_occasions` survives for the cross-activity case only; the **one window
  function** and that it closes the `ActivityCalendar` leak by construction; the **three states
  by row presence** and why clearing is a delete that breaks no rule; **the empty roster stays
  loud** as `classifyLocation.ts`'s refusal in a fourth place; that **no policy moved**; and that
  this **supersedes migration 061's placement** while keeping every rule `youth-i` established.
  Amend the `youth-i` entry to point here rather than leaving it contradicting the code.
- **`plans/INDEX.md`** — the `youth-j` row in the slice table, and update the Phase 8 status line.

---

## Testing Strategy

### Unit — pure functions

**`tests/lib/youthRoster.test.ts`** (create) — the highest-value file in the slice.

- `memberIsExpectedAt`: both null (everything in); `startedOn` **inclusive on its own day**;
  `endedOn` **inclusive on its own day**; an event on the boundary day at 7:30pm in a ward zone
  west of UTC — the case a `slice(0, 10)` comparison gets wrong; `closedAt` before / after an
  event; `endedOn` and `closedAt` both set, nearer one wins; an unreadable date returns `false`.
- `eventYouthAttendance` — **the branch order is the assertion**:
  - **empty roster → `expected` with an empty list** (loud). Assert this explicitly and comment
    the test with why, because it is the branch a future "tidy-up" will invert.
  - all members in window marked `false` → `no_expectation` / `all_absent`.
  - event after `closedAt` → `no_expectation` / `season_closed`, **even when the roster is
    non-empty and nobody is marked**.
  - one of three absent → `expected` with two expected and one absent, and the absent one carries
    a whole `RosterMember`, not an id.
- `youthAttendedForEvent` maps both kinds.

**`tests/lib/youthProfileNeed.test.ts`** (modify)

- `buildSupportEvents` excludes events outside a membership window, on both sides.
- Two team-mates on one set of events produce **different** `SupportEvent[]` when one is marked
  absent for one game — the slice's headline behaviour, and unprovable before it.
- A youth who **joined in January** is not measured on December's games.
- A youth who **left in February** is not measured on March's games, and the team's percentage for
  everybody else is unchanged.
- **The null rules survive:** `supportedFraction === null` when nothing is counted; it renders as
  an em dash and never `0%`; `compareYouth` sorts null **last in both directions** — assert both
  directions explicitly, as the file already does, because the two rules look identical to the
  `nobody_all_season` sort and are its opposite.
- `carriesCoverageExpectation`'s four exclusions still assert **separately** (different reasons).

**`tests/lib/youthCoverage.test.ts`** (modify) — `eventCoverage` unchanged; add that
`youthAttended: false` still returns `not_expected` **before the clock**, at three days out *and*
three days past.

### RLS — the highest-value tests in this codebase

**`tests/rls/activity-roster.test.ts`** and **`tests/rls/activity-event-participation.test.ts`**
(create), following `tests/rls/youth-activity-scope.test.ts`'s shape exactly — `seedFixtures`,
`asRole`, `fixtures.cleanup()` in `afterAll`, never assuming an empty table.

- Ward A cannot read or write ward B's rows on either table.
- **Reads are ward-wide across organizations** — an Elders Quorum president reads a roster row on
  a Young Women team. Without this the ward-wide read could be an accident of the seed, and the
  first person to "tidy up" the select policy would find every test green (that sentence is
  `youth-activity-scope.test.ts`'s own, and it applies verbatim).
- **Writes are ward-wide too**, and there is a case asserting a cross-organization write
  **succeeds** — so a future narrowing breaks a test rather than silently removing the feature
  (`youth-g`'s pattern).
- Deleting a **member** removes their roster and participation rows and **leaves the team, its
  events and its follow-ups intact** — the cascade improvement 062a claims, proved rather than
  asserted in a comment.
- A refused write is asserted by **re-reading the row with the service client**: an RLS-denied
  UPDATE or DELETE is a zero-row success, not an error; only INSERT raises.

**`tests/rls/youth-activity-scope.test.ts`** (modify) — its seeds set `member_id`; move them to
roster rows. Its four stated purposes are unchanged and must all still pass.

### Routes

**`tests/routes/youthRoster.test.ts`** (create) — happy path for all three verbs; 403 for a role
without `youth_activities.manage` (**check the fixture's real permissions first** —
`org_president` and `music_coordinator` do not hold the intuitive set, and
`lib/auth/permissions.ts` is the source of truth); 409 on a duplicate; 404 on a foreign member;
400 on `endedOn < startedOn`; an audit row written on every success.

**`tests/routes/youthParticipation.test.ts`** (create) — set `true`, set `false`, clear with
`null` (assert the **row is gone**, re-read with the service client); 400 with a sentence when
the member is not on the roster; a double `PATCH` writes **one** row.

**`tests/routes/youthProfiles.test.ts`** (modify) — create with two `memberIds` writes a profile
and two roster rows; create with `[]` succeeds and the team is readable.

**`tests/routes/youthEvents.test.ts`** (modify) — `youthAttended` on the event PATCH is now
rejected by the schema; remove the 400-on-null-profile case that migration 061's CHECK backed.

### Component

**`tests/components/youth/YouthAbsenceChip.test.tsx`** (modify) — several chips on one event.

**`tests/components/youth/OccasionMarker.test.tsx`** (modify) — "+N others" counts roster-derived
young people **and** occasion-linked ones, from the **unfiltered** rows.

**New** — the participation control renders **no question by default**, which is the only place a
test rather than a walk can catch success criterion 5 regressing.

---

## Test Scenarios (Harness)

### Scenario 062: One schedule, four players

**Tags:** `youth`, `full`, `roster`, `coverage`
**Purpose:** The whole model in one seed. Prove that one imported schedule serves four young
people, that a youth who left mid-season is not measured on games after they left, that a youth
who joined late is not measured on games before, and that marking one player absent for one game
moves **only** that player's number. Every one of these takes many minutes to build by hand and
several are unreachable through the UI in a sensible order.

**Seed data summary:**
- `youth_activity_profiles` — 1 — "Varsity Basketball", Lincoln High, `sport`, Young Men,
  `closed_at` null.
- `activity_calendars` — 1 — `ics_upload`, so the events read as imported.
- `activity_events` — 12 — one team schedule; 8 past, 4 upcoming; 9 `home`, 3 `away`; one
  `cancelled`; source uid/recurrence set so a re-import matches.
- `activity_roster` — 4 — Ethan (no dates), Josh (no dates), Maya (`ended_on` mid-season),
  Tyler (`started_on` mid-season).
- `activity_event_participation` — 1 — Ethan, `taking_part = false`, on one past home game.
- `activity_attendees` — 6 — spread so the four percentages are all different and none is 0 or 100.

**Tester action:** Open `/youth`. Read the four cards. Expand Ethan's, then Maya's. Open
`/youth/profiles` and read the Varsity Basketball roster. Open `/youth/calendar` and find the
game Ethan missed. Mark Josh as not taking part for an upcoming game and watch only his pill move.

**Verification checklist:**
- [ ] `/youth` shows **four** young people, each with a "Varsity Basketball" pill.
- [ ] The four percentages **differ**, and each denominator matches that person's window.
- [ ] Maya's denominator counts **no** game after her `ended_on`; the game **on** her `ended_on`
      **is** counted.
- [ ] Tyler's denominator counts **no** game before his `started_on`; the game **on** it **is**.
- [ ] Ethan's marked game is excluded from his denominator and from **nobody else's**.
- [ ] `/youth/profiles` shows **one** Varsity Basketball card, not four, with four names on it.
- [ ] The calendar shows **12** cards for this team, not 48.
- [ ] The game Ethan missed carries **one** absence chip naming him, and no chip for the others.
- [ ] **No unanswered Yes/No control appears on any event card.**
- [ ] Marking Josh absent for an upcoming game moves **only** Josh's pill.
- [ ] Clearing that mark restores it exactly, and the row is gone from the database.

### Scenario 063: A schedule with nobody on it yet

**Tags:** `youth`, `full`, `roster`, `coverage`, `regression`
**Purpose:** The state ITER-033's own flow passes through — imported first, assigned second — and
the one a future "tidy-up" is most likely to make silently disappear. Seeding it is the only way
to reach it deterministically, and a green suite cannot see it going quiet.

**Seed data summary:**
- `youth_activity_profiles` — 2 — "Concert Choir" (empty roster) and "Cross Country"
  (`closed_at` set, one youth on the roster, two games **after** the closing instant).
- `activity_events` — 8 — 4 upcoming on the choir, 4 on cross country (2 before the close, 2 after).
- `activity_roster` — 1 — one youth on Cross Country only.

**Tester action:** Open `/youth/calendar` and read the coverage strip and every card. Then open
`/youth/profiles` and read both activity cards.

**Verification checklist:**
- [ ] The Concert Choir's four upcoming games read **uncovered / unassigned** — **loud**, not
      absent and not `not_expected`.
- [ ] Cross Country's two games **before** the closing instant read ordinary coverage.
- [ ] Cross Country's two games **after** the closing instant read `not_expected` and raise
      **nothing** — the ITER-033 leak, closed.
- [ ] `/youth/profiles` says in a sentence that nobody is on the Concert Choir yet, and says what
      that means for its games.
- [ ] Adding one young person to the Concert Choir makes them appear on `/youth` immediately,
      with a real percentage or an em dash — **never `0%`**.
- [ ] The closed Cross Country season contributes **no pill percentage** on `/youth` and its
      young person still has a card.

---

## Validation Commands

```bash
# Apply 062 to the hosted project (063 is NOT pushed until the build is live)
npm run db:push

# Regenerate the generated types after 062 applies
npm run db:types

# Linting
npm run lint

# Type checking — both the app and the harness
npm run typecheck
npm run harness:typecheck

# Tests
npm run test

# Production build — REQUIRED, not optional.
# youth-c: `npm run build` caught a server-only module reaching the client bundle
# where lint, typecheck and 2982 tests did not. lib/youth/roster.ts is imported by three
# client components, so this is the exact shape that fails here.
npm run build
```

---

## Integration Notes

### Shipping order — this matters

1. **Commit the `youth-i` working tree first** (the user's decision). This plan assumes 061 is
   applied and `activity_events.youth_attended` exists.
2. Write and apply **062**. Nothing on any screen moves: every profile becomes a team of one and
   every answered `youth_attended` becomes a participation row.
3. Build the code. `063` sits on disk **unapplied**, with its `HELD_BACK_UNTIL_DEPLOYED` entry.
4. Deploy.
5. Apply **063** and **remove the allowlist entry in the same change**. An entry that outlives its
   deploy makes the test blind to that migration for ever, which is itself the bug the second half
   of `migrations.test.ts` exists to catch.

### Breaking changes

- `ActivityProfile.memberId` / `.memberName` are **gone**. ~14 files read them; the type checker
  enumerates every one. This is rule 9 enforced by the compiler, and it is deliberate.
- `ActivityEvent.youthAttended` is **gone**. `EventCoverageInput.youthAttended` stays **required**,
  so every construction site is a compile error until it supplies the new source — which is what
  will find them.
- `POST /api/youth/profiles` takes `memberIds: string[]`, not `memberId: string`.
- `PATCH /api/youth/events/[id]` no longer accepts `youthAttended`.

### What deliberately does not change

- **No RLS policy moves.** Both new tables are ward-wide on all four verbs, matching
  `activity_events`, `activity_calendars` and `activity_occasions`; and 061 already put
  `youth_attended` under ward-wide writes.
- `activity_occasions`, its four policies, `tests/rls/activity-occasions.test.ts`,
  `/youth/events/[id]` and both occasion routes — **untouched**.
- `activity_logs`, `activity_private_notes` and migration 057c/058's org-scoped reads —
  **untouched**. Rule 5 is not near this change.
- `carriesCoverageExpectation()`, `eventCoverage()`, `isFollowUpWritable()`, the horizon rule,
  `compareYouth()`'s null-last-in-both-directions, em-dash-never-`0%`, and the ICS re-import
  guarantee — **all unchanged**, and the plan asserts each rather than assuming it.
- `lib/auth/navigation.ts` — the front door did not move.
- **No new notification trigger key**, so `tests/db/notification-triggers-seed.test.ts` and its
  three sources stay in step.

### Handed forward

- **Merging two teams** is not built, on the user's decision. If a ward ever needs it, the shape is
  a *move* of roster rows plus an explicit decision about the abandoned team's events — and
  `youth-h`'s 409 is the precedent for refusing to destroy follow-ups on the way.
- **JV vs Varsity from one imported calendar** stays out (ITER-033 Q7). A person confirms.
- **`activity_events` still has no `entered_by`** — `youth-a` handed that forward and it is still
  open; the unscoped leader-to-leader messaging feature needs it.
- **Phase 11 still inherits six clock-driven things.** This slice adds none: participation,
  coverage and the window are all computed on read.
