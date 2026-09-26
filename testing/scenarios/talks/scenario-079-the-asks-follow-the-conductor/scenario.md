---
name: The asks follow the conductor
scope: p4-sacrament-f2
part: 1
tags: [sacrament, talks, todos, calendar, full, P4]
prerequisites: none
---

## Purpose

Sacrament slice `f2`. A Sunday's "Ask ___ to speak" to-dos belong to whoever **conducts** it. When
the conductor changes, the open asks move: the new conductor gets a **clean copy** built from the
talk, and the old copy is closed on the old conductor's list with a line naming who took it over.
The scheduled time and the "With" person move with it. Whatever the old owner wrote on their copy
stays with them.

A conductor changes in two ways, and the walk does both: **by hand** in the Sunday editor, and
through the **re-shift** a type change applies to later Sundays (turning a Sunday into a stake
conference moves everybody after it one place in the rotation).

**Already automated:**
- `tests/routes/conductor-handover.test.ts`: a change by hand (clean copy, old copy closed with its
  line, time and "With" carried, the old owner's words left behind, audit ids), My Appointments
  following the work, a retry repairing a half-finished move without a second copy, no audit key
  when nothing moved, a Sunday with nobody conducting keeping its asks, and the re-shift
- `tests/lib/conductorHandoverSites.test.ts`: reads the source and fails if a new write of
  `sundays.conducting_user_id` skips the handover (proved able to fail)

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver) |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura), `counselor2` (David Okafor) |
| Calendar | **Every Sunday** from the first of this month through ten weeks out, each month's first Sunday a **pinned Fast Sunday** |
| Rotation | Weekly, counselor1 → counselor2 → bishop, starting on **A**. Every stored conductor matches it |
| Sunday **A** | The first ordinary Sunday at least a week out. References **skipped**. Slot 1 Maria Lopez (phone 801-555-0142), slot 2 Brother Kent Walker (a **visitor**) |
| Sunday **B** | The next ordinary Sunday. No talks. The walker makes it a stake conference |
| Sunday **C** | The next ordinary Sunday. References **skipped**. Slot 1 Tomas Reyes (no phone) |
| To-dos | **None.** Sending them is part of the walk |

The seed **prints** A, B and C with who conducts each, and who conducts C once B's change is
applied. Dates are relative to today.

**Sign in with:** `counselor1@`, `counselor2@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-079-the-asks-follow-the-conductor`, and note what it prints.
2. `npm run dev`, open http://localhost:3000, and sign in as `counselor1`.
3. Open `/sacrament` at A's month. On **A**, press **Send asks (2)** and wait for **Asks sent**.
4. Open **To Do**. On Maria's ask press **Schedule**, pick any day and time, and save. Then press
   **Edit**, add a line of your own to the notes (for example "MY OWN NOTE: call after 6pm"), and
   save.
5. Back on `/sacrament`, press A's **Conducting:** name. In the Sunday editor, change **Conducting**
   to **David Okafor** and press **Save Sunday**.
6. Open `/sacrament` again and read A's card.
7. Open **To Do** (Open, then **Done**). Open Maria's ask in Done.
8. Open **My Appointments**.
9. Sign out. Sign in as `counselor2`. Open **To Do**, then open Maria's ask. Then open **My
   Appointments**.
10. On `/sacrament`, move to C's month. On **C**, press **Send asks (1)**.
11. Press **B's** Conducting name. Change the type to **Stake Conference** and press **Save
    Sunday**. Read the warning, then press **Apply the change**.
12. Back on `/sacrament`, read B's and C's cards.

## Verification Checklist

The change by hand

- [ ] Step 5: the editor says **Saved.** A is still an **ordinary** Sunday, not a Fast Sunday
- [ ] Step 6: A's card reads **Conducting: David Okafor**, and its Talks check still reads **Asks
      sent**
- [ ] Step 7: counselor1 has **no open** asks. In Done, Maria's ask still has your own line in its
      notes, and its timeline reads **"Handed over to David Okafor"**
- [ ] Step 8: counselor1's My Appointments **no longer shows** Maria's appointment
- [ ] Step 9: counselor2 has **both** asks, open, with Accepted and Declined
- [ ] Step 9: Maria's ask shows the **same scheduled time** and **with Maria Lopez**, the phone and
      topic, and **not** your own line from step 4
- [ ] Step 9: counselor2's My Appointments shows Maria's appointment with **Accepted / Declined**

The re-shift

- [ ] Step 10: C's Talks check turns to **Asks sent**
- [ ] Step 11: the warning says who conducts will change on later Sundays
- [ ] Step 12: B reads **Stake Conference**, and C now names the conductor the seed printed for
      "after B's change"
- [ ] Step 12: Tomas's ask moved to that person, and the one it left was closed as handed over
      (`todos.closed_reason = 'handed_over'`)

The record

- [ ] `audit_log`: each `sunday_updated` row that moved asks carries `asksHandedOver` with
      `complete: true` and the Sunday, created and closed ids. An ordinary save carries none

Questions for a human

- [ ] Should the new conductor's copy say **where it came from** ("Taken over from Peter
      Nakamura")? Today its timeline reads "Nothing yet"
- [ ] Should step 11's warning also say **open asks will move** with the conductors?

## Failure Behavior

| Check | Test |
|---|---|
| Hand change, appointments, retry repair, no-op audit, nobody conducting, re-shift | `tests/routes/conductor-handover.test.ts` |
| Every write of the conductor hands over | `tests/lib/conductorHandoverSites.test.ts` |
| The ask's text and contact line | `tests/lib/talkAsks.test.ts` |

## Walkthrough record

**2026-09-26, by the agent, dev server, 1280px.** Seeded, then walked as counselor1 and
counselor2.

- **Seed defect found on the first attempt, and why the seed builds a whole calendar.** The first
  seed created only four Sundays. Saving A in the editor (step 5) moved September's Fast Sunday
  onto A and zeroed its speaking slots with **no warning**: the month resolution picks the first
  Sunday that exists, and the editor sends the whole form on every save. This predates slice f2
  and was reported separately. The seed now creates every Sunday, with each month's first one
  pinned, as a generated calendar would.
- **Defect found and fixed: the old owner kept the appointment.** After the change by hand,
  counselor1's My Appointments still showed "7:00 PM · Ask Maria Lopez to speak · **Done** · With
  Maria Lopez", beside counselor2's copy of the same meeting. `readScheduledTodos` now leaves out
  a to-do closed without an answer (`closed_reason` set). The time stays on the closed copy as its
  record. Covered by a test that was proved to fail without the fix.
- After the fix: counselor1 had no open asks; Maria's Done copy kept "MY OWN NOTE: call after 6pm"
  and read "Handed over to David Okafor"; counselor1's My Appointments was empty. counselor2 had
  both asks with fresh notes, "Scheduled Sat, Sep 26, 2026, 7:00 PM · with Maria Lopez", and the
  appointment with Accepted / Declined. A stayed an ordinary Sunday reading "Asks sent".
- Re-shift: making B (Oct 11) a stake conference warned "Who conducts will also change on 7 later
  Sundays", and on Apply, C (Oct 18) moved from Peter Nakamura to Mark Andersen. Tomas's ask moved
  from counselor1 to the bishop, and the audit row named only C.
- Timing on the dev server: a Sunday save with nothing to move took 4.6s of application time; a
  save that moved two asks took 8.2s.
- Walk artifacts, not defects: the first attempt read To Do before the Send asks request had
  finished, so the list looked empty until a reload; and Next.js's development-only "N" indicator
  was hidden with a style tag.
