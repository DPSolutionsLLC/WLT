# Plan: Talk asks for the conductor, handover, and an assistant (P4 Sacrament slice f)

**Created:** 2026-09-24
**Type:** feature
**Phase:** P4 module 1 (Sacrament), slice `f`. Slice `g` (Prayers) reuses everything here.
**Structure:** Three sub-slices, `f1` → `f2` → `f3`, each its own commit. `f1` and `f3` each own a
migration.

## Overview

Sending the asks for a Sunday's talks creates one **"Ask ___ to speak"** to-do per speaker, owned
by that Sunday's **conducting** leader. The answer (accepted / declined with a reason) is recorded
**on the to-do**, and goes through the talk pipeline's existing outcome path. If the conductor
changes, the open asks follow the new conductor. Any bishopric member can add an **assistant** for a
Sunday. The assistant gets a mirrored copy of every open ask, and whichever of the two records the
answer resolves it for both.

### Decisions settled with the user (2026-09-24)

| # | Decision |
|---|---|
| U1 | The **conducting leader** (`sundays.conducting_user_id`) owns every to-do that comes out of that Sunday's planning. |
| U2 | Any bishopric member can manage any Sunday. This is already true (bishop and counselors hold identical permissions); nothing to build. |
| U3 | **Changing the conductor moves that Sunday's open work** to the new conductor. |
| U4 | Clicking the conductor's name opens a window where any of the three can **change the conductor** or **add an assistant** (another bishopric member). The assistant gets a mirrored copy of the open asks; completing on either list resolves both. |
| U5 | The existing 9-stage talk pipeline **stays**; this sits beside it. The user will rework the pipeline stage by stage later. |
| U6 | **Fresh copy on handover.** The new owner gets a clean copy (speaker, topic, date, contact, references, scheduled time). The old copy is closed on the old owner's list with a line naming who took it over. Private steps and notes never move and are never deleted. |
| U7 | **An answered ask is marked done, never deleted.** Its timeline says "Accepted" or "Declined — Not available". The answer also goes through the pipeline's accept/decline, so a decline reopens the slot and reaches speaker history. |
| U8 | **Visiting (non-roster) speakers are asked too**, marked "Not on the roster — no contact on file". Their answer is recorded on the talk, but not in speaker history, which only holds members. |
| U9 | **Finalize becomes "Send asks"**, which sends only to speakers not yet asked. Pressing it again later sends just the new ones. A changed speaker's old ask is closed, so nobody is asked twice. |

### Decisions made in this plan (flag to the user if they read wrong)

- **The gate is References decided** (`referencesDecisionOf(sunday) !== null`, finalized *or*
  skipped) plus at least one talk with a speaker. That matches the plan note and the prototype.
  Topics is gated only indirectly: References cannot be finalized without topics, but a skip can.
- **No conductor, no asks.** Send asks is refused (400, with a sentence) while
  `conducting_user_id` is null. **If the conductor becomes nobody** (a type change to a non-meeting
  Sunday nulls it), the open asks **stay with the previous owner**; work is never orphaned.
- **One assistant per Sunday** (`sundays.assistant_user_id`), bishopric only, never the conductor.
- **"Not yet asked" is computed, never stored.** A talk needs an ask when it has a speaker, has no
  open ask to-do, and its outcome is not already `accepted` or `declined`. There is **no
  `talks_finalized_at` stamp**; the four-state pill is derived from the asks and outcomes.
- **Ask to-dos cannot be ticked done or deleted while open.** Accept / Decline replace the done
  checkbox (the prototype's shape). Delete answers 409 with "Record their answer instead —
  Accepted or Declined". Once answered, the owner can delete it like any other.
- **Removing or changing the assistant closes their open copies** with a line ("No longer
  assisting this Sunday"), the same as a handover. Nothing is deleted.
- **A speaker change on a talk closes that talk's open asks** ("Speaker changed") and resets the
  talk's outcome, so Send asks offers the new speaker. This is the one place this slice touches the
  pipeline's data beyond recording an answer (see Task 3's investigation).

### Success criteria

- Send asks creates exactly one open ask per unasked speaker for the conductor, plus a mirror for
  the assistant if there is one. Pressing it twice creates nothing new.
- Accept/Decline from either copy completes **every** open copy for that talk, records the outcome
  through the pipeline's existing path (a decline reopens the slot and writes speaker history with
  its reason), and writes one audit row.
- Changing the conductor, by hand **or by a rotation re-shift**, gives the new conductor fresh
  copies and closes the old ones with a line. A source-reading test fails if a new write of
  `conducting_user_id` skips the handover.
- The Talks pill shows four states: dimmed (gate not met), "N not yet asked", pending, all
  accepted, any declined.
- Nobody but a to-do's owner can read it (migration 081 is unchanged): the conductor never sees the
  assistant's notes, and vice versa.
- Lint, typecheck, the full suite and the production build pass. `explicitTimeZone`,
  `navigationRoutesExist`, `user-author-fks` and `ward-isolation` stay green.

## Relevant Files

**f1 — Send asks, answer on the to-do, four-state pill**
- `supabase/migrations/083_talk_asks.sql` — create
  - `todos.ask_assignment_id`
  - `todos.closed_reason`
  - new `todo_log_entries.kind` values
  - `assignment_history.decline_reason`
- `types/database.ts` — regenerate (`npm run db:types`)
- `types/domain.ts` — modify
  - `Todo.askAssignmentId`, `Todo.closedReason`
  - `TODO_LOG_KINDS` additions
  - `DECLINE_REASONS`, `DECLINE_REASON_LABELS`
  - `TodoSummary.askSource`
- `lib/todos/logLines.ts` — modify — sentences for the new kinds
- `lib/todos/queries.ts` — modify
  - column list and mapper (rule 9)
  - delete refusal for an open ask
  - complete refusal for an open ask
- `lib/sacrament/talkAsks.ts` — create — pure:
  - `talkNeedsAsk()`
  - `talksAskState()` for the pill
  - `buildAskNotes()` for the to-do text
- `lib/todos/askLinks.ts` — create — service-role writes to other people's ask to-dos:
  - `createAsksForSunday()`
  - `resolveAsksForAssignment()`
  - `closeAsksForAssignment()`
- `lib/assignments/requestOutcome.ts` — create — the ONE server function recording an outcome (accept / decline + reason). It is extracted from what `PATCH /api/assignments/[id]` + `ContactStagePanel` do today, so the to-do route and the assignment route share it.
- `app/api/sundays/[id]/asks/route.ts` — create
  - `POST` = Send asks
  - `GET` = the Sunday's ask state for the pill
- `app/api/todos/[id]/answer/route.ts` — create — `POST { outcome: "accepted" | "declined", declineReason?, note? }`
- `lib/validation/talkAsk.ts` — create — Zod schemas
- `app/api/assignments/[id]/route.ts` — modify
  - use `requestOutcome.ts`
  - on a speaker change, close the talk's open asks and reset the outcome
- `app/(app)/assignments/ContactStagePanel.tsx` — modify — decline gains the reason select; it posts the same fields
- `app/(app)/todos/TodoCard.tsx` — modify — an open ask shows **Accepted** / **Declined** in place of the checkbox, plus the decline window
- `app/(app)/todos/AskAnswerDialog.tsx` — create — the decline window (reason select + optional note)
- `lib/sacrament/sundayStatus.ts` + `components/sacrament/SundayCard.tsx` + `app/(app)/sacrament/page.tsx` — modify — the four-state Talks check and a **Send asks** control, in the style of `FinalizeToggle`
- `app/(app)/roster/member/[id]/SpeakerHistoryTab.tsx` (+ its query) — modify — declines show the reason label and a "Talk" role label

**f2 — The work follows the conductor**
- `lib/todos/askLinks.ts` — modify — `handOverSundayAsks(wardId, sundayId, fromUserId, toUserId)`
- `lib/calendar/queries.ts` — modify
  - `updateSunday()` returns the conductor change
  - `applyConductingReshift()` returns `{ sundayId, from, to }[]`
- `app/api/sundays/[id]/route.ts` and the rotation route(s) that apply a re-shift — modify — call `handOverSundayAsks` for every change
- `tests/lib/conductorHandoverSites.test.ts` — create — source-reading guard

**f3 — The conductor window and the assistant**
- `supabase/migrations/084_sunday_assistant.sql` — create — `sundays.assistant_user_id`
- `types/database.ts`, `types/domain.ts`, `lib/calendar/queries.ts` (Sunday mapper and column list), `lib/validation/calendar.ts` — modify — `assistantUserId` (rule 9)
- `lib/todos/askLinks.ts` — modify
  - `mirrorAsksToAssistant()`
  - `releaseAssistantAsks()`
  - `createAsksForSunday` also creates the assistant's copy
- `app/api/sundays/[id]/route.ts` — modify — accept `assistantUserId`, validate bishopric-only and not-the-conductor, then mirror or release
- `components/sacrament/ConductorDialog.tsx` — create — "Who's conducting?": change the conductor, add, change or remove the assistant
- `components/sacrament/SundayCard.tsx` — modify — the conducting name opens the window instead of linking to the editor; the assistant's name shows beside it ("with Brother X")

**All sub-slices — docs, tests, harness**
- `SPEC.md`, `FEATURES.md` (Sacrament module), `plans/prototype/module-map.md` §2.1 (behaviours 3–6 built, and the user's conductor/assistant model as a deliberate extension), `plans/P4-module-reskins.md` (slice `f` status), `CLAUDE.md` §9 (one entry)
- Tests and scenarios listed under Testing Strategy

## Dependencies

- **No new libraries.**
- **Reuse, do not re-derive:**
  - `referencesDecisionOf()` (`lib/calendar/queries.ts:96`) — the gate
  - `listReferencesForAssignments()` (`lib/references/queries.ts:77`) — the ask's references
  - `listBishopricUsers()` (`lib/calendar/queries.ts:2226`) — the assistant must be one
  - `findUsersOutsideWard()` — the assistant is a SUBJECT user id from a request body (CLAUDE.md §7)
  - `writeAssignmentHistory()` — already writes a `declined` row. It gains the reason
  - `lib/todos/sourceLinks.ts` — the pattern for service-role writes to another person's to-do (header, `SourceLinkWriteError`, idempotence, `ward_id` on every write). `askLinks.ts` is its sibling, not an extension of it
  - `isTodoUntouched()`, `wardDateOnly()`, `readWardTimezone()`
  - `notifyOtherBishopric()` — adding or removing an assistant is an admin change the other two hear about (CLAUDE.md §7)
  - `FinalizeToggle.tsx` — the Send asks control's look
  - `Modal`, `SmallButton` / `RemoveButton` from `app/(app)/todos/SmallButton.tsx`
  - `tests/helpers/routeClient.ts`, `tests/helpers/seed.ts`
- **Permissions:**
  - Send asks and recording an answer: `talks.request` (held by the bishopric)
  - The conductor/assistant window: `calendar.manage`, like the existing conductor override
  - No new permission

## Known Pitfalls (from retro context)

- **p5-b-agenda-link-two-keys** — another person's to-do is written only through a service-role
  helper behind the source's own guard, after the source row was read through the caller's RLS
  client, with `ward_id` set and filtered on every write. Partial unique index plus 23505 treated as
  success makes creation idempotent. **Order: source write → link write → audit**, and a failed
  link write answers 500 with a sentence saying what did and did not happen.
- **p5-a-todo-core** — the audit detail carries ids and field names, never a title or note, and
  never a key containing "note" (`writeAuditLog()` redacts it). Python rewrites on Windows must
  keep LF (`newline=""`). A bare checkbox needs a 44px label.
- **sacrament-topics-finalize-and-history** (`lib/topics/finalize.ts` header) — a stale "ready"
  signal must not survive an edit, and the rule is about **what** changed, never **who moved**. A
  pipeline transition or an accept/decline must NOT un-send or re-send anything. Only a **speaker
  change** closes an ask. That header also shows the pattern for guarding every write path: one
  function, several call sites, and a test that reads the source.
- **calendar-c-rotation-cadence** — a rotation edit **re-shifts later Sundays' conductors**
  (`applyConductingReshift`). The handover must follow those too, or asks stay with somebody who
  no longer conducts, with nothing saying so. Generation writes several statements with no
  transaction. Every ask write here must be idempotent, so a repeat repairs a half-done run.
- **ward-callings-model** — no composite `(user_col, ward_id) → users` FK. `assistant_user_id`
  is a plain `references users (id)`, validated in the route (`findUsersOutsideWard` plus
  bishopric membership) with a 400 and a sentence.
- **youth-h (060-D2)** — keep USING and WITH CHECK identical on any policy you touch. This plan
  adds no policy: `todos` stays owner-only (081) and `sundays` keeps migration 019's policies.
- **sacrament-references-over-pgvector** — never `npm run build` while `npm run dev` is running.
  Check port 3000 first. Stopping a background `npm run dev` can orphan the Next.js child; check
  with `Get-NetTCPConnection`.
- **remember-page-view (memory)** — any new collapsible or toggled state on these pages
  remembers how it was left through `users.settings.page_views`. None is planned here; if one
  appears, use the shared helper.

## Tasks

### Sub-slice f1 — Send asks, answer on the to-do, four-state pill (commit 1)

#### Task 1: Migration 083
**File:** `supabase/migrations/083_talk_asks.sql` (create)
```sql
alter table todos
  add column ask_assignment_id uuid references assignments (id) on delete set null,
  -- Why an open item left this list without being done: 'handed_over', 'assistant_released',
  -- 'speaker_changed'. Null for every ordinary to-do. A closed ask has completed_at set too.
  add column closed_reason text check (closed_reason is null or closed_reason in
    ('handed_over', 'assistant_released', 'speaker_changed'));
-- At most one OPEN ask per talk per person: idempotence under a double press.
create unique index todos_one_open_ask_per_owner
  on todos (ask_assignment_id, user_id)
  where ask_assignment_id is not null and completed_at is null;
create index todos_ask_assignment on todos (ask_assignment_id) where ask_assignment_id is not null;

alter table todo_log_entries drop constraint <the kind check>;  -- look up the name in 081
alter table todo_log_entries add constraint todo_log_entries_kind_check check (kind in (
  'note','step_done','step_undone','completed','reopened','scheduled','unscheduled',
  'source_completed','ask_accepted','ask_declined','handed_over','assistant_released',
  'speaker_changed'));

alter table assignment_history
  add column decline_reason text check (decline_reason is null or decline_reason in ('not_available','other'));
```
- Header: U1, U6–U9, why `ask_assignment_id` is its own column rather than a polymorphic source
  (FK integrity; the P5 plan's Integration Notes say exactly this), and that **no policy moves**.
- `on delete set null` on a single column: `todos` has no `(id, ward_id)` pairing to
  `assignments`. Deleting a talk leaves its asks standing as ordinary to-dos, per "never destroy
  what somebody wrote".
- Add every log kind f2 and f3 need **now**, so their migrations do not rewrite this CHECK
  (081's precedent with `source_completed`).
- Push with `npm run db:push`, then `npm run db:types`.

#### Task 2: Types and log lines
**Files:** `types/domain.ts`, `lib/todos/logLines.ts`, `lib/todos/queries.ts` (modify)
- `DECLINE_REASONS = ["not_available", "other"] as const`, labels "Not available" / "Other".
- `TODO_LOG_KINDS` gains the five kinds. `describeLogEntry()` sentences:
  - `ask_accepted` → "Accepted"
  - `ask_declined` → "Declined — " + reason label (the reason label goes in `body`, never a free-text note)
  - `handed_over` → "Handed over to " + name (snapshotted in `body`)
  - `assistant_released` → "No longer assisting this Sunday"
  - `speaker_changed` → "Speaker changed — this ask is closed"
  - Keep the exhaustive `never` check.
- `Todo` gains `askAssignmentId` and `closedReason`. `TodoSummary` gains
  `askSource: { assignmentId, sundayDate, speakerName, isOpen } | null`, read through an embed on
  `assignments` (name the FK hint; check `types/database.ts`).
- Queries:
  - `deleteTodo` refuses an **open** ask (new outcome `"open_ask"` → 409, sentence in Overview).
  - `updateTodo` refuses `complete: true` on an open ask (400: "Record their answer — Accepted
    or Declined").
  - A **closed** ask (`closed_reason` set) behaves like any done to-do.

#### Task 3: One function records an outcome
**File:** `lib/assignments/requestOutcome.ts` (create); `app/api/assignments/[id]/route.ts`, `app/(app)/assignments/ContactStagePanel.tsx` (modify)
- **Investigate first, and write what you find in the file's header:**
  - Today, the decline path is two client calls in `ContactStagePanel`: `update { requestOutcome, requestNotes }`, then `transition { to: "plan", reason }`.
  - Read the route to learn:
    - where `writeAssignmentHistory(..., "declined")` fires
    - whether `requestOutcome` is writable at **every** stage, or only at `request`
    - whether `transition to plan` clears the speaker
  - An ask can go out while the talk is still at `plan`, `review` or `approve` (U5: it sits beside the pipeline), so the function must record the outcome at any stage.
  - If the route refuses that, relax **only** the outcome write, and say so in the retro.
- `recordRequestOutcome({ supabase, wardId, assignmentId, outcome, declineReason?, note?, actorUserId })`:
  - **accepted:** set `request_outcome = 'accepted'`. No stage move.
  - **declined:**
    - set `request_outcome = 'declined'` and `request_notes`
    - write history with `decline_reason` (members only; `writeAssignmentHistory` gains a reason parameter)
    - move back to `plan` and clear the speaker exactly as the panel does today, reusing the route's existing transition function
    - skip the stage move if already at `plan`, but still clear the speaker
- `PATCH /api/assignments/[id]`:
  - route its outcome writes through this function
  - **on a speaker change** (`memberId` or `externalSpeakerName` in the fields and different from before):
    - call `closeAsksForAssignment(..., "speaker_changed")`
    - reset `request_outcome` to null, so the new speaker counts as not yet asked (U9)
- `ContactStagePanel`: the decline gets the reason select. Its two calls become one call that
  carries the reason.

#### Task 4: Pure ask rules
**File:** `lib/sacrament/talkAsks.ts` (create). Imports `@/types/domain` only (pipeline.ts's rule).
- `talkNeedsAsk({ hasSpeaker, requestOutcome, openAskCount })` → true when there is a speaker,
  `openAskCount === 0` and the outcome is null or `pending`.
- `talksAskState({ referencesDecided, talks: {hasSpeaker, requestOutcome, openAskCount}[] })` →
  one of:
  - `{ kind: "locked", reason }`
  - `{ kind: "not_asked", count }`
  - `{ kind: "pending" }`
  - `{ kind: "accepted" }`
  - `{ kind: "declined", count }`

  Precedence: any declined, then not_asked, then pending, then all accepted. That is the
  prototype's order with "not yet asked" added.
- `buildAskNotes({ speakerName, onRoster, phone, topicTitle, sundayDate, references })`:
  - The text of the to-do's `notes`, like the prototype's, except the date uses the UTC day formatter
    (a `date` column) and the references are one per line.
  - A visitor reads "Not on the roster — no contact on file".
  - Cap it at `MAX_TODO_NOTES` (4000).

#### Task 5: Service-role ask writes
**File:** `lib/todos/askLinks.ts` (create). Header copied in spirit from `sourceLinks.ts` (service role, the caller's guard, `ward_id` on every write, no text read back to the caller).
- `createAsksForSunday({ wardId, sundayId, ownerUserIds, asks: { assignmentId, title, notes }[], assignedByUserId, today })`:
  - Insert one row per (ask × owner) with `ask_assignment_id`, `assigned_by`, `tag: "Sacrament"`
    and `do_date: today` (the ward's date).
  - 23505 means it already exists, which counts as success.
  - Returns the created ids.
- `resolveAsksForAssignment({ wardId, assignmentId, outcome, reasonLabel })`:
  - Set `completed_at` on **every open** ask for the talk.
  - Write an `ask_accepted` / `ask_declined` line on each.
  - This is the shared completion U4 asks for. It is **the one deliberate exception** to p5-b's
    "flag, never complete" rule: here two people hold **one** piece of work, not an assigner and
    an assignee. Say so in the header.
- `closeAsksForAssignment({ wardId, assignmentId, reason })`:
  - Set `completed_at` and `closed_reason` on every open ask for the talk, with a log line.
  - Never deletes.

#### Task 6: Routes
**Files:** `app/api/sundays/[id]/asks/route.ts`, `app/api/todos/[id]/answer/route.ts`, `lib/validation/talkAsk.ts` (create)
- `POST /api/sundays/[id]/asks`:
  1. `assertCan(talks.request)`.
  2. Read the Sunday through the caller's client (the 404 path), then its talks, openAskCount per talk and references.
  3. Refuse with 400 and a sentence when:
     - the References gate is not met
     - there is no conductor
     - no talk needs an ask ("Everyone on this Sunday has been asked.")
  4. Build asks with `talkNeedsAsk` + `buildAskNotes` (member phone from `members.phone`; members have no email column).
  5. Call `createAsksForSunday` with owners = [conductor, assistant if any].
  6. Audit `talk_asks_sent`, `{ sundayId, assignmentIds, todoIds }`.
- `GET` returns `talksAskState` input for the pill.
- `POST /api/todos/[id]/answer`:
  1. `assertCan(talks.request)`.
  2. Read the to-do through the caller's own client, which proves ownership; 404 otherwise.
  3. It must be an open ask; otherwise 400.
  4. `recordRequestOutcome(...)`, then `resolveAsksForAssignment(...)`.
  5. Audit `talk_ask_answered`, `{ todoId, assignmentId, outcome, declineReason }` (no note text).
  6. If the outcome is saved but the to-dos are not, answer 500: "The answer was recorded on the talk, but not every copy of the ask was closed. Please refresh." Re-sending is safe.

#### Task 7: The to-do card and the decline window
**Files:** `app/(app)/todos/TodoCard.tsx` (modify), `app/(app)/todos/AskAnswerDialog.tsx` (create)
- An **open** ask:
  - The checkbox is replaced by two compact buttons, **Accepted** and **Declined**. Keep 44px targets (the p5-a 075-D1 lesson).
  - Declined opens `AskAnswerDialog`:
    - a reason select (Not available / Other, default Not available)
    - "A quick note (optional)"
    - **Record decline** / Cancel
- A quiet source line: "Talk on <Sunday> · <speaker>".
- ✕ stays; its 409 sentence appears beside the card.
- A **closed** ask shows its closed reason in the timeline only.

#### Task 8: The hub pill and Send asks
**Files:** `lib/sacrament/sundayStatus.ts`, `components/sacrament/SundayCard.tsx`, `app/(app)/sacrament/page.tsx` (modify)
- The Talks pill gains a check, like the Topics and Refs checks:
  - dimmed with a tooltip when locked ("Finalize or skip References first" / "No speaker to ask yet" / "Nobody is conducting yet")
  - gold "Asks sent" when pending
  - green when all accepted
  - rust with a count when any declined
- When `not_asked` > 0: a small **Send asks (N)** button beside it, posting to the route and then refreshing.
- The page reads open-ask counts per talk in one query for the month (not per Sunday) and passes them down. `sundayStatus.ts` stays pure.

#### Task 9: Decline history shows its reason
**Files:** `app/(app)/roster/member/[id]/SpeakerHistoryTab.tsx` and its query (modify)
- Declined rows show "Declined — Not available" with a "Talk" label, so that when prayers join in
  slice `g`, "declines talks but accepts prayers" can be seen at a glance (build note 351).

#### Task 10: Docs for f1
SPEC (migration 083, the two routes, the rule), FEATURES (Sacrament: asks), module-map §2.1
(behaviours 3–6 built, with the U-decisions as deliberate departures: never deleted, visitors asked,
re-ask via Send asks, a speaker change closes the ask), P4 slice `f` status.

### Sub-slice f2 — The work follows the conductor (commit 2)

#### Task 11: Handover
**File:** `lib/todos/askLinks.ts` (modify)
- `handOverSundayAsks({ wardId, sundayId, fromUserId, toUserId, toName })`:
  - If `toUserId` is null or equals `fromUserId`, do nothing (the open asks stay with the previous owner).
  - For each open ask owned by `fromUserId` on this Sunday's talks:
    1. Create the fresh copy for `toUserId` with the same title, notes, `scheduled_for` and
       `scheduled_with_member_id` (the appointment follows the work, per U3).
    2. Close the old copy with `closed_reason = 'handed_over'` and a `handed_over` line naming the new owner.
  - Idempotent: the partial unique index stops a second copy, and closing is conditional on still being open.
  - **If the new conductor is the current assistant**, they already hold a copy. Keep theirs and close only the old conductor's.

#### Task 12: Every conductor write hands over
**Files:** `lib/calendar/queries.ts`, `app/api/sundays/[id]/route.ts`, the route(s) applying a rotation re-shift (modify)
- `updateSunday()` already exposes `before` / `after`. In the route, after the Sunday write,
  call `handOverSundayAsks` when `before.conductingUserId !== sunday.conductingUserId`. Add the
  result ids to the existing audit detail.
- `applyConductingReshift()` returns `{ sundayId, fromUserId, toUserId }[]` for the rows it
  overwrote. Every caller hands over each change.
- `populateConducting()` only fills nulls, so there is no previous owner and **no handover is
  needed**. Say so in a comment, because the test below will ask.
- A failed handover after a saved conductor change answers 500: "The conductor was changed, but
  their open asks were not all moved. Please try again." Re-sending is safe.

#### Task 13: Guard every write path
**File:** `tests/lib/conductorHandoverSites.test.ts` (create)
- Read `lib/calendar/queries.ts` and the Sunday and rotation route sources.
- Assert that every function containing `.update({ conducting_user_id` or `conducting_user_id:`
  in an update either returns its changes (`applyConductingReshift`, `updateSunday`) or is named
  on an explicit exemption list with its reason (`populateConducting`: nulls only).
- Assert that every route calling them references `handOverSundayAsks`.
- Prove it can fail: temporarily remove one call and see it go red, then restore it. Record this
  in the retro (`appWideGrant`'s discipline).

### Sub-slice f3 — The conductor window and the assistant (commit 3)

#### Task 14: Migration 084
**File:** `supabase/migrations/084_sunday_assistant.sql` (create)
```sql
alter table sundays
  add column assistant_user_id uuid references users (id) on delete set null,
  add constraint sundays_assistant_not_conductor
    check (assistant_user_id is null or assistant_user_id is distinct from conducting_user_id);
```
- A plain FK (ward-callings-model). No policy moves: `sundays` writes are already bishopric-scoped by migration 019.
- The CHECK means a handover **to the assistant** must clear `assistant_user_id` in the same
  update. `updateSunday()` does that when the new conductor equals the current assistant, and the
  window says so ("Brother X was assisting — they now conduct, with no assistant").

#### Task 15: Types, schema, route
**Files:** `types/database.ts` (regenerate), `types/domain.ts`, `lib/calendar/queries.ts`, `lib/validation/calendar.ts`, `app/api/sundays/[id]/route.ts` (modify)
- `Sunday.assistantUserId` goes through the column list and the mapper (rule 9).
- The schema accepts `assistantUserId: uuid | null`.
- The route:
  1. Validate with `findUsersOutsideWard` + `listBishopricUsers` (400: "An assistant must be in the bishopric.") and not-the-conductor (400).
  2. On a change: `releaseAssistantAsks(old)`, then `mirrorAsksToAssistant(new)`.
  3. `notifyOtherBishopric` ("Brother X is assisting on <date>" / "No assistant on <date>").
  4. The audit detail gains the assistant ids.

#### Task 16: Mirror and release
**File:** `lib/todos/askLinks.ts` (modify)
- `mirrorAsksToAssistant({ wardId, sundayId, assistantUserId, conductorUserId })`: a fresh copy of every **open conductor ask** on the Sunday (U6: never the conductor's notes).
- `releaseAssistantAsks({ wardId, sundayId, assistantUserId })`: close each open copy with `assistant_released`.
- `createAsksForSunday` (f1) already takes a list of owners. The asks route now passes the assistant too.

#### Task 17: The conductor window
**Files:** `components/sacrament/ConductorDialog.tsx` (create), `components/sacrament/SundayCard.tsx`, `app/(app)/sacrament/page.tsx` (modify)
- Clicking the conducting name opens **"Who's conducting?"** (the prototype's title) for anyone
  holding `calendar.manage`.
  - **Conducting:** the three bishopric members as quick picks, current one marked, and a line:
    "Their open asks for this Sunday move with them."
  - **Assistant:** the other two as quick picks, **None**, and a line: "An assistant gets a copy of
    every open ask. Whoever records the answer closes it for both."
  - Save → `PATCH /api/sundays/[id]`. The route's sentence appears on error.
- The card shows "Conducting: Bishop A · with Brother B" when there is an assistant.
- The old link to the Sunday editor moves to a small "Edit Sunday" link inside the window, so the
  override editor stays reachable (p4-sacrament-a's note).
- The compact-ui preference applies: the window fits its content, with small grouped buttons.

#### Task 18: Docs for f2/f3
- SPEC: migration 084, the assistant field, the handover rule.
- FEATURES.
- module-map §2.1: the user's conductor/assistant model, marked as a deliberate extension beyond the prototype, whose `ConductingModal` only substitutes.
- `CLAUDE.md` §9: one entry:
  - ask to-dos follow the conductor on every conductor write, including re-shifts
  - fresh copy on handover
  - one assistant, sharing completion, as the named exception to p5-b's flag rule
  - "a speaker change closes an ask; nothing else does"
- P4 slice `f` done; slice `g` notes: it reuses `askLinks`, `talkAsks` and `requestOutcome` with a
  `prayer_id` link column. Prayers are not gated on References.

## Testing Strategy

**RLS (highest value)**
- `tests/rls/todos.test.ts` — extend:
  - A conductor's ask to-do created by the service role is invisible to the assistant and to the third bishopric member, and vice versa. Anchor on the owner reading exactly one.
  - An authenticated INSERT with `ask_assignment_id` set **and** `assigned_by` set still raises (081's policy).

**Pure logic**
- `tests/lib/talkAsks.test.ts`:
  - `talkNeedsAsk` for every combination
  - `talksAskState` precedence (declined > not_asked > pending > accepted), each lock reason
  - `buildAskNotes` for a member with a phone, a member without one, a visitor, and no references
- `tests/lib/todoLogLines.test.ts` — its loop over `TODO_LOG_KINDS` covers the new kinds automatically; confirm each sentence.
- `tests/lib/conductorHandoverSites.test.ts` — Task 13, proved able to fail.

**Routes** (`// @vitest-environment node`, `routeClient`)
- `tests/routes/talk-asks.test.ts`:
  - **Sending:**
    - Send asks is refused before References is decided and with no conductor.
    - With the gate met, two speakers (one member, one visitor) produce exactly 2 open asks for the conductor, read back with the service client.
    - A second Send asks creates 0.
  - **Answering:**
    - Accepting from the to-do sets `request_outcome = 'accepted'` and completes the ask with an `ask_accepted` line.
    - Declining with `not_available` completes the ask, writes `assignment_history` with `decline_reason`, and reopens the slot.
    - A visitor's decline writes no history row.
  - **Refusals on an open ask:**
    - Deleting it answers 409.
    - Ticking it done answers 400.
    - Another bishopric member answering it gets 404.
  - **Speaker change:** changing the speaker on an asked talk closes the ask with `speaker_changed` and makes Send asks offer the new speaker.
  - **Privacy:** the audit rows carry no title or note text.
- `tests/routes/conductor-handover.test.ts` (f2/f3):
  - A manual conductor change moves open asks, giving fresh copies to the new conductor and closing the old ones with `handed_over`. The old copy's note stays on the old copy.
  - A rotation re-shift moves them too.
  - Changing to a non-meeting type (conductor nulls) leaves them.
  - Adding an assistant mirrors every open ask; answering from the assistant's copy completes both.
  - Removing the assistant closes their copies with `assistant_released`.
  - A non-bishopric assistant answers 400; the assistant equal to the conductor answers 400.

**Mechanical guards to keep green:** `explicitTimeZone`, `navigationRoutesExist`,
`user-author-fks`, `ward-isolation`, `migrations.test.ts`, `notification-triggers-seed` (no new
trigger key is added; `notifyOtherBishopric` uses its existing one).

## Test Scenarios (Harness)

Area `testing/scenarios/sacrament/` (copy `_templates/`). Numbers continue from 077.

### Scenario 078: Send the asks and hear back
**Tags:** sacrament, todos, full, P4
**Purpose:** The Send asks gate, the four-state pill and accept/decline on the to-do cross the hub
and To Do. Reaching "References decided with three speakers, one a visitor" by hand takes many
steps, so seeding it helps.
**Seed data summary:**
- Ward (America/Denver) with bishop, 1st counselor and 2nd counselor
- Next Sunday:
  - conducted by the 1st counselor
  - References **skipped**
  - three talks: two members (one with a phone, one without) and one visitor
- The Sunday after: References not decided, one speaker (the locked state)

**Tester action:** as the 1st counselor, open Sacrament and press Send asks (3). Open To Do,
accept one ask, and decline one as "Not available" with a note. Change the declined slot's speaker
on the Topics page, return to the hub and press Send asks (1).

**Verification checklist:**
- [ ] The locked Sunday's Talks check is dimmed, with "Finalize or skip References first"
- [ ] Send asks (3) creates three asks on the counselor's list: the visitor's reads "Not on the roster — no contact on file", and the phoneless member's reads "no contact on file"
- [ ] Each open ask shows Accepted / Declined and no checkbox; ✕ is refused with the sentence
- [ ] Accept: the ask moves to Done with "Accepted", the talk's outcome is `accepted`, and the pill stays gold (others pending)
- [ ] Decline: Done with "Declined — Not available"; the slot reopens; the member page shows "Declined — Not available · Talk"
- [ ] The pill turns rust with a count, and after a new speaker is chosen, Send asks (1) sends only one
- [ ] The bishop sees none of the counselor's asks on their own To Do
- [ ] Is "Send asks (N)" clear about what it will do, and does the rust state read as needing action? (judgement)

### Scenario 079: A new conductor, and an assistant
**Tags:** sacrament, todos, calendar, full, P4
**Purpose:** Handover and mirroring cross three people's lists and the rotation. The state needs
open asks with private notes already on them.
**Seed data summary:**
- Next Sunday conducted by the 1st counselor, with two open asks on their list
- One of those asks has a step and a private note, "PRIVATE COUNSELOR NOTE"
- The Sunday after also has an open ask for the same counselor (for the re-shift)

**Tester action:** as the bishop:
1. Click the conducting name and make the 2nd counselor the conductor.
2. Add the bishop as assistant.
3. As the 2nd counselor, accept one ask.
4. As the bishop, confirm it is done on their list too.
5. Remove the assistant.
6. Change the conducting rotation so the following Sunday re-shifts.

**Verification checklist:**
- [ ] The 2nd counselor now holds fresh copies without the step or "PRIVATE COUNSELOR NOTE"; the 1st counselor's copies are Done with "Handed over to …" and still carry their note
- [ ] Adding the bishop as assistant gives them copies; the card reads "… · with Bishop …"; the other two get a notification
- [ ] Accepting on the 2nd counselor's copy moves the bishop's copy to Done with "Accepted" too
- [ ] Removing the assistant closes the bishop's remaining open copies with "No longer assisting this Sunday"
- [ ] The re-shifted Sunday's ask moves to its new conductor
- [ ] Choosing the assistant as conductor clears the assistant and says so
- [ ] Is "Their open asks for this Sunday move with them" enough warning before changing the conductor? (judgement)

## Validation Commands

```bash
# Migrations and types (f1: 083; f3: 084)
npm run db:push
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests: targeted first, then the full suite
npx vitest run tests/lib/talkAsks.test.ts tests/lib/conductorHandoverSites.test.ts tests/lib/todoLogLines.test.ts tests/routes/talk-asks.test.ts tests/routes/conductor-handover.test.ts tests/rls/todos.test.ts tests/routes/todos.test.ts tests/routes/assignments.test.ts
npm test

# Production build: check port 3000 is free first (Get-NetTCPConnection -LocalPort 3000)
npm run build

# Harness manifest after adding scenarios
npm run manifest
```

## Integration Notes

- **Slice `g` (Prayers)** reuses `askLinks.ts`, `talkAsks.ts` (generalized, or a sibling
  `prayerAsks.ts`), `requestOutcome.ts`'s shape and the answer route, with its own link column
  (`todos.ask_prayer_id`). Prayers are **not** gated on References. `declineHistory` gains the
  "Prayer" role label there.
- **P6's conflict check** reads scheduled ask to-dos through `buildMyAppointments()`; nothing new
  is needed.
- **The pipeline revamp (the user's, later)** is expected to absorb the request stage. Keep
  `recordRequestOutcome()` the only writer of an outcome, so the revamp changes one function.
- **Breaking changes:** none. `ContactStagePanel`'s decline gains a required reason select;
  existing history rows keep `decline_reason` null, which renders as "Declined".
- **Migrations:** 083 and 084 are purely additive, so neither is held back. Apply 083 before
  deploying f1 and 084 before f3.
- **Deliberately not built:**
  - notifications to the conductor when asks arrive (the to-dos simply appear, P5's rule)
  - more than one assistant
  - a snapshot of who conducted after the meeting (prototype notes 368 and 418)
  - un-sending an ask other than by changing the speaker
