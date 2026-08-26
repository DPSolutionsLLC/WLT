# Plan: Visits D — Attempts, Appointments and Who Actually Went

**Created:** 2026-08-25
**Type:** feature
**Structure:** Sequential — plan 4 of 4 for Phase 7 ([07-visits.md](07-visits.md) §Step 7)
**Depends on:** `visits-a` (built). **Build this BEFORE `visits-b`** — see §Ordering.

---

## Ordering — this plan moved ahead of `visits-b`

Phase 7's execution table originally ran `a → b → c`. Step 7 was added on 2026-08-25 during the
`visits-a` walkthrough, and it changes **what a visit is**: a row in `visit_logs` may now record an
attempt rather than a visit, and the person who went is no longer the person who typed it in.

`visits-b` computes the progress denominator and a per-household status over exactly those two
facts. Built first, it would be written against a data model that this slice then invalidates —
its `householdStatus()` would have no notion of an attempt, and its `loggedBy` column would be
showing the recorder while claiming to show the visitor.

So the order is now **`a` → `d` → `b` → `c`**. `visits-c` is unaffected except for one field
mapping (§Integration Notes).

---

## Overview

Record what actually happened on a visit and who was actually there: an attempt as distinct from a
completed visit, an arranged appointment as distinct from a call-in, appointments scheduled before
they happen, up to five companions per visit, and a hard separation between the person who
conducted a visit and the person who recorded it.

### Key requirements

1. **Logging an attempt is one action, not a workaround.** A leader who knocked and got no answer
   records that in the same form, with one control changed.
2. **Appointment or drop-in** is captured on every visit.
3. **Appointments made ahead of time** are tracked before they happen, and a completed visit can
   say which appointment it kept.
4. **Who went** — the recorder is a participant by default, may remove themselves, and may add up
   to five companions.
5. **Every visit names both roles** — conducted by, and recorded by — because they are frequently
   different people.

### Success criteria

- An attempted visit never counts toward a goal's progress and is always visible on the record.
- `visit_logs.recorded_by` is stamped from the session on every write and can never be supplied by
  a request body.
- A visit with no participants at all is representable (the recorder removed themselves and added
  nobody) and reads as "not recorded" rather than as the recorder having gone.
- A sixth companion is refused with a sentence.
- An EQ leader cannot read the participants of an RS visit with cross-org visibility off, and
  cannot write one in either mode.
- `npm run lint`, `typecheck`, `harness:typecheck`, `test` and `build` all pass.

---

## Confirmed decisions

Settled with the user on 2026-08-25 before planning. Do not re-litigate; record any change as a
deviation.

### 1. An attempt is shown but never counted

The progress number counts `outcome = 'completed'` only. Attempts appear on the dashboard as their
own state, so a household nobody can catch at home is visible rather than invisible.

> This is `visits-b`'s rule as much as this slice's. `visits-b` §Task 1 must treat an attempt as
> **not a visit** for `lastVisitedOn` and `visitCountThisPeriod`, and surface it separately.

### 2. A participant is a user, OR a member, OR a typed name — exactly one

**`users` and `members` are not linked in this schema.** There is no `users.member_id`; a leader
and their own member record are two unrelated rows. That was verified against
`supabase/migrations/002_core.sql` and every migration after it.

So a participants table keyed only to `users` cannot record a spouse, and one keyed only to
`members` cannot record the recording leader. The row carries all three columns and a CHECK
enforcing that exactly one is set.

> **Worth raising later, not here.** Linking `users` to `members` would collapse this into one
> column and would help several other features. It is a schema decision affecting Phases 1, 2 and
> 10, and it is not this slice's to take.

### 3. A scheduled appointment is not a visit log

`visit_logs` means "a thing that happened" — `createVisitLogSchema` refuses a future date for that
reason, and `visits-b` counts those rows as progress. Appointments live in their own table where
future timestamps are the normal case, and a completed visit optionally points back at the
appointment it kept.

### 4. `scheduled_for` is `timestamptz`, not `date`

Every other date in this app is date-only, and CLAUDE.md §6 says so — but it also says
`timestamptz` for **events**, and an appointment is an event with a time. "Tuesday at 7" is the
whole point of arranging one. The ward's timezone is already in `wards.settings.timezone`.

### 5. "Missed" is computed, never stored

`visit_appointments.status` holds only what a human did: `scheduled`, `kept`, `cancelled`. A missed
appointment is `status = 'scheduled'` with `scheduled_for` in the past, computed on read.

This follows the `goals.status` precedent (04-talks-pipeline.md §Step 9, and
`lib/goals/goalStatus.ts`): a stored status that time invalidates goes stale the moment nobody
writes to it, and this project has **no `pg_cron` and no triggers** to keep it fresh.

### 6. The five-companion limit is enforced by the route, not the database

A CHECK constraint cannot count rows in another table, and this repo deliberately has no triggers
(migration 027 Part 3, recorded in `talks-d`). The limit lives in the Zod schema and the route.

The precedent to copy is `sunday_org_conducting`: `tests/routes/org-conducting.test.ts` opens by
explaining that the database holds no equivalent rule, that the route is the only thing keeping
it, and that the refusal is therefore asserted **and** proven by re-reading the table. Do the same
here.

---

## What already exists (do not rebuild)

| Thing | Where | State |
|---|---|---|
| `visit_logs`, `visit_goals`, `visit_private_notes` | [008_visits.sql](../supabase/migrations/008_visits.sql) | Complete |
| `visit_logs.visit_type` + CHECK | [044](../supabase/migrations/044_visit_log_type_and_private_note_upsert.sql) | Complete |
| Org-scoped RLS with a cross-org READ branch on `visit_logs` | [019_rls.sql](../supabase/migrations/019_rls.sql) L358–400 | Complete — copy this shape |
| `ward_allows_cross_org_visibility()` | 019_rls.sql L90 | Complete |
| `lib/visits/queries.ts`, `lib/validation/visit.ts`, the five routes | `visits-a` | Complete — this slice edits them |
| `/visits` page, `VisitLogForm`, `VisitGoalPanel` | `visits-a` | Complete — this slice edits them |
| `visits.view` / `visits.create` / `visits.manage_goals` | [permissions.ts](../lib/auth/permissions.ts) | Complete — **no new permission** |
| Route-test helper | [routeClient.ts](../tests/helpers/routeClient.ts) | Complete |

**No new permission is introduced.** Booking an appointment and logging a visit are the same
authority: `visits.create`.

---

## Relevant Files

### Create

- `supabase/migrations/046_visit_attempts_appointments_participants.sql` — the additive half.
- `supabase/migrations/047_drop_visit_logs_visited_by.sql` — the contract half. **Applied after the
  code deploy**, see §Task 2.
- `lib/visits/participants.ts` — participant reads and writes, and the display-label resolution.
- `lib/visits/appointments.ts` — appointment reads and writes, plus the computed `missed` state.
- `app/api/visit-appointments/route.ts` — GET, POST.
- `app/api/visit-appointments/[id]/route.ts` — PATCH (keep, cancel, reschedule).
- `app/(app)/visits/VisitParticipantsField.tsx` — `"use client"`. The who-went picker.
- `app/(app)/visits/AppointmentPanel.tsx` — `"use client"`. Upcoming appointments and booking.
- `tests/lib/visitParticipants.test.ts`
- `tests/lib/appointmentStatus.test.ts`
- `tests/rls/visit-participants.test.ts`
- `tests/routes/visitAppointments.test.ts`
- `tests/routes/visitParticipants.test.ts`
- `testing/scenarios/visits/scenario-043-who-actually-went/`
- `testing/scenarios/visits/scenario-044-appointments-and-attempts/`

### Modify

- `types/domain.ts` — `VisitOutcome`, `VisitArrangement`, `AppointmentStatus`, label maps.
- `types/database.ts` — regenerate with `npm run db:types`. Do not hand-edit.
- `lib/validation/visit.ts` — `outcome`, `arrangement`, `participants`, appointment schemas.
- `lib/visits/queries.ts` — `recorded_by` replaces `visited_by`; participants join; no
  `visit_private_notes`, still and always.
- `app/api/visits/route.ts` — stamp `recorded_by`; accept participants and the appointment link.
- `app/api/visits/[id]/route.ts` — allow editing participants and outcome.
- `app/(app)/visits/VisitLogForm.tsx` — outcome control, arrangement control, participants field.
- `app/(app)/visits/page.tsx` — render both roles and the outcome; mount `AppointmentPanel`.
- `testing/infrastructure/seedUtils.ts` — builders for participants and appointments; extend
  `createVisitLog`.
- `testing/infrastructure/types.ts` — re-export the new domain types.
- `plans/07-visits.md` — mark `visits-d` built; update the Step 7 sketch to match what shipped.
- `plans/visits-b-progress-dashboard.md` — §Task 1 and §Task 2 must exclude attempts; the
  `loggedBy` column becomes `conductedBy`. **Edit the plan, do not leave it to be discovered.**
- `plans/visits-c-report-feed-and-cross-org.md` — the `visited_by → authorLabel` row in its
  mapping table is now `conducted by`, with the recorder secondary.

**Not modified:** `lib/visits/privateNotes.ts`, `lib/visits/flagNotification.ts`,
`lib/auth/permissions.ts`, `lib/auth/navigation.ts`.

---

## Dependencies

No new libraries. Everything needed is in the repo:

- `assertCan()`, `resolveRoleAccess()` — `lib/auth/permissions.ts`.
- `requireSessionUser()`, `readJsonBody()`, `respondToRouteError()`.
- `writeAuditLog()` — `lib/audit/writeAuditLog.ts`.
- `formatDateOnly` / `parseDateOnly` — `lib/calendar/dates.ts`.
- `listMembers()` — `lib/roster/queries.ts`, for the member half of the participant picker.
- `MemberPicker` — `components/roster/MemberPicker.tsx`. **Read `roster-b`'s retro before using
  it**; it is a frozen controlled component and re-deriving its state is the documented bug.
- `tests/helpers/routeClient.ts` — `actAs`, `jsonRequest`, `readResponse`.

---

## Known Pitfalls (from retro context)

- **[visits-a]** — **A household with no active members must never be offered or counted.**
  `listHouseholds()` filters the members it ATTACHES, not the households it RETURNS, so a
  moved-out household comes back with `members: []`. `app/(app)/visits/page.tsx` filters on
  `members.length > 0`. Any new picker in this slice does the same. Found by walking scenario 038.
- **[visits-a]** — **The private-notes boundary is unchanged and must stay unchanged.** No module
  this slice creates may import `lib/visits/privateNotes.ts`. A participant is not entitled to
  another participant's private note, and neither is the recorder.
- **[talks-d]** — **Dropping a policy is not replacing one.** PostgreSQL ORs permissive policies
  together. Migration 046 adds policies for NEW tables only and touches none of 019's.
- **[talks-d]** — **`org_id = current_org_id()` is never true when both are null.** Every new table
  carries `org_id` stamped from the session, and a non-bishopric author with no org is refused
  rather than written into the hole.
- **[talks-d]** — **`asOf` is a parameter, never `new Date()` inside the function.** The computed
  `missed` state in `appointments.ts` takes the clock as an argument, or it cannot be tested at its
  boundaries.
- **[talks-d]** — **Migration and scenario numbers collide.** 046/047 and 043/044 are free as of
  2026-08-25. Check `supabase/migrations/` and `testing/scenarios/manifest.json` before writing.
- **[route-tests-and-realtime]** — **`vi.mock` is hoisted above every import.** Read the header of
  `tests/helpers/routeClient.ts` first.
- **[route-tests-and-realtime]** — **Assert a refused write by RE-READING the row.** An RLS-denied
  UPDATE or DELETE is a zero-row success; only INSERT raises.
- **[route-tests-and-realtime]** — **Order any query you then index into.**
- **[roster-b]** — **A query param the handler does not read is silently ignored.** Parse every new
  filter with Zod using exactly the names the client sends.
- **[roster-a]** — `DEFAULT_MEMBER_STATUSES` is `["active"]`. The member half of the participant
  picker uses the default; do not opt into `moved_out`.
- **[role-access-overrides]** — Gate on `assertCan(user, "visits.create", roleAccess)`. Never
  compare `user.role` to a string.

---

## Tasks

### Task 1: Migration 046 — the additive half

**File:** `supabase/migrations/046_visit_attempts_appointments_participants.sql` (create)

**Action:** Add the columns and tables, backfill, and add RLS for the new tables only.

**Details:**

```sql
-- Part 1: what happened, and how it was arranged.
alter table visit_logs
  add column outcome text not null default 'completed'
    check (outcome in ('completed', 'attempted')),
  add column arrangement text not null default 'drop_in'
    check (arrangement in ('appointment', 'drop_in')),
  add column recorded_by uuid,
  add constraint visit_logs_recorded_by_fkey
    foreign key (recorded_by, ward_id) references users (id, ward_id);

-- Every existing row was recorded by the person it credits as the visitor, because visits-a had
-- only one column for both. Backfill preserves that reading before the column is retired.
update visit_logs set recorded_by = visited_by where recorded_by is null;
```

- `outcome` defaults to `completed` so every existing row keeps its meaning. `arrangement` defaults
  to `drop_in` — the honest default, since no existing row recorded an arrangement and claiming
  they were all appointments would be an invention.
- **Add no policy to `visit_logs` and drop none.** 019's four policies already cover the new
  columns; RLS grants rows, not columns.

```sql
-- Part 2: appointments. A separate table because these have NOT happened yet, and visit_logs
-- means "a thing that happened" (see §Confirmed decision 3).
create table visit_appointments (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,
  org_id        uuid,
  household_id  uuid,
  -- timestamptz, not date: an appointment is an event with a time (CLAUDE.md §6).
  scheduled_for timestamptz not null,
  -- Only what a human did. "Missed" is computed on read (§Confirmed decision 5).
  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'kept', 'cancelled')),
  visit_log_id  uuid,
  made_by       uuid,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (org_id, ward_id) references organizations (id, ward_id),
  foreign key (household_id, ward_id) references households (id, ward_id),
  foreign key (visit_log_id, ward_id) references visit_logs (id, ward_id) on delete set null,
  foreign key (made_by, ward_id) references users (id, ward_id)
);
```

- `on delete set null` on `visit_log_id`: deleting a visit must not delete the record that an
  appointment was made.

```sql
-- Part 3: who actually went.
create table visit_participants (
  id           uuid primary key default gen_random_uuid(),
  ward_id      uuid not null references wards (id) on delete cascade,
  -- Denormalized from the parent so the policy below can be the SAME SHAPE as visit_logs'
  -- rather than an EXISTS subquery on every row. Safe because a visit log's org_id is not
  -- patchable — app/api/visits/[id]/route.ts accepts no org change, by design.
  org_id       uuid,
  visit_log_id uuid not null,
  -- EXACTLY ONE of the three. users and members are unlinked in this schema (§Decision 2), so
  -- no single foreign key can name every real companion.
  user_id      uuid,
  member_id    uuid,
  label        text,
  created_at   timestamptz not null default now(),
  constraint visit_participants_one_identity check (
    (user_id is not null)::int + (member_id is not null)::int
      + (nullif(btrim(coalesce(label, '')), '') is not null)::int = 1
  ),
  foreign key (org_id, ward_id) references organizations (id, ward_id),
  foreign key (visit_log_id, ward_id) references visit_logs (id, ward_id) on delete cascade,
  foreign key (user_id, ward_id) references users (id, ward_id),
  foreign key (member_id, ward_id) references members (id, ward_id)
);

-- The same person is not on the same visit twice. Two partial unique indexes rather than one
-- constraint, because a NULL never equals a NULL and a plain unique would allow duplicates.
create unique index visit_participants_one_user_per_visit
  on visit_participants (visit_log_id, user_id) where user_id is not null;
create unique index visit_participants_one_member_per_visit
  on visit_participants (visit_log_id, member_id) where member_id is not null;

create index visit_participants_visit_log_idx on visit_participants (visit_log_id);
create index visit_appointments_household_idx
  on visit_appointments (ward_id, household_id, scheduled_for desc);
```

- **No unique index on `label`.** Two people can genuinely be "a neighbour".

**RLS for the two new tables — copy `visit_logs`' shape exactly, including the cross-org READ
branch and its absence from every write:**

```sql
alter table visit_appointments enable row level security;
alter table visit_participants enable row level security;

-- SELECT: bishopric, own org, or any org when the ward allows cross-org visibility.
-- INSERT/UPDATE/DELETE: bishopric or own org. NEVER the cross-org branch — visibility widens
-- reads only, in this slice exactly as in visits-a.
```

- Write the eight policies out per table rather than in a `do $$` loop. The loops in 019 exist
  because a dozen tables shared one shape; two tables sharing a shape read more clearly written
  out, and a reviewer can see the missing cross-org branch on the write policies.
- **`visit_participants` must NOT go in 019's ward-wide loop** — `member_organizations` is in that
  loop, and copying it here would let an EQ leader read who visited an RS household.

Apply with `npm run db:push`, then `npm run db:types`.

### Task 2: Migration 047 — retire `visited_by`

**File:** `supabase/migrations/047_drop_visit_logs_visited_by.sql` (create)

**Action:** Drop `visit_logs.visited_by` once nothing reads it.

**Details:**

```sql
alter table visit_logs drop column visited_by;
```

**This migration is applied LAST, after the code from Tasks 3–10 is deployed.** Expand and
contract: migration 046 adds `recorded_by` and backfills it, the application stops reading
`visited_by`, and only then does the column go. Applying both migrations before the deploy would
leave the running app selecting a column that no longer exists, and every visit query would 500
until the deploy landed.

- Two columns meaning "who" is exactly the two-sources-of-truth problem this codebase keeps
  refusing elsewhere, so it does not survive the slice — but it survives until the deploy.
- Do not skip 047. A column nobody reads is the next person's trap.

### Task 3: Domain types

**File:** `types/domain.ts` (modify)

**Details:**

- `VISIT_OUTCOMES = ["completed", "attempted"]`, `VISIT_ARRANGEMENTS = ["appointment", "drop_in"]`,
  `APPOINTMENT_STATUSES = ["scheduled", "kept", "cancelled"]`, each with its type.
- `VISIT_OUTCOME_LABELS`, `VISIT_ARRANGEMENT_LABELS`, `APPOINTMENT_STATUS_LABELS` as `Record`s,
  following the `ROLE_LABELS` precedent — a value added to the tuple must not silently render as
  its own raw column value.
- `APPOINTMENT_VIEW_STATES = ["scheduled", "kept", "cancelled", "missed"]` — the COMPUTED set,
  named apart from the stored set so nobody writes `missed` to the column.
- **Check for an existing declaration before adding.** `VISIT_TARGET_TYPES` and `VISIT_CADENCES`
  were already in this file when `visits-a` added its types, and the duplicate was only caught by
  `tsc`.

### Task 4: Validation schemas

**File:** `lib/validation/visit.ts` (modify)

**Details:**

- `MAX_VISIT_COMPANIONS = 5`.
- `visitParticipantSchema` — a discriminated union on `kind`: `{kind: "user", userId}`,
  `{kind: "member", memberId}`, `{kind: "label", label}` with the label trimmed and non-empty.
  A union by SHAPE means a row with two identities is unrepresentable at the boundary, matching
  the CHECK rather than restating it.
- `participantsSchema` — `z.array(visitParticipantSchema).max(MAX_VISIT_COMPANIONS + 1)`.
  **The cap is companions PLUS the recorder**, so a leader who keeps themselves on the list may
  still add five. Say so in a comment; off-by-one here is the obvious bug.
  Refine for duplicates: the same `userId` or `memberId` twice is refused.
- `createVisitLogSchema` — add `outcome`, `arrangement`, optional `participants`, optional
  `appointmentId`. **No `recordedBy` field, ever** — the route stamps it.
- `updateVisitLogSchema` — add `outcome`, `arrangement`, `participants`.
- `createAppointmentSchema` — `householdId`, `scheduledFor` (ISO datetime), optional `notes`.
  **A future date is allowed and a past one is not refused** — an appointment recorded after the
  fact is a real thing, and refusing it would push leaders back into the notes field.
- `updateAppointmentSchema` — a discriminated union on `action`: `keep` (carries `visitLogId`),
  `cancel`, `reschedule` (carries `scheduledFor`). Three different events with three different
  audit rows, following the `updateGoalSchema` precedent from `talks-a`.

### Task 5: `lib/visits/appointments.ts`

**File:** create

**Details:**

- Header stating that this module never touches `visit_private_notes`, in the manner of
  `lib/visits/queries.ts`.
- `appointmentViewState(appointment, asOf)` — **pure, client-importable, `asOf` as a parameter.**
  Returns `"missed"` when `status === "scheduled" && scheduledFor < asOf`, otherwise the stored
  status. Keep it in this file only if it stays free of the server client; if it cannot, split it
  the way `goalStatus.ts` is split from `goals/queries.ts` and say so.
- `listAppointments`, `createAppointment`, `getAppointment`, `updateAppointment`.
- Explicit column constant, never `select("*")`.
- Session client on every call; no belt-and-braces `org_id` filter over the policy.

### Task 6: `lib/visits/participants.ts`

**File:** create

**Details:**

- `listParticipantsForVisits(wardId, visitLogIds, client)` — one query for many visits, returning
  a `Map<visitLogId, VisitParticipant[]>`. **Not one query per visit**; the list page renders
  many rows and an N+1 here is the whole page.
- `replaceParticipants(wardId, orgId, visitLogId, participants, client)` — delete-then-insert
  inside one call, mirroring `replaceConductingRotation` in `lib/calendar/queries.ts`. Read that
  function first and follow its shape.
- Display labels resolved here: a `user` participant renders `first_name last_name` from `users`,
  a `member` participant from `members`, a `label` participant renders its text.
  **Read only id and name from both tables** — no phone, no address, no email, no status.
- `VisitParticipant` is a discriminated union on `kind`, matching the schema.

### Task 7: `lib/visits/queries.ts` (modify)

**Details:**

- `VISIT_LOG_COLUMNS`: `visited_by` → `recorded_by`; add `outcome`, `arrangement`.
- `VisitLog`: `visitedBy` → `recordedBy`; add `outcome`, `arrangement`.
- `VisitLogWithContext`: `visitedByName` → `recordedByName`; add
  `participants: VisitParticipant[]` and `conductedByLabel: string | null`.
- `conductedByLabel` is built from the participants — **null when there are none**, and the page
  renders "Not recorded" rather than falling back to the recorder. Falling back would re-create
  the exact ambiguity this slice exists to remove.
- `listVisitLogs` calls `listParticipantsForVisits` once and stitches. It still joins `households`
  and `users`, and still **never** `visit_private_notes`.
- `createVisitLog` takes `recordedBy` and writes `outcome`, `arrangement`, `recorded_by`.

### Task 8: Visit routes (modify)

**Files:** `app/api/visits/route.ts`, `app/api/visits/[id]/route.ts`

**Details:**

- `POST` — stamp `recorded_by` from the session. Parse `participants`; when the key is **absent**,
  default to a single `user` participant for the caller (requirement 4's "by default"); when it is
  present but **empty**, honour the empty list. `undefined` and `[]` are different answers and the
  route must not conflate them.
- Refuse more than `MAX_VISIT_COMPANIONS` companions with a sentence naming the limit. The database
  does not enforce this (§Confirmed decision 6), so the route is the only keeper of the rule and
  the test proves it by re-reading the table.
- Validate `appointmentId` resolves to an appointment in the ward for the same household; on
  success set that appointment's `status = 'kept'` and its `visit_log_id`.
- `PATCH` — allow editing `outcome`, `arrangement`, `participants`. Editing participants goes
  through `replaceParticipants`.
- Audit both: `visit_logged` gains `outcome`, `arrangement`, `participantCount` — **counts, never
  names.** A companion's name in an audit row is a person's movements in a log they cannot read.

### Task 9: Appointment routes

**Files:** `app/api/visit-appointments/route.ts`, `app/api/visit-appointments/[id]/route.ts`

**Details:**

- `GET` — `visits.view`. Filters: `householdId`, `from`, `to`, `status`. Returns the computed view
  state alongside the stored status.
- `POST` — `visits.create`. `org_id` and `made_by` stamped from the session. Refuse a
  non-bishopric author with no org, exactly as `POST /api/visit-goals` does.
- `PATCH` — `visits.create`. The three-action union from Task 4; one audit row per action
  (`appointment_kept`, `appointment_cancelled`, `appointment_rescheduled`).
- 404 for an appointment outside the caller's scope, never 403 — the same reasoning as the
  private-note route: do not confirm another organization's row exists.
- `params` is a Promise in Next 16.

### Task 10: The write surfaces

**Files:** `VisitLogForm.tsx`, `VisitParticipantsField.tsx`, `AppointmentPanel.tsx`,
`page.tsx` (modify/create)

**Details:**

- **The outcome control is the first thing in the form**, because it changes what the rest of the
  form means. A segmented two-button control — "Visited" / "Attempted" — not a dropdown; it is a
  binary a leader answers before anything else, and requirement 1 asks for one action.
- Choosing "Attempted" **keeps the notes fields** — a leader who got no answer often has something
  worth recording — but the helper text under Shared stays as it is. Do not hide fields; a form
  that rearranges itself is harder to trust than one that does not.
- **Do not disturb the Notes section.** Its shared-carries-the-emphasis treatment was settled by
  the 2026-08-25 walkthrough and is the subject of scenario 038. Read `VisitLogForm.tsx`'s header
  before touching the file.
- `VisitParticipantsField` — a chip list with the current user present by default and removable,
  plus "Add someone": a leader (from `users`), a member (via `MemberPicker`), or a typed name.
  Disable "Add someone" at the cap and say why in visible text, not a tooltip.
- **The empty state has words.** No participants reads "Nobody recorded as visiting", not a blank.
- `AppointmentPanel` — upcoming appointments for the org, a booking form, and each row offering
  "Log this visit" (which opens the form with `appointmentId` prefilled), "Cancel", "Reschedule".
  A missed appointment is visually distinct and says so.
- `page.tsx` — each visit row shows the outcome, the arrangement, **conducted by** and, separately
  and quieter, **recorded by**.

### Task 11: Update the sibling plans

**Files:** `plans/visits-b-progress-dashboard.md`, `plans/visits-c-report-feed-and-cross-org.md`,
`plans/07-visits.md` (modify)

**Action:** Make the downstream plans correct rather than leaving the contradiction to be found.

**Details:**

- `visits-b` §Task 1 and §Task 2: `lastVisitedOn` and `visitCountThisPeriod` count
  `outcome = 'completed'` only; add an `lastAttemptedOn` column to the dashboard row and a
  household state for "attempted, never reached". Its `loggedBy` becomes `conductedBy`.
- `visits-b` §The denominator trap: add that `visits-a` shipped the `members.length > 0` filter in
  `app/(app)/visits/page.tsx` and the dashboard must match it.
- `visits-c` §Designing for Phase 8: the `visited_by → authorLabel` row becomes
  `conducted by → authorLabel`, with the recorder a secondary field. `activity_logs.logged_by` is
  the RECORDER, so the two tables now differ in what that column means — say so in the table.
- `07-visits.md`: mark `visits-d` built and replace the Step 7 sketch with what shipped.

---

## Testing Strategy

`npm run test` is `vitest run` against the **hosted** project. Every suite seeds with
`seedFixtures(handles)` and cleans up in `afterAll` (CLAUDE.md §9).

### `tests/lib/appointmentStatus.test.ts`
Pure. `missed` when scheduled and past; never when `kept` or `cancelled`; the boundary second in
both directions; `asOf` pinned, never `new Date()`.

### `tests/lib/visitParticipants.test.ts`
Pure. The discriminated union refuses two identities in one participant and refuses none; the
duplicate refinement catches the same `userId` twice; the cap refuses a seventh entry and permits
six (recorder plus five companions) — **the off-by-one is the point of this test.**

### `tests/rls/visit-participants.test.ts`
Seed an EQ visit and an RS visit, each with participants.
- **Visibility off:** the EQ president reads participants for exactly one visit, counted ward-wide
  rather than within a filter — that is the assertion that catches a surviving permissive policy.
- **Visibility on:** they read both sets, and **still read zero `visit_private_notes` rows** that
  are not their own.
- **Writes, both modes:** their INSERT of a participant on the RS visit raises; their UPDATE is a
  zero-row success — **re-read with the service client**.
- The same four assertions for `visit_appointments`.
- Restore `wards.settings.cross_org_visibility` in `afterAll`.

### `tests/routes/visitAppointments.test.ts`
- `POST` stamps `org_id` and `made_by` from the session and ignores both if sent in the body.
- `keep` sets `status` and `visit_log_id`; `cancel` and `reschedule` write their own audit actions.
- A missed appointment reports `missed` on read while its stored `status` is still `scheduled`.
- 404, not 403, for another org's appointment.
- `org_secretary` gets 201 from `POST` — they hold `visits.create`. **Check the matrix.**

### `tests/routes/visitParticipants.test.ts`
- `POST /api/visits` with no `participants` key records the caller; with `[]` records nobody.
- Six companions refused with a sentence; **re-read the table to prove nothing was written.**
- A `userId` for another ward's user is refused.
- `recorded_by` is the session user even when the body tries to set it.
- The audit detail carries `participantCount` and **no participant name**.

### Regression
`tests/routes/visits.test.ts` and `tests/rls/visit-cross-org.test.ts` both reference
`visited_by`. Update them; **do not weaken any private-note assertion while doing it** — those are
the highest-value assertions in the suite.

---

## Test Scenarios (Harness)

Numbering: 042 is the highest reserved (by `visits-c`). **Verify against
`testing/scenarios/manifest.json` before writing** — `talks-d` recorded exactly this collision.

### Scenario 043: Who actually went
**Tags:** `visits`, `full`, `participants`
**Purpose:** Three participant kinds and the recorder-versus-visitor split are all invisible until
somebody looks at a rendered visit. Seeding a visit that the recorder did **not** attend is the
state that makes the distinction checkable, and it is tedious to reach by hand.
**Seed data summary:**
- Everything scenario 038 seeds, plus:
- `users` — +1 — a second EQ counselor
- `visit_logs` — 1 recorded by the EQ secretary, conducted by the president and a member
  (a spouse), where **the recorder is not a participant**
- `visit_logs` — 1 with **no participants at all**
- `visit_logs` — 1 with a typed-name participant
- `visit_appointments` — 1 scheduled in the past, still `scheduled` (a missed one)

**Tester action:** As the EQ president, log a visit; remove yourself; add a member and a typed
name. Then open the visit the secretary recorded.
**Verification checklist:**
- [ ] The recorder appears by default and can be removed
- [ ] A member, a leader and a typed name can all be added
- [ ] The sixth companion is refused, and the reason is visible text rather than a tooltip
- [ ] The visit with no participants reads "Nobody recorded as visiting", not a blank
- [ ] The secretary-recorded visit shows the president as conducting and the secretary as recording
- [ ] No participant name appears in any audit row
- [ ] Dark mode and 375px

### Scenario 044: Appointments and attempts
**Tags:** `visits`, `full`, `appointments`
**Purpose:** "Missed" is computed rather than stored, so it only appears when a scheduled
appointment's time has passed — a state that cannot be created by clicking, only by seeding.
**Seed data summary:**
- `visit_appointments` — 4 — one upcoming, one past-and-still-scheduled (missed), one `kept` with
  its visit log, one `cancelled`
- `visit_logs` — 2 — one `attempted`, one `completed`, same household

**Tester action:** Book an appointment. Keep one from the panel and let it open the visit form.
Log an attempted visit on a household that has a completed one.
**Verification checklist:**
- [ ] The past scheduled appointment reads **missed** while its stored `status` is `scheduled`
- [ ] Keeping an appointment sets `status = 'kept'` and links the visit log
- [ ] The attempted visit is visible on the household and **does not** increase any count of visits
- [ ] Cancelling does not delete the row
- [ ] An appointment can be booked for a time already past without being refused
- [ ] Dark mode and 375px

---

## Validation Commands

Run in order. **Note where the deploy sits** — this is the one plan in Phase 7 with a migration
that must not be applied before the code ships.

```bash
# 1. The additive migration, then types
npm run db:push          # applies 046 ONLY — do not create 047 until step 5
npm run db:types

# 2. Build everything (Tasks 3–11)

# 3. Checks
npm run lint
npm run typecheck
npm run harness:typecheck
npm run test             # do NOT run `npm run seed` concurrently — same hosted ward
npm run build

# 4. Deploy the application

# 5. Only now: write and apply 047, which drops visit_logs.visited_by
npm run db:push
npm run db:types
npm run typecheck && npm run test
```

`npm run db:push` needs a valid CLI token; an expired one fails at "Initialising login role" with a
bare 401. `npx supabase login` fixes it (`route-tests-and-realtime`).

---

## Integration Notes

- **`visits-b` and `visits-c` are edited by this plan, not merely affected by it** (Task 11).
  Leaving them stale would hand the next execution a plan that contradicts the schema.
- **No breaking change for a user.** Every existing visit keeps its meaning: `completed`,
  `drop_in`, recorded by whoever it credited.
- **`visited_by` disappears in migration 047.** Anything outside this repo reading that column
  breaks. Nothing does today.
- **The five-companion limit lives only in the application.** If a future import path writes
  `visit_participants` directly, it must re-check the limit; the database will not.
- **Linking `users` to `members` remains unresolved** and would simplify participants to one
  column. It affects Phases 1, 2 and 10 and belongs in its own decision, not here.
- **`current_org_id()` is `users.org_id` — one organization per user.** A leader serving in two
  organizations still cannot be represented; a participant from another org can now at least be
  *named* on a visit, which is a partial and deliberate softening.
- **`visit_overdue` still has nowhere to run.** No `supabase/functions/`, no `pg_cron`. This slice
  adds a second computed-on-read state (`missed`) that has the same shape and the same absence of
  a scheduler — neither emits a notification. Raise the mechanism before `visits-c`.
- **Documentation:** update `plans/INDEX.md` only if Phase 7's row changes; the phase file's
  execution table is where slice status lives.
