---
name: The three-approval gate
scope: talks-b-month-planner
part: 1
tags: [talks, full, approvals, permissions]
prerequisites: none
---

## Purpose

Building a 2-of-3 and then a 3-of-3 approval state by hand across three accounts is tedious and
easy to get subtly wrong, which is exactly what seeding is for.

The gate itself is already pinned by `tests/lib/approvalGate.test.ts` and by the
`assignment_approvals_one_per_user` constraint. What a walkthrough proves that neither can:

- that the indicator reads as a **sentence a bishopric understands** — "waiting on Mark Andersen",
  not "2/3"
- that the invalidation warning arrives **before** the edit rather than as a report afterwards
- that approval never happens as a **side effect** of saving, which is the phase's first pitfall
  and the one no unit test can see, because the pure layer is not what would do it

March 2026 opens on a Sunday, so the month grid has no leading blanks and 03-01 is the fast
Sunday — which carries `speaking_slots = 0` and must offer no add control at all.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) — the third approver, the one 03-08 is waiting on |
| | `counselor1` (counselor, position 1, Peter Nakamura) — has already approved 03-08 |
| | `counselor2` (counselor, position 2, Daniel Okafor) — has already approved 03-08 |
| | `secretary` (ward_secretary, Ruth Kaufman) — holds `talks.view` and **not** `talks.plan` |
| | `eqpres` (org_president, Elders Quorum, Tomas Ruiz) — holds **no** talks permission at all |
| Members | Sarah Whitfield, Andre Bell, Claire Bennett (adults, active, with phone numbers) |
| Topics | "Faith in Jesus Christ", "Bearing One Another's Burdens", "The Sabbath Day" |
| Sundays | March 2026 generated: 03-01, 03-08, 03-15, 03-22, 03-29 |
| | 03-01 `fast_sunday`, **`speaking_slots = 0`**; the rest `standard` with 3 |
| Assignments | 03-08 fully planned at stage `review` — three slots, speakers, topics, slot lengths |
| | 03-08 slot 1 carries **two** approvals: `counselor1` and `counselor2`. `bishop` has not decided |
| | 03-15 at `plan` with one speaker in slot 1 and nothing else |
| | 03-22 empty — no assignments at all |
| Notification triggers | all |

**Sign in with:** `bishop@`, `counselor1@`, `secretary@`, `eqpres@` — all
`@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-012-three-approval-gate`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open `/assignments?month=2026-03` and read the whole month before
   touching anything.
4. Read the 03-01 card, then the 03-22 card.
5. Open `/assignments/<the 03-08 Sunday id>` — or use **Open this Sunday** on the 03-08 card.
6. Read the Approvals section on slot 1 without acting on it.
7. Press **Request changes** with the comment box empty.
8. Type a comment and press **Approve**.
9. Read the Approvals section again.
10. Press **Approve plan**.
11. Press **Edit** on slot 1, change the slot length, and press **Save**. Read what appears
    before confirming.
12. Confirm. Then read the Approvals section again.
13. Go back to `/assignments?month=2026-03` and read slot 1 of 03-08.
14. Open `/calendar?month=2026-03` and read the 03-08 cell.
15. Sign out. Sign in as `counselor1` and open the notification centre.
16. Sign out. Sign in as `secretary`. Open `/assignments?month=2026-03` and then 03-08's page.
17. Sign out. Sign in as `eqpres` and open `/assignments`.
18. In the Supabase dashboard, read `assignment_approvals`, `audit_log` and `notifications` for
    this ward.

## Verification Checklist

The indicator

- [ ] Slot 1 on 03-08 reads **"Approved by Peter Nakamura and Daniel Okafor — waiting on Mark
      Andersen."** — a sentence naming people, never "2/3" and never a bare count
- [ ] The month card for that slot says **"Waiting on 1 more approval"**, singular
- [ ] Nothing anywhere on either screen hard-codes the number **3**
- [ ] The stage badge reads **In Review**, and its colour is legible in both themes

Approving

- [ ] **Request changes** with an empty comment is refused **before** submit — the message
      appears without a round trip and the plan does not move
- [ ] **Approve** and **Request changes** are two separate controls, never one toggle
- [ ] After the bishop approves, the sentence becomes "Approved by …" with all three names
- [ ] The **Approve plan** action appears **only after the third approval**, and the assignment
      is still at **In Review** until it is pressed — approving is not a side effect of the
      third decision being recorded
- [ ] Pressing **Approve plan** moves it to **Approved**
- [ ] `counselor1` receives a `plan_approved` notification

Invalidation

- [ ] Editing the approved plan warns **before** saving, not after
- [ ] The warning **names who loses their approval** — Peter, Daniel and Mark — not just a count
- [ ] The confirm button's own label says what it does ("Save and clear the approvals")
- [ ] A screen reader announces the warning when the confirm button is focused (the button is
      `aria-describedby` the warning paragraph)
- [ ] Cancelling at the warning leaves the approvals untouched
- [ ] After confirming, the approval count is back to **zero** and the sentence says nobody has
      approved yet
- [ ] `counselor1` and `counselor2` receive a `plan_change_requested` notification saying the
      approvals no longer stand
- [ ] `assignment_approvals` has **no rows** for that assignment afterwards

The month and the calendar

- [ ] 03-01 shows **"No speaking slots"** and offers **no Plan button at all** — not a disabled
      one
- [ ] 03-22 shows three slots, all reading **"Slot N — open"**, never blank
- [ ] 03-15 shows slot 1 with a name and slots 2 and 3 open
- [ ] The `/calendar` month cell for 03-08 shows the same speakers and a one-line stage summary
- [ ] That summary names the **furthest-behind** stage first
- [ ] The calendar cell has not changed height or wrapped — it was designed for this content

Permissions

- [ ] `secretary` sees the whole month and 03-08's detail page, and **no** Plan, Edit, Approve,
      Request changes or comment control anywhere
- [ ] `eqpres` gets a **"Not permitted"** page, not an empty planner
- [ ] Audit rows exist for the approval, the stage change, the edit, and the invalidation
- [ ] No audit row exists for anything `secretary` or `eqpres` did

Mobile and theme

- [ ] Every screen works at **375px** in both themes
- [ ] The approval panel does not scroll horizontally at 375px
- [ ] Every tap target clears 44×44
- [ ] No raw uuid appears anywhere

## Failure Behavior

Run these from the browser console while signed in as `secretary`, substituting a real
assignment id from the Supabase dashboard.

- [ ] Approving through the route — **403**:
      `await (await fetch('/api/assignments/<id>/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved: true }) })).json()`
- [ ] Editing through the route — **403**:
      `await (await fetch('/api/assignments/<id>', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', fields: { slotLengthMinutes: 5 } }) })).json()`
- [ ] Approving an assignment that is **not** at `review` — **409** with a sentence saying to
      reload, not a 500
- [ ] Moving a stage backwards with no reason — **409** naming the reason as what is missing
- [ ] Every refused request leaves `audit_log` untouched

## Notes

**Steps 8 onwards change data.** `createAssignment` and `createTestUser` use stable ids, so
re-seeding restores 03-08's plan — but the approval rows the seed inserts are cleared by the
invalidation in step 12 and re-created by a re-seed. Run `npm run seed:clean` and re-seed for a
clean run.

**Why `secretary` and `eqpres` are separate seats.** `talks.view` and `talks.plan` are two
different gates. Collapsing them into one account would hide the more likely wiring mistake: a
read-only viewer who still gets an Edit button, which looks completely normal until they press it.

**Why the bishop is the one still to decide.** CLAUDE.md §7: bishopric admin authority is
shared, and the bishop must not be able to do anything a counselor cannot. Seeding the two
counselors as the ones who have already approved means the sentence has to name the bishop by
name — if any code path treats the bishop as special, this is where it shows.

**The comment thread is realtime.** `assignment_comments` must be in the `supabase_realtime`
publication for a second browser to see a comment appear without a reload. If it is not, the
thread still works — posting and reading are plain HTTP — it simply does not update on its own.
Open 03-08 in two browsers side by side and say which behaviour you saw.
