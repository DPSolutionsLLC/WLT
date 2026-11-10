# Plan: Bishopric Visits — the ward-wide visiting effort

**Created:** 2026-10-31
**Type:** feature
**Scope refs:** ITER-055
**Structure:** One plan, **eight slices, eight commits** (`bv1` … `bv8`). Each slice is shippable on
its own, has its own migration (where it needs one), its own tests, its own scenario and its own
retro. Build them in order; each depends on the ones before it.

### Status (refreshed 2026-11-09)

| Slice | State |
|---|---|
| bv1 | ✅ committed `393a98c` (migration 099) |
| bv2 | ✅ committed `280b9aa` |
| bv3 | **Built and walked 2026-11-09, NOT committed** — migration **101**, scenario **100** (`visits/scenario-100-partly-reached-and-a-call`, all 14 pass after fixing 100-D1 and 100-D2). Run `/commit`, then start bv4. |
| bv4–bv8 | Not started |

**What the 2026-11-09 refresh changed — no decision (D1–D9, P1–P16) moved:**
- **Migration numbers are one later than first written.** 100 went to `100_zoom_join_links_w_to_j.sql`, so bv3 used 101. From here: **bv4 → 102, bv5 → 103, bv6 → 104, bv7 → 105.** Always re-check `ls supabase/migrations | tail -3` before creating one.
- **Scenario numbers shift by one** for the same reason: bv4 → 101, bv5/bv6 → 102, bv7 → 103.
- **bv3 did not create `RecordVisitWindow` or `ScheduleVisitWindow`.** It extended `VisitLogForm.tsx` (outcome, reason, attempt detail) and reused `AppointmentPanel.tsx` for scheduling (`ContactPanel`'s `onSchedule`). Later slices extend those components; they do not create the two windows (bv6 creates `ScheduleVisitWindow` — see its section).
- **"Done" already has one meaning: `isDoneVisit()` in `lib/visits/householdStatus.ts`** (CLAUDE.md §9, bv3). `sweepProgress()` (bv4) and the to-do closing in bv5 must call it, never re-test `outcome`/`needs_another_visit` themselves. A phone call is only ever an attempt.
- **The tabs live in `lib/visits/visitsView.ts`** (`VISITS_TABS`, `VISITS_TAB_LABELS`, `visibleVisitsTabs()`), not in `VisitsScreen`. bv4 adds `goal_history`, bv5 adds `my_visits`; the stored page view parses through `visitsViewSchema`, so a new tab value must be added there too.
- **The active goal is chosen in TWO places:** `selectActiveGoal()` in `lib/visits/progress.ts` **and** a copy of its rule in `lib/visits/allOrgProgress.ts` (~line 220). bv4 changes both, or the all-orgs page counts an ended goal.

---

## Overview

The bishopric wants to visit every household in the ward. They want to divide the households among
the bishop and two counselors, carry each assignment through To Do and My Appointments (with
companions who accept or decline), record how each visit went, send follow-ups and discussion items
onward, and keep every goal with its history to look back on.

Visits already exists (Phase 7, `visits-a` … `visits-f`, ITER-018/019): organization-scoped visit
logs, rolling-cadence goals with four bands, stewardship, appointments, participants and the
return-and-report feed. **This is a modification of that module, not a new one.** It also delivers
the module's outstanding P4 re-skin (module-map §2.9: invites with accept/decline, the
schedule/log-contact panel), because the new screens are built in the prototype's shape from the
start.

### Decisions settled with the user (2026-10-31, during `/planning`)

| # | Decision |
|---|---|
| D1 | **Each organization's visits are private to that organization by default. The bishopric decides, per organization, which other organizations may see them** (e.g. "let the Elders Quorum see the Bishopric's visits"). The bishopric always sees everything. |
| D2 | **Only the bishopric sets sharing**, for every organization, on one screen. Org presidents cannot change it. |
| D3 | **Per-organization sharing REPLACES the ward-wide switch for visits.** Day one: a ward whose switch was on gets "every organization shares with every other organization", **except the Bishopric, which starts shared with nobody**. A ward whose switch was off gets no grants. Nobody outside the bishopric gains or loses anything except sight of the Bishopric's visits. |
| D4 | **One shared bishopric goal**, not one per member. Each member's assigned households show as their share of it. |
| D5 | A goal is a **sweep** (every household once — a finish line) or a **repeating cadence** (today's model). It ends as **completed** or **set aside**, and ended goals stay on record. |
| D6 | **"Visited, but still needs a visit"** is a separate **partly reached** count — not done, still on the list, visible in the progress ("42 of 180 done · 6 partly reached"). |
| D7 | The reason is **a short fixed list plus the notes**: someone wasn't home, spouse absent, asked us to come back, other. |
| D8 | **Reassigning a household closes the old to-do** (with a line saying it was reassigned) and gives the new person their own. A visit already scheduled stays on the old holder's appointments and they are warned. |
| D9 | **"Discuss in bishopric meeting" lands on the next bishopric agenda.** Only a one-line item goes — never the shared report, never the private note. |

### Two departures found during research — tell the user at the start of `bv1` and `bv7`

- **P-A (affects D3). The ward switch also controls youth follow-ups.**
  `ward_allows_cross_org_visibility()` appears in `activity_logs`' SELECT policy (migration 057c)
  and is read by `/youth`, `/youth/feed` and `/youth/profiles`. Visits stop reading it (bv1). The
  switch **stays, for youth only**, and its admin label is renamed to say so, so youth behaviour
  does not change without being asked. Giving youth per-organization sharing as well would be a
  separate item.
- **P-B (affects D9). No agenda is created automatically.** `lib/agendas/flaggedItems.ts` already
  gathers flagged visits when an agenda is created. "Discuss in bishopric meeting" reuses that: if
  a **draft** bishopric agenda for an upcoming date already exists, the line is appended to it at
  once; otherwise it waits and is gathered when the next bishopric agenda is created. Creating an
  agenda nobody made would be a surprise and would put a write outside a person's action.

### Planning decisions made here (P1–P16) — the executor follows these

| # | Decision | Why |
|---|---|---|
| P1 | **REVISED 2026-10-31 at the start of bv1, with the user:** bishopric visits **stay stored with `org_id = null`**, as today. The sharing check treats a null owner as the ward's `bishopric`-typed organization: `visit_org_visible_to_caller()` resolves `coalesce(owner_org, <the ward's bishopric org id>)` before looking up a grant, and grants for the Bishopric are stored against that organization's id. | The original P1 (backfill onto the Bishopric org row) would have meant adding a Bishopric organization to `tests/helpers/seed.ts` — which has none, and whose bishop calling carries no org — and rewriting every "null means bishopric" reader in `lib/visits/`. Task 0 found no visit data anywhere and one Bishopric org in each of the three real wards. A null-org visit row can only be written by the bishopric (the write policy's org arm is never true for null), so null is unambiguous. A ward with no Bishopric org simply cannot share the Bishopric's visits. |
| P2 | **Sharing is a table, `visit_org_sharing (ward_id, owner_org_id, viewer_org_id)`**, unique on the pair, with a SELECT policy and **no write policy**. The only writer is `PUT /api/visit-sharing` behind `visits.manage_sharing` + `is_bishopric`, through the service role. | The 073 / 089 / 094 shape: the rule "only the bishopric" lives in one route and RLS cannot be talked past it. Absent row = not shared (the absent-means-default idiom). |
| P3 | **One `security definer` function `visit_org_visible_to_caller(owner_org uuid)`** replaces `ward_allows_cross_org_visibility()` in all **six** visit SELECT policies: `visit_logs`, `visit_goals`, `household_visit_cadences`, `household_stewardships`, `visit_appointments`, `visit_participants`. It returns true when `owner_org = current_org_id()` or a grant `(owner_org → current_org_id())` exists in `current_ward_id()`. Policies keep their `is_bishopric()` arm. **Write policies do not move.** `visit_private_notes` does not move. | One function behind six policies (the `current_ward_id()` lesson). Migration 053's header named four widened tables when there were six; this one names all six and the test covers all six. |
| P4 | **The all-organizations view becomes bishopric-only.** A non-bishopric reader with grants sees each shared organization through the organization selector on `/visits` (read-only), not on the all-organizations page. | CLAUDE.md §9: "an organization claims households only if it has a visit goal" is only safe while it is **uniformly evaluable**. With per-pair grants, two readers would see different unclaimed counts from the same data. The bishopric reads everything, so for them it stays uniform. |
| P5 | **Goals gain** `kind ('cadence','sweep') not null default 'cadence'`, `started_on date not null default current_date` (backfilled from `created_at` in the ward's zone, or UTC date if the zone is unknown), `ended_at timestamptz`, `end_reason ('completed','set_aside')`, with a CHECK that the two are set together, and **a partial unique index — one active goal per (ward, org)** `where ended_at is null`. | History is the rows themselves (never destroy). The unique index makes "the active goal" a database fact instead of `selectActiveGoal()`'s "first one". **The migration first reports any (ward, org) with more than one goal and stops** — the executor resolves it with the user, never by deleting. |
| P6 | **Sweep progress: done = a completed visit, not marked "still needs a visit", dated on or after `started_on`.** Partly reached = the household's latest completed visit since `started_on` is marked "still needs a visit" and there is no done visit since. Everything else is not yet reached. Pure function `sweepProgress()` in `lib/visits/sweep.ts`. | Computed on read, never stored. Uses `describeHouseholdForVisits()` for the denominator so the picker and the count cannot drift (visits-b's rule). |
| P7 | **For cadence goals, a "still needs a visit" visit does not reset the household's clock.** It adds a **partly reached** mark beside the band, like the attempts mark. Only a done visit resets it. | One meaning of "done" across both goal kinds. `householdVisitPriority()` gains the input; its existing tests must still pass unchanged. |
| P8 | **Visit outcome columns on `visit_logs`:** `needs_another_visit boolean not null default false`, `needs_another_reason text` check in (`not_home`, `spouse_absent`, `asked_to_return`, `other`), CHECK: reason set ⇔ flag true, and flag true ⇒ `outcome = 'completed'`. Attempt detail: `attempt_detail text` check in (`no_answer`, `left_message`, `no_message_left`), CHECK: set only when `outcome = 'attempted'`. `visit_type` gains `'phone'`. | The prototype's three attempt outcomes and contact type. The scope's "appointment set" attempt is not a stored detail; it opens scheduling. |
| P9 | **Assignment is `visit_assignments`** (`id, ward_id, org_id, household_id, goal_id, assigned_to, assigned_by, created_at, ended_at, end_reason ('reassigned','unassigned','visited','goal_ended')`), with a partial unique index **one open assignment per (household, org)** `where ended_at is null`. SELECT: `is_bishopric() or visit_org_visible_to_caller(org_id) or assigned_to = auth.uid()`. **No write policy** — `lib/visits/assignments.ts` (service role, behind `visits.assign` + `is_bishopric`) is the only writer. | Ending, never deleting, keeps the history. `assigned_to` is a **subject** column written from a request body, so the route calls `findUsersOutsideWard()` **and** checks the person holds an active bishopric calling (`listBishopricUsers`) — the 069 warning in CLAUDE.md §7. |
| P10 | **An assignment puts "Visit the ___ family" on the assignee's To Do** (`todos.visit_assignment_id`, partial unique one open per owner). It has **no checkbox and cannot be deleted while open** (the Zoom pattern). It closes itself when a **done** visit is recorded for that household by anyone (`source_completed`, "Visited."), and closes with `closed_reason = 'reassigned'` or `'unassigned'` when the assignment ends that way. A "still needs a visit" visit keeps it open and adds a line naming the reason. `lib/todos/visitLinks.ts` is the only writer. | P5's rule: another person's work arrives only through a source that owns it, written with the service role. |
| P11 | **Scheduling from a visit to-do creates a `visit_appointments` row, not `todos.scheduled_for`.** The to-do card's Schedule button opens the visit scheduler. The appointment carries `assignment_id` (new nullable column). | Otherwise the same visit would appear twice on My Appointments. |
| P12 | **Companions: `visit_appointment_companions`** (`id, ward_id, appointment_id, user_id, member_id, label, status`, exactly one identity; `status` in `pending`/`accepted`/`declined` **only for `user_id` rows**, null otherwise). An app user is **invited** (pending → accept / decline). A roster member or typed name is **recorded** and gets no invite, because a roster member has no account link (that is ITER-058). The scheduler is never a row; they are `made_by`. SELECT: the appointment's readers plus `user_id = auth.uid()`. **No write policy** — `lib/visits/companions.ts` is the only writer. | Prototype §2.9 #1: "scheduling auto-confirms the scheduler and creates a pending invite for a companion — never silently adding anyone". A companion outside the bishopric can read their own invite and the appointment it names through a `security definer` arm `is_visit_companion(appointment_id)` on `visit_appointments_select` — the **only** read widening, and it exposes the appointment row, never a visit log or note. |
| P13 | **An invite reaches the invitee three ways:** a pending-invites panel at the top of My Appointments and of `/visits` (prototype: above the tabs whatever the view), and a bell notification `visit_companion_invited`. Accepted invites appear on the companion's My Appointments as a fourth source kind in `buildMyAppointments()`, never a second list. | P5 / P6 rule: one computation. Adding a trigger key touches **four copies plus a backfill migration** (`notification-trigger-drift`). |
| P14 | **Follow-ups are ordinary to-dos linked by `todos.visit_log_id`**, created from a visit for any bishopric member (self included) by `lib/todos/visitLinks.ts`. They **can** be ticked and deleted like any to-do — a follow-up is the owner's own work once given. The card shows "From a visit to the ___ family" linking back. | Unlike the assignment to-do, nothing closes it automatically. |
| P15 | **Discuss in bishopric meeting:** `visit_logs.discuss_in_bishopric boolean not null default false` and `bishopric_discussed_at timestamptz`. `flaggedItems.ts` gains a third gatherer used **only for `meeting_type = 'bishopric'`**, reading `discuss_in_bishopric and bishopric_discussed_at is null`, one line: "Visit — ___ family — to discuss". Publishing a bishopric agenda stamps `bishopric_discussed_at` for the items on it (the `markFlagsSent` pattern, matched by `sourceId`, never by text). Append-on-flag per P-B. | The one-liner privacy boundary in `flaggedItems.ts` stays intact: the select names no note column. |
| P16 | **Street grouping is a pure parse of `households.address`** (one free-text field — there are no street columns): drop a leading house number and any unit, normalize case and whitespace and common suffixes (St/Street, Ave/Avenue, Dr/Drive, Rd/Road, Ln/Lane, Ct/Court, Cir/Circle, Way). Blank or unparseable → a final "No street on file" group. A toggle "Group by street" on the household list, **remembered on the account** via `readPageView` / `writePageView`. Not a map. | Memory: every page reopens as left. Matching stays boring (`classifyLocation.ts`'s rule): a near-miss is a separate group, never a guess. |

### Success criteria

- An Elders Quorum president cannot read one Bishopric visit, goal, cadence, stewardship,
  appointment or participant row **until the bishopric shares the Bishopric with the Elders
  Quorum**, and can afterwards — asserted at the table for all six.
- The bishopric sets a sweep goal, divides households among the three, and each sees "My visits"
  with only their own.
- Assigning puts a to-do on the assignee's list. Scheduling from it with a companion creates a
  pending invite the companion can accept, after which it is on their My Appointments.
- A visit marked "still needs a visit — spouse absent" shows the household as partly reached,
  keeps the to-do open with a line, and counts as "6 partly reached" in the progress.
- A done visit closes the to-do. Setting the goal aside keeps it, with its numbers, in Goal history.
- A follow-up lands on the chosen member's To Do. "Discuss in bishopric meeting" appears as one
  line on the next bishopric agenda and nowhere on a ward council agenda.
- The household list groups by street on request and reopens that way.

---

## Relevant Files

Grouped by slice. "create" / "modify". The executor confirms each path exists before editing.

### bv1 — Sharing replaces the switch for visits
- `supabase/migrations/099_visit_org_sharing.sql` — create — P1 backfill, `visit_org_sharing`, `visit_org_visible_to_caller()`, six SELECT policies replaced, day-one grants (D3), release policy for the new table, `visits.manage_sharing` needs no SQL.
- `lib/visits/sharing.ts` — create — `readVisitSharing(wardId)`, `writeVisitSharing(wardId, grants, service)` (replace-all within the ward, refuses a grant whose two orgs are equal or outside the ward), `visibleOrgIdsFor(user)`.
- `lib/validation/visit.ts` — modify — `visitSharingSchema`.
- `app/api/visit-sharing/route.ts` — create — GET (`visits.view`, bishopric), PUT (`visits.manage_sharing` + `isBishopricRole`), audit `visit_sharing_updated` with counts only.
- `app/(app)/visits/SharingPanel.tsx` — create — the grid: one row per organization ("Who can see the Elders Quorum's visits"), chips per other organization, Save. Bishopric only.
- `lib/auth/permissions.ts` — modify — add `visits.manage_sharing` (bishopric only via "all permissions"; **non-overridable**, added to the non-overridable list).
- `lib/access/releasedModules.ts` — modify — add `visit_org_sharing` to the visits module's tables.
- `lib/access/accessModules.ts` — modify only if it enumerates visits permissions; `visits.manage_sharing` must not be offered there.
- `app/api/visits/route.ts`, `app/api/visit-appointments/route.ts` — modify — stamp the Bishopric organization's id for a bishopric author (P1), via a new `readBishopricOrgId(wardId)` in `lib/visits/sharing.ts`.
- `lib/visits/progress.ts`, `lib/visits/allOrgProgress.ts`, `lib/visits/reportFeed.ts` — modify — anything that treats `org_id null` as "bishopric" reads the Bishopric org id instead; grep `org_id` null handling and `isBishopricRole` in `lib/visits/visitOwnership.ts`.
- `app/(app)/visits/page.tsx`, `app/(app)/visits/all-organizations/page.tsx`, `app/(app)/visits/feed/page.tsx` — modify — stop reading `readCrossOrgVisibility`; selector offers own org + shared orgs (read-only for shared); all-organizations page bishopric-only (P4).
- `app/(app)/admin/CrossOrgVisibilityToggle.tsx`, `app/(app)/admin/page.tsx` — modify — relabel to youth follow-ups only (P-A). `lib/ward/crossOrgVisibility.ts` header updated to say visits no longer read it.
- `types/domain.ts` — modify — `VisitSharingGrant` type.
- `types/database.ts` — regenerate (`npm run db:types`).
- Tests: `tests/rls/visit-org-sharing.test.ts` (create), `tests/rls/visit-cross-org.test.ts` (modify — invert to grants, see Testing), `tests/routes/visitSharing.test.ts` (create), `tests/lib/visitSharing.test.ts` (create), `tests/routes/crossOrgVisibility.test.ts` (modify — label/semantics), `tests/db/module-release-policies.test.ts` (no edit expected; must stay green).

### bv2 — Re-skin `/visits` as the prototype's sub-view machine
- `app/(app)/visits/page.tsx` — modify — server half loads data; renders `VisitsScreen`.
- `app/(app)/visits/VisitsScreen.tsx` — create — client sub-view machine: tabs **Households** (default), **My visits** (bv5; hidden until then), **Feed**, **All organizations** (bishopric), **Goal history** (bv4), **Sharing** (bishopric, from bv1's panel). Tab remembered via `readPageView`/`writePageView`. Header: contextual back link (`components/layout/ContextualBackLink.tsx`), eyebrow "People & Care", title "Visits", organization selector.
- `app/(app)/visits/HouseholdPriorityCard.tsx` — create — prototype L10556–10618: title line with band pill or Do-not-contact pill, fill gauge (not a percentage), meta line, grouped small action buttons on the title line (memory: compact UI), expand for do-not-contact / cadence override.
- Existing panels (`VisitProgressTable`, `VisitGoalPanel`, `StewardshipPanel`, `AppointmentPanel`, `VisitLogForm`, `CollapsibleSection`) — modify or retire into windows (`Modal`) per the compact-UI memory. **Delete nothing a later slice needs; retire a component only when no import remains** (and list it in the retro).
- Tests: `tests/components/visits/HouseholdPriorityCard.test.tsx` (create), existing visits component tests updated.

### bv3 — Contact panel and the "still needs a visit" outcome
_As built (uncommitted 2026-11-09): migration **101**, `ContactPanel.tsx`, `lib/visits/visitOutcome.ts` (`describeVisitOutcome`; `isDoneVisit` is in `householdStatus.ts`), and the outcome fields added to the existing `VisitLogForm.tsx` instead of a new `RecordVisitWindow`. Scheduling reuses `AppointmentPanel`._
- `supabase/migrations/101_visit_outcomes.sql` — create — P8 columns and checks.
- `app/(app)/visits/ContactPanel.tsx` — create — prototype L10490–10553: phones as `tel:` links per member, Log a contact attempt (three outcomes + notes), Schedule an appointment, Close.
- ~~`app/(app)/visits/RecordVisitWindow.tsx`~~ — **not created**; `VisitLogForm.tsx` modified instead (date, outcome, reason when "still needs", shared report, private note, participants).
- `lib/visits/queries.ts`, `lib/validation/visit.ts`, `app/api/visits/route.ts`, `app/api/visits/[id]/route.ts` — modify — new fields; Zod refines mirror the CHECKs.
- `lib/visits/householdStatus.ts` — modify — P7 partly-reached input and mark.
- `lib/visits/progress.ts` — modify — "done" means completed and not `needs_another_visit`.
- `types/domain.ts` — `VISIT_NEEDS_ANOTHER_REASONS`, `VISIT_ATTEMPT_DETAILS` with labels.
- Tests: `tests/lib/householdStatus.test.ts` (extend), `tests/lib/visitValidation.test.ts` (extend), `tests/routes/visits.test.ts` (extend).

### bv4 — Sweep goals, ending a goal, goal history
- `supabase/migrations/102_visit_goal_kinds.sql` — create — P5.
- `lib/visits/sweep.ts` — create — `sweepProgress(households, logs, goal)` → `{ done, partlyReached, notYet, total, byHousehold }`. "Done" and "partly reached" come from `isDoneVisit()` and the bv3 `needsAnotherVisit` flag — never re-derived.
- `lib/visits/allOrgProgress.ts` — modify — its own copy of the active-goal rule (~line 220) reads `ended_at is null` too.
- `lib/visits/visitsView.ts` — modify — `goal_history` in `VISITS_TABS`, its label, `visitsViewSchema`, and `visibleVisitsTabs()` (bishopric + anyone holding `visits.manage_goals` for the selected org — decide at bv4 start; default bishopric only, matching D4).
- `lib/visits/queries.ts` — modify — goal reads/writes; `endGoal(goalId, reason)`; `listGoalHistory(orgId)`.
- `app/api/visit-goals/route.ts`, `app/api/visit-goals/[id]/route.ts` — modify — `kind`, start date, end (`{ end: 'completed' | 'set_aside' }`); creating a goal while one is active → **409 with a sentence** ("End the current goal first").
- `app/(app)/visits/GoalWindow.tsx`, `app/(app)/visits/GoalHistory.tsx` — create.
- `lib/visits/progress.ts` — modify — `selectActiveGoal` reads `ended_at is null`.
- Tests: `tests/lib/visitSweep.test.ts` (create), `tests/routes/visitGoals.test.ts` (create or extend), `tests/rls/visit-goals-history.test.ts` (create — unique active goal, ended goals readable).

### bv5 — Assign → To Do
- `supabase/migrations/103_visit_assignments.sql` — create — P9 table, `todos.visit_assignment_id` + partial unique index (copy `todos_one_open_zoom_link_todo_per_owner` in 095), `todos_closed_reason_check` gains `reassigned`, `unassigned`; `todo_log_entries_kind_check` gains `visit_assigned`, `visit_reassigned`, `visit_partly_reached`; release policy. **The latest full lists of both checks are in `095_zoom_link_pool_and_invitees.sql`** — start from those and `TODO_CLOSED_REASONS` / `TODO_LOG_KINDS` in `types/domain.ts`, or a value added since 089 is silently dropped.
- `lib/visits/visitsView.ts` — modify — `my_visits` tab (bishopric only).
- `lib/visits/assignments.ts` — create — `assignHouseholds()`, `reassign()`, `unassign()`, `listAssignments()`; ends rows, never deletes.
- `lib/todos/visitLinks.ts` — create — `createVisitTodo`, `closeVisitTodos(householdId, reason, line)`, `addLineToVisitTodo`.
- `app/api/visit-assignments/route.ts` (POST bulk assign, GET), `app/api/visit-assignments/[id]/route.ts` (PATCH reassign / unassign) — create — `visits.assign` + bishopric; `findUsersOutsideWard()` + bishopric-calling check; audit with ids only.
- `app/api/visits/route.ts` — modify — after a done visit: `closeVisitTodos` + end assignment `visited`; after a partly-reached visit: line only.
- `lib/todos/queries.ts`, `app/api/todos/[id]/route.ts`, `app/(app)/todos/TodoCard.tsx`, `lib/todos/logLines.ts`, `types/domain.ts` (`TODO_LOG_KINDS`, `TODO_CLOSED_REASONS`, `Todo.visitLink`) — modify — no checkbox, 409 on delete while open, "Open visit" link, sentences for new kinds.
- `app/(app)/visits/AssignWindow.tsx`, `app/(app)/visits/MyVisits.tsx` — create — multi-select households → choose bishopric member; "My visits" tab; each member's share on the progress banner (D4).
- `lib/auth/permissions.ts` — add `visits.assign` (non-overridable).
- Tests: `tests/rls/visit-assignments.test.ts`, `tests/routes/visitAssignments.test.ts`, `tests/lib/visitTodoSites.test.ts` (source-read: only `lib/todos/visitLinks.ts` writes `visit_assignment_id`; only `lib/visits/assignments.ts` writes `visit_assignments`).

### bv6 — Schedule with companions; invites
- `supabase/migrations/104_visit_companion_invites.sql` — create — `visit_appointments.assignment_id`, `visit_appointment_companions`, `is_visit_companion()`, the one SELECT arm, release policy, notification trigger `visit_companion_invited` backfilled for every ward (template: `089_sunday_music_review.sql`'s insert … cross join … on conflict do nothing).
- `lib/visits/companions.ts` — create — `inviteCompanions()`, `respondToInvite(companionId, accept)`, `listPendingInvitesFor(userId)`.
- `app/api/visit-appointments/route.ts` — modify — accept `companions` (users / members / labels; max `MAX_VISIT_COMPANIONS`).
- `app/api/visit-invites/[id]/route.ts` — create — POST accept/decline; only the invited user; service role after the check.
- `lib/appointments/myAppointments.ts`, `lib/appointments/queries.ts` — modify — accepted companion appointments as part of the existing `visit` kind (with `role: 'companion'`), pending invites as a separate list; **one** `buildMyAppointments()` call.
- `app/(app)/appointments/page.tsx`, `app/(app)/visits/InvitesPanel.tsx` (create) — pending invites with Accept / Decline.
- `app/(app)/visits/ScheduleVisitWindow.tsx` — create — date and time on the ward's clock (`wardInputsToInstant`), companion picker (bishopric members first, then roster members, then "use as typed"), notes. Opened from the to-do card (P11) and the contact panel. **Today (after bv3) scheduling is the existing `AppointmentPanel.tsx` form, opened from `ContactPanel`'s `onSchedule` in `HouseholdsPanel.tsx`.** Extract that form into this window and add the companion field, so there is still ONE scheduling form; `AppointmentPanel` keeps the list of appointments.
- Notification copies: `supabase/seed/notification_triggers.sql`, `SPEC.md`, `testing/infrastructure/seedUtils.ts`, `lib/notifications/triggerDefaults.ts`.
- Tests: `tests/rls/visit-companions.test.ts`, `tests/routes/visitInvites.test.ts`, `tests/lib/myAppointments.test.ts` (extend), `tests/db/notification-triggers-seed.test.ts` (must stay green).

### bv7 — Follow-ups and "discuss in bishopric meeting"
- `supabase/migrations/105_visit_followups_and_discussion.sql` — create — `todos.visit_log_id` (FK `on delete set null`), P15 columns.
- `lib/todos/visitLinks.ts` — modify — `createFollowUpTodo`.
- `app/api/visits/[id]/follow-ups/route.ts` — create — POST `{ ownerUserId, title, dueDate? }`; bishopric; owner must hold a bishopric calling.
- `app/api/visits/[id]/route.ts` — modify — `discussInBishopric` toggle; append to an upcoming draft bishopric agenda (P-B) through `lib/agendas/flaggedItems.ts`.
- `lib/agendas/flaggedItems.ts` — modify — third gatherer, bishopric agendas only; one-liner; no note column selected.
- `app/api/agendas/route.ts`, `app/api/agendas/[id]/publish/route.ts` — modify — gather for bishopric; stamp `bishopric_discussed_at` on publish.
- `app/(app)/visits/VisitLogCard.tsx` — create or modify — "Add a follow-up", "Discuss in bishopric meeting" buttons.
- `TodoCard.tsx` — "From a visit to the ___ family" link.
- Tests: `tests/routes/visitFollowUps.test.ts`, `tests/lib/flaggedItems.test.ts` (extend — bishopric gatherer absent from ward council; selects no note column), `tests/routes/agendas*.test.ts` (extend).

### bv8 — Street grouping
- `lib/visits/streetKey.ts` — create — `streetKeyFor(address)` → `{ key, label } | null`.
- `app/(app)/visits/VisitsScreen.tsx` — modify — "Group by street" toggle, remembered.
- Tests: `tests/lib/streetKey.test.ts`.

### Every slice
- `SPEC.md`, `FEATURES.md`, `CLAUDE.md` §9 (one entry for the effort, extended per slice), `plans/prototype/module-map.md` §2.9 (**first task of bv1 — CLAUDE.md §12**), `plans/P4-module-reskins.md` §2 (note that ITER-055 delivers the re-skin and two of the three behaviours), `testing/scenarios/manifest.json` (`npm run manifest`), retro under `plans/retros/`, `plans/retros/INDEX.md`.

---

## Dependencies

- **No new libraries.**
- Existing: `findUsersOutsideWard()` (`lib/callings/queries.ts`), `listBishopricUsers()` (`lib/calendar/queries.ts`), `emitNotification()`, `writeAuditLog()`, `readWardTimezone()`, `wardInputsToInstant()` (`lib/todos/scheduleInstant.ts`), `readPageView`/`writePageView` (`lib/users/userSettings.ts`), `describeHouseholdForVisits()`, `householdVisitPriority()`, `ReportFeed`, `MemberPicker`, `Modal`, `ContextualBackLink`.
- Configuration: **Visits must be released for Buffalo Ward** (Stakes & Wards → Edit released modules). Say so to the user after bv1 deploys.
- Migrations apply to the hosted project with `npm run db:push`, then `npm run db:types`. Apply each slice's migration **after** the user has seen it, never ahead of the code that reads it if it drops anything (none of these drop a column; `bv1` only replaces policies).

---

## Known Pitfalls (from retro context)

- **visits-a** — the private-note boundary is proven at the table; nothing in this plan may select `visit_private_notes` for anyone but its author, and no agenda line may carry a note.
- **visits-b** — the picker and the denominator must come from one function (`describeHouseholdForVisits`). `sweepProgress` takes its output; it does not re-decide which households count.
- **visits-c** — `ReportFeed` is shared with youth. Change it by prop, never fork it.
- **visits-d** — "only opening the page proves the page": every slice is walked at 375px. `replaceParticipants` runs without a transaction; do not build the companion writer the same way — write the appointment and its companions in one SQL function or order them so a failure leaves no half invite (insert appointment → insert companions → on failure delete the appointment it just made, and say so).
- **visits-e** — cadence comparisons are anchored at 2000-07-01; reuse `cadence.ts`, never re-derive. Held-back migrations go in `HELD_BACK_UNTIL_DEPLOYED`.
- **visits-f** — "a rule right for one caller becomes a bug when a second caller inherits it": P4 (all-organizations bishopric-only) is exactly this. And a Server Component list is stale after a client write — `router.refresh()` after assigning.
- **notification-trigger-drift** — four copies of the trigger list plus a backfill; `emitNotification` with an unknown key sends nothing silently.
- **role-access-overrides (ITER-005)** — new permissions must be added to the non-overridable list deliberately; `can()` takes the resolved access as its third argument.
- **zoom-link-pool-and-invitees** — an audit row written after a failure path got skipped; write the audit row on every successful write path, and a source-completed line carries its own sentence.
- **sacrament-finalize-hands-off-asks** — a partial unique index on open to-dos makes a second insert a 23505 that is treated as "already there". On **reassign**, close the old holder's to-do **before** creating the new one, and they are different owners, so the per-owner index never collides — test it anyway.
- **069 (CLAUDE.md §7)** — `assigned_to`, `visit_appointment_companions.user_id` and the follow-up owner are SUBJECT columns from a request body: `findUsersOutsideWard()` on every one.
- **Rule 12** — every formatter names its zone; appointment times in the ward's zone, `date` columns in UTC. `explicitTimeZone.test.ts` must stay green.
- **Memory: compact UI** — results-only lists, small grouped buttons on the title line opening windows, ✕ to remove, windows sized to content, 44px targets. **Memory: remember page view** — tab and street grouping stored on the account.

---

## Tasks

### Task 0 (before bv1): Verify the assumptions on the hosted database — read only
**Action:** With the service role from a scratch script (in the scratchpad, never committed):
- Every ward has **exactly one** `organizations` row with `type = 'bishopric'`. If any ward has zero or several, **stop and ask the user**.
- Count `visit_logs`, `visit_appointments`, `visit_participants`, `visit_goals` rows with `org_id is null`, per ward (P1 backfill size).
- Any (ward, org) with more than one `visit_goals` row (P5's unique index would fail). If any, **stop and ask**.
- Which wards have `settings.cross_org_visibility = true` (D3 day-one grants).
Report the numbers to the user in plain words before writing migration 099.

### Task 1 (bv1): Update the module-map row
**File:** `plans/prototype/module-map.md` (modify)
**Action:** In §2.9 add an ITER-055 note listing the new behaviours of this plan (sharing, sweep goals, goal history, partly reached, assignment → To Do, companions with invites, follow-ups, bishopric discussion, street grouping) and that the `wardVisitSettings` blob behaviour is **superseded** by the sharing table (D3). In §6, confirm Visits is a sub-view machine and list the tabs.

### Task 2 (bv1): Migration 099
**File:** `supabase/migrations/099_visit_org_sharing.sql` (create)
**Details:**
- `099a` ~~P1 backfill~~ — **dropped (P1 revised)**. No visit row is rewritten.
- `099b` `visit_org_sharing`: `id`, `ward_id not null → wards on delete cascade`, `owner_org_id`, `viewer_org_id` (both composite FKs to `organizations (id, ward_id)` on delete cascade), `created_by uuid → users(id) on delete set null` (single-column, per 069), `created_at`; `unique (owner_org_id, viewer_org_id)`; CHECK `owner_org_id <> viewer_org_id`. RLS enabled; SELECT `ward_id = current_ward_id()`; no write policy.
- `099c` `visit_org_visible_to_caller(owner_org uuid) returns boolean language sql stable security definer set search_path = public` — `owner_org = current_org_id() or exists (select 1 from visit_org_sharing s where s.ward_id = current_ward_id() and s.owner_org_id = owner_org and s.viewer_org_id = current_org_id())`. Grant execute to `authenticated`.
- `099d` Drop and recreate the six SELECT policies as `ward_id = current_ward_id() and (is_bishopric() or visit_org_visible_to_caller(org_id))`. Copy each existing policy name. `visit_participants` reads its own `org_id` (it is stamped from the parent).
- `099e` Day-one grants (D3): for each ward with the switch on, insert every ordered pair of its organizations **excluding any pair whose owner is the bishopric org**, `on conflict do nothing`.
- `099f` Restrictive release policy `visit_org_sharing_module_released` using `ward_module_released('visits')` (copy 091's form).
- Header comment: names all six tables, P-A (youth keeps the switch), P4.

### Task 3 (bv1): Library, route, permission
**Files:** `lib/visits/sharing.ts`, `lib/validation/visit.ts`, `app/api/visit-sharing/route.ts`, `lib/auth/permissions.ts`, `lib/access/releasedModules.ts`
**Details:**
- `writeVisitSharing` replaces the ward's grants in one call: delete rows not in the new set, insert new ones. Validate every org id belongs to the ward (read through the caller's client first).
- `visitSharingSchema = z.object({ grants: z.array(z.object({ ownerOrgId: z.uuid(), viewerOrgId: z.uuid() })).max(64) })` with a refine `owner !== viewer`.
- PUT: `assertCan(user, "visits.manage_sharing", access)`; also `isBishopricRole(user.role)` (structural, like `canUsePlanner`). Audit `visit_sharing_updated` with `{ grantCount, added, removed }`.
- Notify the other two bishopric members with `notifyOtherBishopric` (§7: any admin change notifies the other two).

### Task 4 (bv1): Readers stop using the switch
**Files:** visits pages and libs listed under bv1.
**Details:** `canSeeAllOrganizations` becomes `isBishopric`. The organization selector offers `user.orgId` plus every org shared with it (read-only: hide log/goal/stewardship controls when the selected org is not the reader's own; the policies would refuse anyway). Bishopric visits display as "Bishopric" everywhere `org_id null` was "Bishopric/Ward". Relabel the admin toggle "Organizations can see each other's youth follow-ups" and update `lib/ward/crossOrgVisibility.ts`'s header.

### Task 5 (bv1): Sharing panel
**File:** `app/(app)/visits/SharingPanel.tsx` (create)
**Details:** One row per organization: "Who can see the {org}'s visits?" followed by toggle chips for each other organization. The Bishopric row is first and starts empty. Save sends the whole set. Shown as the **Sharing** tab for the bishopric only. Text under the title: "The bishopric always sees every organization's visits. Private notes are never shared."

### Task 6 (bv1): Tests, scenario, docs, retro → commit `bv1`

### Task 7 (bv2): Re-skin
**Action:** Open `prototype/WLT.jsx` L10151–10488 (`VisitsPage`) and L10556–10618 (`HouseholdPriorityCard`) **for structure only — copy no roster data**. Build `VisitsScreen` and `HouseholdPriorityCard` as described under bv2. Keep every existing behaviour reachable (goal panel, stewardship, cadence override, log a visit, flag, private note) — moved into windows, not removed. Pending invites panel is a placeholder slot until bv6. Walk at 375px light and dark. → commit `bv2`.

### Task 8 (bv3): Outcomes and the contact panel
**Details:**
- Migration 101 per P8 _(built as 101; see Status)_.
- `ContactPanel`: lists each member of the household with a phone as `<a href="tel:…">` (44px targets); "No phone number on file." otherwise. **Log a contact attempt** → outcome select (No answer / Left a message / Couldn't leave a message) + notes → writes `outcome 'attempted'`, `visit_type 'phone'`, `attempt_detail`. **Schedule an appointment** → `ScheduleVisitWindow` (bv6 adds companions; bv3 ships it without the companion field).
- `RecordVisitWindow`: Done / Visited — still needs a visit / Attempted; when "still needs" a required reason select (Someone wasn't home · Spouse absent · Asked us to come back · Other) with the notes field labelled "Say more in the report".
- `householdVisitPriority` gains `partlyReachedSince: string | null`; the card shows "Partly reached {date} — {reason}". → commit `bv3`.

### Task 9 (bv4): Goal kinds and history
**Before writing code (bv4 start):**
- **Re-run Task 0's duplicate-goal check, read only** — any (ward, org) with more than one `visit_goals` row. Task 0 found none on 2026-10-31, but nothing in the schema prevents duplicates and Visits may since have been released for Buffalo Ward. If any exist, stop and ask the user; never delete.
- **Ask the user the open question in Testing Strategy:** a household marked done that later gets a "still needs a visit" visit — does it stay done? Default: yes.
- Ask who sees the Goal history tab (default: the bishopric only).

**Details:** Migration 102 per P5 (the duplicate check is a `do` block that raises with a list of `(ward_id, org_id)` if any exist). `GoalWindow`: kind toggle (Visit every household once · Keep visiting on a schedule), start date (default today, ward zone), cadence fields only for cadence. Progress banner for a sweep: "{done} of {total} done · {partly} partly reached · {notYet} not yet", plus per-member shares once bv5 lands. **End goal** → window: "Completed" or "Set aside", confirm sentence "It stays in Goal history." `GoalHistory` tab: each ended goal with kind, dates, end reason, and its final numbers **recomputed against `ended_at`** (the `closed_at` precedent — computed, never stored). → commit `bv4`.

### Task 10 (bv5): Assignment and its to-do
**Details:**
- Migration 103 per P9/P10. Drop and re-add `todos_closed_reason_check` and `todo_log_entries_kind_check` by name with the full lists from `types/domain.ts` plus the new values.
- `AssignWindow`: pick households (checkboxes, with "Select the street" once bv8 exists), pick one of the bishopric (from `listBishopricUsers`), Assign. Already-assigned households show who holds them; choosing them again is a reassign and the window names who loses it and any scheduled visit (D8 warning).
- Reassign order: end old assignment `reassigned` → close old to-do (`closed_reason 'reassigned'`, line "Reassigned to {name}.") → create new assignment → create new to-do. A scheduled appointment is left alone; the warning names it.
- Done visit (any author, any route path where `isDoneVisit()` is true — `POST /api/visits` and a `PATCH /api/visits/[id]` that changes the outcome to done) → end assignment `visited`, `closeVisitTodos(..., "Visited.")`. Partly reached → `visit_partly_reached` line with the reason label.
- Ending the goal ends open assignments `goal_ended` and closes their to-dos with a line "The visit goal ended." (decide with the user at bv5 start whether set-aside should keep assignments open; default: close).
- `MyVisits` tab: my open assignments, each a `HouseholdPriorityCard` with Contact / Schedule / Record buttons.
- Progress banner adds "Bishop 12 of 60 · 1st Counselor 9 of 60 · 2nd Counselor 15 of 60" (by calling label, the D6 rule from `zoom-remote-links` — never he/she).
→ commit `bv5`.

### Task 11 (bv6): Companions and invites
**Details:**
- Migration 104 per P12/P13. `is_visit_companion(appointment uuid)` — security definer, `exists (… where appointment_id = appointment and user_id = auth.uid() and status in ('pending','accepted'))`. Add `or is_visit_companion(id)` to `visit_appointments_select` only.
- `inviteCompanions` writes rows and emits `visit_companion_invited` to each user companion ("{scheduler} invited you to visit the {family} family on {ward-zone date, time}").
- Accept → `accepted`; Decline → `declined`, and the scheduler gets a line on their visit to-do ("{name} can't come.") if one exists.
- `ScheduleVisitWindow` companion picker: bishopric members (invited), "Someone else in the ward" (MemberPicker, recorded), "Use … as typed" (recorded).
- My Appointments: pending invites panel at the top; accepted invites as visits with "with {scheduler}".
→ commit `bv6`.

### Task 12 (bv7): Follow-ups and discussion
**Details:**
- Migration 105 per P14/P15.
- Visit card buttons: **Add a follow-up** (window: what, for whom — bishopric members, default me — and an optional due date) and **Discuss in bishopric meeting** (toggle; when on, the card shows "On the next bishopric agenda" or "Waiting for the next bishopric agenda").
- Agenda line text: `Visit — {family} family — to discuss`. Appended into the agenda's flagged section using `newAgendaItem` with `source: "flag"`, `sourceId: visit_log_id`.
- Publish stamps `bishopric_discussed_at` for every `sourceId` on the published bishopric agenda that is a visit discussion.
→ commit `bv7`.

### Task 13 (bv8): Street grouping
**Details:** `streetKeyFor` as P16. Household list groups by street label in alphabetical order with "No street on file" last; within a group the existing priority order. Toggle remembered. → commit `bv8`.

---

## Testing Strategy

**RLS (highest value)**
- `tests/rls/visit-org-sharing.test.ts` — all six tables, both sides: EQ president reads **no** Bishopric row of any of the six before a grant, reads all six after `(bishopric → EQ)`, and still reads **no** RS row; a grant `(EQ → RS)` lets RS read EQ but not the reverse; writes stay refused across a grant (insert raises; update/delete re-read unchanged); `visit_private_notes` unchanged; `visit_org_sharing` has no write path for any authenticated client (insert raises for the bishop too). Re-read refused writes with the service client (§8).
- `tests/rls/visit-cross-org.test.ts` — **inverted, not deleted**: the switch ON no longer widens any visit table; keep the youth half asserting it still widens `activity_logs`. Write the inversion so it reads as a decision.
- `tests/rls/visit-assignments.test.ts` — bishop sees all; assignee sees own; EQ president sees none until shared; no client can insert.
- `tests/rls/visit-companions.test.ts` — an invited non-bishopric user reads their invite row and that **one** appointment, not other appointments, not the visit log; after decline they lose the appointment.
- `tests/rls/visit-goals-history.test.ts` — a second active goal for one org raises 23505; ended goals stay readable.

**Pure functions**
- `tests/lib/visitSweep.test.ts` — done / partly / not yet; visits before `started_on` ignored; partly then done → done; done then partly → done (a later partial visit does not undo done — **confirm with the user at bv4 start**; default as written); do-not-contact excluded from the denominator.
- `tests/lib/householdStatus.test.ts` — existing cases unchanged; partly-reached does not reset the clock.
- `tests/lib/streetKey.test.ts` — "123 N Main St" and "45 North Main Street Apt 2" group together; blank → null; "PO Box 9" → null.
- `tests/lib/visitSharing.test.ts` — schema refuses owner = viewer; diffing added/removed.

**Source-read guards** (copy `tests/lib/musicReopenSites.test.ts`)
- `tests/lib/visitTodoSites.test.ts` — only `lib/todos/visitLinks.ts` names `visit_assignment_id` / `visit_log_id` in a todos write; only `lib/visits/assignments.ts` writes `visit_assignments`; only `lib/visits/companions.ts` writes `visit_appointment_companions`; only `lib/visits/sharing.ts` writes `visit_org_sharing`; every route that records a visit calls `closeVisitTodos`. Prove each assertion able to fail before believing it.

**Routes** (`tests/helpers/routeClient.ts`)
- Sharing PUT: bishop 200; EQ president 403; audit row written; other two bishopric notified.
- Assign: bishop assigns to counselor1 → to-do exists on counselor1's list; assigning to the EQ president → 400 with a sentence; reassign closes the first to-do with a line and creates the second.
- Done visit closes the to-do; partly-reached adds a line and keeps it open.
- Invite: only the invitee may answer (another user 404); accept shows on My Appointments sources.
- Follow-up: lands on the chosen bishopric member; owner outside the bishopric → 400.
- Discussion: bishopric agenda created afterwards contains the line; a ward council agenda does not; publish stamps it; the line contains no shared-notes text.
- Each route: an unauthorized role gets 403 (check the matrix in `lib/auth/permissions.ts` first).

---

## Test Scenarios (Harness)

Numbers are provisional — use the next free numbers at the time. **As of 2026-11-09: 099 = bv1's sharing scenario, 100 = bv3's `scenario-100-partly-reached-and-a-call`, so the next free is 101.** The three below are renumbered accordingly.

### Scenario 099: Sharing the Bishopric's visits _(built in bv1)_
**Tags:** visits, full, rls
**Purpose:** Proves D1–D3 at the screen. Hard to set up by hand: needs visits from three organizations and a ward that had the switch on.
**Seed data summary:**
- organizations — Bishopric, Elders Quorum, Relief Society
- households — 6, with members
- visit_logs — 2 Bishopric, 2 EQ, 2 RS, each with a shared report and one private note
- ward settings — cross_org_visibility true (to show day-one grants)
- visit_org_sharing — the day-one grants (all pairs except from Bishopric)
**Tester action:** Sign in as the EQ president, open Visits; sign in as a counselor, open Sharing, share the Bishopric with the EQ; sign back in as the EQ president.
**Verification checklist:**
- [ ] Before: EQ president sees EQ and RS visits, **no** Bishopric visit, and no All organizations tab
- [ ] Sharing tab is absent for the EQ president and present for the counselor
- [ ] After sharing: EQ president can select Bishopric (read-only) and sees its two visits, never a private note
- [ ] The other two bishopric members have a notification about the change
- [ ] Admin page's toggle now reads as youth follow-ups only

### Scenario 101: A sweep, partly reached, and goal history (bv4)
**Tags:** visits, full
**Purpose:** States the clock and the data decide: a sweep partway through with done, partly reached and not-yet households, plus an ended goal.
**Seed data summary:**
- visit_goals — one ended (set aside) cadence goal, one active sweep started 30 days ago
- households — 10; visit_logs: 4 done, 2 "still needs a visit" (spouse absent, not home), 1 attempt, 1 done **before** the start date
**Tester action:** Open Visits as the bishop.
**Verification checklist:**
- [ ] Banner reads "4 of 10 done · 2 partly reached · 4 not yet"
- [ ] The household visited before the start date counts as not yet
- [ ] A partly reached card names its reason
- [ ] Goal history lists the set-aside goal with its dates and final numbers
- [ ] Creating a second goal is refused with a sentence; End goal → Completed moves it to history

### Scenario 102: Assign, schedule with a companion, accept (bv5 + bv6)
**Tags:** visits, todos, appointments, full
**Purpose:** The whole flow across three accounts.
**Seed data summary:** an active sweep; 6 households; none assigned
**Tester action:** As the bishop, assign 3 households to the 2nd counselor and 3 to yourself. As the 2nd counselor, open To Do → Schedule a visit with the 1st counselor as companion. As the 1st counselor, accept. As the 2nd counselor, record a done visit and a partly-reached visit.
**Verification checklist:**
- [ ] Each assignee's To Do has one "Visit the ___ family" per household, with no checkbox
- [ ] The scheduled visit appears once on the 2nd counselor's My Appointments
- [ ] The 1st counselor sees a pending invite (bell, My Appointments, Visits), and after Accept it is on their My Appointments
- [ ] The done visit closed its to-do; the partly-reached one stayed open with a line
- [ ] Reassigning a household closes the old to-do with "Reassigned to …" and warns about the scheduled visit

### Scenario 103: Follow-up and bishopric discussion (bv7)
**Tags:** visits, agendas, todos, full
**Seed data summary:** a recorded bishopric visit; a draft bishopric agenda dated next week; a draft ward council agenda
**Tester action:** On the visit, add a follow-up for the 1st counselor and turn on Discuss in bishopric meeting.
**Verification checklist:**
- [ ] The 1st counselor's To Do has the follow-up, linking back to the visit
- [ ] The draft bishopric agenda has "Visit — ___ family — to discuss"; the ward council agenda does not
- [ ] The line contains none of the report text
- [ ] Publishing the bishopric agenda, then creating the next one, does not repeat the line

bv2 and bv8 need no seeded scenario of their own; they are walked on scenario 101's data at 375px in light and dark (street grouping needs the seeded addresses: give scenario 101's households addresses on three streets plus one blank).

---

## Validation Commands

Run after each slice, in order:

```bash
# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests (full suite — RLS suites run against the hosted project)
npm test

# Production build
npm run build
```

After a migration: `npm run db:push`, then `npm run db:types`, then the commands above. After a scenario: `npm run manifest`.

---

## Integration Notes

- **What changes for people outside the bishopric on the day bv1 deploys:** org leaders in a ward with the switch on **lose sight of Bishopric visits** (D3) and of the all-organizations page (P4); they keep each other's. This is the decision, not a regression — say it in the retro and in CLAUDE.md §9.
- **CLAUDE.md §9 entries to update, not just append to:** "Cross-org visibility widens an organization's whole PROGRESS" (visits no longer use the switch), "An organization claims households only if it has a visit goal" (now bishopric-only because grants are per pair), and the youth entries that cite the switch (unchanged behaviour, new label). Add one new entry for ITER-055 and extend it per slice.
- **Ward secretary and executive secretary** hold `visits.*` but usually have no organization, so `current_org_id()` is null and grants give them nothing; they see their own org-less writes only. Unchanged by this plan; record it as the cost, like `ward_council_member` on youth follow-ups. Do not special-case a role (rule 2).
- **Goals retirement (P4 §2)** — the old `goals` table is **not** retired here. It stays a separate P4 item, one problem at a time.
- **ITER-058** — when logins link to roster members, companion members could receive invites. Nothing here assumes either outcome.
- **The Planner** has its own lists; no pipeline to or from it.
- **Release:** every new table (`visit_org_sharing`, `visit_assignments`, `visit_appointment_companions`) joins the visits module's `tables` in `lib/access/releasedModules.ts` **and** gets its restrictive policy in its migration; `tests/db/module-release-policies.test.ts` checks both directions.
- **Docs per slice:** SPEC.md (schema, routes), FEATURES.md (Visits module text), module-map §2.9, P4 §2 note, retro, retros INDEX.
