---
id: talks-a-pipeline-core
type: feature
iter: ["ITER-004"]
commits: []
date: 2026-08-20
files:
  - supabase/migrations/025_talks_pipeline.sql
  - supabase/seed/notification_triggers.sql
  - lib/assignments/pipeline.ts
  - lib/assignments/speaker.ts
  - lib/assignments/rotation.ts
  - lib/assignments/queries.ts
  - lib/validation/assignment.ts
  - lib/calendar/queries.ts
  - app/api/assignments/route.ts
  - app/api/assignments/[id]/route.ts
  - app/api/assignments/[id]/approve/route.ts
  - app/api/assignment-comments/route.ts
  - types/domain.ts
related:
  - calendar-a-rules-and-api
  - calendar-b-month-view
  - calendar-c-rotation-cadence
  - roster-b-picker-and-orgs
  - foundation-c-services
---

## What was done

Everything Phase 4 needs beneath the UI: migration 025, three pure client-importable modules
(the nine-stage state machine, speaker discrimination, rotation eligibility), the assignment
data-access layer, four API routes, and seven test suites. No pages and no components —
`talks-b` builds the month planner on top of this. The `calendar-a` shape repeated: land the
rules as pure functions with the routes that call them, prove them against the hosted database,
then build screens against a layer that is already correct.

ITER-004 lands here as schema and pipeline shape. A speaker may be a ward member **or** an
external person, and the contact stages for an external speaker are waived *explicitly* — a
recorded decision with a name and a timestamp — rather than silently skipped.

It also closes the gap `calendar-b` handed forward: `revertAssignmentsToPlan()` now emits
`assignment_reverted` to the planner whose work a calendar change voided.

847 tests pass, 213 of them new.

## Key decisions

- **The pipeline is a pure function that writes nothing.** `canTransition()` answers one question
  and has no access to Supabase. The phase's first pitfall is implicit stage advancement, and the
  defence is structural at two layers: the PATCH body is a discriminated union so a field update
  and a stage move cannot arrive in one request, and `updateAssignmentFields()` has no parameter
  that could carry a stage. Neither is a rule somebody has to remember.
- **The approval gate counts PEOPLE, not rows — at both layers.** `assignment_approvals_one_per_user`
  (UNIQUE on `assignment_id, user_id`) is the real boundary; without it one counselor inserts three
  rows and satisfies a 3-of-3 gate alone. `reviewToApprove()` counts distinct user ids anyway, so
  relaxing the constraint later cannot silently open the gate.
- **The gate is "everyone on the roll", never a hard-coded three.** A ward mid-reorganization with
  two bishopric members needs both. An empty roll *refuses* rather than passing a vacuous
  "0 outstanding" — that would let any assignment walk through the one gate the phase is built on.
- **The waiver satisfies exactly four gates.** REQUEST→CONFIRM, CONFIRM→NOTIFY, NOTIFY→SPEAK and
  APPRECIATE→COMPLETE. It never substitutes for a speaker, a topic, an approval, or
  `sunday_confirmed_at` — whether the meeting happened is a fact about the meeting, not about who
  spoke in it. `tests/lib/externalSpeaker.test.ts` asserts all four negatives explicitly.
- **External speakers are excluded from history by the SCHEMA, not by a check.**
  `assignment_history.member_id` is `not null`, so `writeAssignmentHistory()` returns false rather
  than writing a row. ITER-004's "speaker history is not distorted" is true by construction.
- **`countsAsSpokenTalk` requires all three of stage, type and member.** Filtering on a row's mere
  existence counts a talk that never happened and suppresses that member from the rotation for
  months with no symptom at all.
- **The create route keys off `speakingSlots`, not `SundayType`.** One check covers stake
  conference, general conference, a holiday and a Sunday deliberately set to zero, without the
  route knowing what any of those mean — and stays independent of the unbuilt ITER-002/ITER-003.

## Deviations from the plan

- **`clearApprovals()` gained an `options.exceptUserId` parameter.** The plan's signature was
  `(wardId, assignmentId, client)`, but its own prose for the change-request path says "clear the
  **other** approval rows". The refusing member's row carries the comment saying what to change —
  the only explanation the planner gets — so clearing it along with the stale approvals deletes
  the point of the whole interaction. The listed signature could not express that.
- **`countApprovalsFor()` was added, and is not in the plan.** The first cut of `GET /api/assignments`
  read approvals once per assignment, which is a dozen round trips to draw one month of "2 of 3"
  badges. One batched query replaces it.
- **`clearSpeaker()` returns the updated row rather than `void`.** The decline path transitions,
  then clears the speaker; returning `void` meant the response still named a speaker the server had
  just removed.

## Pitfalls hit

- **A patch object typed `Record<string, unknown>` will not compile against supabase-js.** It also
  would have accepted any column name at all, which is precisely how a typo becomes a write that
  silently does nothing. Every patch here is typed
  `Database["public"]["Tables"]["assignments"]["Update"]`.
- **A Zod union's default issue message is the bare string `"Invalid input"`.**
  `respondToRouteError` renders `issues[0].message` verbatim, so both query schemas would have told
  a caller nothing about what the route wanted. Both now pass an explicit `{ error: … }`.
- **`emitNotification` must be given `recipientUserIds` as *undefined*, never as `[]`.** It resolves
  the trigger's default roles only when the field is absent; an empty array addresses the
  notification to nobody and returns silently. The revert path spreads the key conditionally for
  exactly this reason.
- **The Supabase CLI's access token had lapsed**, so `db:push` returned 401 with no hint that login
  was the problem. Unrelated to the code, but it blocks every `db:*` script and looks like a
  project-link failure.

## Known gaps

- **Route handlers stay unit-untested**, for the fifth slice running — there is no local server
  (roster-b). The library layer beneath them is fully tested and `talks-b`'s harness scenarios
  drive the routes by hand.
- **No harness scenario in this slice**, following the `calendar-a` precedent exactly: there are no
  pages and no components, so there is nothing a tester can walk. `talks-b` owns scenario 012 (the
  three-approval gate) and 013 (a ward conference with an external speaker).
- **`scenario-008` (roster-b's member picker) is still unwalked** and has now been handed forward
  four times. It is the interface `talks-b` consumes first. `scenario-011` (calendar-c) is written
  but unwalked.
- **The Definition of Done in `plans/04-talks-pipeline.md` says "all eight pipeline notification
  triggers".** There are now nine keys in play — `assignment_reverted` is the ninth. Four of them
  fire from this slice (`plan_submitted`, `plan_approved`, `plan_change_requested`,
  `assignment_declined`, plus `assignment_reverted` from the calendar path); the rest belong to
  `talks-c` and `talks-d`.
- **`notify_message` and `thank_you_message` are plain columns here.** Phase 5 adds the AI drafting
  route that returns a *draft* a human approves. Nothing in this slice populates them
  (CLAUDE.md rule 3).
- **Phase 6 must read the speaker through `speakerFrom()`**, not `member_id`, or an external
  speaker vanishes from the printed program. The public-page privacy case for an external speaker
  is genuinely different from a ward member's — a visiting stake president is normally named in
  full — and that decision belongs to Phase 6.
