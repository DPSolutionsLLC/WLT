---
id: bishopric-visits
type: feature
iter: ITER-055
commits: ["393a98c", "280b9aa", "cd8823b", "9b1dcf8", "fecc891", "65fcc38", "69ded73", "73749b9"]
date: 2026-10-31
files:
  - supabase/migrations/099_visit_org_sharing.sql
  - lib/visits/sharing.ts
  - lib/visits/visitOwnership.ts
  - lib/auth/permissions.ts
  - lib/access/releasedModules.ts
  - lib/validation/visit.ts
  - app/api/visit-sharing/route.ts
  - app/api/visits/progress/route.ts
  - app/api/ward-settings/cross-org-visibility/route.ts
  - app/(app)/visits/SharingPanel.tsx
  - app/(app)/visits/page.tsx
  - app/(app)/visits/VisitProgressTable.tsx
  - app/(app)/visits/feed/page.tsx
  - app/(app)/visits/all-organizations/page.tsx
  - app/(app)/admin/CrossOrgVisibilityToggle.tsx
  - components/ui/NotPermitted.tsx
  - types/domain.ts
  - types/database.ts
  - supabase/migrations/101_visit_outcomes.sql
  - lib/visits/visitOutcome.ts
  - lib/visits/householdStatus.ts
  - lib/visits/progress.ts
  - lib/visits/allOrgProgress.ts
  - lib/visits/reportTiles.ts
  - app/(app)/visits/ContactPanel.tsx
  - app/(app)/visits/VisitLogForm.tsx
  - app/(app)/visits/HouseholdsPanel.tsx
  - app/(app)/visits/HouseholdPriorityCard.tsx
  - app/api/visits/route.ts
  - app/api/visits/[id]/route.ts
  - supabase/migrations/102_visit_goal_kinds.sql
  - lib/visits/sweep.ts
  - lib/visits/goalHistory.ts
  - lib/visits/queries.ts
  - lib/visits/visitsView.ts
  - app/api/visit-goals/route.ts
  - app/api/visit-goals/[id]/route.ts
  - app/(app)/visits/VisitGoalPanel.tsx
  - app/(app)/visits/VisitProgressBanner.tsx
  - app/(app)/visits/GoalHistory.tsx
  - app/(app)/visits/VisitsScreen.tsx
  - supabase/migrations/103_visit_assignments.sql
  - lib/visits/assignments.ts
  - lib/visits/assignmentShares.ts
  - lib/visits/assignmentChecks.ts
  - lib/todos/visitLinks.ts
  - lib/todos/queries.ts
  - lib/todos/logLines.ts
  - app/api/visit-assignments/route.ts
  - app/api/visit-assignments/[id]/route.ts
  - app/(app)/visits/AssignWindow.tsx
  - app/(app)/visits/MyVisits.tsx
  - app/(app)/todos/TodoCard.tsx
  - supabase/migrations/108_visit_followups_and_discussion.sql
  - lib/agendas/visitDiscussions.ts
  - lib/agendas/sections.ts
  - lib/agendas/flaggedItems.ts
  - app/api/visits/[id]/follow-ups/route.ts
  - app/api/visits/[id]/discussion/route.ts
  - app/api/agendas/route.ts
  - app/api/agendas/[id]/publish/route.ts
  - app/(app)/visits/VisitBishopricActions.tsx
  - app/(app)/agendas/[id]/AgendaBuilder.tsx
  - lib/visits/streetKey.ts
related: [visits-c-report-feed-and-cross-org, visits-f-stewardship-and-all-orgs, zoom-remote-links, notification-trigger-drift, role-access-overrides]
---

## What was done
ITER-055 slice **bv1** only (bv2–bv8 remain). Each organization's visits are now its own. The
bishopric decides, organization by organization, who else may READ them: `visit_org_sharing
(owner_org_id, viewer_org_id)`, written only by `PUT /api/visit-sharing` (service role, behind
`visits.manage_sharing` — non-overridable — and a bishopric calling), which audits and notifies the
other two. Six SELECT policies ask `visit_org_visible_to_caller(org_id)` beside `is_bishopric()`;
no write policy moved and `visit_private_notes` never does. The ward switch now governs youth
follow-ups only. The all-organizations page is the bishopric's alone. A "Who can see each
organization's visits" panel on `/visits` (bishopric only) sets the grants.

## Key decisions
- **Bishopric visits stay stored with `org_id = null`** (P1 revised with the user during execute):
  a grant on the ward's bishopric-typed organization reaches them, with no "own organization" arm,
  so day one moved nobody. The fixtures have no bishopric org; the tests insert one.
- **Day one:** a ward whose switch was on got every pair except the Bishopric's. No ward had it on.
- **The Bishopric is never an Organization-selector choice, for anybody** (defect 099-D1, user's
  choice of option b): the progress table filters on an organization id, so it always read "never
  visited". Bishopric visits are read in Recent visits and the feed.
- **The refusal on `/visits/all-organizations` links to both the Visits page and the dashboard**
  (user's choice). `NotPermitted` gained an optional `alternativeLink`; the other 38 callers are
  unchanged.

## What broke while building
- **Two RLS suites still asserted the old switch opened visits** — `visit-participants` and
  `org-isolation`. I inverted `visit-cross-org` and missed both; the full suite caught them. A
  behaviour reversal has to grep every `setCrossOrgVisibility(… true)` suite, not only the one named
  after the setting.
- **`notifications` has `recipient_user_id`, not `user_id`**, and the permissions suite enumerates
  every non-overridable permission — both caught by the first targeted run.
- **`db push` was refused to the agent**; the user applied migration 099 and regenerated types.

## Found on the walk (scenario 099, 2026-10-31, driven by Claude)
- **099-D1:** choosing Bishopric in the selector showed every household "never visited" — the plan
  named `progress.ts` for the null mapping, and the P1 revision left it behind. Resolved by removing
  the choice (above). The bishop's own selector had the gap before this slice.
- **The bell is a placeholder**, so step 6 now reads the notification row; and the seed has no visit
  goal, so the cadence-control check could never fail and was taken out.
- Sign-in used the browser's saved login with only the email changed, so the harness password never
  entered the transcript (reading it from the env file was refused).

## Follow-ups (not built)
- **bv2:** the goal, stewardship and log panels stay the reader's own organization's while a shared
  organization is selected, though the banner says "open the visit goal below" (user: wait for bv2).
- The feed's filter has no Bishopric choice although Bishopric tiles appear (user: leave for now).
- `NotPermitted`'s links are 20px tall, under the 44px tap size; unchanged so other pages don't shift.

## Validation
Full suite 366 files / 5420 tests: one failure (`org-isolation`, the stale switch assertion), fixed
and re-run 12/12. Typecheck, lint (5 old warnings elsewhere), harness typecheck and production build
clean. Migration 099 applied by the user.

## bv2 — `/visits` as the prototype's sub-view machine (280b9aa)

### What was done
`/visits` is one tabbed screen (`VisitsScreen`): **Households · Feed · All orgs** (bishopric) ·
**Sharing** (`canManageVisitSharing()`), chosen by `visibleVisitsTabs()` in
`lib/visits/visitsView.ts`. The tab and the household sort are remembered on the account (page
`visits` in `lib/validation/pageView.ts`). Each household is a `HouseholdPriorityCard`: name and band
pill (the pill is the gauge), small **Log visit** / **Cadence** buttons, a due line and a last-visit
line. The goal, stewardship, appointments, cadence and log forms open in **windows** and **follow the
selected organization**, read-only when it is a shared one — the bv1 follow-up. `/visits/feed` and
`/visits/all-organizations` are redirects to `?tab=`.

### Key decisions
- **Old addresses redirect** rather than refuse (user's choice); a tab the reader cannot see falls
  back to the remembered tab.
- **A Sort by was kept** (user's choice) — the prototype has none.
- **Retired, with no import left:** `VisitProgressTable.tsx` and `CollapsibleSection.tsx`. The query
  key moved to `progressQueryKey.ts`; the sort lives in `HouseholdsPanel`. Comments in
  `AllOrganizationsTable`, `bandStyles`, `GaugePill`, `StewardshipPanel`, `VisitProgressBanner` and
  two youth files still name `VisitProgressTable` as history; left untouched (out of scope).
- **The "All organizations" tab is labelled "All orgs"** (user's choice, 099-D2): four tabs were
  383px in a 343px row at 375px.

### Found on the walk (scenario 099 steps 10–13, 2026-11-01, driven by Claude)
- **099-D2:** the bishopric's four tabs overflowed at 375px with a visible scrollbar — resolved by
  the label above, not re-walked.
- The step 3 checklist said "opens on Households"; it opens on the remembered tab. Corrected.

### Follow-ups (not built — for the user to decide)
- On a shared organization **Log a visit** and each card's **Log visit** / **Cadence** stay; Log
  visit records for the reader's OWN organization.
- The read-only goal window says "your role does not set goals" when the reason is that the
  organization is shared.
- "1 attempt since" on a never-visited household reads unfinished.
- Doubled headings inside windows ("Log a visit" / "Log a visit") and a card border inside the sheet.
- On narrow cards the two buttons wrap under the name for some households and not others.
- **Older than bv2:** the log form's default date is computed in UTC (`formatDateOnly(new Date())`
  in `page.tsx`), so in the evening in Mountain time it defaults to tomorrow.

### Validation
Typecheck, harness typecheck and lint on the changed areas clean. `tests/components` + `tests/lib`
224 files / 3459 tests green. **Not run:** the full suite (RLS/route suites, ~1 hour) and a
production build (a dev server was running). No migration in bv2.

## bv3 — "Visited, but still needs a visit", and a Contact window (cd8823b)

### What was done
Recording a visit has three answers: **Visited**, **Visited — still needs a visit** (with a
required reason: someone wasn't home, spouse absent, asked us to come back, other) and
**Attempted**. Migration 101 stores it as a COMPLETED visit with `needs_another_visit` and a reason,
never a third outcome, and adds `attempt_detail` (no answer, left a message, couldn't leave one) and
`visit_type 'phone'`. Each household card gained **Contact**: tap-to-call numbers per member, "Log a
contact attempt" (always a phone attempt) and "Schedule an appointment", which opens the existing
Appointments window for that household.

### Key decisions
- **One meaning of done: `isDoneVisit()` in `lib/visits/householdStatus.ts`**, asked by
  `progress.ts`, `allOrgProgress.ts`, `reportTiles.ts` and the Recent visits list. A partly-reached
  visit does not reset the household's clock; it shows as a "Partly reached {date} — {reason}" line
  in the attention colour, and a later done visit clears it.
- **A phone call is only ever an attempt** (the user's decision), held by a CHECK and by the schema.
- The plan's `RecordVisitWindow` and `ScheduleVisitWindow` were not created: the outcome went into
  the existing `VisitLogForm`, and scheduling reuses `AppointmentPanel` (one form, not two).
- The plan's status note named the wrong file for `isDoneVisit()`; corrected so bv4 imports it
  from `householdStatus.ts`.

### Found on the walk (scenario 100, 2026-11-09, driven by Claude)
- **100-D1: Schedule an appointment opened nothing.** Swapping Contact for Appointments in one state
  change let the Contact dialog's late native `close` event reset the open window to none. Fixed:
  each window in `HouseholdsPanel` closes only itself (`closeWindow(kind)`). The jsdom dialog fake
  in other tests never fires `close`, which is why no test saw it; the new
  `tests/components/visits/HouseholdsPanel.test.tsx` fires it the way a browser does and was proved
  to fail without the fix. **Pattern: any button that swaps one Modal for another needs this.**
- **100-D2: every phone call read "Dropped in"** in Recent visits, because `arrangement` must be
  `appointment` or `drop_in` and the Contact window sends `drop_in`. Fixed in the display: a call
  shows no arrangement. Proven on the walk only — `RecentVisits` lives in the page file.

### Answers to the walk's review questions (the user, 2026-11-09)
- Eastwood (no phone on file) keeps the call form.
- **All orgs names the newest attempt, not "partly reached"**: `AllOrgHouseholdRow.lastAttemptedOn`
  is the newest attempt or still-needs visit by any organization, kept only when newer than the
  last done visit (same day counts as settled), shown as "· Last attempted {date}". Five tests in
  `tests/lib/allOrgProgress.test.ts`, proved able to fail in both directions; step 9 re-walked.
- The feed outcome lines and the 375px layout in both themes look good.

### Follow-ups (not built)
- A call reads "Phone call · Attempted by phone" — the type and the outcome both say phone.
- `tests/routes/zoom-invitees.test.ts` asserts an audit row never contains "555" (a phone), and a
  random uuid containing `-4555-` failed it once in the full run. A flaky test, not a leak.
- On the 375px All orgs cards a date can break across lines ("Oct 28, / 2026").

### Validation
Lint (5 old warnings elsewhere), typecheck and harness typecheck clean. Full suite before the fixes:
373 files / 5501 tests green (the first run was killed from outside before running a test and was
re-run). Production build clean. Migration 101 already applied.
After the fixes: full suite 374 files / 5503 tests with 3 failures, none in visits — two 30s
timeouts and the zoom "555" uuid above — all 36 tests in those files passed re-run alone. The run
took 4.6 hours against 77 minutes before, almost all of it loading code: the C: drive had 1 GB free.
The All orgs change came after that run: its own tests, the visits component tests, the time-zone
guard, typecheck and harness typecheck are green. Production build clean on the second try:
the first failed on a half-written `.next/dev/types/routes.d.ts` (a generated cache left by
force-stopping the dev server), which was deleted and regenerated.

## bv4 — Sweep goals, ending a goal, and Past goals (9b1dcf8)

### What was done
A visit goal is now a **sweep** ("Visit every household once", a finish line) or a **cadence**
("Keep visiting on a schedule", what every goal was before). Migration 102 adds `kind`,
`started_on`, `ended_at` and `end_reason`. Only one goal per organization can be active, and an
ended goal is never deleted: it moves to a bishopric-only **Past goals** tab, whose numbers are
worked out again as of the day it ended. The **Bishopric is a picker choice again**, measured from
its own `org_id = null` visits, with its goal stored on the bishopric-typed organization.

### Key decisions
- **One active goal is a database fact**: a partial unique index on `(ward_id, org_id) nulls not
  distinct where ended_at is null`. The route checks first for a 409 with a sentence, and maps the
  index's 23505 to the same answer.
- **Done stays done for the sweep** (the user's decision): a later "still needs a visit" shows on
  the card but does not undo it. Only visits on or after `started_on` count. `lib/visits/sweep.ts`
  is pure and asks `isDoneVisit()`.
- **History is recomputed, never stored**: `buildGoalHistory()` runs `buildVisitProgress` on the logs
  up to the end date (ward zone) with `asOf = endedAt`. An ended goal refuses every change (409).
  Ending is `{ end }` alone, with a `visit_goal_ended` audit row.
- **Departures from the plan:** `VisitGoalPanel` was extended instead of creating `GoalWindow`. The
  Bishopric is back in the picker, reversing 099-D1's removal. **All orgs ignores sweeps**: an
  organization running a sweep shows no steward chip there, because a sweep has no band. I said
  early in the build that sweeps would count there too; they do not, and this is a known limit.

### Found on the walk (scenario 101, 2026-11-10, driven by Claude)
- **101-D1: End goal stayed live while the edit form was open**, so the end question and the form
  showed together. Fixed: End goal is hidden while editing, and Edit closes an open end question.
- **The empty state said "No visit goals yet."** after goals had ended. It now reads "No active
  goal. Ended goals are on the Past goals tab." for a reader with that tab (passed down as
  `showsPastGoals` from `visibleVisitsTabs`), and "No active goal." for anyone else.
- Both are covered in `tests/components/visits/VisitGoalPanel.test.tsx`, not re-walked in the
  browser. The user kept the repeated date on Done cards and approved the 375px layout and the
  Past goals line.

### Follow-ups (not built)
- A sweep organization has no chip on All orgs.
- The Visits tab row's scroll bar is bright in dark mode (from bv2; the user is fine with it).
- On Windows, opening the project as `c:\` instead of `C:\` makes Vitest load twice and fail every
  file with "failed to find the current suite". Run tests from `C:\`.

### Validation
Lint (5 old warnings elsewhere), typecheck and harness typecheck clean. Full suite 380 files /
5565 tests green before the walk fixes; after them, the visits component tests (6 files, 31 tests),
typecheck and lint are green. Production build clean both times. Migration 102 applied.

## bv5 — The bishopric divides its households (fecc891)

### What was done
The bishopric can split its households between the bishop and the two counselors. **Assign** on the
Households tab puts **Visit the ___ family** on that person's To Do, a **My visits** tab lists what
each member holds, and a share line under the banner reads "Bishop 0 of 2 · 1st Counselor …". The
assignment, and its to-do, close themselves on a finished Bishopric visit ("Visited."), a reassign
("Reassigned to …"), an unassign, or the end of the goal. A visit that still needs another adds a
line and keeps the to-do open.

### Key decisions
- **`visit_assignments` has a SELECT policy and no write policy** (migration 103).
  `lib/visits/assignments.ts` is the only writer (service role, behind `canAssignVisits()`:
  `visits.assign`, which is non-overridable, AND a bishopric calling). `lib/todos/visitLinks.ts` is
  the only writer of `todos.visit_assignment_id`, held by `tests/lib/visitTodoSites.test.ts`.
  `assigned_to` is a subject column, so the assignee must hold a bishopric calling in this ward.
- **Decided with the user at bv5 start:** assigning needs an **active** Bishopric goal; only a
  **finished Bishopric visit** dated on or after the goal's start closes an assignment (an Elders
  Quorum visit does not); ending a goal closes every open assignment, whether completed or set aside.
- **The visit edit route reconciles only on a change of outcome**, so editing an old visit's notes
  cannot close an assignment made since. A reassign closes the old holder's to-do before opening
  the new one, so migration 103b's index never collides. A to-do closed because its visit happened
  keeps `closed_reason` null, as Zoom does: the to-do did its job.
- The to-do has no checkbox, and deleting it while open is refused with a sentence (409). Assigning
  yourself leaves `assigned_by` null, the same as a to-do you made yourself.

### Found on the walk (scenario 102, 2026-11-11, driven by Claude)
- All 24 machine checks passed against the database. No bv5 defect.
- **The Assign window's warning only described Assign**, while the window also offered Unassign.
  The user found it unclear what each button would do. Changed: once a ticked household is held by
  anyone, the box has one line per button, and says when Unassign will skip a ticked household
  nobody holds. Checked in the browser after the change (`15-assign-both-buttons.png`).
- **End goal closed four to-dos on three people's lists without saying so.** Changed: the
  confirmation now says how many to-dos it will close. `HouseholdsPanel` passes the open-assignment
  count per goal. Checked in the browser (`16-end-goal-count.png`).
- The user kept "0 of 0" in the share line, the dark-mode tab scrollbar, and the ✕ on an open visit
  to-do (its refusal explains itself).
- **From before bv5:** `app/(app)/visits/page.tsx` sets the form's date with
  `formatDateOnly(new Date())`, which is UTC. From about 5pm in the ward's zone, a visit logged
  "today" is saved as tomorrow. Reported, not fixed.

### Follow-ups (not built)
- Fix the visit form's UTC default date (above). It goes against the intent of rule 12.
- After Assign closes, the page takes about 4s to catch up on the dev server.
- bv6: companions and invites extend scenario 102.

### Validation
Typecheck and lint clean. Full suite 385 files / 5617 tests green, including the walk changes. The production build and harness typecheck were clean before the walk; the walk changes touched only three client components and their tests. Migration 103 applied.

## bv6 — Companions on a booked visit, and invites (65fcc38)

### What was done
Booking a visit can bring companions along. A **leader** in the ward is **invited**: they get a
`visit_companion_invited` notification, and an invite with Accept / Decline on Visits and on My
Appointments. A **member** or a **typed name** is simply recorded. **Schedule** on a "Visit the ___
family" to-do books a `visit_appointments` row carrying the `assignment_id`, so the visit shows on My
Appointments once. An accepted invite joins the companion's own My Appointments as the same `visit`
kind, with `role: "companion"` and no Cancel. A decline adds "___ can't come" to the booker's to-do
timeline (`visit_companion_declined`). Booking is one form, `ScheduleVisitForm`, inside the new
`ScheduleVisitWindow`, and it reads the **ward's** clock.

### Key decisions
- **`visit_appointment_companions` has a SELECT policy and no write policy** (migration 104).
  `lib/visits/companions.ts` is its only writer, held by `tests/lib/visitTodoSites.test.ts`.
  `visit_appointments_select` gains one arm, `is_visit_companion(id)`. It exposes that appointment
  and nothing else: no log, no participant, no assignment. A decline removes the access.
- **Decided at bv6 start:**
  - Any leader with a calling in the ward may be invited. `findUsersOutsideWard()` checks this, and
    the booker cannot invite themselves.
  - An invite is answered once, while pending.
  - Cancelling or rescheduling a visit notifies nobody.
- **The companion picker is `VisitParticipantsField` with `copy`**, not a second picker. The trigger
  is in all four copies of the list, plus migration 104f's backfill.

### Found on the walk (scenario 102 Part 2, 2026-11-15, driven by Claude)
- **102-D1:** the booking window closed the moment the save succeeded, so "Visit booked. 2 invites
  have been sent." was never seen. **Fixed:** the window now stays open on that sentence with a
  **Done** button (the user's choice).
- **102-D2:** companions were listed in random UUID order, because one statement inserts them all.
  **Fixed:** `compareCompanions()` sorts leaders first, then everyone else, each A to Z (the user's
  choice).
- **102-D3:** a booked visit to-do read **Someday**, because `todoViewState()` read only the to-do's
  own dates. This is 077-D2 again, reached by a second route. **Fixed:** the soonest booking counts
  as the scheduled time. A new way to schedule a to-do must be added there too.
- **A second booking for one assignment** used to add an appointment silently, and the to-do then
  named the *latest* booking. **The user decided:** allow it, but only after an in-page "Book another
  visit?" confirmation. The to-do now names the **soonest** booking, plus "· and N more booked".
- **Checklist corrections:**
  - Step 18 now reads the notification row back, because the bell is a placeholder until P12.
  - Step 20's visit-log check could never fail on that seed, so it now points at
    `tests/rls/visit-companions.test.ts`.
- **Re-walked after the fixes:** full width, then 375px in light and dark. The Ellis household ends
  with 4 appointments, read back. The one console error came from the dev server compiling between
  two edits; four fresh page loads afterwards logged none.

### Follow-ups (not built)
- From bv5, still open: the visit form's default date is in UTC, not the ward's zone.
- Accepting an invite on Visits took 2.5–8 s to clear the panel on the dev server.
- bv7 (scenario 103) is next in this plan.

### Validation
- Typecheck and lint are clean.
- Full suite: 390 files, 5,663 tests, all passing. This run included the walk fixes and the new
  `ScheduleVisitWindow` and `TodoCard` component tests.
- The production build is clean.
- Migration 104 is applied.

## bv7 — Follow-ups, and "Discuss in bishopric meeting" (69ded73)

### What was done
Each visit card under Recent visits gives the bishopric two ways to send a visit onward. **Add a
follow-up** (`POST /api/visits/[id]/follow-ups`) puts an ordinary to-do on a bishopric member's list,
yourself by default, with an optional due date. It is linked by `todos.visit_log_id`, reads "From a
visit to the ___ family", and can be ticked and deleted. **Discuss in bishopric meeting** (`POST
/api/visits/[id]/discussion`) sets `visit_logs.discuss_in_bishopric` and puts one line, "Visit — ___
family — to discuss", under **Visits to discuss** on the soonest draft **bishopric** agenda dated today
or later. If there is none, the visit waits for the next one `POST /api/agendas` creates. Publishing
stamps `bishopric_discussed_at`; "Don't discuss" takes the line off every draft; "Discuss again" clears
the stamp. Migration 108.

### Key decisions
- **The line has its own source, `visit_discussion`, never `flag`** (decided with the user at bv7
  start). Publishing stamps `flag_sent_at` for every `flag` id, so sharing the tag would let a bishopric
  publish silently clear a ward-council flag on the same visit. `tests/routes/visitDiscussion.test.ts`
  holds it, and the assertion was proved able to fail.
- **No agenda is ever created to hold a line, and a ward council agenda never gathers one.**
- **The gather and the stamp run on the service role** (`gatherVisitDiscussions`,
  `markVisitDiscussionsDone`). The clerk and executive secretary build bishopric agendas but read no
  Bishopric visit; only the family name crosses, which is what a ward-council flag already tells them.
- **The follow-up's owner is a subject column**, checked by `assertAssignableBishopricMember`, and
  `lib/todos/visitLinks.ts` stays the only writer of `todos.visit_log_id`
  (`tests/lib/visitTodoSites.test.ts`). The audit detail carries ids and booleans, never the title.

### Found on the walk (scenario 106, 2026-11-20, driven by Claude)
- All 11 steps passed and were read back from the database. No bv7 defect.
- **Checklist correction:** step 7 said "there is no draft now". The ward council draft is still a
  draft, so it now says "no bishopric draft".
- **The user's answers:** the phone layout, "(me)" in the owner picker, the Agendas intro and an
  emptied "Visits to discuss" heading all stay as built.
- **Changed after the walk (the user's call):** a follow-up's **Open Visits** went to `/visits`,
  which reopens on the last tab used. It now goes to `/visits?tab=households&from=todos#visit-<id>`,
  and each Recent visits card has that id, a scroll margin and an outline while it is the target.
  Held by `tests/components/todos/TodoCard.test.tsx`. **Not re-walked in the browser**, because the
  drive was at 0.45 GB; the scroll and the outline need one look by hand.
- **Not from bv7:** the executive secretary's Visits page says "This ward has no organizations yet",
  because they have no organization of their own.

### Follow-ups (not built)
- **Agendas as one living document per meeting type**, raised by the user during the review. The ward
  council can add, only the bishopric removes, and a meeting is *marked as held* (including a quick call
  without the clerk) rather than published per date, so the audit log tells meeting changes from
  changes made between meetings. This changes bv7's "next bishopric agenda" and "publishing marks it
  discussed". It needs its own `/iterate`.
- The executive secretary's misleading "no organizations yet" sentence on Visits.
- From bv5, still open: the visit form's default date is in UTC, not the ward's zone.
- bv8 is next in this plan.

### Validation
- Typecheck and lint are clean, including the post-walk change.
- Full suite: 5,875 tests passing. One Zoom invitees test timed out in the full run and passed 14/14
  when rerun alone. `TodoCard.test.tsx` passes 7/7 after the post-walk change.
- Migration 108 is applied.

## bv8 — Group by street (73749b9)

### What was done
The Households tab gains a **Group by street** switch. When it is on, the cards sit under each
street, A to Z, with "No street on file" last, and the chosen sort orders the cards inside each
street. The switch is remembered on the account, as `byStreet` in the stored `visits` view.
`lib/visits/streetKey.ts` reads the street from the free-text `households.address`: it drops the
house number, any unit and everything after the first comma, then folds case, periods and a fixed
list of suffix and direction spellings. **On the user's yes at bv8 start**, the Assign window follows
the same switch. Each street there has a **Choose unassigned** button, which is the "Select the
street" that the bv5 section held for this slice. No migration and no route.

### Key decisions
- **The matching is deliberately simple, and a near-miss stays its own street**
  (`classifyLocation.ts`'s rule). "Mapel St" is not merged into Maple Street, because a household
  put on the wrong street is one somebody walks past.
- **A direction is folded only at either end of the street, and a suffix only as the last word**
  (or just before a trailing direction). So "St Charles Ave" keeps its saint, and "450 N 300 E"
  reads as North 300 East.
- **Choose unassigned never ticks a household somebody already holds.** It works like the
  existing "Choose every unassigned one", so a reassignment is always ticked by hand and always
  shows its warning box.
- **A view saved before bv8 opens ungrouped.** `parseVisitsView` falls back field by field, as it
  already did for the tab and the sort. The write schema requires `byStreet`, so the app's own saves
  always carry it.
- The progress row gained a required `address` field, so every place that builds a row had to
  supply one. The type checker found the five test fixtures that build rows.

### Follow-ups (not built)
- From bv7, still open: agendas as one living document per meeting type (needs its own
  `/iterate`), and the executive secretary's misleading "no organizations yet" sentence.
- From bv5, still open: the visit form's default date is in UTC, not the ward's zone.
- ITER-055's eight slices are all built. Close the item when bv8 is committed.

### Found on the walk (scenario 101 Part 2, 2026-11-20, driven by Claude)
- All five steps (11–15) passed and were read back from the database. No bv8 defect. The user said
  "tests pass" after the review page.
- **Checklist correction:** Part 2 said to continue after step 8, but it needs only an active
  Bishopric goal, which a fresh seed already has.
- **Seen, not from bv8:** each card's Contact and Log visit buttons are shorter than 44px (bv2).
  The app follows its own theme switch rather than the system setting, so the dark shots were taken
  with the `dark` class set directly.

### Validation
- Lint shows no errors (5 older warnings in untouched files). `typecheck` and `harness:typecheck`
  are clean. `npm run manifest` was regenerated.
- Full suite: 406 files, 5,892 tests passing. `npm run build` passes.
