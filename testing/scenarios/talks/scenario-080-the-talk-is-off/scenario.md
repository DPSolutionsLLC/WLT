---
name: The talk is off
scope: p4-sacrament-f2b
part: 1
tags: [sacrament, talks, todos, calendar, full, P4]
prerequisites: none
---

## Purpose

Sacrament slice `f2b`. A talk is **off** when its Sunday no longer holds a sacrament meeting (a
stake conference, say) or its slot no longer exists (a Fast Sunday, or fewer speaking slots).
Somebody already asked that speaker, and they need to be told they are not needed.

- The calendar's warning says so **before** the change is applied: who was asked, and who will get
  a to-do to tell them.
- An open ask on a talk that is off **stays with its owner**, marked "No talk any more", and offers
  **Told them** in place of Accepted / Declined.
- A speaker who had **already accepted** has no open ask left, so whoever asked them gets a new
  to-do: "Let ___ know there's no talk".
- If the Sunday comes back before everybody is told, what is still open closes ("The talk is back
  on") and the speakers are **asked again from scratch**.

The walk also checks the other f2b change: a handed-over ask now says where it came from ("Taken
over from ___").

**Already automated:**
- `tests/routes/talk-off.test.ts`: the warning's sentences, marking open asks, the to-do for an
  accepted speaker, Accepted refused while off, Told them clearing the answer, nothing written
  twice, the talk coming back on and everybody asked again, Told them refused while on, and a cut
  slot (each rule proved able to fail)
- `tests/routes/conductor-handover.test.ts`: "Taken over from ___" and the re-shift warning's
  "1 open ask moves to ___"
- `tests/lib/talkAsks.test.ts`: `talkIsOff()` and the tell title

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver) |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura), `counselor2` (David Okafor) |
| Calendar | **Every Sunday** from the first of this month through ten weeks out, each month's first Sunday a **pinned Fast Sunday** |
| Rotation | Weekly, counselor1 → counselor2 → bishop, starting on **A** |
| Sunday **A** | The first ordinary Sunday at least a week out. counselor1 conducts. References **skipped**. Slot 1 Maria Lopez, slot 2 Ana Silva, slot 3 Brother Kent Walker (a **visitor**) |
| To-dos | **None.** The walk sends the asks and records Ana's acceptance |

**Sign in with:** `counselor1@`, `counselor2@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-080-the-talk-is-off`, and note A's date.
2. `npm run dev`, open http://localhost:3000, and sign in as `counselor1`.
3. On `/sacrament`, press **Send asks (3)** on A and wait for **Asks sent**.
4. On **To Do**, press **Accepted** on Ana Silva's ask.
5. Press A's **Conducting:** name. In the Sunday editor, set the type to **Stake Conference** and
   press **Save Sunday**. Read the warning, then press **Apply the change**.
6. Open **To Do** and read every card. Open "Let Ana Silva know there's no talk".
7. On Ana's card, press **Told them**.
8. Back in A's Sunday editor, set the type to **Standard** and save (apply if warned).
9. Open `/sacrament` and read A's card. Open **To Do** (Open, then Done).
10. On A, press **Send asks (3)** again. In the Sunday editor, change **Conducting** to **David
    Okafor** and save.
11. Sign out, sign in as `counselor2`, open **To Do**, and open Maria's ask.

## Verification Checklist

Before the change

- [ ] Step 5: the warning ends **"Maria Lopez, Ana Silva and Brother Kent Walker have been asked to
      speak that day. You will get a to-do to let them know they're not needed."**

While the talk is off

- [ ] Step 6: Maria's and the visitor's asks are still open, each with a **No talk any more** pill,
      "Let them know they're not needed.", and **Told them** in place of Accepted / Declined
- [ ] Step 6: there is a new to-do **"Let Ana Silva know there's no talk"** with the same marker, her
      phone and topic, and **Told them**
- [ ] Step 7: Ana's to-do leaves the Open list; in Done its timeline ends **"Told them they're not
      needed"**

When the talk comes back

- [ ] Step 9: A reads **Conducting: Peter Nakamura** (the rotation gave it back) and offers **Send
      asks (3)**: all three are asked again from scratch
- [ ] Step 9: nothing is left open; Maria's and the visitor's asks read **"The talk is back on — ask
      again with Send asks"**

A handover

- [ ] Step 11: David's copy of Maria's ask reads **"Taken over from Peter Nakamura"** in its
      timeline

The record

- [ ] `audit_log`: the stake-conference save carries `talkAsks` with two marked asks and one tell
      to-do; the restoring save carries `talkAsks.backOnTodoIds`; Told them wrote
      `talk_ask_told_not_needed`

Questions for a human

- [ ] Step 8's warning says who conducts will change but not that the open "let them know" items
      will close and the speakers be asked again. Should it?

## Failure Behavior

| Check | Test |
|---|---|
| Warning, marking, tell to-do, Told them, no repeats, back on, a cut slot | `tests/routes/talk-off.test.ts` |
| "Taken over from", the re-shift warning | `tests/routes/conductor-handover.test.ts` |
| `talkIsOff()`, the tell title | `tests/lib/talkAsks.test.ts` |
| Timeline sentences | `tests/lib/todoLogLines.test.ts` |

## Walkthrough record

**2026-09-26, by the agent, dev server, 1280px.** Seeded and walked as counselor1, then
counselor2. Every check passed.

- The warning read: "2026-09-27 would no longer hold a sacrament meeting … Maria Lopez, Ana Silva
  and Brother Kent Walker have been asked to speak that day. You will get a to-do to let them know
  they're not needed."
- To Do then held Maria's and the visitor's asks and "Let Ana Silva know there's no talk", each
  with the **No talk any more** pill and **Told them**. Told them on Ana's closed it
  (`told_not_needed`).
- Restoring the type put Peter Nakamura back as conductor and A read "3 not yet asked … Send asks
  (3)"; Maria's and the visitor's asks closed as `talk_back_on`; every talk's answer was null.
- After Send asks and a change of conductor, David Okafor's copy of Maria's ask read "Taken over
  from Peter Nakamura".
- Found while building, not by the walk: scenario 079's route test had asked speakers on a **Fast
  Sunday** (the first Sunday of July, which has no speaking slots). `talkIsOff()` now counts those
  talks as off, so the test was moved to an ordinary Sunday.
