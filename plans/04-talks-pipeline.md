# Phase 4 — Talk Pipeline, Prayers, Topics & Goals

The core bishopric workflow: a nine-stage pipeline from planning a month of speakers to
sending a thank-you. Plus prayer rotation, the topic library, speaker reliability, and the
goals tracker.

**Depends on:** Phase 3. **Unlocks:** Phases 5, 6.
**Reference:** [FEATURES.md](../FEATURES.md) §Modules 3, 4, 11; [SPEC.md](../SPEC.md) §API Routes → Assignments, Prayers, Topics.

> **Bishopric access only.** Every route in this phase asserts `is_bishopric()`.
> The ward secretary gets read-only pipeline status in Phase 11 — not here.

> AI-generated confirmation and thank-you messages are the CONFIRM and APPRECIATE
> stages. Build the pipeline with those stages **manual first** (a plain textarea), then
> layer AI generation in Phase 5. Do not block the pipeline on the AI platform.

---

## Goals

1. The full PLAN → COMPLETE pipeline with enforced stage transitions
2. Prayer assignments on their own simplified pipeline
3. Topic library with rotation tracking
4. Speaker reliability profile with pattern flags
5. Goals & reminders surfacing on the planning calendar

---

## Step 1 — Pipeline State Machine

Build this first, as a pure module, before any UI.

`lib/assignments/pipeline.ts`:

```ts
export const STAGES = ['plan','review','approve','request','confirm',
                       'notify','speak','appreciate','complete'] as const;

export function canTransition(from: Stage, to: Stage, ctx: TransitionContext): Result
export function requiredFieldsFor(stage: Stage): string[]
```

Transition rules, from FEATURES.md §Talk Assignment Pipeline:

| From → To | Gate |
|---|---|
| `plan` → `review` | Speaker, topic, and slot set. Sets `plan_submitted_at` |
| `review` → `approve` | **All three bishopric members** have an `assignment_approvals` row with `approved = true` |
| `approve` → `request` | Bishop's approval is the final gate. Sets `approved_at` |
| `request` → `confirm` | `request_outcome = 'accepted'`. `declined` returns to `plan`; `pending` stays |
| `confirm` → `notify` | An approved `notify_message` exists |
| `notify` → `speak` | `notify_sent_at` set (user marked it sent) |
| `speak` → `appreciate` | `sunday_confirmed_at` set |
| `appreciate` → `complete` | `thank_you_sent_at` set |

Backward transitions are allowed for correction, but only by a bishopric member, and each
writes an audit row with the reason. A decline at REQUEST is the one *expected* backward
move — it returns to `plan` and clears the speaker.

**Never advance a stage implicitly as a side effect of a field update.** Stage changes are
explicit, validated, and audited. This is the rule that keeps the pipeline debuggable.

---

## Step 2 — Assignment CRUD & Types

Assignment types determine rotation eligibility (FEATURES.md table):

| Type | `counts_toward_rotation` |
|---|---|
| `sacrament_talk` | true |
| `organizational` | false |
| `returning_missionary` | false |
| `new_member` | false |
| `youth_speaker` | false — tracked in a separate youth rotation |
| `high_council` | false |

Set `counts_toward_rotation` from the type automatically; do not make the user pick twice.
It is stored rather than derived so a later policy change does not rewrite history.

### Non-negotiable: a voided assignment must not count as a talk that was given

Phase 3 can send an assignment **backwards** to stage `plan`. It happens whenever a calendar
change voids work — a Sunday is marked stake conference or holiday, a Sunday becomes Fast
Sunday, speaking slots are cut below the speakers already in them, or Fast Sunday re-resolves
onto a Sunday that already has speakers. `lib/calendar/queries.ts` reverts those assignments
rather than deleting them, because the planning work behind one is somebody's
(03-calendar.md §Pitfall 5).

**Two rules follow, and both are load-bearing:**

1. **Speaker history, rotation eligibility, and every "who has spoken recently" calculation
   count an assignment only when it reached `complete`** — never a row that merely exists, and
   never `counts_toward_rotation` on its own. A reverted assignment sits at `plan`, so a
   stage-filtered query excludes it for free. An existence-filtered query counts a talk that
   never happened, quietly suppresses that member from the rotation for months, and there is no
   symptom until somebody asks why a family has not been asked to speak in a year.

2. **`counts_toward_rotation` is not a "cancelled" flag.** It records whether an assignment
   TYPE counts — a high council speaker does not count toward the ward's member rotation, per
   the table above. Setting it to false to mean "this got cancelled" conflates two unrelated
   ideas in one boolean, and would make the column unreadable for its actual purpose. Do not
   do it, and do not accept a PR that does.

`tests/db/fast-sunday-collision.test.ts` proves the revert lands. The corresponding assertion
on this side — that a reverted assignment is absent from speaker history — belongs in
`rotation-eligibility.test.ts` and must be written when Step 8 is built.

| Route | Method | Does |
|---|---|---|
| `/api/assignments` | GET | By `sunday_id` or month. Includes member, topic, stage |
| `/api/assignments` | POST | Create at stage `plan` |
| `/api/assignments/[id]` | PATCH | Update fields **or** request a stage transition |
| `/api/assignments/[id]/approve` | POST | Record an approval or a change request |

---

## Step 3 — REVIEW: Approvals & Comments

`assignment_approvals` records each bishopric member's decision. `assignment_comments`
holds threads at two levels: `month` (keyed by `sunday_id`) and `assignment`.

- All three must approve before APPROVE. Show a clear 1-of-3 / 2-of-3 indicator
- Any member can request changes, which reverts to `plan` and notifies the planner
- Editing an assignment after approvals exist **invalidates them** — clear the approval
  rows and notify. Otherwise a plan can be silently changed post-approval
- Comment threads are realtime via Supabase Realtime

Notifications: `plan_submitted`, `plan_approved`, `plan_change_requested`.

---

## Step 4 — REQUEST → NOTIFY

**REQUEST.** The counselor contacts the speaker personally, then logs the outcome: who
contacted, when, and Accepted / Declined / Pending, plus notes. A decline emits
`assignment_declined` and returns the slot to `plan`.

**CONFIRM.** A confirmation message is composed with topic, suggested scriptures, and
suggested conference talks. In this phase it is a plain textarea with a template. Phase 5
adds AI drafting. Either way the counselor reviews, edits, and approves before it can be
sent — `notify_message` is only set on explicit approval. Emits `message_approved_ready`.

**NOTIFY.** Open the device SMS app with recipient and body pre-filled:

```
sms:{phone}?&body={encodeURIComponent(message)}
```

Then the user taps "Mark as sent", which sets `notify_sent_at` and `notify_sent_by`.

> **The `sms:` scheme is inconsistent across platforms.** iOS wants `&body=`, Android
> wants `?body=`, and long bodies get truncated differently. Test on real devices.
> Always render a **Copy message** button as a fallback — it works everywhere.
> The app has no delivery confirmation; "sent" is a human assertion.

---

## Step 5 — SPEAK → COMPLETE

**SPEAK.** The day after the meeting, a scheduled Edge Function emits
`sunday_confirmation_request` to all bishopric: did this happen as planned? Confirming
sets `sunday_confirmed_at`. Flagging an issue opens a comment thread and emits
`issue_flagged_post_sunday`.

**APPRECIATE.** Each bishopric member submits a brief personal comment about the speaker.
Once comments are in, emit `appreciation_comments_ready`. A thank-you message is drafted
(manual now, AI in Phase 5), reviewed, approved, and sent — by the conducting counselor
or delegated to the secretary.

**COMPLETE.** Thank-you sent and Sunday confirmed. Write an `assignment_history` row
capturing the outcome. This is what the reliability profile reads.

---

## Step 6 — Prayers

Simpler pipeline: `assign → ask → confirm → done`. Same member picker, same rotation
awareness, no approval gate. Invocation and benediction per Sunday. Names feed the
program builder in Phase 6.

Track rotation to ensure variety — surface "last prayed" beside each name in the picker.

---

## Step 7 — Topic Library

| Route | Method | Does |
|---|---|---|
| `/api/topics` | GET | List with filters and `last_assigned_at` |
| `/api/topics` | POST | Create manually |
| `/api/topics/[id]` | PATCH | Edit or archive |

Topics carry title, category, description, `suggested_scriptures`, `suggested_talks`.
Categories: Doctrinal, Scriptural, Conference Talk, Seasonal, Custom.

`last_assigned_at` updates when an assignment referencing the topic reaches `approve`.
Show it in the picker so the bishopric can avoid repeats.

**AI-suggested topics are proposals, never auto-added.** The route that generates them
(Phase 5) returns candidates; a bishopric member accepts each one before it enters the
library. Build the accept/reject UI now with a manual "add topic" path so Phase 5 only
has to supply the candidates.

---

## Step 8 — Speaker Reliability Profile

On the member detail page, bishopric-only tab. Reads `assignment_history`.

Shows: date, assignment type, outcome, cancellation notice given, counselor notes.

Pattern flags (`lib/assignments/reliabilityFlags.ts` — pure, testable):

| Flag | Condition |
|---|---|
| Frequent decliner | Declined 2+ times |
| Late canceller | Cancelled within 7 days of the assignment |
| Not asked recently | No assignment in 18+ months |
| Not spoken recently | No completed talk in 2+ years |

**Flags are informational only.** They never block an assignment and never appear outside
the bishopric view. Word them neutrally — this is pastoral data about real people.

---

## Step 9 — Goals & Reminders

Simple objectives board (`goals` table). Each goal has a target (member, household, org,
or group), a desired frequency in months, a last-fulfilled date, and a computed status.

```ts
export function goalStatus(lastFulfilledAt: Date | null, frequencyMonths: number): 'on_track' | 'due_soon' | 'overdue'
```

`due_soon` at 80% of the interval elapsed; `overdue` past it. Never-fulfilled counts as
overdue once the interval has passed since creation.

Compute status on read rather than storing it — a stored status goes stale silently. The
`status` column exists in the schema; keep it as a materialized cache updated by the same
nightly function, and always trust the computed value in the UI.

Overdue and due-soon goals surface as alerts on the planning calendar cells from Phase 3.

---

## Tests

**Updated 2026-08-22, when `talks-d` closed the phase.** The eight-row table this section used to
carry described tests nobody wrote — four slices produced a different and larger set, and a spec
describing imaginary tests is worse than one describing the real ones. What follows is what exists.

| Test | Asserts |
|---|---|
| `tests/lib/pipelineTransitions.test.ts` | Every legal transition succeeds; every illegal one is rejected. **Highest priority in this phase** |
| `tests/lib/approvalGate.test.ts` | 2-of-3 approvals cannot reach APPROVE; 3-of-3 can, counted against the ward's real bishopric roll |
| `tests/lib/declineFlow.test.ts` | A decline returns to `plan`, clears the speaker, and emits the notification |
| `tests/lib/rotationEligibility.test.ts` | `counts_toward_rotation` is set per type and is stored, not re-derived |
| `tests/lib/externalSpeaker.test.ts` | ITER-004: a row holds a member or an external name, never both; the waiver satisfies exactly four gates |
| `tests/lib/messageTemplate.test.ts`, `smsLink.test.ts` | Confirmation and thank-you drafting, and the `sms:` handoff with its copy fallback |
| `tests/lib/prayerPipeline.test.ts`, `lastPrayed.test.ts` | The four prayer stages, and the last-prayed nudge that renders NOTHING rather than "Never" |
| `tests/lib/topicRotation.test.ts` | Staleness bucketing and the library's ordering |
| `tests/lib/reliabilityFlags.test.ts` | Each of the four flags fires **on** its boundary day and not the day before; no history means no flags |
| `tests/lib/goalStatus.test.ts` | on_track / due_soon / overdue at every boundary, both never-fulfilled cases, a zero interval, and month-end clamping |
| `tests/db/assignment-approvals.test.ts` | The approval constraints against the real database, including `assignment_approvals_one_per_user` |
| `tests/db/topic-last-assigned.test.ts` | `last_assigned_at` is stamped at `approve` only, and survives a revert |
| `tests/rls/assignment-access.test.ts` | The four talk tables are bishopric-only and ward-scoped, on all four verbs |
| `tests/rls/topic-candidates.test.ts` | The AI queue is bishopric-only, ward-scoped, and its review pair is constrained |
| `tests/rls/speaker-history.test.ts` | Five non-bishopric roles read **nothing** while the bishop and a counselor read the seeded row in the same fixture; cross-ward isolation; an external speaker wrote no history row |
| `tests/rls/realtime-isolation.test.ts` | The comment publication does not leak across wards |
| `tests/routes/*.test.ts` | The four assignment routes and the candidate queue, driven as real handlers against the hosted project |
| `tests/components/assignments/*.test.tsx` | Stage badges, the contact-stage panel, and the realtime comment thread |
| `tests/components/roster/ReliabilityFlag.test.tsx` | All four kinds render their label; an empty array renders nothing at all |

**The plan's `bishopric-only.test.ts` was never written as one file.** Its intent is met, spread
across `tests/rls/assignment-access.test.ts`, `tests/rls/speaker-history.test.ts` and the route
suites, each of which proves the refusal for the roles that matter to the surface it covers. A
single file asserting "every route in this phase" would have to be rewritten every time a route was
added; the per-surface suites do not.

---

## Definition of Done

**Walked 2026-08-22 when `talks-d` landed.** Ticked where it is true, and stated plainly where it is
not — an unticked box with a reason is worth more than a ticked one that is aspirational.

- [x] All nine stages implemented; illegal transitions rejected with a clear message — `talks-a`,
      pinned by `tests/lib/pipelineTransitions.test.ts`
- [x] Approvals require all three bishopric members; edits invalidate them — counted against the
      ward's **actual** bishopric roll rather than a hard-coded three, with
      `assignment_approvals_one_per_user` behind it
- [x] Comment threads work at month and assignment level, realtime — the `supabase_realtime`
      publication entry landed in `route-tests-and-realtime`, gated by a cross-ward leak test
- [ ] SMS handoff works on iOS and Android, with a copy-to-clipboard fallback — **built, not
      verified on a device.** The copy fallback and the desktop detection are covered by
      `tests/lib/smsLink.test.ts` and were walked in a desktop browser; no real iPhone or Android
      handset has been tested. CLAUDE.md §9 names this as a known risk and it stays named
- [x] Prayer pipeline complete; rotation visible in the picker — `talks-c`, with a last-prayed
      nudge that renders nothing rather than "Never"
- [x] Topic library CRUD with `last_assigned_at` tracking and an accept/reject queue — `talks-c`.
      The queue ships empty on purpose; Phase 5 fills it
- [x] Reliability flags compute correctly and appear only to bishopric — `talks-d`. Three of the
      four can fire on real data; `late_canceller` is **dormant** (see the deviations below)
- [x] Goals compute status and surface where they can be acted on — `talks-d`. Status is computed
      on read and the `goals.status` column is never selected by the app. **They surface on the
      Sunday planning page, not the calendar** — see deviation 14 below; the phase plan's wording
      ("surface as alerts on the planning calendar cells") was tried, walked, and rejected
- [ ] All eight pipeline notification triggers fire — **five of nine do.** `plan_submitted`,
      `plan_approved`, `plan_change_requested`, `assignment_declined` and the ninth key
      `assignment_reverted` all fire from real code paths. `message_approved_ready`,
      `sunday_confirmation_request`, `issue_flagged_post_sunday` and `appreciation_comments_ready`
      are seeded in `supabase/seed/notification_triggers.sql` and are emitted by nothing. Three of
      those four describe moments Phase 5 (AI message drafting) and Phase 11 (the notification UI)
      own; `issue_flagged_post_sunday` has no surface at all yet. **Phase 11 inherits them.**
- [x] All tests pass — 1224 across 86 files, with the phase's own suites listed above

**Phase 4's AI retrofit closed 2026-08-24 with `ai-c`.** The two textareas
`buildConfirmationMessage` and `buildThankYouMessage` fill now have an AI alternative delivering
into the same place on the same terms — a draft a person edits and approves, with approving still
the only thing that writes a column.

One thing `ai-c` fixed that is NOT AI work and is worth naming: **`ContactStagePanel` had been
passing `comments: []` hard-coded to `buildThankYouMessage` since `talks-b`.** The template has
always taken that parameter and nothing had ever written it, so every thank-you this app has
produced was generic. The assignment's own comment thread now feeds it. The plain template's
output changes for every assignment that has comments, with or without AI.

The four dormant notification triggers are **unchanged**. `message_approved_ready`,
`sunday_confirmation_request`, `issue_flagged_post_sunday` and `appreciation_comments_ready` are
still emitted by nothing — `ai-c` adds no `emitNotification()` call, deliberately, because a
draft is not an event anybody needs telling about. **Phase 11 still inherits all four.**

---

## Pitfalls

- **Implicit stage advancement.** A PATCH that updates `request_outcome` must not silently
  move the stage. Transitions are explicit and validated, always.
- **Editing after approval.** Without invalidation, a counselor can approve a plan and
  then have it changed underneath them. Clear approvals on edit and notify.
- **`sms:` on desktop.** The link does nothing in a desktop browser. Detect and show the
  copy fallback prominently rather than a dead link.
- **Reliability flags leaking.** They must never reach a non-bishopric response. Query
  them in a separate bishopric-only call, not as a field on the shared member type.
- **Storing computed goal status.** It goes stale. Compute on read; treat the column as
  a cache.
- **The pipeline is nine stages, not nine screens.** Most work happens in a modal on the
  month view. Build the month planner as the primary surface and the per-assignment detail
  page as secondary, or the workflow becomes tedious.

---

## Decisions made in talks-a

Recorded when `talks-a` (pipeline engine and assignment API) landed on 2026-08-20. These are
deviations from, and additions to, the plan above — read them before building `talks-b`.

1. **ITER-004 is inline fields, not a reusable table.** `external_speaker_name` and
   `external_speaker_title` on `assignments`, with a CHECK (`assignments_speaker_exactly_one`)
   that a row holds a member **or** an external name, never both — and legitimately neither, which
   is what an unfilled slot and a reverted assignment both are. A saved list of stake leaders was
   considered and rejected as machinery nobody has asked for; a name is retyped each time. Revisit
   only if a ward complains.

2. **The contact stages are waived explicitly, not skipped.** One column pair,
   `contact_waived_at` / `contact_waived_by`, settable only when `member_id is null`. It is what
   lets an external speaker cross REQUEST → CONFIRM → NOTIFY and APPRECIATE → COMPLETE. ITER-004
   forbids a silent skip: a skipped stage reads as an outstanding task nobody can ever complete,
   so a waiver is a recorded decision with a name and a timestamp on it. It satisfies exactly
   those four gates — never a speaker, a topic, an approval, or `sunday_confirmed_at`. The meeting
   either happened or it did not, regardless of who spoke.

3. **External speakers never enter speaker history.** `assignment_history.member_id` is
   `not null`, so `writeAssignmentHistory()` returns false rather than writing a row when there is
   no member. Do not relax that column to make the function simpler — the schema is what makes
   ITER-004's "speaker history is not distorted" true rather than remembered.

4. **PATCH takes a discriminated union.** `{ action: "update", … }`, `{ action: "transition", … }`
   or `{ action: "waive_contact", … }`, never two in one request. The phase's first pitfall is
   implicit stage advancement; making them mutually exclusive *by shape* means the schema rejects
   it rather than a reviewer catching it. `updateAssignmentFields()` has no parameter that could
   carry a stage, which is the same defence one layer down.

5. **`/api/assignment-comments` is a new route SPEC.md did not list.** One table serves both
   comment levels, so one route serves both rather than splitting month-level comments awkwardly
   under `/api/sundays/[id]`. SPEC.md §API Routes was updated in the same change (CLAUDE.md §1).

6. **The planner keys off `speakingSlots`, not `SundayType`.** A Sunday with no meeting already
   carries `speaking_slots = 0` from `generateSundays.ts`, so one check covers stake conference,
   general conference, a holiday, and a Sunday somebody deliberately set to zero. This is
   deliberately independent of ITER-002 and ITER-003, which remain unbuilt.

**Also landed here, beyond the six:**

- A ninth notification trigger, `assignment_reverted`, closing the gap `calendar-b` handed
  forward: `revertAssignmentsToPlan()` in `lib/calendar/queries.ts` now tells the **planner**
  whose work a calendar change voided, once per Sunday with a count, falling back to the
  bishopric when `planned_by` is null. The Definition of Done above says "all eight pipeline
  notification triggers"; there are now nine keys in play for this phase.
- `assignment_approvals_one_per_user`, a UNIQUE (assignment_id, user_id) constraint. The APPROVE
  gate counts rows and calls them people; without this constraint one counselor can insert three
  rows and satisfy a 3-of-3 gate alone.
- The approval gate counts against the ward's **actual** bishopric roll, not a hard-coded three.
  A ward mid-reorganization with two members needs both.
- `POST /api/assignments/[id]/approve` with `approved: false` keeps the refusing member's own
  approval row when it clears the others — that row carries the comment saying what to change,
  which is the only explanation the planner gets.

---

## Decisions and deviations across talks-b, talks-c and talks-d

Recorded 2026-08-22, when `talks-d` closed the phase. The `talks-a` section above stayed as it was
written; this is everything the other three slices changed, added, or did differently from the plan.
Read it before building on any of Phase 4.

### talks-b — the month planner

1. **`listTopicOptions()` was added to `lib/assignments/queries.ts`.** `plan` -> `review` refuses
   without a `topic_id`, and the topic library belonged to `talks-c`, so the smallest possible topic
   read was placed in the existing module rather than in a `lib/topics/queries.ts` that `talks-c`
   would then have to reconcile. `talks-c` kept it and extended it with `suggestedScriptures`
   instead of deleting it — one read used by two modules is not worth a migration of its own.
2. **`MonthGrid` takes `regionsBySundayId`, one map, not per-cell props.** The page builds every
   reserved region for the whole month from one read and threads them through. "Do not fetch per
   cell" is structural this way rather than a rule anyone has to remember, and `talks-d` filled the
   third region without touching the grid at all.
3. **`MonthNavigation` gained a `basePath` prop**, because it hard-coded `/calendar?month=` and
   reusing it on the planner would have navigated away from the planner.
4. **The modal has no "Submit for review".** Every stage move lives on the detail page, so there is
   exactly one place in the app where a stage advances. Planning a whole Sunday still never leaves
   the month view, which is what the phase asked for.

### talks-c — prayers and topics

5. **The topic library lives at `/talks/topics`, not `/topics`.** SPEC.md §Component Structure
   specifies it and `NAVIGATION_ITEMS` has always linked there. The plan's path would have left the
   sidebar's Topics link pointing at a 404.
6. **A unique index on `(ward_id, sunday_id, prayer_type)`**, which the plan did not ask for. "A
   second write replaces the member rather than inserting" needs a constraint behind it or it is a
   race, not a rule — without it, a double-submit gives a Sunday two invocations.
7. **`MemberPicker` gained an `annotations` prop**, raised rather than added quietly, per roster-b's
   rule for that frozen interface. The prayer board's whole reason to exist is spreading prayers
   around the ward, and that judgement is made *while* choosing a name.
8. **Migration numbering collides silently.** `talks-c` shipped as `028` rather than the plan's
   `027`, and `talks-d` as `029`. Two migrations with the same number is a conflict the CLI resolves
   by filename order, without saying so. Check the directory before numbering, not the plan.
   Scenario numbers have the same problem — check `testing/scenarios/manifest.json`.

### talks-d — reliability and goals

9. **`goalStatus()` takes a fourth parameter, `createdAt`.** The signature in §Step 9 omits it, and
   "never fulfilled counts as overdue once the interval has passed since creation" is unanswerable
   without it: with only a null fulfilment date, a goal created this morning and one created three
   years ago are the same value.
10. **`late_canceller` is implemented, tested, and DORMANT on real data.** No code path writes an
    `assignment_history` row with `outcome = 'cancelled'` or a `cancellation_days_notice` —
    `writeAssignmentHistory()` writes only `declined` and `completed`, from the decline path and the
    `complete` transition. The flag exists because §Step 8 specifies it and its boundary is tested,
    but nothing in the app can make it fire. **Whoever builds a cancellation path owns making it
    real**; the flag is not evidence that one exists.
11. **`target_type: 'group'` is readable but not creatable.** The route must verify that a target
    resolves to a live row in the right table, because `target_id` carries no foreign key. There is
    no `groups` table, so a `group` target can never be verified — and accepting an unverifiable
    target is precisely the permanent mystery that rule exists to prevent. Existing `group` rows
    still render, as a target whose record cannot be found.
12. **The `goals.status` column is not selected anywhere in `lib/goals/queries.ts`.** §Step 9 says
    compute on read and treat the column as a cache; leaving it out of the select list makes that
    structural rather than a rule everyone has to remember. `refresh_goal_status()` in migration 029
    maintains it for a future report to index.
13. **`pg_cron` is not enabled on this project**, so migration 029 schedules nothing and the refresh
    function is callable by hand only. `supabase/migrations/001_extensions.sql` creates exactly two
    extensions. The migration header carries the one-line `cron.schedule` call to run if it is ever
    enabled. Nothing in the app depends on it, because nothing reads the column it maintains.
14. **Goal alerts are computed as of EACH SUNDAY'S date, not as of today** — so an alert is a
    statement about that Sunday rather than today's board repeated across a month. That part held.
    **What did not hold is putting them on the calendar.** §Step 9 says "overdue and due-soon goals
    surface as alerts on the planning calendar cells", and that is what talks-d built, filling the
    third region calendar-b reserved. Walking scenario 019 rejected it: three overdue goals wrap to
    nine lines in a ~130px grid column, under the speakers and the pipeline summary, on every
    Sunday of every month whether or not anyone is planning. They now live on the **Sunday planning
    page** as a banner that is dismissible for the month
    (`components/goals/GoalAlertBanner.tsx`), where somebody has already decided to work on that
    Sunday and the warning has a job to do.

    Walking it a second time refined it twice more: the heading now **names both counts** ("3 ward
    goals are overdue, 1 is due soon") rather than counting only the overdue ones above a longer
    list, and the banner **collapses to a single summary line that expands** — 78px at desktop
    against the 250px the open version stood at 375px, with Dismiss deliberately outside the toggle
    because dismissing is what somebody does instead of reading.

    The dismissal is a COOKIE rather than `localStorage`, and that is not a detail. localStorage is
    invisible to the server, so the banner had to be rendered for everybody and hidden after
    hydration — which painted a dismissed banner and then removed it, measured at 268 ms on an
    unthrottled desktop and 3.8 s at 20x CPU throttle. A cookie travels with the request, so the
    Server Component omits it and there is nothing to correct. The app solves the same class of
    problem for the theme with a pre-paint inline script (app/layout.tsx); that works because a
    theme is one class on `<html>`, and telling the server is simpler here.

    **The third reserved region is therefore still OPEN.** `min-h-40` was never the constraint that
    failed — the cells fitted the content without being resized. What failed was the density of
    this particular content at this particular width, and a later slice with something terser to
    say may still fill the region. That is a better outcome than a filled region nobody reads.
15. **`MemberPicker` gained a `flags` prop, and `SpeakerField` already passed `showFlags`.** The
    `talks-d` plan asserted that no caller set `showFlags`; `app/(app)/assignments/SpeakerField.tsx`
    has set it since `talks-b`, rendering a deliberate no-op. Wiring it meant threading one record
    from `app/(app)/assignments/page.tsx` down through `MonthPlannerBoard` and `AssignmentModal` —
    built once per page from one bishopric-only read, never one query per row.
16. **`ASSIGNMENT_TYPE_LABELS` moved from `AssignmentModal` to `types/domain.ts`** when the speaker
    history table became its second reader (conventions.md: a thing used by two modules moves, it is
    not copied).
17. **`goals` is ORG-SCOPED, and this is where that asymmetry got closed rather than handed on.**
    It shipped ward-scoped — migration 019's policy loop let any authenticated ward member read and
    write every goal, while `goals.manage` reached only the bishopric and org leadership, so the
    route was the only real boundary. That was recorded as a Phase 11 inheritance, and walking
    scenario 019 surfaced what it meant in practice: an Elders Quorum president could mark a
    bishopric goal fulfilled.

    Migration **030** fixes it by copying the policy `visit_goals` has carried since migration 019:
    `ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id())` on all four
    verbs. `org_id` null is a ward-level goal the bishopric alone sees; a set `org_id` is that
    organization's leadership plus the bishopric. Ownership is stamped from the session by
    `POST /api/goals` and cannot be named by the request or moved by a `PATCH`.
    `tests/rls/goal-access.test.ts` proves it, including the case that would catch a leftover
    ward-scoped policy surviving alongside the new one.

    **`members`, `households` and `member_organizations` still carry the original asymmetry** —
    Phase 11 inherits those three, not four.
18. **Speaking-history rows needed their own date formatter.** `formatSundayLabel()` renders
    "Sunday, June 7" with no year, which is right on a calendar — the month you are looking at
    supplies it — and wrong in a table that spans years by design. A member whose two rows were
    2024-06-02 and 2026-06-07 read as the same month while the flag above them said "has not spoken
    in two years". Found by walking scenario 018; fixed with `formatSundayLabelWithYear()`, a
    sibling in `lib/calendar/dates.ts`. Both formatters now carry the reasoning, so the next person
    does not merge them back together.
