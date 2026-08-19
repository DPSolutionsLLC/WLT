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

| Test | Asserts |
|---|---|
| `pipeline-transitions.test.ts` | Every legal transition succeeds; every illegal one is rejected. **Highest priority in this phase** |
| `approval-gate.test.ts` | 2-of-3 approvals cannot reach APPROVE; 3-of-3 can |
| `approval-invalidation.test.ts` | Editing an approved assignment clears approvals and notifies |
| `decline-flow.test.ts` | A decline returns to `plan`, clears the speaker, and emits the notification |
| `rotation-eligibility.test.ts` | `counts_toward_rotation` set correctly per type; an assignment reverted to `plan` by a calendar change is absent from speaker history (Step 2) |
| `reliability-flags.test.ts` | Each of the four flags fires on its boundary condition and not before |
| `goal-status.test.ts` | on_track / due_soon / overdue boundaries, including never-fulfilled |
| `bishopric-only.test.ts` | Every route in this phase 403s for a secretary, org president, and youth account |

---

## Definition of Done

- [ ] All nine stages implemented; illegal transitions rejected with a clear message
- [ ] Approvals require all three bishopric members; edits invalidate them
- [ ] Comment threads work at month and assignment level, realtime
- [ ] SMS handoff works on iOS and Android, with a copy-to-clipboard fallback
- [ ] Prayer pipeline complete; rotation visible in the picker
- [ ] Topic library CRUD with `last_assigned_at` tracking and an accept/reject queue
- [ ] Reliability flags compute correctly and appear only to bishopric
- [ ] Goals compute status and surface on the calendar
- [ ] All eight pipeline notification triggers fire
- [ ] All eight tests pass

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
