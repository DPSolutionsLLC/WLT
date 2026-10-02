---
name: Finalize prayers and they reach To Do
scope: sacrament-finalize-hands-off-asks
part: 2
tags: [sacrament, prayers, todos, full, P4]
prerequisites: none
---

## Purpose

ITER-036 `fb` (plans/sacrament-finalize-hands-off-asks.md). Prayers had no asks at all. Now
**finalizing the prayers** — from a check on the hub's **Prayer** pill, or a **Finalize prayers**
button on each Sunday of the Prayers board — puts "Ask ___ to give the opening prayer" (or closing)
on the **conductor's** To Do. **Accepted** moves the prayer to Confirmed; **Declined** frees it, with
no reason asked. Choosing somebody else un-finalizes and starts that prayer over; re-finalizing asks
only the new person. A board move to Confirmed closes the ask as Accepted.

The walker finalizes as the **bishop**, who is NOT the conductor, so the confirm must name somebody
else's To Do.

**Already automated:**
- `tests/routes/prayers-finalized.test.ts` — finalize to the conductor; a second finalize asks
  nobody; no conductor refused; the ask card's prayer details; an open ask cannot be ticked;
  Accepted → Confirmed with `asked_by` the owner; Declined frees it with no reason and does not
  un-finalize; a change of person un-finalizes, deletes or closes the old ask and starts the prayer
  over; a board move to Confirmed closes the ask; GET names who is scheduled or confirmed; un-finalize
  keeps a scheduled ask; asks follow a new conductor; a cancelled prayer's ask is marked, never
  doubled; a prayer whose ask was answered is still told when cancelled; audit rows carry ids only
- `tests/lib/prayerAsks.test.ts` — who needs asking, the four states, the titles and notes
- `tests/lib/prayersFinalizeSites.test.ts` — both prayer write paths un-finalize; a decline never does
- `tests/components/sacrament/SundayCard.test.tsx` — the Prayer pill's check

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver), a whole calendar from this month through the month after next |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura), `counselor2` (David Okafor) |
| Sunday **A** | First ordinary Sunday at least a week out. **Peter** conducts. Invocation **Maria Lopez** (phone 801-555-0142), benediction **Tomas Reyes** (no phone), both at **Assigned** |
| Spare | **Ana Silva** prays nowhere |
| Not seeded | No finalize stamp and no asks |

**Sign in with:** `bishop@`, `counselor1@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-086-finalize-prayers`, and note A's date.
2. `npm run dev`, open http://localhost:3000, and sign in as `bishop`.
3. Open **Sacrament** and find A's card. Read the check attached to its **Prayer** pill, then press
   it. Read the confirm, then press **Finalize prayers**.
4. Open **Prayers** (the Prayer pill's link) and read A's **Finalize prayers** button.
5. Sign out, sign in as `counselor1`, and open **To Do**. Read both prayer asks. Press **Accepted** on
   Maria's and **Declined** on Tomas's.
6. Sign out, sign in as `bishop`, and open **Prayers**. Read A's two prayers and its finalize button.
7. Choose **Ana Silva** for the closing prayer. Read A's finalize button, press it, and finalize.
8. On the hub, read A's Prayer check.
9. Sign in as `counselor1`, open **To Do**, and read Ana's ask. Sign back in as `bishop` and, on
   **Prayers**, press **Move to Asked** then **Move to Confirmed** on Ana's prayer.
10. As `counselor1`, reread **To Do**.
11. As `bishop`, on **Prayers**, choose somebody else for the **opening** prayer (Maria confirmed).

## Verification Checklist

### Machine-checkable

- [ ] Step 3: before finalizing, A's Prayer check reads **2 to ask**
- [ ] Step 3: the confirm says **"The 2 asks go to Peter Nakamura's To Do."**; afterwards the check reads **Asks sent**, and read back `sundays.prayers_finalized_at` is set for A
- [ ] Step 4: the board's button reads **Prayers finalized** and is pressed
- [ ] Step 5: Peter's To Do has *Ask Maria Lopez to give the opening prayer* (Prayer: Invocation, Phone: 801-555-0142) and *Ask Tomas Reyes to give the closing prayer* (No contact on file); the card line says **Prayer on …**
- [ ] Step 5: **Declined** on Tomas's ask records straight away — no reason dialog
- [ ] Step 6: Maria's prayer reads **Confirmed**; the closing prayer reads **nobody yet** at **Assigned**; the finalize button is still pressed (a decline does not un-finalize)
- [ ] Step 7: after choosing Ana the button reads **Finalize prayers (1 to ask)**; finalizing creates one ask, for Ana only
- [ ] Step 8: the hub's Prayer check reads **Asks sent**
- [ ] Step 10: Ana's ask is gone from the open list and its timeline says **Accepted** (read back: `ask_accepted`)
- [ ] Step 11: choosing somebody else for Maria's prayer **warns first**: *"Maria Lopez has already accepted — you'll need to let them know they're no longer needed."*; **Change anyway** saves it, the prayer reads **Assigned**, and the finalize button reads not finalized
- [ ] `audit_log` has `sunday_prayers_finalized` and `prayer_ask_answered` rows with ids only — no title, no names
- [ ] 375px: the Prayer check stays attached to its pill; the board's button and the confirm fit without horizontal scroll

### Needs a human eye

- [ ] Do "the opening prayer" / "the closing prayer" read naturally on the to-do?
- [ ] Is it clear on the Prayers board that finalizing sends the asks to the conductor?
- [ ] Is starting the prayer over at Assigned, when somebody else is chosen, what you expect?

## Walkthrough record

_Not walked yet._
