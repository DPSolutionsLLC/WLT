---
name: Two keys, one agenda item
scope: P5
part: 2
tags: [todos, agendas, full, P5]
prerequisites: none
---

## Purpose

The two-key rules cross two people and two modules. When the meeting completes an agenda item,
the assignee's to-do is **flagged, never deleted or completed**. When the assignee completes their
to-do, the agenda item is **flagged for review, never completed**. A to-do linked to an open item
cannot be deleted. The assignee picker does not exist yet (decision D1), so the only way to reach
these states is to seed them.

The table-level and route-level guarantees are already covered in Vitest
(`tests/routes/action-item-todo-link.test.ts`: create, reassign, delete, carry-forward, the 409 and
the 400). This walk checks that **both flags are visible** on screen, which no test can see.

## Seed Data

Dates are relative to **today in America/Denver**; the seed prints which day it used.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver) |
| Users | `bishop@harness.wardleadershiptools.test` (bishop, Mark Andersen); `eq-president@harness.wardleadershiptools.test` (Elders Quorum president, Miguel Cortez) |
| Agenda | One **draft bishopric** agenda dated today, from the app's template |
| Action item A | "Visit the Okafor family before they move", assigned to the president, due in a week |
| Action item B | "Organise the quorum's move-in crew for the Nguyen family", assigned to the president, due in a week |
| President's to-do for A | Same title, `assigned_by` = bishop, **untouched** |
| President's to-do for B | Same title, 2 steps (1 done), a `Checked off …` line and a note containing the words **PRIVATE NOTE TEXT** |

**Sign in with:** `bishop@harness.wardleadershiptools.test`, then `eq-president@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- todos/scenario-076-two-keys-one-agenda-item`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the **president**. Open **To Do**. Read both cards.
4. On B's card, press ✕ and confirm **Remove?**.
5. Sign out. Sign in as the **bishop**. Open **Agendas**, then today's bishopric agenda.
6. Press **Mark done** on item A.
7. Sign out. Sign in as the **president**. Open **To Do**.
8. Tick B's to-do done.
9. Sign out. Sign in as the **bishop**. Open today's bishopric agenda again.

## Verification Checklist

### Machine-checkable

- [ ] Step 3: both cards show **From the Bishopric meeting agenda of <today>** (the label comes from `MEETING_TYPE_LABELS`); neither shows "Marked complete on the agenda"
- [ ] Step 4: removal is refused with "This came from an agenda item that is still open. Mark it complete instead — that asks the bishopric to review it." beside the card, and B's to-do is still in the database
- [ ] Step 4: no `todo_deleted` audit row was written for the refusal
- [ ] Step 6: item A reads as completed (struck through). In the database, A's to-do **still exists**, `completed_at` is null, `source_completed_at` is set, and it has a `source_completed` timeline line
- [ ] Step 7: A's card shows **Marked complete on the agenda** and is still under **Open**; opening it shows the timeline line "Marked complete on the agenda"
- [ ] Step 8: B moves to **Done**. In the database, item B has `status = 'open'` and `completion_review_requested_at` set
- [ ] Step 9: item B shows **Assignee marked done — review** and is **not** struck through; item A shows no review pill
- [ ] The bishop sees none of B's steps or its note anywhere: the agenda page text does not contain "PRIVATE NOTE TEXT", and `GET /api/todos/<B's to-do>` as the bishop answers **404**
- [ ] Audit rows exist for step 6 (`action_item_status_changed`, with `todoLinks.flagged` naming A's to-do) and step 8 (`todo_completed`); no audit row's `detail` contains any to-do title, step label or note text
- [ ] At 375px: no horizontal overflow on either page; the review pill and the source line wrap rather than overflow
- [ ] No raw uuid on screen

### Needs a human eye

- [ ] Does **Assignee marked done — review** read as something the bishop is expected to act on, and does it make clear that "Mark done" is how they act?
- [ ] Does **Marked complete on the agenda** read as "the meeting thinks this is finished — you decide", rather than as an error? Does "From the Bishopric meeting agenda of …" read naturally, and is the pill wrapping to two lines at 375px acceptable?
- [ ] Is the refusal sentence in step 4 clear about what to do instead?

## Failure Behavior

- [ ] Assigning an item to somebody with no calling in the ward answers 400 "That person does not hold a calling in this ward." and creates no to-do. Covered by `tests/routes/action-item-todo-link.test.ts`; do not re-test it by hand (there is no picker to do it with).
- [ ] Reassigning deletes an untouched to-do and keeps a touched one unlinked. Covered by the same file.

## Walkthrough record

**2026-09-24 — driven by an agent (Claude, Playwright against `npm run dev` on :3000), with the
three judgement checks handed to the user as screenshots.** Not yet a person using the app.
Every write was read back with the service-role client (`testing/walk-screenshots/scenario-076/
readback.mjs`; final state in `final-readback.txt` beside it). Screenshots are in the same folder.

Seed: today = 2026-09-24 (America/Denver). Agenda `1b899675…`, item A `bfe552ec…`, item B
`568c3392…`, A's to-do `5457632e…`, B's to-do `d9432c74…`.

**Machine-checkable — observed values**
- Step 3: both cards read `Upcoming · Due Thu, Oct 1 · From the Bishopric meeting agenda of Thu,
  Sep 24`; B also `1/2`. No "Marked complete on the agenda" on either. ✅
- Step 4: `DELETE /api/todos/d9432c74…` → **409**; the card's `role="alert"` reads "This came from an
  agenda item that is still open. Mark it complete instead — that asks the bishopric to review
  it.", inside B's card (card 340–471px, alert at 434px). B's to-do still in the DB; **0** audit rows
  written. The only console error is the browser logging that 409. ✅
- Step 6: item A `status=complete`, `completed_at=16:40:34Z`. A's to-do still present,
  `completed_at` null, `source_completed_at=16:40:34.891Z`, log line `source_completed` at
  16:40:36Z. Audit `agendas/action_item_status_changed` with `todoLinks.flagged = [A's to-do]`,
  `todoLinkFailed: false`. A rendered `line-through`; B `none`. ✅
- Step 7: A's card under **Open**, unticked, pill "Marked complete on the agenda"; timeline
  `Sep 24, 10:40 AM · Marked complete on the agenda` (16:40Z in Denver). ✅
- Step 8: B's to-do `completed_at=16:42:04Z`, log `completed`; item B `status=open`,
  `completion_review_requested_at=16:42:07Z`. Audit `todos/todo_completed
  {todoId, changedFields:[completedAt]}`. B left Open and is the only item under Done. ✅
- Step 9: B shows "Assignee marked done — review" (204×22, one line at 375px) and is **not** struck
  through; A struck through with no pill. ✅
- Privacy: the agenda page's text contains none of "PRIVATE NOTE TEXT", "Borrow the stake", "Ask for
  six volunteers"; the bishop's `GET /api/todos/d9432c74…` → **404** "That to-do could not be
  found." ✅
- Audit: 2 rows for the walk; **0** contain any to-do title, step label or note text. ✅
- 375px: `scrollWidth − clientWidth = 0` on /todos and on the agenda; no uuid in page text. The
  "Marked complete on the agenda" pill wraps to two lines at 375px (see judgement 2). ✅

**Walk notes (not defects)**
- The ✕ → "Remove?" arming clears after 4 seconds (`useArmedRemoval`). The agent's first two clicks
  were 15–20s apart, so each one re-armed rather than confirmed and no request was sent; arm and
  confirm were then done 300ms apart. A person tapping twice is well inside the window.

**Checklist corrections:** step 3's wording said "From the Bishopric agenda of"; the app renders
`MEETING_TYPE_LABELS.bishopric` ("Bishopric meeting"), so it reads "From the Bishopric meeting
agenda of". The check now describes what renders; whether that reads well is judgement 2's.

**Not walked:** carry-forward moving the link (covered by
`tests/routes/action-item-todo-link.test.ts`; this seed has no published agenda to carry from).
Dark theme was not exercised — no new colours were introduced, only the existing `pending` pill tone.

**Needs a human eye — answered by the user from the screenshots, 2026-09-24: all three pass.**
"Assignee marked done — review" reads as a call to act, with Mark done as the way to act; "Marked
complete on the agenda" reads as "the meeting thinks it's finished — you decide" (and "From the
Bishopric meeting agenda of …" plus the two-line pill wrap at 375px are accepted); the refusal
sentence is clear about what to do instead.

## Notes

- **The picker is not here, on purpose (D1).** The only assignee control on the agenda is still the
  free-text one. A walk that looks for a way to assign a person is looking for P4's Agendas slice.
- **Carry-forward moves the link.** When the next bishopric agenda is created from a published
  one, the open item is copied and the assignee's to-do follows the copy. That is proved by the
  route test; walking it needs a published agenda plus a second create, which this scenario does
  not seed.
