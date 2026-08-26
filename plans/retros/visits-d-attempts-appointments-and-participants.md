---
id: visits-d-attempts-appointments-and-participants
type: feature
iter: null
commits: ["842968d"]
date: 2026-08-26
files:
  - supabase/migrations/046_visit_attempts_appointments_participants.sql
  - supabase/migrations/047_visit_appointment_set_null_column.sql
  - supabase/migrations/048_visit_participants_parent_scope.sql
  - supabase/migrations-pending/049_drop_visit_logs_visited_by.sql
  - lib/visits/appointments.ts
  - lib/visits/appointmentStatus.ts
  - lib/visits/appointmentLink.ts
  - lib/visits/participants.ts
  - lib/visits/queries.ts
  - lib/validation/visit.ts
  - app/api/visit-appointments/route.ts
  - app/api/visit-appointments/[id]/route.ts
  - app/api/visits/route.ts
  - app/api/visits/[id]/route.ts
  - app/(app)/visits/page.tsx
  - app/(app)/visits/VisitLogForm.tsx
  - app/(app)/visits/VisitParticipantsField.tsx
  - app/(app)/visits/AppointmentPanel.tsx
  - types/domain.ts
  - testing/infrastructure/seedUtils.ts
related:
  - visits-a-goals-logs-and-notes
  - talks-d-reliability-goals
  - route-tests-and-realtime
  - roster-b-picker-and-orgs
  - ai-a-client-and-settings
  - role-access-overrides
---

## What was done

Split what a visit *is*. A `visit_logs` row now records an outcome (`completed` or `attempted`)
and an arrangement (`appointment` or `drop_in`); `visited_by` became `recorded_by` — who typed it
in — with who actually **went** moved into a `visit_participants` table that can name a user, a
member, or somebody this ward has no row for at all. Appointments got their own table where
future timestamps are normal and "missed" is computed on read rather than stored.

Built ahead of `visits-b` deliberately, because `visits-b` computes its progress denominator and
per-household status over exactly the two facts this slice changed.

Walked in a real browser through scenarios 043 and 044. **Four defects came out of the walk that
2304 passing tests had not caught**, three of them fixed the same day.

## Key decisions

- **A participant is a user OR a member OR a typed name, exactly one.** `users` and `members` are
  unlinked in this schema — there is no `users.member_id` — so no single foreign key can name
  both a leader and their spouse. The row carries three columns and a CHECK; the Zod schema is a
  discriminated union on `kind`, so two identities are *unrepresentable* at the boundary rather
  than merely refused. Linking the two tables would collapse this to one column and remains an
  open decision affecting Phases 1, 2 and 10.

- **"Missed" is computed, never stored**, following the `goals.status` precedent. `asOf` is a
  parameter, never `new Date()` inside — a clock the test does not pass in cannot be asserted at
  its boundary, and the boundary is the whole point. It lives in its own module
  (`appointmentStatus.ts`) because a client component renders it and one import of the queries
  module would pull `next/headers` into the browser bundle.

- **Absent and empty are different answers.** No `participants` key means "I went"; `[]` means
  "nobody is recorded as having gone". Collapsing them would re-create the exact ambiguity the
  slice exists to remove, so `undefined` stays distinguishable from `[]` all the way down and the
  schema is given no default.

- **The five-companion cap lives only in the route**, because a CHECK cannot count rows in another
  table and this repo has no triggers. Asserted *and* proven by re-reading the table — a 400 with
  six rows written behind it looks identical from the response body.

- **`conductedByLabel` is null when nobody went, and the page never falls back to the recorder.**
  A fallback would quietly credit the person who typed the visit up with making it.

- **Expand and contract, with the contract migration held out of the pushed directory.**
  `049_drop_visit_logs_visited_by.sql` waits in `supabase/migrations-pending/`, which
  `supabase db push` and `tests/db/migrations.test.ts` both ignore because neither recurses.
  Applying it before the deploy would 500 every visit query in production.

## What the tests found that review did not

- **A composite `on delete set null` made visits undeletable.** Migration 046 wrote
  `foreign key (visit_log_id, ward_id) … on delete set null`. On a composite key that nulls
  *every* referencing column — `ward_id` included, and it is `not null` — so deleting a visit
  raised instead of clearing the link. The exact opposite of the comment sitting above it.
  Migration 047 narrows it to `on delete set null (visit_log_id)`. Caught because the RLS test
  deleted a visit and re-read the appointment; it would have passed silently had the test
  asserted only that the appointment still existed.

- **Copying `visit_logs`' policy shape onto `visit_participants` left a write hole.** A
  participant row has a *parent*, so its own denormalized `org_id` answers only half the
  question: an EQ leader could write a participant onto an RS visit by claiming their own org.
  The route never produced that shape, but a policy that holds only because the one caller is
  careful is not the boundary CLAUDE.md rule 2 asks for. Migration 048 adds a parent check to the
  three write policies via a `security definer` helper and leaves SELECT on the cheap column.

- **The PostgREST embed went ambiguous mid-migration.** Between 046 and 049 `visit_logs` has two
  foreign keys to `users`, and a bare `users (…)` embed answers *"more than one relationship was
  found"* — every visit query 500s. That window **is** expand-and-contract, so the query has to
  survive it: the embed now names its constraint, and stays named afterwards.

## What the walkthrough changed

- **A constant imported from a `"use client"` module into a Server Component is not the
  constant.** `APPOINTMENT_QUERY_PARAM` lived in `AppointmentPanel.tsx`; imported into
  `page.tsx` it arrived as a **client-reference proxy — a function**. Nothing threw:
  `searchParams[someFunction]` is `undefined`, so the page found no appointment, the form opened
  blank, and every route test still passed because they call handlers rather than render pages.
  The whole "Log this visit" flow was dead. Now in `lib/visits/appointmentLink.ts`, a module that
  is neither, owning both halves of the protocol so they cannot drift.

- **…and it had a second layer underneath.** With the server half fixed the form was *still*
  blank, because `VisitLogForm` seeds its draft in a `useState` initializer and React runs that
  once per mount — "Log this visit" is a client-side navigation. A hard reload prefilling
  correctly is what isolated it. Fixed with a `key` on the form. This is the same stale-client-
  state trap `ai-a` recorded for `router.refresh()`; it is now the second time it has bitten.

- **An attempted visit rendered "Visited by <name>"** directly under the word "Attempted". The
  prefix was hardcoded. That is the same quiet untruth the slice exists to remove, relocated from
  a database column into the copy — so the verb is now a lookup on the outcome
  (`VISIT_CONDUCTED_PREFIX`), and the participants field's empty state follows it too.

- **Appointment states did not stand out.** The user's review: four states down a list all read
  as body copy, and "Cancelled" in grey read as *disabled text* rather than as a state somebody
  chose. Now a bordered pill following `StageBadge`, with a **mark as well as a colour** —
  `○ Scheduled`, `✓ Kept`, `✕ Cancelled`, `! Missed`. Four different shapes, so they separate in
  greyscale; the word stays, so the badge never leans on the mark. Text glyphs rather than emoji,
  which would render in their own colour and fight the state colour.

- **The chip remove control shipped at 32×32**, under this app's 44×44 floor — on the smallest
  control on the page, which needs the floor most.

## Gaps introduced

- **Migration 049 is not applied.** It waits in `supabase/migrations-pending/` until the code
  deploys. Until then `visit_logs.visited_by` still exists, unread. The README there has the
  release steps.

- **The member half of the participants picker is unusable, and the decision behind it is
  open.** `MemberPicker` defaults an org leader to their own organization, so a companion from
  another organization — a president's wife in Relief Society — cannot be recorded. Widening it
  means an opt-out prop on a frozen component, which `roster-b` says to raise rather than add
  quietly. **Raised, not taken.** Separately, the picker reports *"There are no members in the
  roster yet"* for a *filtered*-empty result, which its own comment at `MemberPicker.tsx:463`
  says must never happen; that is a small pre-existing fix worth making either way.

- **Appointment dates render without a year**, so a 2099 fixture reads like a 2026 one. Minor,
  reported, left alone.

- **`visit_overdue` still has nowhere to run, and `missed` now joins it.** Two computed-on-read
  states, neither emitting a notification, with no `supabase/functions/` and no `pg_cron`.
  **Raise the mechanism before `visits-c`** — this is the second slice in a row to record it.

- **`replaceParticipants` is delete-then-insert without a transaction**, because PostgREST offers
  none and this repo has no RPC for it. Worst case is a visit whose participants were cleared and
  not rewritten: visible, editable, and not money.

## Pattern

**A test that calls the route handler proves the route, and nothing above it.** 2304 tests passed
while the single most visible new interaction in the feature — pressing "Log this visit" — did
nothing at all, because the defect lived in how a Server Component imported a constant, which no
handler test can reach. Both walkthrough defects were of that shape: correct server behaviour,
correct route responses, and a screen that did not do what it said. The suite proves the
boundaries; only opening the page proves the page.
