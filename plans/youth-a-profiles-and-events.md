# Plan: Youth A — Activity Profiles and Manual Events

**Created:** 2026-08-27
**Type:** feature
**Phase:** 8 — Youth Activity Support ([08-youth-activities.md](08-youth-activities.md)), slice A of four

---

## Overview

Phase 8 is seven steps and eight required tests. It ships in four slices, the same way Phase 7
shipped as `visits-a` … `visits-f`. **This plan covers slice A only.**

| Slice | Covers | Phase-plan steps |
|---|---|---|
| **youth-a** (this plan) | Migration 054, activity profiles CRUD, manual event entry, the `/youth` page | 1, part of 2 |
| youth-b | ICS upload: `ical.js`, preview-then-confirm, timezones, `RRULE`, idempotent re-import, `activity_calendars` | 2 |
| youth-c | Home/away classification, attendees (assign + self-add), coverage computed on read, `/youth/calendar` | 3, 4, 7 |
| youth-d | `activity_logs`, the shared/private note split, ward-council flagging, `lib/youth/reportTiles.ts` + feed route | 5, 6 |

Google Calendar sync is **cut**, as the phase plan's own Pitfalls section instructs
("Cut Google sync before cutting anything else here"). `ACTIVITY_SOURCE_TYPES` keeps its
`google_sync` value — removing it is a migration for no gain — but nothing writes it.

### What slice A delivers

A ward council member or org leader can record that a youth is on a team or in a choir, add
the games and concerts by hand, and see them in one list. No import, no coverage, no
follow-up. The phase plan asks for exactly this ordering: *"Manual entry — always available,
always works. Build this first so the module is usable before any import exists."*

### Four decisions taken before planning

These were put to the user on 2026-08-27 and answered. They are recorded here because three of
them were deferred to Phase 8 **by name** in shipped code, and the fourth needed permission.

1. **`org_id` goes on `youth_activity_profiles` only, and is nullable.** Migration 019 left a
   note addressed to this phase: *"SPEC.md gives none of the activity tables an org_id column…
   Phase 8 should decide whether youth activity coordination is genuinely org-private; if so it
   needs an org_id migration first."* It is not genuinely org-private — FEATURES.md §Module 10
   and the phase plan both say ward council members view the **full** calendar. So **reads stay
   ward-wide and only writes are org-scoped**, which is the two-different-rules split the phase
   plan's Pitfalls section warns about, enforced in two different places so they cannot be
   confused. Events, attendees and logs inherit their org through the profile and get no column
   of their own. **Null means ward-wide**, the same absent-means-default idiom as
   `household_stewardships` and `household_visit_cadences`.

2. **`ical.js` will be installed** — in slice B, not this one. Recorded here so slice B does not
   have to re-ask. It reads the `VTIMEZONE` blocks the feed itself carries, so a `TZID` resolves
   from the file rather than from a bundled tzdata that goes stale, and it expands `RRULE`.
   **Do not add it to `package.json` in this slice.**

3. **Coverage is computed on read; both scheduled notifications are deferred to Phase 11.**
   `pg_cron` is not enabled on this project, `supabase/functions/` does not exist, and
   `vercel.json` declares no crons — three separate migrations and the `visits-c` retro record
   this. The house pattern is a pure function of the clock: `appointmentViewState()`,
   `goalStatus`, `householdVisitPriority()`. `youth_event_uncovered` and the Monday away-digest
   join `visit_overdue` as **Phase 11's** decision, which already owns exactly this problem.
   The consequence for slice A is small but real and lands in the migration: **`covered` and
   `uncovered` come out of `activity_events.status`**, because they are things the clock decides
   and a stored value the clock decides goes stale the moment nobody refreshes it.

4. **Slice A only.** See the table above.

### Success criteria

- A ward council member can create an activity profile for a youth, and the profile is stamped
  with their organization from the session — never from the request body.
- The same person can add an event to that profile by hand and see it on `/youth`.
- An org leader **cannot** create a profile owned by another organization, and is told so in a
  sentence rather than refused by a constraint violation.
- Everyone with `youth_activities.view` sees every profile in the ward, regardless of org.
- `/youth` stops being a 404. `NAVIGATION_ITEMS` has linked to it since `auth-a`.

---

## Relevant Files

### Create

- `supabase/migrations/054_youth_activity_scope.sql` — org scoping, column tightening, status
  narrowing, replacement write policies, two indexes.
- `lib/validation/youth.ts` — Zod schemas shared by routes and forms.
- `app/api/youth/profiles/route.ts` — `GET` list, `POST` create.
- `app/api/youth/profiles/[id]/route.ts` — `PATCH` update, `DELETE`.
- `app/api/youth/events/route.ts` — `GET` list, `POST` manual create.
- `app/api/youth/events/[id]/route.ts` — `PATCH` update, `DELETE`.
- `app/(app)/youth/page.tsx` — the module's landing page (Server Component).
- `app/(app)/youth/ActivityProfileList.tsx` — client list + create/edit modal.
- `app/(app)/youth/ActivityProfileForm.tsx` — client form, uses `MemberPicker`.
- `app/(app)/youth/ManualEventForm.tsx` — client form for one event.
- `app/(app)/youth/EventList.tsx` — client list of upcoming/past events.

### Modify

- `lib/youth/queries.ts` — **extend, do not rewrite.** `getActivityLog()` stays exactly as it
  is; slice D needs it. Add the profile and event data-access functions beneath it.
- `types/domain.ts` — narrow `EVENT_STATUSES`, add label maps and `ACTIVITY_TYPE_TONES`.
- `types/database.ts` — regenerate with `npm run db:types`. Never hand-edit.

### Do not touch

- `components/visits/ReportFeed.tsx`, `lib/reports/*` — slice D's business.
- `lib/visits/*` — slice C imports `cadence.ts` and `stewardshipScope.ts`; slice A needs neither.
- `supabase/migrations-pending/` — 054 is additive-with-tightening and applies immediately.
  There is nothing to hold back and **no `HELD_BACK_UNTIL_DEPLOYED` entry should be added.**

---

## Dependencies

- **No new libraries in this slice.** `ical.js` is approved but belongs to slice B.
- Existing utilities this slice must use rather than re-implement:
  - `assertCan` / `resolveRoleAccess` from `lib/auth/permissions.ts` — resolve **once per
    request into a local** and pass it down (CLAUDE.md rule 10).
  - `requireSessionUser` from `lib/auth/session.ts` — called **outside** the `try` block.
  - `readJsonBody` / `respondToRouteError` from `lib/auth/routeErrors.ts`.
  - `writeAuditLog` from `lib/audit/writeAuditLog.ts` — every mutation, no inline inserts.
  - `notifyOrgLeadership` from `lib/notifications/notifyOrgLeadership.ts` — for
    `youth_activity_added`, which is already seeded in
    `supabase/seed/notification_triggers.sql` line 48.
  - `MemberPicker` from `components/roster/MemberPicker.tsx` — **its interface is frozen.**
    Slice A needs only `filter.categories: ["youth"]` and `mode: "inline"`, both of which
    already exist. If something is missing, raise it; do not add a prop quietly.
  - `listWardOrganizations` from `lib/auth/adminUsers.ts` — to validate a bishopric-supplied
    `orgId` against the ward's live organizations.

---

## Known Pitfalls (from retro context)

- **`visits-d` / migration 047 — the composite `SET NULL` trap.** A bare
  `on delete set null` on a composite foreign key nulls **every** referencing column, `ward_id`
  included, and `ward_id` is `not null`, so the cascade raises and the parent row becomes
  **undeletable**. Migration 046 shipped this bug and 047 fixed it with PostgreSQL 15's column
  list. `054`'s `org_id` foreign key must be written
  `on delete set null (org_id)` — never a bare `on delete set null`.

- **`talks-d` / `visit-goals` — the null-org hole.** `org_id = current_org_id()` is `NULL`, not
  `true`, when both sides are null: SQL's `null = null` is not JavaScript's. A row written by a
  user with no organization under a policy of that shape is **invisible to its own author**.
  Slice A's write policies carry an explicit `org_id is null` branch for exactly this, and
  `ward_council_member` is the role most likely to have no `org_id` set — it is also the role
  the phase plan singles out as the widest.

- **`role-access-overrides`** — 25 of 62 permission checks once ignored the ward's
  `role_access` override. Never compare `user.role` to a string to decide access; go through
  `assertCan`. The one legitimate role comparison is *"is this person bishopric, so which org
  do they mean?"* — the `visit-goals` route does exactly that with `BISHOPRIC_ROLES` and is the
  pattern to copy.

- **`calendar-a` — select-list concatenation.** Column lists are **one string literal on one
  line**. A `+` concatenation widens the type to `string` and defeats supabase-js's literal
  parsing, silently degrading the row type to `any`-ish. `lib/youth/queries.ts` already states
  this rule in its header.

- **`visits-d` — a constant imported from a `"use client"` module reaches a Server Component
  as a function, not a string.** This killed the entire "Log this visit" flow. Shared constants
  (`ACTIVITY_TYPE_LABELS`, form limits) go in `types/domain.ts` or `lib/validation/youth.ts` —
  never exported from a component file that a page also imports.

- **`visits-b` / `visits-f` — one predicate, one place.** Two places deciding the same thing
  and disagreeing is worse than either being wrong. Slice A has one such rule: *"which member
  may an activity profile name?"* It lives in `lib/validation/youth.ts` and both the route and
  the `MemberPicker` filter derive from it.

- **`roster-b` — client-side filtering of a paginated list answers the wrong number.** Slice
  A's event list is small enough not to paginate; if it grows a filter, the filter is
  server-side.

- **`ai-b` — the "all 1 of its passages" plural bug the fixture's own design hid.** Any count
  rendered in a sentence needs a singular case, and a fixture with exactly one of everything
  cannot catch it. Seed the harness scenario with a youth who has **two** profiles and a
  profile with **one** event.

---

## Tasks

### Task 1: Migration 054 — org scope, tightened columns, narrowed status

**File:** `supabase/migrations/054_youth_activity_scope.sql` (create)

**Action:** One migration, five parts, each with a header comment saying *why* (the house style
— see 052 for the register to write in).

**Before writing it, verify the tables are empty.** Several steps add `NOT NULL` to existing
nullable columns, which fails on a populated table. Phase 8 has never run, so they should be
empty, but confirm with the service client rather than assuming:

```sql
select
  (select count(*) from youth_activity_profiles) as profiles,
  (select count(*) from activity_events)         as events,
  (select count(*) from activity_calendars)      as calendars;
```

If any row exists, **stop and report it** — a backfill is a different plan.

**054a — `org_id` on `youth_activity_profiles`.**

```sql
alter table youth_activity_profiles add column org_id uuid;

alter table youth_activity_profiles
  add constraint youth_activity_profiles_org_id_ward_id_fkey
    foreign key (org_id, ward_id) references organizations (id, ward_id)
    on delete set null (org_id);
```

The column list on `set null` is not optional — see Known Pitfalls. Releasing a leader or
dissolving an organization must not take the youth's basketball season with it; the profile
survives and becomes ward-wide.

Write the absent-means-default rule into the comment in the same terms 052 uses: **a null
`org_id` is a ward-wide profile, and there is no sentinel row meaning "everybody".**

**054b — tighten `youth_activity_profiles`.**

```sql
alter table youth_activity_profiles alter column member_id     set not null;
alter table youth_activity_profiles alter column activity_type set not null;
```

`member_id` nullable made a profile that names no youth representable; `activity_type` nullable
contradicted `ActivityType` in `types/domain.ts`, which is not a union with `null`. Both were
nullable in migration 009 only because Foundation B created every table before anything wrote
to them.

**054c — tighten `activity_events` and narrow its status.**

```sql
alter table activity_events alter column title      set not null;
alter table activity_events alter column event_date set not null;
alter table activity_events alter column event_type set not null;
alter table activity_events alter column event_type set default 'tbd';

alter table activity_events drop constraint activity_events_status_check;
alter table activity_events
  add constraint activity_events_status_check
    check (status in ('upcoming', 'cancelled', 'completed'));
```

Two things happen here and the comment must separate them:

- **`covered` and `uncovered` are removed** because the clock decides them, not a person.
  Slice C computes coverage from `(event_date, event_type, attendee count, now)` as a pure
  function, exactly as `appointmentViewState()` computes "missed". A stored coverage value goes
  stale the moment nobody refreshes it, and nothing in this project refreshes anything.
- **`cancelled` is added**, which is a small deviation from SPEC.md's four values and is
  deliberate. A cancelled game is a fact a person knows and nothing else can express; without
  it, the only way to take a cancelled game off the list is to delete the row, which loses the
  record that it was ever scheduled. `upcoming` and `completed` stay, but note in the comment
  that **slice C should revisit whether `completed` earns its place** — an event in the past is
  completed by the clock too, and the only reason to store it is if follow-up state turns out
  to need it.

`event_date` stays `timestamptz`, and that is correct rather than a violation of CLAUDE.md §6:
a Sunday is a date, but a game kicks off at four o'clock.

**054d — replace the generic write policies on `youth_activity_profiles`.**

Migration 019 generated four ward-wide policies for this table in a loop. Drop the three write
policies and write org-scoped replacements. **Leave `youth_activity_profiles_ward_select`
exactly as it is** — reads are ward-wide by product decision, and that contrast is the whole
point.

```sql
drop policy youth_activity_profiles_ward_insert on youth_activity_profiles;
drop policy youth_activity_profiles_ward_update on youth_activity_profiles;
drop policy youth_activity_profiles_ward_delete on youth_activity_profiles;

create policy youth_activity_profiles_insert on youth_activity_profiles
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id is null or org_id = current_org_id())
  );

create policy youth_activity_profiles_update on youth_activity_profiles
  for update to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or entered_by = auth.uid() or org_id = current_org_id())
  )
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id is null or org_id = current_org_id())
  );

create policy youth_activity_profiles_delete on youth_activity_profiles
  for delete to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or entered_by = auth.uid() or org_id = current_org_id())
  );
```

The `org_id is null` branch on the two `with check` clauses is the `talks-d` hole, closed. A
ward council member whose account has no organization writes a ward-wide profile and can still
see it; without that branch the row would be written and then invisible to the person who wrote
it. Say so in the comment, and name `talks-d`.

The `USING` clause on update and delete matches the phase plan's rule — *"Creator, bishopric,
or the youth's org leaders"* — with `entered_by = auth.uid()` carrying "creator". The `WITH
CHECK` deliberately omits `entered_by`: you may edit your own ward-wide profile, but you may
not move it into somebody else's organization.

**054e — indexes.** Follow the naming in `018_indexes.sql`.

```sql
create index youth_activity_profiles_member_idx on youth_activity_profiles (ward_id, member_id);
create index activity_events_date_idx           on activity_events (ward_id, event_date);
create index activity_events_profile_idx        on activity_events (ward_id, profile_id);
```

**Then:** `npm run db:push` and `npm run db:types`. Migration 054 is additive-with-tightening
on empty tables and applies before the code deploys, so it is **not** an expand-and-contract
slice and adds no `HELD_BACK_UNTIL_DEPLOYED` entry.

---

### Task 2: Domain types

**File:** `types/domain.ts` (modify)

**Action:** Narrow one const, add three.

- Narrow `EVENT_STATUSES` to `["upcoming", "cancelled", "completed"] as const` to match 054c.
  The compiler will point at anything that read the removed values; nothing should, since
  nothing reads them today.
- `ACTIVITY_TYPE_LABELS: Record<ActivityType, string>` — `sport: "Sport"`,
  `performance: "Performance"`, `academic: "Academic"`, `community: "Community"`,
  `other: "Other"`. A `Record`, not a lookup with a fallback, for the reason
  `ORGANIZATION_TYPE_LABELS` is one: a type added later must be given a label deliberately
  instead of silently rendering as the default.
- `EVENT_TYPE_LABELS: Record<EventType, string>` — `home: "Home"`, `away: "Away"`,
  `tbd: "Not yet known"`. **`tbd` spelled out**, because an initialism on a phone in a hurry
  reads as a bug, and slice C's whole point is that a `tbd` event is something a person must
  resolve.
- `EVENT_STATUS_LABELS: Record<EventStatus, string>`.
- `ACTIVITY_TYPE_TONES: Record<ActivityType, ContextTone>` — slice D's report tiles carry a
  context chip whose tone comes from the **activity type**, where a visit's comes from the
  organization type. `types/domain.ts` line 50 already anticipates this: *"the same scale labels
  organizations here and will label activity kinds in Phase 8."* Assign
  `sport: "teal"`, `performance: "violet"`, `academic: "blue"`, `community: "amber"`,
  `other: "slate"` — `other` shares slate with `bishopric` for the reason recorded there.

Adding it now rather than in slice D is deliberate: it is one line per value, it belongs beside
`ORGANIZATION_TYPE_TONES` where a reader will look for it, and slice D should not have to open
this file to add a tone map that slice A already knew the shape of.

---

### Task 3: Validation schemas

**File:** `lib/validation/youth.ts` (create)

**Action:** Zod schemas, used unchanged by both the route handlers and the forms.

Follow `lib/validation/visit.ts`: exported `MAX_*` length constants first, then schemas, each
with an inferred type exported beside it.

```ts
export const MAX_ACTIVITY_NAME = 120;
export const MAX_SCHOOL_ORG = 160;
export const MAX_SEASON_SCHEDULE = 120;
export const MAX_ACTIVITY_NOTES = 2000;
export const MAX_EVENT_TITLE = 200;
export const MAX_EVENT_LOCATION = 240;
```

- `createActivityProfileSchema` — `memberId` (uuid), `activityName` (trimmed, 1…`MAX_ACTIVITY_NAME`),
  `activityType` (`z.enum(ACTIVITY_TYPES)`), `schoolOrg`/`seasonSchedule`/`notes` optional and
  nullable, `orgId` optional uuid.
- `updateActivityProfileSchema` — the same fields, all optional, with a `.refine()` that at
  least one is present. Copy the shape of `updateVisitGoalSchema`, which already does this and
  words the failure as a sentence.
- `createActivityEventSchema` — `profileId` (uuid), `title`, `eventDate` (see below),
  `location` optional/nullable, `eventType` (`z.enum(EVENT_TYPES)`, default `"tbd"`).
- `updateActivityEventSchema` — optional fields plus `status` (`z.enum(EVENT_STATUSES)`),
  same `.refine()`.
- `listActivityEventsQuerySchema` — `profileId?`, `from?`, `to?`, `includePast?`.

**`eventDate` needs its own validator and a comment.** It is a `timestamptz`, and the whole of
slice B turns on getting instants right, so slice A must not establish a sloppy precedent.
Accept an ISO-8601 string that parses to a finite instant and **carries an explicit offset or
`Z`** — reject a bare `2026-09-04T16:00` with a sentence naming the problem. A manual-entry
form submits from the browser, so it has a zone available and should send one; accepting a
floating time here would mean slice B inherits a column whose existing rows already have the
ambiguity it exists to prevent.

Also export the single shared predicate the Known Pitfalls section names:

```ts
export const PROFILE_MEMBER_CATEGORIES = ["youth"] as const;
```

Both the route's validation and `ActivityProfileForm`'s `MemberPicker` filter read this, so
"which member may a profile name" has one answer in one place.

---

### Task 4: Data access

**File:** `lib/youth/queries.ts` (modify — extend beneath the existing function)

**Action:** Add profile and event functions. **Preserve `getActivityLog()` and the entire file
header verbatim** — the header states the rule that this module never selects from
`activity_private_notes` and never imports the module that will, and slice D depends on it.

Types to export, mapped snake_case → camelCase at this layer and nowhere else:

```ts
export type ActivityProfile = {
  id: string;
  memberId: string;
  memberName: string;        // from the embed, for display
  orgId: string | null;
  activityName: string;
  schoolOrg: string | null;
  activityType: ActivityType;
  seasonSchedule: string | null;
  notes: string | null;
  enteredBy: string | null;
  createdAt: string;
};

export type ActivityEvent = {
  id: string;
  profileId: string | null;
  calendarId: string | null;
  title: string;
  eventType: EventType;
  eventDate: string;
  location: string | null;
  status: EventStatus;
  createdAt: string;
};
```

Functions: `listActivityProfiles`, `getActivityProfile`, `createActivityProfile`,
`updateActivityProfile`, `deleteActivityProfile`, `listActivityEvents`, `getActivityEvent`,
`createActivityEvent`, `updateActivityEvent`, `deleteActivityEvent`.

Every one takes `(wardId, …, client?: SupabaseClient<Database>)` and falls back to
`createServerSupabaseClient()`, matching the existing function. Column lists are **one string
literal on one line** (`calendar-a`).

The member name comes from a **named** embed —
`members!youth_activity_profiles_member_id_ward_id_fkey (first_name, last_name)` — not an
inferred one. `visits-d`'s release note records why: an inferred embed silently changes meaning
the next time somebody adds a second foreign key to the same table, and slice B is about to add
`activity_calendars` relationships nearby.

On error: `console.error` with context, then `throw new Error` with a sentence a person can act
on. Never `catch {}` (CLAUDE.md rule 7).

---

### Task 5: Profile routes

**Files:** `app/api/youth/profiles/route.ts`, `app/api/youth/profiles/[id]/route.ts` (create)

**Action:** Model these on `app/api/visit-goals/route.ts` — it is the closest analogue in the
codebase and solves the same org-ownership problem. Read it before writing.

**`GET /api/youth/profiles`** — `assertCan(user, "youth_activities.view", roleAccess)`. Returns
every profile in the ward; no org filter, deliberately, and a comment saying so with the
FEATURES.md §Module 10 reference. No audit row — this is a read.

**`POST /api/youth/profiles`** — `assertCan(user, "youth_activities.manage", roleAccess)`.

Ownership is stamped **from the session, never from the body**, and the three cases mirror
`visit-goals` exactly:

- **Bishopric author** — may create for any organization, so `orgId` is honoured if supplied and
  validated against `listWardOrganizations()`. An id not in the ward gets a 404 with a sentence,
  not a foreign-key violation. `orgId` omitted means a ward-wide profile.
- **Non-bishopric author supplying a different `orgId`** — **403, refused rather than ignored.**
  Silently overwriting it would let a leader believe they had just entered an activity for the
  Young Women.
- **Non-bishopric author with `user.orgId === null`** — this is where slice A **departs** from
  `visit-goals`, and the departure needs a comment. `visit-goals` returns 409 because a goal
  with no org is invisible to its author. A profile with no org is **ward-wide and visible to
  everyone**, which is a legitimate state that policy 054d explicitly permits. So: write it with
  `org_id = null` and do not refuse. `ward_council_member` is the role that will hit this most
  often and it is the role the phase plan calls the widest in the app.

Then `writeAuditLog({ action: "youth_activity_profile_created", module: "youth_activities", … })`
and `notifyOrgLeadership` for `youth_activity_added` — the trigger is already seeded with
`org_president`, `org_counselor`, `org_secretary` as its default roles. **A ward-wide profile
has no org leadership to notify**; skip the emit rather than calling it with a null `orgId`, and
say why in one line.

**`PATCH /api/youth/profiles/[id]`** — `params` is a **Promise** in Next 16:
`PATCH(request, { params: Promise.resolve({ id }) })`. Permission is
`youth_activities.manage`; *which* profiles is decided by policy 054d, not by a branch here
(CLAUDE.md rule 2). Audit row on success.

**`DELETE /api/youth/profiles/[id]`** — same permission. Cascades to the profile's events, which
is correct: the events have no meaning without the activity. Audit row.

**Every handler:** `requireSessionUser()` outside the `try`, `resolveRoleAccess` once into a
local, `respondToRouteError` in the `catch` with `route`, `fallbackMessage` and `detail`.

---

### Task 6: Event routes

**Files:** `app/api/youth/events/route.ts`, `app/api/youth/events/[id]/route.ts` (create)

**Action:** Same skeleton, simpler ownership — `activity_events` keeps migration 019's ward-wide
policies and gets no org column, because an event inherits its org through its profile.

**`GET /api/youth/events`** — `youth_activities.view`, query validated with
`listActivityEventsQuerySchema`. Default to **upcoming events only**, ordered by `event_date`
ascending; `includePast=true` widens it. A module whose landing page opens on last season's
games is a module nobody uses twice.

**`POST /api/youth/events`** — `youth_activities.manage`. Verify the `profileId` resolves to a
profile in this ward through `getActivityProfile()` and return 404 with a sentence if not; the
composite foreign key would otherwise answer with a constraint violation nobody can act on.
Sets `calendar_id = null` — a hand-entered event belongs to no calendar, and slice B's
idempotent re-import must never match against one.

**`PATCH /api/youth/events/[id]`**, **`DELETE /api/youth/events/[id]`** — `youth_activities.manage`,
audit rows, `params` awaited.

No notification on an event: the phase plan lists `youth_activity_added` against the profile,
and one notification per game would be the digest-spam pitfall arriving early.

---

### Task 7: The `/youth` page

**Files:** `app/(app)/youth/page.tsx` and its four client components (create)

**Action:** A Server Component page that resolves the session, calls
`assertCan(user, "youth_activities.view", roleAccess)`, reads profiles and upcoming events
through `lib/youth/queries.ts`, and passes them to client components.

**Naming caution worth stating in the page header:** `app/(youth)/` already exists and is the
**sacrament manager's PIN-only shell** — a different feature for a different kind of account.
This page lives at `app/(app)/youth/`. The URLs do not collide (`/youth` versus `/sacrament`)
but the directory names read as if they should, and a future reader will assume they are
related. One comment prevents that.

- **`ActivityProfileList.tsx`** — grouped by youth, since the phase plan's first line is that a
  youth can have several. Each card: activity name, type badge, school/org, season. Empty state
  is a sentence about what the page is for, not a blank panel.
- **`ActivityProfileForm.tsx`** — `MemberPicker` with
  `filter={{ categories: PROFILE_MEMBER_CATEGORIES }}` and `mode="inline"`, plus the activity
  fields. For a bishopric user, an organization select; for everyone else, no control at all —
  their organization is not theirs to choose, and a disabled select showing it invites the
  question of why it is disabled.
- **`ManualEventForm.tsx`** — profile select, title, date-and-time, location, home/away/tbd.
  The datetime input must submit an **offset-bearing ISO string**; build it from the
  `datetime-local` value plus the browser's zone rather than posting the raw value, which is
  floating. This is the client half of Task 3's validator and the two must agree.
- **`EventList.tsx`** — date, title, youth's name, type badge. Cards on mobile.

All four are `"use client"` with TanStack Query mutations that invalidate on success. **Every
filter or view state is its own cache key** — `visits-c` found a bookmark made under one filter
invisible under another until reload, and `program-b` found a cache write racing a refetch
already in flight. Invalidate; do not write into the cache by hand.

375px width and both themes, per the phase Definition of Done. Reuse `components/ui`
primitives; add none.

---

## Testing Strategy

Per CLAUDE.md §8 priority order. Slice A owns two of the phase's eight named tests
(`ward-council-access.test.ts` in part, and none of the ICS three); the rest belong to later
slices and should not be stubbed here.

### `tests/rls/youth-activity-scope.test.ts` (create) — highest value

Seed with the service client, assert with authenticated anon clients, clean up in `afterAll`.
The suite runs over the network against the shared hosted project, so it cannot assume an empty
table (CLAUDE.md §9).

- A user in ward A cannot read or write ward B's profiles or events.
- **Reads are ward-wide across organizations:** an Elders Quorum leader reads a profile owned by
  the Young Women. This is the assertion that proves the read/write asymmetry is real and not an
  accident of the seed.
- An org leader **cannot insert** a profile with another organization's `org_id`.
- An org leader **can** insert one with `org_id = null`.
- **A user with `org_id = null` can insert a ward-wide profile and then read it back.** This is
  the `talks-d` hole; without this case the bug ships silently, because the INSERT succeeds and
  only the subsequent read is empty.
- Bishopric can insert for any organization.
- **Assert a refused UPDATE or DELETE by re-reading the row with the service client.** An
  RLS-denied update is a zero-row success, not an error — only INSERT raises.

### `tests/routes/youthProfiles.test.ts` (create)

Use `tests/helpers/routeClient.ts`; read its header first for the `vi.mock` hoisting trap.
Seed exactly like an RLS suite.

- `POST` as `org_president` stamps `org_id` from the session and **ignores a body `orgId` that
  matches**, 403s on one that does not.
- `POST` as `ward_council_member` with no `org_id` returns 201 and writes a null org — the case
  that departs from `visit-goals`.
- `POST` as `bishop` with an `orgId` from another ward returns 404, not a constraint violation.
- `GET` as `org_secretary` returns profiles from every organization. **Check the fixture's real
  permissions before asserting anything:** `org_secretary` holds `youth_activities.view` and
  `.log` but **not** `.manage`, so it is the right role for a read-allowed/write-denied pair,
  and `music_coordinator` holds none of the three.
- `PATCH` with `params: Promise.resolve({ id })`.
- Every mutation writes an audit row.

### `tests/routes/youthEvents.test.ts` (create)

- A `profileId` from another ward returns 404 with a message.
- A floating `eventDate` (no offset, no `Z`) is rejected with the sentence, not silently stored.
- `GET` defaults to upcoming and widens with `includePast`.

### `tests/lib/youthValidation.test.ts` (create) — pure, no database

- Every `MAX_*` boundary, one under and one over.
- The `eventDate` validator across all three forms it will meet in slice B: offset-bearing
  (accept), `Z` (accept), floating (reject). **Writing the rejection case now is what makes
  slice B's `ics-timezone.test.ts` an extension rather than a rewrite.**
- The `.refine()` on both update schemas rejects an empty object.

### `tests/db/migrations.test.ts` — no change

054 applies immediately. Confirm the suite passes rather than editing it; a new
`HELD_BACK_UNTIL_DEPLOYED` entry here would be wrong.

---

## Test Scenarios (Harness)

Existing scenarios run to 048. Slice A adds two, in a new `testing/scenarios/youth/` directory.

### Scenario 049: Entering an activity for a youth who is not yours

**Tags:** `youth`, `full`, `permissions`, `org-scope`

**Purpose:** The read/write asymmetry is the one decision in this slice that cannot be seen from
a single account — it needs three people logged in at different times, which is exactly what
seeding is for. It also covers the phase plan's "ward council member scope confusion" pitfall,
which it describes as two different rules that must both be checked.

**Seed data summary:**
- `users` — 4 — a bishop; an Elders Quorum president (`org_id` set); a Young Women president
  (`org_id` set); a ward council member with **`org_id` deliberately null**.
- `members` — 3 youth across 2 households, one male and two female, all `active`.
- `youth_activity_profiles` — 3 — one owned by Young Women, one owned by Elders Quorum, one
  **ward-wide** (`org_id` null) entered by the ward council member. One youth has **two**
  profiles, so the list's grouping and its plural wording both have something to be wrong about.
- `activity_events` — 4 — three upcoming across the profiles, one in the past.

**Tester action:** Sign in as each of the four in turn. From each account: open `/youth`, note
which profiles are listed, then try to edit one belonging to another organization. As the
bishop, create a profile and choose an organization from the select. As the ward council member,
create one and confirm no organization control appears.

**Verification checklist:**
- [ ] All four accounts see **all three** profiles on `/youth`.
- [ ] The Elders Quorum president cannot edit the Young Women's profile, and is told why in a
      sentence — not shown a control that fails.
- [ ] The ward council member creates a profile successfully **and it appears in their own list
      immediately** (the `talks-d` hole, seen from the outside).
- [ ] The bishop sees an organization select; nobody else does.
- [ ] The youth with two profiles renders as one person with two activities, not twice.
- [ ] A count rendered anywhere reads correctly at **one** as well as at three.
- [ ] Works at 375px in both light and dark mode.

### Scenario 050: A game added by hand, at the right time of day

**Tags:** `youth`, `smoke`, `timezones`

**Purpose:** Manual entry is the path that must work before any import exists, and the hour a
game shows at is the thing slice B is most likely to break. Establishing the correct instant now,
by hand, gives slice B something to compare against. The phase plan is blunt: *"A game showing
at the wrong hour makes the whole feature useless."*

**Seed data summary:**
- `users` — 1 — an org president.
- `members` — 1 youth; `youth_activity_profiles` — 1 with no events.

**Tester action:** Add an event at a distinctive time — 7:30pm on a specific date. Reload the
page. Check the row in Supabase directly. Then change the ward's timezone setting and reload.

**Verification checklist:**
- [ ] The event lists at 7:30pm after a reload, not shifted by an hour or by a zone.
- [ ] The stored `event_date` is an instant with an offset, and converting it back to the ward's
      zone gives 7:30pm.
- [ ] An event created near a DST boundary still reads correctly.
- [ ] Editing the time and saving does not shift it a second time — **the double-conversion bug,
      which only appears on the second write.**
- [ ] A cancelled event stays visible and marked, rather than disappearing.

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Run all four. `program-d` recorded a `revalidatePath` throw that only a real build surfaced, and
static generation runs code the dev server never does.

Database steps, in order, **before** the test run:

```bash
npm run db:push
npm run db:types
```

To run just this slice's suites while iterating:

```bash
npx vitest run tests/rls/youth-activity-scope.test.ts tests/routes/youthProfiles.test.ts tests/routes/youthEvents.test.ts tests/lib/youthValidation.test.ts
```

Note `tests/rls/realtime-isolation.test.ts` is known to be flaky under load on this two-core
machine (`visits-c`). If it fails during a full run, re-run it alone before treating it as a
regression — nothing in this slice touches realtime.

---

## Integration Notes

- **`/youth` is already in the navigation.** `lib/auth/navigation.ts` line 36 has linked
  `youth_activities.view` holders at `/youth` since `auth-a`, and the page has never existed —
  so today four roles have a nav item that 404s. Slice A fixes a live defect as a side effect;
  **no change to `navigation.ts` is needed**, and adding one would be wrong.

- **`lib/youth/queries.ts` grows; it does not get rewritten.** `getActivityLog()` was written
  during `visits-c` so the generic read-status route's claim to work for `youth_activity` was a
  fact rather than a promise. It stays, along with the header explaining why this module never
  reads `activity_private_notes`.

- **What slice A hands forward:**
  - *Slice B* gets a validated instant format it must match, a `calendar_id` that is null on
    every hand-entered row, and an approved `ical.js`.
  - *Slice C* gets `EVENT_TYPES` and a `tbd` default on every event, and should import
    `lib/visits/cadence.ts` and `lib/visits/stewardshipScope.ts` rather than re-deriving them —
    both were written subject-agnostic (`subjectId`, `lastCompletedOn`) for exactly this
    (CLAUDE.md §9, plans/INDEX.md). It also inherits the open question of whether `completed`
    still earns its place in `activity_events.status`.
  - *Slice D* gets `ACTIVITY_TYPE_TONES` and maps `activity_logs.logged_by` to
    **`recordedByLabel`**, leaving `authorLabel` null — `lib/reports/types.ts` states this at
    length and it is not negotiable: that table has no participants, so mapping the recorder to
    "who went" would put two different facts under one label.

- **Two Phase 11 items get one more entry each.** `youth_event_uncovered` and the Monday digest
  now sit beside `visit_overdue` and `refresh_goal_status()` as things that are computable and
  fire from nothing. That is four. Phase 11 should decide the mechanism once, for all of them.

- **Documentation to update when the slice lands:**
  - `plans/INDEX.md` — Phase 8 row, marking slice A shipped.
  - `plans/retros/INDEX.md` — a `youth-a-profiles-and-events` entry with its commit.
  - `CLAUDE.md` §9 — add the org-scoping decision (reads ward-wide, writes org-scoped, null
    means ward-wide) and the coverage-computed-on-read decision. Both are the kind of
    "do not re-propose this" entry that section exists to hold.
  - `SPEC.md` — the `activity_events.status` values changed and `youth_activity_profiles` gained
    a column. The specs win over the code, so when the code is deliberately different, the spec
    is what moves.
