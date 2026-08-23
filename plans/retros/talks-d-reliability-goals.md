---
id: talks-d-reliability-goals
type: feature
iter: null
commits: ["0fe6564"]
date: 2026-08-22
files:
  - lib/assignments/reliabilityFlags.ts
  - lib/goals/goalStatus.ts
  - lib/goals/alertDismissal.ts
  - lib/goals/queries.ts
  - lib/validation/goal.ts
  - lib/assignments/queries.ts
  - lib/calendar/dates.ts
  - supabase/migrations/029_goal_status_refresh.sql
  - supabase/migrations/030_goals_org_scope.sql
  - app/api/goals/route.ts
  - app/api/goals/[id]/route.ts
  - app/api/members/[id]/speaker-history/route.ts
  - app/(app)/goals/page.tsx
  - app/(app)/goals/GoalBoard.tsx
  - app/(app)/roster/member/[id]/SpeakerHistoryTab.tsx
  - app/(app)/roster/member/[id]/page.tsx
  - app/(app)/assignments/[sunday_id]/page.tsx
  - app/(app)/assignments/page.tsx
  - app/(app)/assignments/MonthPlannerBoard.tsx
  - app/(app)/assignments/AssignmentModal.tsx
  - app/(app)/assignments/SpeakerField.tsx
  - app/(app)/calendar/page.tsx
  - components/goals/GoalAlerts.tsx
  - components/goals/GoalAlertBanner.tsx
  - components/goals/GoalStatusBadge.tsx
  - components/roster/ReliabilityFlag.tsx
  - components/roster/MemberPicker.tsx
  - components/calendar/SundayCell.tsx
  - types/domain.ts
  - plans/04-talks-pipeline.md
  - SPEC.md
related:
  - talks-a-pipeline-core
  - talks-b-month-planner
  - talks-c-prayers-topics
  - roster-b-picker-and-orgs
  - calendar-a-rules-and-api
  - calendar-b-month-view
  - foundation-c-services
---

## What was done

The two features that read what the pipeline wrote, and the close-out of Phase 4. A bishopric-only
speaker reliability profile on the member detail page — four pattern flags computed by a pure,
boundary-tested function over `assignment_history` — and a goals board whose overdue items reach the
bishopric while they plan. `roster-b`'s `ReliabilityFlag`, which had rendered nothing since it was
created, now renders real flags on two surfaces.

Both features were walked in a browser before they were called done, and **the walk changed the
design of one of them and the schema of the other**. Goal alerts shipped on the calendar as the
phase plan specified, were rejected as clutter, and moved to the Sunday planning page as a
dismissible banner. Goals shipped ward-scoped with a recorded Phase 11 asymmetry, and that
asymmetry was closed here instead by migration 030.

## Key decisions

- **Speaker history is a separate call and a separate route, never a field.** `GET
  /api/members/[id]/speaker-history` exists so that reliability data can never ride along on a
  member response somebody did not review — CLAUDE.md rule 9 run in reverse, and the phase's stated
  pitfall. Three boundaries stack: the RLS policy (the real one), `talks.view` (the module gate),
  and an explicit bishopric check that turns a silent empty array into an honest 403. Proven from a
  browser signed in as a ward secretary, who holds `talks.view` and is refused anyway.
- **Both pure rules take `asOf` as a parameter.** `reliabilityFlags()` and `goalStatus()` never read
  the clock, which is what makes every boundary testable on the exact day. It also let the planning
  page ask "what is overdue *by this Sunday*" rather than only "what is overdue today".
- **`goals.status` is never selected.** The phase plan calls the column a cache and the computed
  value the truth; leaving it out of `GOAL_COLUMNS` makes that structural instead of a rule to
  remember. Migration 029 keeps the column current for a future report. Scenario 019 seeds the
  column deliberately WRONG, so a board that ever agrees with it has a bug.
- **Goal alerts live where somebody can act on them, not where they are always visible.** The phase
  plan said calendar cells. Three overdue goals wrap to nine lines in a ~130px grid column, on every
  Sunday of every month, whether or not anyone is planning — a warning that is always on is a
  warning nobody reads. They moved to the Sunday planning page, dismissible for the month.
- **Goals are org-scoped, by copying a policy that already existed.** `visit_goals` has been
  org-scoped since migration 019; migration 030 gives `goals` the identical shape rather than
  inventing one. `org_id` null is a ward-level goal the bishopric alone sees. Ownership is stamped
  from the session and cannot be named by the request or moved by a PATCH.

## Deviations from the plan

1. **Migration numbers are 029 and 030, not the plan's 027.** 027 and 028 were taken. Same collision
   `talks-c` recorded; check the directory, not the plan.
2. **Scenarios are 018 and 019, not 016 and 017** — those were taken by `talks-c`. Check
   `testing/scenarios/manifest.json` before numbering.
3. **`goalStatus()` takes a fourth parameter, `createdAt`.** "Never fulfilled counts as overdue once
   the interval has passed since creation" is unanswerable without it — with only a null fulfilment
   date, a goal created this morning and one created three years ago are the same value.
4. **`SpeakerHistoryEntry.outcome` and `.sundayDate` are nullable**, which the plan's signature did
   not anticipate. Migration 005 declares `outcome` with no NOT NULL, and `assignment_id` is
   `on delete set null` — so a history row can outlive the assignment that dated it. Typing them
   non-null would mean inventing a value to satisfy the type.
5. **`target_type: 'group'` is readable but not creatable.** The route must verify a target resolves
   to a live row, because `target_id` carries no foreign key. There is no `groups` table, so a group
   target could never be verified.
6. **The plan was wrong that nothing sets `showFlags`.** `SpeakerField` has set it since `talks-b`,
   rendering a deliberate no-op. Wiring it meant a `flags` prop on `MemberPicker` (raised, per
   roster-b's rule for that frozen interface) threaded from `app/(app)/assignments/page.tsx` through
   `MonthPlannerBoard` and `AssignmentModal` — built once per page from one bishopric-only read.
7. **`ASSIGNMENT_TYPE_LABELS` moved** from `AssignmentModal` to `types/domain.ts` when the history
   table became its second reader.
8. **The third reserved region on `SundayCell` is open again**, and the prop was deliberately NOT
   removed. `min-h-40` was never the constraint that failed — the cells fitted three regions without
   resizing. What failed was this content's density at that width.

## Pitfalls hit

- **`formatSundayLabel()` renders no year**, and that is correct on a calendar where the month you
  are viewing supplies it. In a speaking-history table spanning years it is a bug: a member's 2024
  and 2026 rows both read "Sunday, June …" while the flag above them said "has not spoken in two
  years". Found by walking scenario 018, fixed with a sibling formatter. **A formatter's correctness
  is a property of its context, not of the formatter.**
- **Dropping a policy is not the same as replacing one.** PostgreSQL ORs permissive policies
  together, so a surviving `goals_ward_select` alongside the new `goals_org_select` would have left
  every read ward-wide while the migration reported success. `tests/rls/goal-access.test.ts` asserts
  the EQ president sees exactly one goal *across the whole ward*, which is the check that catches it.
- **`org_id = current_org_id()` is never true when both are null.** That is what makes a ward-level
  goal bishopric-only, and it falls out of SQL's null semantics rather than any clause — so it is
  asserted explicitly, and the route refuses to create a goal that would land in that hole.
- **A walk can report a false defect if it reads too early.** "Mark fulfilled" appeared not to work;
  it takes ~2.5s against the hosted project, and the audit row proved the first click had landed.
  Read back from the source of truth before calling something broken.
- **Client-only state that the server renders around is a flash, not a detail.** The banner read
  its dismissal from `localStorage`, which the server cannot see — so the server rendered it for
  everybody and the client removed it on hydration. That paints a dismissed banner and then takes
  it away: **268 ms** unthrottled, **645 ms** at 4x CPU, **3.8 s** at 20x, measured with a pre-paint
  `requestAnimationFrame` sampler under CDP throttling. Moving the value to a cookie let the Server
  Component decide, which removed the flash AND deleted `useSyncExternalStore` and its subscribe
  plumbing. The lesson generalises: if the server renders a thing whose visibility only the client
  knows, the server is guessing, and a wrong guess is visible. The app already had the right
  instinct for the theme (`app/layout.tsx` runs a pre-paint script); a cookie is the same idea with
  less machinery.
- **Never run `npm run seed` while the test suite is running.** Both target the same hosted ward;
  seeding mid-run deletes the fixtures out from under the RLS suites.

## Known gaps

- **`late_canceller` is implemented, tested, and dormant.** No code path writes an
  `assignment_history` row with `outcome = 'cancelled'` or a `cancellation_days_notice` —
  `writeAssignmentHistory()` writes only `declined` and `completed`. The flag exists because §Step 8
  specifies it, and scenario 018 seeds its row by hand. Whoever builds a cancellation path owns
  making it real.
- **Four of the nine pipeline notification triggers still fire from nothing.**
  `message_approved_ready`, `sunday_confirmation_request`, `issue_flagged_post_sunday` and
  `appreciation_comments_ready` are seeded and emitted by no code. Phase 5 and Phase 11 own three of
  them; `issue_flagged_post_sunday` has no surface at all.
- **`pg_cron` is not enabled**, so `refresh_goal_status()` is manual-only. Nothing depends on it,
  because nothing reads the column it maintains.
- **The banner's dismissal is a cookie** — per browser, not per user. The cheap deliberate choice;
  if a ward wants it to follow them across devices, that belongs with Phase 11's notification
  settings. It started as `localStorage` and moved after the flash it caused was measured (see the
  pitfall below).
- **`members`, `households` and `member_organizations` still carry the ward-wide-RLS asymmetry**
  that goals had. Phase 11 inherits three, not four.
- **Scenario 018 was walked; scenario 019's current form was not.** Its banner and ownership checks
  were written after the walk that produced them, and were verified by an agent in a browser rather
  than by a person. Its older walkthrough record is marked as describing the superseded design.
- **SMS handoff is still unverified on a real handset**, which is the one Definition of Done item
  Phase 4 closes without ticking.
