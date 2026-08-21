# Plan: Talks B — Month Planner & the Contact Stages

**Created:** 2026-08-20
**Type:** feature
**Phase:** 4 of 13 — part 2 of 4 ([plans/04-talks-pipeline.md](04-talks-pipeline.md))
**Scope refs:** ITER-004 (external speakers — the on-screen half)
**Structure:** Sequential — depends on `talks-a-pipeline-core.md`; `talks-c` and `talks-d` follow

---

## Overview

The screens. `talks-a` landed a tested pipeline engine and four routes with no way to reach them;
this plan builds the surface a bishopric actually works in — a month planner where most of the
work happens in a modal, an assignment detail page for the rest, realtime comment threads, and the
REQUEST → CONFIRM → NOTIFY sequence including the `sms:` handoff.

**Key requirements**

1. **The pipeline is nine stages, not nine screens.** The month view is the primary surface and a
   modal is where an assignment is planned. A per-assignment page exists for the long-form work
   (comments, approvals, the confirmation message) and is secondary. Building nine screens makes
   the workflow tedious — this is the phase's last and most expensive pitfall.
2. Fills the three reserved regions `calendar-b` left on `SundayCell` and `SundayCard`
   (`speakers`, `pipelineStatus`) so one change lights up both the grid and the 375px list.
3. The approval indicator reads 1-of-3 / 2-of-3 at a glance, and editing an approved assignment
   warns **before** it invalidates.
4. An external speaker's waived contact stages read as **"Not applicable"** with the reason, never
   as an outstanding task and never as a silently-skipped step (ITER-004).
5. The `sms:` handoff always ships beside a **Copy message** button, because the link is dead in a
   desktop browser and truncates differently on every phone.

**Success criteria**

- A bishopric member plans a full Sunday — three speakers, topics, slot lengths — without leaving
  the month view
- The month grid shows each Sunday's speakers and a stage summary; both render at 375px
- 2-of-3 approvals show as "Waiting on 1 more"; the third flips it to an explicit **Approve plan**
  action, and approval never happens as a side effect of anything
- Editing an approved assignment warns first, then clears approvals and notifies
- A declined request returns the slot to `plan` with the speaker cleared, visibly
- An external speaker reaches `complete` with REQUEST/CONFIRM/NOTIFY/APPRECIATE shown as
  "Not applicable — invited outside the ward", and nothing looks outstanding
- Scenarios 012 and 013 walked; `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
  all pass

---

## Relevant Files

| File | Action | What and why |
|---|---|---|
| `app/(app)/assignments/page.tsx` | create | Month planner — the primary surface. Server Component |
| `app/(app)/assignments/MonthPlannerBoard.tsx` | create | `"use client"` — owns modal state and the TanStack Query cache for the month |
| `app/(app)/assignments/AssignmentModal.tsx` | create | Plan/edit one assignment. Where most work happens |
| `app/(app)/assignments/SpeakerField.tsx` | create | The member-or-external switch (ITER-004) |
| `app/(app)/assignments/ApprovalPanel.tsx` | create | n-of-3 indicator, approve, request changes |
| `app/(app)/assignments/[sunday_id]/page.tsx` | create | Single Sunday detail — approvals, comments, contact stages |
| `app/(app)/assignments/ContactStagePanel.tsx` | create | REQUEST → CONFIRM → NOTIFY, or the waiver |
| `app/(app)/assignments/CommentThread.tsx` | create | `"use client"` — realtime via Supabase Realtime |
| `components/assignments/StageBadge.tsx` | create | Uses the nine `--stage-*` tokens |
| `components/assignments/SpeakerLine.tsx` | create | One speaker, member or external, with title |
| `components/assignments/PipelineStatusSummary.tsx` | create | The `pipelineStatus` reserved region |
| `components/assignments/SpeakerList.tsx` | create | The `speakers` reserved region |
| `components/assignments/SmsHandoff.tsx` | create | `sms:` link **and** copy fallback |
| `app/(app)/calendar/page.tsx` | modify | Pass `speakers` and `pipelineStatus` into `SundayCard` |
| `components/calendar/MonthGrid.tsx` | modify | Thread the same two regions into `SundayCell` |
| `app/(app)/calendar/sunday/[id]/page.tsx` | modify | Replace the "arrives in Phase 4" placeholder at line ~182 |
| `app/globals.css` | modify | Retune the nine `--stage-*` hex values; **the names must not change** |
| `lib/assignments/smsLink.ts` | create | Pure — builds the `sms:` URL. Client-importable |
| `lib/assignments/messageTemplate.ts` | create | Pure — the manual confirmation/thank-you template |
| `components/layout/Sidebar.tsx` | modify | Add the Talks entry if `navigation.ts` does not already emit it |
| `tests/lib/smsLink.test.ts` | create | Platform quirks, encoding, truncation guard |
| `tests/lib/messageTemplate.test.ts` | create | Template fills; missing topic degrades honestly |
| `tests/components/assignments/StageBadge.test.tsx` | create | All nine stages render their label |
| `tests/components/assignments/ContactStagePanel.test.tsx` | create | Waived stages read "Not applicable", not "outstanding" |
| `SPEC.md` | modify | Record the component tree actually built |

---

## Dependencies

- **No new packages.** `@testing-library/user-event` is **not installed** and adding it needs
  permission — `fireEvent` from `@testing-library/react` covers clicks (roster-b).
- **Reuse, do not rebuild:**
  - `MemberPicker` — **the interface is frozen.** Phase 4 uses `multiple`, `max`,
    `filter.categories`, and `showFlags`. If something is missing, **raise it**; do not add a prop
    quietly (the comment block in `components/roster/MemberPicker.tsx` is explicit about the cost)
  - `Modal` — native `<dialog>`, deliberately not configurable
  - `Card`, `Button`, `Input`, `FormError`, `NotPermitted`
  - `QueryProvider` — already mounted; TanStack Query is client-only
  - `ReservedRegions`, `SundayCell`, `SundayCard` from `components/calendar`
- **`showFlags` renders nothing until `talks-d`.** `ReliabilityFlag` is a deliberate no-op. Pass
  `showFlags` where the planning view wants it; expect no output yet, and do **not** wire a guessed
  rule in this slice.

---

## Known Pitfalls (from retro context)

- **[roster-b] A client component importing `lib/<module>/queries.ts` fails the build.** Every
  screen here is a client component. Import `lib/assignments/pipeline.ts`, `speaker.ts`,
  `rotation.ts`, `smsLink.ts` and `messageTemplate.ts` freely — they are type-only by design — and
  never `lib/assignments/queries.ts`. Only `npm run build` catches this.
- **[roster-b] A Server Component cannot hand a client list a callback.** `MonthPlannerBoard` owns
  the selection and modal state and renders the grid, exactly as `BulkAssignBar` ended up owning
  `MemberList`.
- **[roster-b] `useMemo` on a value feeding a TanStack Query key buys nothing.** Keys are hashed
  structurally.
- **[roster-b] Check the query parameter name against the handler.** The members route reads
  `getAll("status")`, singular; a client sending `statuses` gets silently ignored. Read
  `app/api/assignments/route.ts` before writing the fetch.
- **[roster-b / calendar-b] Do not drive the native `<dialog>` through jsdom.** Render tests use
  `mode: "inline"`; the dialog itself is covered by the harness on a real device.
- **[calendar-b] A `<dialog>` confirm button must be `aria-describedby` the text explaining it.**
  The approval-invalidation warning is exactly this shape — `roster-c` shipped a dead button with
  an unconnected announcement and it had to be fixed.
- **[calendar-b] `next/link` renders fine in jsdom** without an App Router context mock.
- **[roster-b] `react-hooks/globals` rejects assigning to a module-level variable during render.**
  Capture a controlled value from the change handler instead.
- **[auth-b] `can()` not `assertCan()` in a Server Component.** A `ForbiddenError` escaping one
  becomes a 500 whose message Next.js strips in production. Render `<NotPermitted>` instead.
- **[foundation-a] `params` and `searchParams` are Promises in Next 16.** Type the props
  explicitly; the generated `PageProps` helper only exists after a build.

---

## Tasks

### Task 1: Pure — the `sms:` link builder

**File:** `lib/assignments/smsLink.ts` (create)

```ts
export type SmsTarget = { phone: string | null; body: string };
export type SmsLink = { href: string | null; truncationRisk: boolean };

export function buildSmsLink(target: SmsTarget): SmsLink
export function normalizePhone(raw: string): string | null
```

- iOS wants `&body=`, Android wants `?body=`. `sms:{phone}?&body={encoded}` is the form that works
  on both and is what 04-talks-pipeline.md §Step 4 specifies — use it verbatim.
- `encodeURIComponent` the body, always.
- `href` is `null` when there is no phone. **A null href must render as no link at all**, never as
  a disabled-looking anchor.
- `truncationRisk` is true past ~500 characters. The UI uses it to surface Copy more prominently;
  it never blocks sending.
- Client-importable: import nothing but types.

### Task 2: Pure — the message template

**File:** `lib/assignments/messageTemplate.ts` (create)

```ts
export function buildConfirmationMessage(input: {
  speakerFirstName: string | null;
  date: string;
  topicTitle: string | null;
  slotLengthMinutes: number | null;
  suggestedScriptures: readonly string[];
}): string

export function buildThankYouMessage(input: {
  speakerFirstName: string | null;
  date: string;
  comments: readonly string[];
}): string
```

Each returns a **draft the user edits**. A missing topic or scripture list omits that sentence
rather than emitting "undefined" or a placeholder — degrade honestly.

> **Phase 5 replaces the body of these functions, not their signature.** The AI route returns a
> draft into the same textarea. Nothing here may auto-populate `notify_message` (CLAUDE.md rule 3).

### Task 3: Stage badge and the colour tokens

**Files:** `components/assignments/StageBadge.tsx` (create), `app/globals.css` (modify)

- `StageBadge` takes a `PipelineStage` and renders `PIPELINE_STAGE_LABELS[stage]` with the
  matching `--stage-<name>` token.
- **The nine token names are the contract between Phase 3 and Phase 4 and must not change.** The
  hex values are Phase 4's to retune — `calendar-b` checked contrast by eye, not by measurement.
  Measure both themes against WCAG AA this time and record the numbers in the retro.

### Task 4: The reserved regions

**Files:** `components/assignments/SpeakerList.tsx`, `PipelineStatusSummary.tsx` (create);
`app/(app)/calendar/page.tsx`, `components/calendar/MonthGrid.tsx` (modify)

`calendar-b` left `speakers`, `pipelineStatus` and `goalAlerts` as real `ReactNode` props on both
`SundayCell` and `SundayCard`. Fill the first two; `goalAlerts` belongs to `talks-d`.

- `SpeakerList` — one line per assignment, ordered by `slot_number`, member name or external
  display name. Empty slots read "Slot 2 — open", not blank; an unfilled slot is information.
- `PipelineStatusSummary` — the Sunday's furthest-behind stage plus a count, e.g. "2 confirmed,
  1 awaiting approval". One line; the cell is `min-h-40` and already sized for it.
- The calendar page fetches assignments for the month **once** and passes both regions down. Do not
  fetch per cell.

### Task 5: Month planner page

**Files:** `app/(app)/assignments/page.tsx`, `MonthPlannerBoard.tsx` (create)

- Server Component resolves the session, `can(user, "talks.view", roleAccess)` → `<NotPermitted>`
  on failure, reads the month's Sundays and assignments, and hands them to the board.
- `?month=YYYY-MM`, parsed with `parseMonthParam` from `lib/calendar/dates.ts`. Reuse
  `MonthNavigation`.
- The board is `"use client"`, owns modal state, and holds the month's assignments in a TanStack
  Query cache keyed `["assignments", month]`.
- Each Sunday is a card listing its slots. **A Sunday with `speakingSlots === 0` shows "No
  speaking slots" and offers no add control** — key off the slot count, not the Sunday type
  (talks-a Decision 6).
- Tapping a slot opens `AssignmentModal`. At 375px the card list stacks; no horizontal scroll.

### Task 6: The assignment modal

**Files:** `app/(app)/assignments/AssignmentModal.tsx`, `SpeakerField.tsx` (create)

- Fields: speaker, assignment type, topic, slot length. `counts_toward_rotation` is **never shown**
  — the server sets it from the type (talks-a Task 9).
- `SpeakerField` is a two-way switch:
  - **Ward member** → `MemberPicker` with `multiple={false}`, `showFlags`, and
    `filter.categories: ["adult"]` (or `["youth"]` when the type is `youth_speaker`)
  - **Someone outside the ward** → two text inputs, name and title, with the hint *"Type the title
    exactly as it should print — 'President', 'Sister', 'Elder'."* Nothing is derived: `users`
    records no gender and `bishopricDisplayName()` refuses to guess an honorific for that reason
  - Switching sides **clears the other**, matching the database CHECK that a row has one or the
    other, never both
- Saving an assignment that already has approvals shows a confirm step first: *"Two members have
  approved this plan. Saving clears those approvals and asks them again."* The confirm button is
  `aria-describedby` that paragraph (calendar-b).
- Advancing a stage is always its own explicit control, never a save side effect.

### Task 7: Approvals

**File:** `app/(app)/assignments/ApprovalPanel.tsx` (create)

- Reads the approval rows and `listBishopricUsers()`. Renders "Approved by Peter and Daniel —
  waiting on the bishop", not a bare "2/3".
- **Approve** and **Request changes** are separate controls. Request changes requires a comment;
  the schema already enforces it, and the form must say so before submit rather than after.
- When every member has approved, the panel surfaces an explicit **Approve plan** action that
  performs the `review → approve` transition. `readyToApprove` from the approve route drives its
  visibility. It never fires automatically.
- A bishopric of two — a ward mid-reorganization — needs both, not three. The copy must not
  hardcode "3".

### Task 8: Sunday detail page and contact stages

**Files:** `app/(app)/assignments/[sunday_id]/page.tsx`, `ContactStagePanel.tsx`,
`components/assignments/SmsHandoff.tsx` (create)

- The secondary surface: every assignment on one Sunday, expanded — approvals, comments, contact
  stages, the confirmation message textarea.
- **REQUEST** — who contacted, when, and Accepted / Declined / Pending plus notes. A decline
  triggers the `request → plan` transition and the UI must show the slot returning to open with
  the speaker cleared.
- **CONFIRM** — a textarea pre-filled from `buildConfirmationMessage()`. The counselor edits and
  **approves**; only approval writes `notify_message`.
- **NOTIFY** — `SmsHandoff` renders the `sms:` link **and** a Copy message button, always, side by
  side with equal weight. On desktop, where the link is dead, the link is not rendered at all and
  Copy carries a line explaining why. Then **Mark as sent** sets `notify_sent_at`. There is no
  delivery confirmation; "sent" is a human assertion and the copy should say so plainly.
- **The waived path (ITER-004).** When `contactWaivedAt` is set, all three stages render as
  **"Not applicable — invited outside the ward"** with the waiving member's name and date. No
  progress bar, no outstanding-task styling, no disabled buttons implying something is pending.
  When the speaker is external and the waiver is *not* yet set, offer **Mark not applicable** with
  a one-line explanation of what it does.
- APPRECIATE follows the same shape: comments from each bishopric member, then a thank-you draft,
  or the waived treatment.

### Task 9: Comment threads

**File:** `app/(app)/assignments/CommentThread.tsx` (create)

- Both levels through `/api/assignment-comments` — `month` keyed by `sundayId`, `assignment` by
  `assignmentId`.
- Realtime via Supabase Realtime on `assignment_comments`, filtered by ward. Subscribe on mount,
  **unsubscribe on unmount** — a leaked channel per navigation is the usual bug here.
- Optimistic append on send, reconciled by the realtime event. On failure, restore the draft text
  into the input rather than discarding what somebody typed.

### Task 10: Navigation and spec

**Files:** `components/layout/Sidebar.tsx` / `lib/auth/navigation.ts`, `SPEC.md` (modify)

- Check `lib/auth/navigation.ts` first — it may already emit a Talks entry gated on `talks.view`
  (`tests/lib/navigation.test.ts` asserts the role matrix). Extend the test if the entry is new.
- Record the component tree actually built in SPEC.md §Component Structure; it currently guesses
  `/assignments/[sunday_id]/page.tsx`, which this plan matches — confirm rather than assume.

---

## Testing Strategy

| File | Asserts |
|---|---|
| `tests/lib/smsLink.test.ts` | The `?&body=` form is produced verbatim; the body is URI-encoded; a null phone yields a null href; `truncationRisk` flips at the boundary |
| `tests/lib/messageTemplate.test.ts` | Both templates fill; a null topic and an empty scripture list omit their sentence rather than emitting a placeholder |
| `tests/components/assignments/StageBadge.test.tsx` | All nine stages render `PIPELINE_STAGE_LABELS`; a stage added to the enum fails the test |
| `tests/components/assignments/ContactStagePanel.test.tsx` | **The ITER-004 assertion.** A waived panel renders "Not applicable", renders no disabled action, and contains none of the outstanding-task copy. A member speaker never offers the waiver control |

Route handlers stay unit-untested — no local server (roster-b, fifth slice running). The pipeline
rules are already pinned by `talks-a`'s pure tests; these four cover only what the UI adds.

---

## Test Scenarios (Harness)

### Scenario 012: The three-approval gate
**Tags:** `[talks, full, approvals, permissions]`
**Purpose:** Building 2-of-3 and 3-of-3 approval states by hand across three accounts is tedious
and easy to get subtly wrong, which is exactly what seeding is for. What a walkthrough proves that
`approvalGate.test.ts` cannot: that the indicator reads as a sentence a bishopric understands, that
the invalidation warning arrives *before* the edit rather than after, and that approval never
happens as a side effect of saving.

**Seed data summary:**
- Ward — Harness Test Ward
- Users — `bishop`, `counselor1`, `counselor2` (the three approvers); `secretary` (holds
  `talks.view` only); `eqpres` (holds nothing here)
- Sundays — March 2026 generated; 03-01 fast Sunday `speaking_slots = 0`, the rest standard with 3
- Assignments — 03-08 fully planned at stage `review` with **two** approvals already recorded;
  03-15 at `plan` with one speaker; 03-22 empty

**Tester action:** Sign in as the bishop, approve 03-08, then edit it and observe invalidation.
Then sign in as the secretary and confirm read-only.

**Verification checklist:**
- [ ] 03-08 reads "waiting on the bishop" by name, not "2/3"
- [ ] The **Approve plan** action appears only after the third approval and must be tapped
- [ ] Editing the approved plan warns first, naming who loses their approval
- [ ] After the edit, the count is back to zero and the other two are notified
- [ ] Requesting changes without a comment is refused before submit, not after
- [ ] The secretary sees the plan and no approve, edit, or add control
- [ ] `eqpres` gets a "not permitted" page, not an empty planner
- [ ] Works at 375px in both themes; the approval panel does not scroll horizontally
- [ ] Audit rows exist for the approval, the edit, and the invalidation

### Scenario 013: A visiting speaker with no phone number
**Tags:** `[talks, full, external-speaker, iter-004]`
**Purpose:** The precise failure ITER-004 exists to prevent — a pipeline sitting in a stuck state
waiting for a confirmation that was never going to arrive. Only a walkthrough can judge whether the
waived stages *read* as "not applicable" rather than as an unfinished task.

**Seed data summary:**
- Ward — Harness Test Ward; users `bishop`, `counselor1`
- Sundays — April 2026; 04-12 standard, `speaking_slots = 2`
- Assignments — 04-12 slot 1 an ordinary member at `notify`; slot 2 **external**, "Mark Andersen",
  title "President", at stage `approve` with no waiver set yet

**Tester action:** Take the external speaker from `approve` to `complete`.

**Verification checklist:**
- [ ] The external speaker shows name and title as they would print — "President Mark Andersen"
- [ ] No phone number, no household link, and no "contact" affordance is offered for them
- [ ] **Mark not applicable** appears with a one-line explanation of what it does
- [ ] Once waived, REQUEST/CONFIRM/NOTIFY read "Not applicable — invited outside the ward" with the
      name and date of who waived it
- [ ] Nothing on the Sunday looks outstanding or disabled-but-pending
- [ ] The assignment still requires an explicit transition at every step — the waiver moves nothing
- [ ] Reaching `complete` writes **no** `assignment_history` row for the external speaker
- [ ] The member in slot 1 is unaffected and still shows its real contact stages
- [ ] Switching a speaker from external to member clears the name and title
- [ ] Works at 375px in both themes

**Still outstanding and not this plan's to fix:** `scenario-008` (roster-b's member picker) is the
interface this slice consumes first and has been handed forward three times. Run it **before**
starting this plan, not after — it exists to shake out the frozen interface while changing it is
still cheap, and Task 6 is the first real consumer.

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm test

# The ONLY thing that catches a client component importing lib/assignments/queries.ts
npm run build
```

---

## Integration Notes

- **Fills `calendar-b`'s reserved regions rather than refactoring them.** `speakers` and
  `pipelineStatus` are already typed `ReactNode` props on `SundayCell` and `SundayCard`. One change
  lights up both the grid and the mobile list; do not restructure either component.
- **`MemberPicker`'s interface is frozen.** If the planner needs something the props table does not
  cover, raise it as a decision rather than adding a prop. The known sharp edge: the picker's chips
  read from the fetched slice, so selecting a member and then changing the organization filter
  drops the chip while keeping the id in `value` (roster-b). The planner does not change the filter
  mid-selection, so it does not hit this — do not introduce a flow that does.
- **Breaking changes: none.** Every calendar file touched gains a prop that already exists.
- **Phase 5 seam.** The CONFIRM textarea is where `POST /api/assignments/[id]/ai-message` will
  deliver its draft. Build the textarea so a draft can be dropped in and edited; do not build an
  AI-shaped affordance yet.
- **Phase 6 seam.** The program builder reads speakers through `speakerFrom()`. `SpeakerLine` is
  the shared rendering; Phase 6 should reuse it rather than re-deriving a display name, or an
  external speaker's title goes missing on the printed program.
