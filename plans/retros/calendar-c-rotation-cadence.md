---
id: calendar-c-rotation-cadence
type: feature
iter: null
commits: ["13fced6"]
date: 2026-08-19
files:
  - supabase/migrations/024_rotation_cadence.sql
  - lib/calendar/queries.ts
  - lib/calendar/resolveConductingUser.ts
  - lib/calendar/orgRotationScope.ts
  - lib/calendar/dates.ts
  - lib/auth/permissions.ts
  - lib/notifications/notifyOrgLeadership.ts
  - lib/validation/calendar.ts
  - app/api/conducting-rotation/route.ts
  - app/api/sundays/[id]/org-conducting/route.ts
  - app/(app)/calendar/RotationForm.tsx
  - app/(app)/calendar/OrgRotationPanel.tsx
  - app/(app)/calendar/page.tsx
  - app/(app)/calendar/sunday/[id]/OrgConductingEditor.tsx
  - types/domain.ts
related:
  - calendar-a-rules-and-api
  - calendar-b-month-view
  - roster-b-picker-and-orgs
---

## What was done

A conducting rotation now carries a **cadence** — `weekly` or `monthly` — so a ward whose
bishopric hands over month by month can say so. Weekly stays the default and every existing
assertion about it is unchanged, which is the proof the default really did not move.

The same machinery, at either cadence, extends to the six organizations with a presidency:
`conducting_rotation.org_id` is NULL for the bishopric's sacrament-meeting rotation and a uuid
for an organization's own. Who conducts an organization's meeting on one Sunday is stored per
(Sunday, organization) in the new `sunday_org_conducting`, and editing that row **is** the
override — there is no flag.

Migration 024 also tightened `conducting_rotation`, replacing migration 019's ward-wide write
grant with real policies. This is the first genuinely org-scoped write boundary in the app.

## Key decisions

- **Cadence lives on every rotation row, not in a header table.** A rotation is already a set of
  three rows written in one insert, so changing the cadence *is* inserting a new set — which
  makes "cadence changes apply forward only" true by construction, exactly like reordering,
  with no second mechanism to keep in step.
- **A new permission, `calendar.manage_org_conducting`, rather than widening `calendar.manage`.**
  Widening would have handed an Elders Quorum president the sacrament meeting calendar and every
  Sunday's type. This overturns a deferral `roster-b` handed to Phase 11, deliberately; the shape
  is now recorded in `plans/11-notifications-admin.md` as the pattern for "may manage my own
  organization's data", and the roster gap should follow it rather than invent a second one.
- **`unique nulls not distinct` on (ward_id, org_id, position, effective_from).** A plain unique
  constraint treats every NULL as distinct and would let two bishopric rotations land on the same
  date. Postgres 17.6 here; the fallback to partial indexes was not needed.
- **The `org_id is not null` clause in the RLS org branch is load-bearing.** Without it, any user
  whose own `org_id` is NULL — both secretaries, the music coordinator, a ward council member —
  matches the bishopric rotation's NULL `org_id` and gains write access to it.
  `tests/rls/org-conducting.test.ts` asserts that case from both directions.

## What broke during the walkthrough, and why

Two defects, neither in the cadence logic, both invisible to the test suite because no test had
ever produced the state they occur in.

**Months rendered blank.** `generateSundayRange()` writes the Sunday rows, resolves Fast Sunday,
and assigns conductors in three separate statements — @supabase/supabase-js has no transaction
API. Anything that abandons the request in between leaves the month partly built: rows with no
conductor, or a month with no Fast Sunday. Skipping quickly through months does exactly that,
because the browser cancels the in-flight render.

`ensureMonthGenerated()` then made it permanent by returning early on "this month has rows".
Every affected month read "Not set" forever and nothing in the UI could repair it.

Fixed in two parts. The conductor is now resolved from the candidate **date** and written as part
of the insert — `resolveConductingUser()` never needed a row id — so a new month arrives complete
in one statement. And `ensureMonthGenerated()` repairs a month it finds half-built: conductors
whenever any are null, and Fast Sunday only when the month has none *and* a Sunday could be one,
a combination unreachable by any legitimate edit.

**The real fix is a transaction, and this is not one.** Generation is still three writes.
Repair-on-read makes the damage self-healing rather than permanent; a plpgsql function shaped like
`apply_fast_sunday()` would make it impossible. Recorded in `plans/03-calendar.md`.

## Pattern

**A page that writes must survive being abandoned.** `ensureMonthGenerated()` performs a
multi-step write during a GET render, and renders get cancelled all the time — a browser
navigating away is not an error condition, it is Tuesday. Any sequence of writes in that position
needs to be either atomic or idempotent-and-self-repairing. Ours was neither, and the failure was
silent: no error, no log, just a calendar that looked finished and was not.

The related trap: **"rows exist" is not "work finished."** An early return keyed on presence turns
one transient failure into permanent damage.

## Status

**Scenario 011 is written (39 checks) but not yet walked.** Committed ahead of the walkthrough at
the user's direction. `npm run lint`, `npm run typecheck`, `npm run test` (654 tests, 49 files)
and `npm run build` all pass, and migration 024 is applied to the linked project. Record the
walkthrough results against Scenario 011 in `plans/03-calendar.md` when it is walked.
