---
name: A cancelled Sunday
scope: p4-sacrament-f2c
part: 1
tags: [sacrament, talks, prayers, music, todos, calendar, full, P4]
prerequisites: none
---

## Purpose

Sacrament slice `f2c`. When a Sunday stops holding sacrament meeting, **all of its planning work
is released and recorded as cancelled** — talks, prayers, the hymn choice and the musical number —
and the Sunday's topics and references decisions are cleared. Nothing is deleted: every row stays
as a record, marked cancelled, and every screen skips it, so the Sunday reads as empty. Whoever
asked each person gets a **"Let ___ know it's cancelled"** to-do and confirms with **Told them**. A
ward member's speaker history shows **"Cancelled · Talk"**, which never counts as having spoken or
as being asked. If the Sunday holds a meeting again, planning starts over.

This **reverses** the older rule that a lost talk went "back to planning" with its speaker.

**Already automated:**
- `tests/routes/talk-off.test.ts`: the warning's sentences; every talk, prayer and piece of music
  cancelled with nothing deleted; the decisions cleared; history for members only, never a late
  cancellation; the to-dos for an asked speaker, an accepted speaker, an asked prayer and the
  musical number, and none for an unasked prayer or a hymn; Accepted refused; Told them leaving the
  record as it was; a retry writing nothing twice; planning starting over in the same slots; a cut
  slot (each rule proved able to fail)
- `tests/lib/cancelledReaders.test.ts`: no read of talks, prayers or music skips the cancelled
  filter (proved able to fail)
- `tests/db/fast-sunday-collision.test.ts`, `tests/routes/sunday-update.test.ts`: the calendar's
  own cancellations, inverted from "reverted to planning"
- `tests/lib/reliabilityFlags.test.ts`: a cancelled talk is not "asked recently"

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver) |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura), `counselor2` (David Okafor) |
| Calendar | **Every Sunday** from the first of this month through ten weeks out, each month's first Sunday a **pinned Fast Sunday**; a weekly rotation from A |
| Sunday **A** | The first ordinary Sunday at least a week out. counselor1 conducts. Topics **decided**, References **skipped**. Talks: Maria Lopez, Ana Silva, Brother Kent Walker (**visitor**). Invocation **Tomas Reyes, asked by counselor2**; benediction **David Chen, only assigned**. Opening hymn chosen; a musical number by the **Ward choir** |
| To-dos | **None.** The walk sends the asks and records Ana's acceptance |

**Sign in with:** `counselor1@`, `counselor2@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-081-a-cancelled-sunday`, and note A's date.
2. `npm run dev`, open http://localhost:3000, and sign in as `counselor1`.
3. On `/sacrament`, read A's card. Press **Send asks (3)** and wait for **Asks sent**.
4. On **To Do**, press **Accepted** on Ana Silva's ask.
5. Press A's **Conducting:** name. Set the type to **Stake Conference**, press **Save Sunday**, read
   the warning, and press **Apply the change**. Read the saved message.
6. Open `/sacrament` and read A's card.
7. Open **To Do** and read every card.
8. Open Maria Lopez on the roster and read her speaking history.
9. Sign out, sign in as `counselor2`, open **To Do**, and press **Told them** on the prayer.
10. Sign back in as `counselor1`. In A's Sunday editor set the type back to **Standard** and save
    (apply if warned). Open `/sacrament`, then **To Do**.

## Verification Checklist

Before the change

- [ ] Step 3: A reads **Topics 3/3 · Refs: skipped · Talks 3/3 · Prayer 2/2 · Music 1/3**
- [ ] Step 5: the warning says the 3 speaking assignments will be **cancelled**, that they **stay
      on record** and **do not count as a talk that was given**, that **2 prayer assignments and 2
      music choices** will be cancelled too, and that **Maria Lopez, Ana Silva and Brother Kent
      Walker have been asked to speak that day. You will get a to-do to let them know they're not
      needed.**

After it

- [ ] Step 5: the editor reads **"Saved. 3 speakers, 2 prayers and 2 music choices cancelled."**
- [ ] Step 6: A reads **Stake Conference — No sacrament meeting**
- [ ] Step 7: counselor1 has **four** to-dos, each with a **Cancelled** pill and **Told them**:
      Maria's and the visitor's asks, **"Let Ana Silva know the talk is cancelled"**, and **"Let
      Ward choir know the musical number is cancelled"**
- [ ] Step 8: Maria's speaking history shows A's date as **"Cancelled · Talk"**
- [ ] Step 9: counselor2 has **"Let Tomas Reyes know the prayer is cancelled"**, and nothing about
      David Chen (he was never asked). Told them closes it

When the meeting comes back

- [ ] Step 10: A reads **Conducting: Peter Nakamura** and **Topics 0/3 · Talks 0/3 · Prayer 0/2 ·
      Music 0/3** — an empty Sunday, ready to plan again
- [ ] Step 10: counselor1's four to-dos are **still open**: the cancellation happened, and those
      people still need telling

The record

- [ ] Nothing was deleted: every talk, prayer, hymn and musical-number row is still in the database
      with `cancelled_reason = 'no_meeting'`, and each talk keeps its speaker and stage
- [ ] `audit_log`: the save carries `workCancelled` and `talkAsks` with the history, marked and
      tell ids

## Failure Behavior

| Check | Test |
|---|---|
| Cancelling, telling, Told them, retries, starting over, a cut slot | `tests/routes/talk-off.test.ts` |
| Every read skips cancelled rows | `tests/lib/cancelledReaders.test.ts` |
| The calendar's cancellations and warning | `tests/db/fast-sunday-collision.test.ts`, `tests/routes/sunday-update.test.ts` |
| A cancelled talk is not "asked recently" | `tests/lib/reliabilityFlags.test.ts` |

## Walkthrough record

**2026-09-26, by the agent, dev server, 1280px.** Seeded, walked as counselor1 and counselor2.
Every check passed.

- A started "Topics 3/3 · Refs: skipped · Talks 3/3 · Prayer 2/2 · Music 1/3". The warning read:
  "… it already has 3 speaking assignments. Confirming cancels them: they stay on record as
  cancelled, nothing is deleted, and they do not count as a talk that was given. Its 2 prayer
  assignments and 2 music choices will be cancelled too. Who conducts will also change on 9 later
  Sundays. … Maria Lopez, Ana Silva and Brother Kent Walker have been asked to speak that day. You
  will get a to-do to let them know they're not needed."
- Saved: "Saved. 3 speakers, 2 prayers and 2 music choices cancelled." A: "Stake Conference — No
  sacrament meeting".
- counselor1: Maria's and the visitor's asks, "Let Ana Silva know the talk is cancelled" and "Let
  Ward choir know the musical number is cancelled", each with the Cancelled pill and Told them.
  counselor2: "Let Tomas Reyes know the prayer is cancelled"; Told them closed it. Nothing for David
  Chen.
- Maria's history: "Sunday, September 27, 2026 · Sacrament talk · Cancelled · Talk".
- Back to Standard: "Conducting: Peter Nakamura · Topics 0/3 · Refs 0 · Talks 0/3 · Prayer 0/2 ·
  Music 0/3", and counselor1's four to-dos still open.
