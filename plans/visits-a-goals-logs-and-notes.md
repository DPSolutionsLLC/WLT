# Plan: Visits A — Goals, Logs, and the Private-Notes Boundary

**Created:** 2026-08-25
**Type:** feature
**Structure:** Sequential — plan 1 of 3 for Phase 7 ([07-visits.md](07-visits.md))
**Depends on:** Phase 2 (roster). Independent of Phases 3–6.

> **This slice contains the most sensitive rule in the codebase.** A private note is visible
> to its author and to no one else — not the bishop, not an admin, not a support query.
> Read §The Notes Boundary before writing any code.

---

## Phase 7 slice map

Phase 7's six steps split into three execution plans, matching how `roster`, `auth` and
`calendar` (also "Medium" phases) were sliced. **This plan is `visits-a`.**

| Plan | Phase 7 steps | Delivers | Tests from §Tests |
|---|---|---|---|
| **visits-a** (this) | 1, 2, 3 | Goals, visit logs, the notes split, ward-council flagging | `private-notes-absolute`, `private-notes-not-in-list`, `cross-org-read`, `cross-org-write`, `flag-notification` |
| [`visits-b`](visits-b-progress-dashboard.md) | 4 | Progress dashboard, `householdStatus.ts` | `household-status`, `progress-denominator` |
| [`visits-c`](visits-c-report-feed-and-cross-org.md) | 5, 6 | Generic `ReportFeed`, per-user read state, cross-org admin toggle | `read-state-per-user` |

All three are planned. Execute them **in order** — `visits-b` replaces the placeholder page
body this slice leaves behind, and `visits-c` adds a tab to it. Scenario numbers run 038–039
here, 040 in `visits-b`, 041–042 in `visits-c`; verify against
`testing/scenarios/manifest.json` before writing, since `talks-d` recorded exactly this
collision.

**One decision is deferred out of all three:** `visit_overdue` (§Step 4) has nowhere to run —
no `supabase/functions/` directory, and `pg_cron` is not enabled. `visits-b` makes overdue
computable and `visits-c` closes the phase without it. Raise the mechanism before `visits-c`.

---

## Overview

Build the data layer, API routes and write surfaces for the visit tracker: per-organization
visit goals, household visit logs with a hard shared/private note split, and ward-council
flagging that notifies the executive secretary with a one-line agenda item.

### Key requirements

1. Each organization sets and tracks its own goals. Bishopric configures any org; an org
   president or counselor configures their own only; an **org secretary can view but not
   configure**.
2. Visit logs carry `shared_notes`. Private notes live in a **separate table** with its own
   author-only RLS policy, and never appear in any list, export, report tile or notification.
3. Flagging a visit notifies the executive secretary with the one-liner only. `flag_sent_at`
   makes a re-flag idempotent; unflagging clears it.
4. Cross-org visibility widens **reads only** — writes stay org-confined in both modes.

### Success criteria

- A bishop cannot reach a counselor's private note through the API, a list endpoint, or a
  direct query. Proven by test at both the RLS layer and the route layer.
- No response body from `GET /api/visits` contains a private-note field for anyone.
- With cross-org visibility on, an EQ user reads RS shared notes but still cannot write an
  RS log or goal.
- Flagging twice notifies once.
- `npm run lint`, `typecheck`, `test` and `build` all pass.

---

## What already exists (do not rebuild)

This phase was scaffolded in Phase 0 far more completely than the phase file implies.
**Read this section before writing a migration.**

| Thing | Where | State |
|---|---|---|
| `visit_goals`, `visit_logs`, `visit_private_notes`, `report_read_status` | [008_visits.sql](../supabase/migrations/008_visits.sql) | Complete |
| Org-scoped RLS on `visit_goals` / `visit_logs` | [019_rls.sql](../supabase/migrations/019_rls.sql) L358–400 | Complete |
| Author-only RLS on `visit_private_notes` (4 policies, no bishopric branch) | 019_rls.sql L290–317 | Complete |
| `ward_allows_cross_org_visibility()` — reads `wards.settings.cross_org_visibility` | 019_rls.sql L90 | Complete |
| Cross-org read branch already in `visit_logs_select` | 019_rls.sql L379 | Complete |
| Indexes incl. `visit_logs (household_id, visit_date desc)` | [018_indexes.sql](../supabase/migrations/018_indexes.sql) | Complete |
| `visits.view` / `visits.create` / `visits.manage_goals` in the matrix | [lib/auth/permissions.ts](../lib/auth/permissions.ts) | Complete |
| `visit_flagged_for_ward_council` + `visit_overdue` triggers | [notification_triggers.sql](../supabase/seed/notification_triggers.sql) | Seeded (recipients need a fix — Task 1) |
| `{ label: "Visits", href: "/visits", permission: "visits.view" }` | [lib/auth/navigation.ts](../lib/auth/navigation.ts#L34) | Complete |
| RLS proof that the bishop cannot read `visit_private_notes` | [tests/rls/private-notes.test.ts](../tests/rls/private-notes.test.ts) | 7 tests, passing |

**The RLS boundary for this entire phase is already written and already tested at the
database layer.** What is missing is the application layer above it, three small schema
gaps (Task 1), and proof at the *route* layer that the boundary holds there too.

---

## Confirmed decisions

Settled with the user before planning. Do not re-litigate; record any change as a deviation.

### 1. Flag notification goes to the executive secretary, explicitly resolved

`supabase/seed/notification_triggers.sql` seeds `visit_flagged_for_ward_council` with
`['bishop', 'counselor', 'ward_council_member']`. **FEATURES.md §Module 9 and
07-visits.md §Step 3 both say the executive secretary**, who owns the ward council agenda.

FEATURES.md wins. The route resolves the executive secretary explicitly and passes
`recipientUserIds`, exactly as [`notifyOrgLeadership`](../lib/notifications/notifyOrgLeadership.ts)
does — that helper's header explains why explicit resolution beats `default_roles` when a
notification concerns one specific thing. The seed row is updated to match so Phase 11's
settings screen does not show a contradiction.

> The executive secretary holds **no `visits.view` permission** (see the matrix). That is
> not a bug to fix here — it is what makes "the notification carries the one-liner only"
> structurally true rather than a rule someone has to remember.

### 2. `target_type` — `all_households` only in v1

The CHECK constraint allows `all_households`, `specific_households` and `custom`, but **no
table stores which households** a `specific_households` or `custom` goal covers.

`talks-d` set the precedent with `target_type: 'group'` — shipped **readable but not
creatable**, because nothing could verify the target resolved to a live row. Same here:
`createVisitGoalSchema` accepts `all_households` only; the other two stay in the constraint
for a future slice, and any row carrying them still reads back correctly.

This keeps `visits-b`'s progress denominator well-defined: all active households.

### 3. Three schema gaps get one migration

Migration **044** (next free number — 043 is taken; check the directory, not this plan):

1. **`visit_logs.visit_type`** — FEATURES.md and §Step 2 both list it; the table has no such
   column. Add `text not null default 'in_home'` with a CHECK. One value in v1.
2. **`unique (visit_log_id, user_id)` on `visit_private_notes`** — the route is specified as
   an *upsert*, and there is no constraint to upsert onto. Without it a user accumulates
   duplicate private notes for one visit.
3. **`updated_at` on `visit_private_notes`** — an edited note with no `updated_at` cannot
   show the author when they last touched it.

---

## The Notes Boundary

The single rule this slice exists to protect. Four mechanisms, each independent:

1. **A separate table.** `visit_private_notes` is not a column on `visit_logs`, so no
   `select *` can leak it. This is the mechanism, not a nicety.
2. **A separate module.** `lib/visits/privateNotes.ts` holds every private-note read and
   write. `lib/visits/queries.ts` **never imports it and never selects from that table**, so
   "did this response include private notes?" is answerable by reading an import list —
   exactly the rule [`lib/roster/memberNotes.ts`](../lib/roster/memberNotes.ts) states in its
   own header. Copy that header's reasoning.
3. **RLS.** Already written, already tested. The module is the reminder; the policy is the
   guard.
4. **A test that reads route responses, not just tables.** `private-notes-not-in-list`
   asserts on the serialized JSON body, so a future `select` widening is caught even if the
   type still compiles.

**Never** join private notes into a general query, include them in a list response, an
export, a report tile, or a notification body — not even "just for the detail view".

The session client is used for every private-note read and write. **A service-role read here
would hand notes to anyone who reached the code path.**

---

## Relevant Files

### Create

- `supabase/migrations/044_visit_log_type_and_private_note_upsert.sql` — the three gaps in
  §Decision 3.
- `lib/visits/queries.ts` — all `visit_goals` and `visit_logs` reads/writes. Never touches
  `visit_private_notes`.
- `lib/visits/privateNotes.ts` — the caller's own private notes, and nothing else.
- `lib/visits/flagNotification.ts` — resolves the executive secretary and emits the
  one-liner.
- `lib/validation/visit.ts` — Zod schemas shared by routes and forms.
- `app/api/visit-goals/route.ts` — GET, POST.
- `app/api/visit-goals/[id]/route.ts` — PATCH.
- `app/api/visits/route.ts` — GET (list, never private notes), POST.
- `app/api/visits/[id]/route.ts` — PATCH (shared notes, flag).
- `app/api/visits/[id]/private-note/route.ts` — GET, POST (upsert the caller's own).
- `app/(app)/visits/page.tsx` — Server Component shell. **List-only placeholder in this
  slice**; `visits-b` replaces the body with the dashboard.
- `app/(app)/visits/VisitLogForm.tsx` — `"use client"`. The shared/private split, made
  visually unmistakable.
- `app/(app)/visits/VisitGoalPanel.tsx` — `"use client"`. Goal configuration, hidden without
  `visits.manage_goals`.
- `tests/lib/visitValidation.test.ts`
- `tests/rls/visit-cross-org.test.ts` — `cross-org-read` + `cross-org-write`.
- `tests/routes/visits.test.ts` — `private-notes-absolute` (route layer),
  `private-notes-not-in-list`, `flag-notification`.
- `testing/scenarios/scenario-038-*` and `scenario-039-*` (see §Test Scenarios).

### Modify

- `supabase/seed/notification_triggers.sql` — `visit_flagged_for_ward_council` default_roles
  → `executive_secretary`. **The hosted row needs the same change** (§Integration Notes).
- `types/domain.ts` — `VisitType`, `VisitTargetType`, `VisitCadence`, and the label maps.
- `types/database.ts` — regenerate with `npm run db:types` after migration 044 applies.
  Do not hand-edit.
- `testing/infrastructure/seedUtils.ts` — seed builders for goals, logs and private notes.

**Not modified:** `lib/auth/navigation.ts` (the Visits entry already exists),
`supabase/migrations/019_rls.sql` (its policies are correct as written).

---

## Dependencies

No new libraries. Everything needed is already in the repo:

- `emitNotification()` — [lib/notifications/emitNotification.ts](../lib/notifications/emitNotification.ts).
  Takes `recipientUserIds` to override `default_roles`.
- `notifyOrgLeadership()` — the pattern to copy for explicit recipient resolution, including
  its never-throws contract.
- `writeAuditLog()` — [lib/audit/writeAuditLog.ts](../lib/audit/writeAuditLog.ts).
- `assertCan()`, `resolveRoleAccess()` — [lib/auth/permissions.ts](../lib/auth/permissions.ts).
- `requireSessionUser()`, `readJsonBody()`, `respondToRouteError()`.
- `tests/helpers/routeClient.ts` — `actAs`, `jsonRequest`, `readResponse`.
- `formatDateOnly` / `parseDateOnly` — [lib/calendar/dates.ts](../lib/calendar/dates.ts).

---

## Known Pitfalls (from retro context)

- **[role-access-overrides]** — §Step 1 of the phase file says *"Check `role` explicitly —
  `org_secretary` is not `org_counselor`"*. **Do not follow that advice.** The permission
  matrix already models it: `ORG_LEADERSHIP_PERMISSIONS` holds `visits.manage_goals`,
  `ORG_SECRETARY_PERMISSIONS` does not. Gate on
  `assertCan(user, "visits.manage_goals", roleAccess)`. A hardcoded role string bypasses the
  ward's `role_access` override and is the exact bug that retro records.
- **[talks-d]** — **Dropping a policy is not the same as replacing one.** PostgreSQL ORs
  permissive policies together. Migration 044 adds columns only and touches no policy; keep
  it that way.
- **[talks-d]** — **`org_id = current_org_id()` is never true when both are null.** A
  bishopric-authored goal with `org_id = null` is bishopric-only, and that falls out of SQL
  null semantics rather than any clause. Follow `app/api/goals/route.ts`: stamp `org_id` from
  the **session**, never from the request body, and refuse to create a row that lands in the
  null hole for a non-bishopric author.
- **[talks-d]** — **Migration and scenario numbers collide.** 044 is free today; check
  `supabase/migrations/` and `testing/scenarios/manifest.json` before writing. Scenario 037
  is taken by `program-e`.
- **[route-tests-and-realtime]** — **`vi.mock` is hoisted above every import.** Its factory
  cannot close over anything declared later. Read the header of
  `tests/helpers/routeClient.ts` first; it is the single most likely hour to lose.
- **[route-tests-and-realtime]** — **Assert a refused write by RE-READING the row** with the
  service client. An RLS-denied UPDATE or DELETE is a zero-row success, not an error. Only
  INSERT raises. Both `cross-org-write` assertions depend on this.
- **[route-tests-and-realtime]** — **Order any query you then index into.**
  `.order("visit_date", { ascending: false })` before `data[0]`. Heap order shifts as other
  suites write to the same shared hosted tables.
- **[route-tests-and-realtime]** — **Never run `npm run seed` while the suite is running.**
  Both target the same hosted ward.
- **[roster-b]** — **A query param the handler does not read gets no error, just a silently
  ignored filter.** Parse the `GET /api/visits` filters with Zod using exactly the names the
  client sends.
- **[roster-a]** — `DEFAULT_MEMBER_STATUSES` is `["active"]` and its header names *"a
  visit-goal denominator"* as the reason. Reuse it; do not re-derive a status filter here.

---

## Tasks

### Task 1: Migration 044 and the seed correction

**Files:** `supabase/migrations/044_visit_log_type_and_private_note_upsert.sql` (create),
`supabase/seed/notification_triggers.sql` (modify)

**Action:** Close the three schema gaps and correct the flag trigger's recipients.

**Details:**

```sql
alter table visit_logs
  add column visit_type text not null default 'in_home'
    check (visit_type in ('in_home'));

alter table visit_private_notes
  add column updated_at timestamptz not null default now();

-- The private-note route is an upsert (07-visits.md §Step 2) and there was no constraint to
-- upsert onto. Without this a user accumulates duplicate notes for one visit.
alter table visit_private_notes
  add constraint visit_private_notes_one_per_author unique (visit_log_id, user_id);
```

- **Add no policy and drop no policy.** Migration 019's visit policies are correct.
- A single-value CHECK looks odd but is deliberate: FEATURES.md names exactly one type, and
  a constraint is how a second one becomes a decision rather than a typo.
- In the seed, change `visit_flagged_for_ward_council`'s roles array to
  `array['executive_secretary']`, with a one-line comment pointing at FEATURES.md §Module 9.
- Apply with `npm run db:push`, then `npm run db:types`.

### Task 2: Domain types and validation

**Files:** `types/domain.ts` (modify), `lib/validation/visit.ts` (create)

**Details:**

- `types/domain.ts`: `VisitType = "in_home"`, `VisitTargetType`, `VisitCadence`, plus
  `VISIT_TYPE_LABELS` / `VISIT_CADENCE_LABELS`. Follow the `ASSIGNMENT_TYPE_LABELS`
  precedent — labels live here once a second reader appears.
- `lib/validation/visit.ts`:
  - `createVisitGoalSchema` — `targetType` **`z.literal("all_households")`** (§Decision 2),
    `cadence`, `cadenceMonths` (positive int, required when `cadence === "custom"`, refused
    otherwise), `goalPeriodStart` / `goalPeriodEnd` as date-only strings with
    `end > start`. **No `orgId` field** — the route stamps it from the session.
  - `updateVisitGoalSchema` — partial, same refinements.
  - `createVisitLogSchema` — `householdId` (uuid), `visitDate` (date-only, not in the
    future), `visitType`, `sharedNotes` (optional, trimmed, max length).
  - `updateVisitLogSchema` — `sharedNotes`, `flaggedForWardCouncil`.
  - `upsertPrivateNoteSchema` — `notes`, non-empty after trim.
  - `listVisitsQuerySchema` — `orgId`, `householdId`, `from`, `to`, all optional.
- Cadence → months lives here as one exported map (`annual: 12`, `biannual: 6`) so
  `visits-b` reads the same numbers.

### Task 3: `lib/visits/queries.ts`

**File:** `lib/visits/queries.ts` (create)

**Action:** Every `visit_goals` and `visit_logs` read and write. Routes and pages never touch
Supabase directly (conventions.md §Data Access).

**Details:**

- Open with a header stating, in the manner of `lib/roster/queries.ts`, that **this module
  never selects from `visit_private_notes`** and that private notes live in
  `lib/visits/privateNotes.ts`.
- Explicit column constants — **never `select("*")`**:
  ```ts
  const VISIT_LOG_COLUMNS =
    "id, org_id, household_id, visited_by, visit_date, visit_type, shared_notes, flagged_for_ward_council, flag_sent_at, created_at";
  ```
- Row types (`snake_case`) and domain types (`camelCase`) with `mapVisitLogRow` /
  `mapVisitGoalRow`. Map once, here.
- Functions: `listVisitGoals`, `createVisitGoal`, `updateVisitGoal`, `getVisitGoal`,
  `listVisitLogs`, `createVisitLog`, `getVisitLog`, `updateVisitLog`.
- `listVisitLogs` joins `households (id, family_name)` and `users (id, first_name,
  last_name)` for the org/family/who-visited display. **It does not join private notes.**
- Every function takes the caller's session client. RLS does the scoping; do not add a
  belt-and-braces `org_id` filter that would mask a policy regression.

### Task 4: `lib/visits/privateNotes.ts`

**File:** `lib/visits/privateNotes.ts` (create)

**Action:** The caller's own private notes, and nothing else.

**Details:**

- Header modelled on `lib/roster/memberNotes.ts`: this module is the reminder, RLS is the
  guard, `tests/rls/private-notes.test.ts` is the proof.
- `getOwnPrivateNote(visitLogId, client)` — returns the caller's note or `null`.
- `upsertOwnPrivateNote(visitLogId, notes, client)` — `.upsert(..., { onConflict:
  "visit_log_id,user_id" })` against the constraint from Task 1, setting `updated_at`.
- `deleteOwnPrivateNote(visitLogId, client)`.
- **Session client only, always.** No `createServiceSupabaseClient` import in this file —
  its presence is the smell.
- No function here accepts a `userId` parameter. The author is always `auth.uid()`, so
  "read someone else's note" is not expressible in the API surface.

### Task 5: `lib/visits/flagNotification.ts`

**File:** `lib/visits/flagNotification.ts` (create)

**Action:** Resolve the executive secretary and emit the one-liner.

**Details:**

- Copy the shape and the never-throws contract of `notifyOrgLeadership()` — the write has
  already committed, and a notification failure must degrade the message rather than fail
  the edit.
- Resolve recipients explicitly: `users` where `ward_id` matches and `role =
  'executive_secretary'`. Pass as `recipientUserIds` (§Decision 1).
- Body is **exactly** the one-liner and nothing else:
  ```
  [Org Name] — [Family Name] — requested for ward council discussion
  ```
- **Assert in a comment that no note text may ever be added to this body**, and why: a
  digest or email carrying note text defeats the whole design.
- Ward name/org name/family name are resolved by the caller and passed in, so this module
  needs no joins of its own.

### Task 6: Visit goal routes

**Files:** `app/api/visit-goals/route.ts`, `app/api/visit-goals/[id]/route.ts` (create)

**Details:**

- Follow `app/api/goals/route.ts` closely, including the header comment explaining the
  ownership stamp and the "session resolved OUTSIDE the try block" note —
  `requireSessionUser()` redirects by throwing, and catching that turns a redirect into
  a 500.
- `GET` — `assertCan(user, "visits.view", roleAccess)`. RLS narrows to own-org or all for
  bishopric.
- `POST` / `PATCH` — `assertCan(user, "visits.manage_goals", roleAccess)`. This is what
  makes an org secretary read-only (§Known Pitfalls, first bullet).
- `org_id` is stamped from the session: bishopric author → the `orgId` they administer must
  be supplied and validated as a real org in the ward; everyone else → `user.orgId`. **Refuse
  a non-bishopric author with no `orgId`** rather than writing a null that no one can read.
- `writeAuditLog()` on every POST and PATCH, module `"visits"`.
- `params` is a Promise in Next 16: `PATCH(request, { params: Promise.resolve({ id }) })`.

### Task 7: Visit log routes

**Files:** `app/api/visits/route.ts`, `app/api/visits/[id]/route.ts` (create)

**Details:**

- `GET` — `visits.view`. Parses `listVisitsQuerySchema`. Returns
  `{ visits: [...] }`. **The response type must make a private note unrepresentable** — build
  it from `lib/visits/queries.ts`'s domain type, which has no such field.
- `POST` — `visits.create`. `visited_by` and `org_id` stamped from the session, never the
  body. Audit row.
- `PATCH` — `visits.create`. Updates `shared_notes` and `flagged_for_ward_council`.

  **Flag transition logic — the crux of Step 3:**
  ```
  false -> true, flag_sent_at IS NULL   => set flag, set flag_sent_at = now(), notify
  false -> true, flag_sent_at IS NOT NULL => set flag, do NOT notify   (re-flag)
  true  -> false                        => clear flag, clear flag_sent_at
  ```
  Clearing `flag_sent_at` on unflag is what lets a genuine re-raise notify again, and is
  what §Step 3 means by "unflagging is allowed and clears it".
- The notification is fired **after** the update commits, and its failure never fails the
  request.
- No route in this file imports `lib/visits/privateNotes.ts`.

### Task 8: Private-note route

**File:** `app/api/visits/[id]/private-note/route.ts` (create)

**Details:**

- `GET` — returns the caller's own note or `null`. Never accepts a `userId` query param.
- `POST` — upserts the caller's own note.
- Permission is `visits.create` **plus** RLS. The route cannot express another author.
- **Audit:** write a row recording that a private note was written, with the **visit log id
  only — never the note body.** `writeAuditLog` runs `redactSensitive()` on `detail`, but do
  not rely on that; simply never pass the text.
- Return 404, not 403, for a visit log the caller cannot see, so the endpoint does not
  confirm the existence of another org's visit.

### Task 9: The write surfaces

**Files:** `app/(app)/visits/page.tsx`, `app/(app)/visits/VisitLogForm.tsx`,
`app/(app)/visits/VisitGoalPanel.tsx` (create)

**Details:**

- `page.tsx` is a Server Component: resolves the session, resolves `roleAccess` once, renders
  `NotPermitted` without `visits.view`. **A simple list of recent logs plus the form** —
  `visits-b` replaces the body with the real dashboard, so do not invest in layout here.
- `VisitGoalPanel` renders only when `can(user, "visits.manage_goals", roleAccess)`. Pass the
  boolean down as a prop; do not re-derive permissions in a client component.
- **`VisitLogForm` is where the notes rule becomes visible to a human.** The two fields must
  be impossible to confuse:

  | | Shared notes | Private notes |
  |---|---|---|
  | Label | "Shared notes" | "Private notes" |
  | Helper text | "Shared with other leaders" | "Only you can ever see this" |
  | Treatment | default card surface | distinct bordered/tinted block, visually separated |

  Both `dark:` variants required. Helper text is **always visible**, never a tooltip or a
  placeholder — a leader writing a pastoral observation needs to know at a glance, and a
  placeholder disappears the moment they start typing.
- The private note posts to its own endpoint, in its own request, after the log exists. It is
  never a field on the log payload — the wire format carries the boundary too.
- The flag control gets a confirm step naming who will be told.

---

## Testing Strategy

`npm run test` is `vitest run` against the **hosted** project. Every suite seeds with
`seedFixtures(handles)` and cleans up in `afterAll` — the tables are shared and cannot be
assumed empty (CLAUDE.md §9).

### `tests/lib/visitValidation.test.ts`
Pure, fast. `cadenceMonths` required only for `custom`; `goalPeriodEnd > goalPeriodStart`;
a future `visitDate` refused; `targetType: "specific_households"` **refused on create**
(§Decision 2); empty/whitespace private note refused.

### `tests/rls/visit-cross-org.test.ts` — `cross-org-read` + `cross-org-write`
Seed an EQ log and an RS log, plus a private note on each.

- **Visibility off:** the EQ president reads exactly one log across the whole ward. Assert
  the count ward-wide, not within a filter — that is the assertion that catches a surviving
  permissive policy (`talks-d`).
- **Visibility on:** the EQ president reads both logs and both shared notes, and **still
  reads zero rows from `visit_private_notes`** that are not their own.
- **Writes, both modes:** the EQ president's INSERT of an RS log raises; their UPDATE of the
  RS log is a zero-row success — **re-read with the service client** to prove nothing changed.
- Same four assertions for `visit_goals`.
- Toggle `wards.settings.cross_org_visibility` with the service client between phases and
  restore it in `afterAll`.

### `tests/routes/visits.test.ts`
Uses `tests/helpers/routeClient.ts`. Read its header first.

- **`private-notes-absolute` (route layer).** The RLS half is already proven by
  `tests/rls/private-notes.test.ts`; this is the half that does not exist yet.
  `actAs(fixtures, "bishop")`, then `GET /api/visits/[id]/private-note` on a note authored by
  a counselor → `null`, never the body. Same for the org president.
- **`private-notes-not-in-list`.** Seed a private note, `GET /api/visits` as each of bishop,
  org president and the note's own author, and assert on the **serialized JSON**:
  ```ts
  expect(JSON.stringify(body)).not.toContain(THE_NOTE_TEXT);
  ```
  plus a structural check that no key matching `/private/i` appears anywhere in the payload.
  Asserting on the string is deliberate — it survives a refactor that renames the field.
- **`flag-notification`.** `PATCH` with `flaggedForWardCouncil: true` → exactly one
  notification row, recipient is the executive secretary, and its body **equals** the
  one-liner. Assert `not.toContain` the shared-note text and the private-note text. PATCH
  again → still exactly one row and `flag_sent_at` unchanged. Unflag → `flag_sent_at` is
  null. Re-flag → a second notification.
- **Permission paths.** `org_secretary` gets 403 from `POST /api/visit-goals` but 200 from
  `GET`. `org_secretary` gets 200 from `POST /api/visits` — they hold `visits.create`.
  **Check the matrix before asserting a 403**; it is not always the intuitive answer.

---

## Test Scenarios (Harness)

Numbering: 037 is the highest in `testing/scenarios/manifest.json` today. **Verify before
writing** — `talks-d` recorded exactly this collision.

### Scenario 038: The shared/private note split
**Tags:** `visits`, `smoke`, `privacy`
**Purpose:** The boundary is a UI promise as much as a policy. Seeding two orgs with existing
logs and a counselor-authored private note is tedious by hand and is the state that makes the
promise checkable.
**Seed data summary:**
- `organizations` — 2 — Elders Quorum, Relief Society
- `users` — 4 — bishop, EQ president, EQ secretary, RS president
- `households` — 6 — 5 with active members, 1 all moved-out
- `visit_goals` — 2 — one per org, `all_households`, annual, current period
- `visit_logs` — 4 — 3 EQ, 1 RS, one carrying a distinctive shared note
- `visit_private_notes` — 1 — authored by the EQ president, distinctive text

**Tester action:** Log in as the EQ president, open `/visits`, log a visit filling **both**
note fields. Then log in as the bishop and open the same visit.
**Verification checklist:**
- [ ] The two note fields are visually distinct without reading the labels
- [ ] Helper text is visible on both before typing, and stays visible while typing
- [ ] The bishop sees the shared note and **no trace** of the private note
- [ ] Ctrl+F for the private note text on the bishop's page finds nothing
- [ ] The EQ secretary sees the goal panel as read-only, with no Save control
- [ ] Dark mode: both fields remain distinguishable

### Scenario 039: Flagging for ward council
**Tags:** `visits`, `full`, `notifications`
**Purpose:** The idempotence of `flag_sent_at` and the emptiness of the notification body are
both invisible in the UI; seeding an already-flagged log is what makes the re-flag path
reachable in one sitting.
**Seed data summary:**
- Everything from 038, plus:
- `users` — +1 — executive secretary
- `visit_logs` — 1 already flagged with `flag_sent_at` set, 1 unflagged with a long shared note

**Tester action:** As the EQ president, flag the unflagged visit. Log in as the executive
secretary and open the notification bell. Return, unflag and re-flag the same visit.
**Verification checklist:**
- [ ] Flagging shows a confirm naming who will be notified
- [ ] The executive secretary receives exactly one notification
- [ ] The notification body is the one-liner and contains **no** note text
- [ ] Re-flagging the already-flagged visit produces no second notification
- [ ] Unflag then re-flag **does** produce a new notification
- [ ] The bishop receives no notification (the trigger's roles were corrected in Task 1)

---

## Validation Commands

Run in order:

```bash
# Apply the migration to the linked hosted project, then regenerate types
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests  (do NOT run `npm run seed` concurrently — same hosted ward)
npm run test

# Production build
npm run build
```

`npm run db:push` needs a valid CLI token; an expired one fails at "Initialising login role"
with a bare 401. `npx supabase login` fixes it, and `--debug` surfaces the cause
(`route-tests-and-realtime`).

---

## Integration Notes

- **The hosted `notification_settings` row must be updated, not just the seed file.**
  Editing `supabase/seed/notification_triggers.sql` changes what a *fresh* ward gets;
  the linked project already holds a row with the old roles. Either re-run the seed for that
  trigger or update the row directly, and say which was done in the retro. A correct seed
  file plus a stale hosted row is a bug that only shows up in production behavior.
- **`testing/infrastructure/seedUtils.ts` also lists the trigger defaults** (around L1397).
  It must match the seed file or scenario seeding will restore the old roles.
- **No breaking changes.** Every table, policy and permission this slice uses already exists;
  migration 044 only adds columns and one constraint.
- **`visits-b` inherits two open questions.** Neither is this slice's to answer:
  1. **The overdue emit has no home.** §Step 4 says "nightly Edge Function", but there is no
     `supabase/functions/` directory in this project and **`pg_cron` is not enabled**
     (`talks-d` recorded that for `refresh_goal_status()`). `visit_overdue` is seeded and
     will fire from nothing until someone chooses a mechanism.
  2. **`visit_goals_select` has no cross-org branch** while `visit_logs_select` does
     (019_rls.sql L358 vs L379). With visibility on, a leader reads another org's logs but
     not the goal that supplies the denominator for them — so a cross-org progress view
     cannot compute "X of Y" today. Decide it when the dashboard needs it.
- **`current_org_id()` is `users.org_id` — one organization per user.** A leader serving in
  two organizations is not representable. Out of scope here; worth recording if it comes up.
- **Documentation:** update `plans/INDEX.md` to mark Phase 7 in progress, and record any
  deviation from §Confirmed decisions in the retro that `/execute` generates.
