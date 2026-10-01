---
name: Finalize speakers and they reach To Do
scope: sacrament-finalize-hands-off-asks
part: 1
tags: [sacrament, todos, full, P4]
prerequisites: none
---

## Purpose

ITER-036 `fa` (plans/sacrament-finalize-hands-off-asks.md). The user tested the live site, chose
topics and speakers, and nothing reached To Do: asks came only from a small **Send asks** button that
appeared after References was decided. Now **finalizing the speakers** sends the asks to the
**conductor's** To Do (D1, D6), References need not be decided first (D5), a speaker change
un-finalizes (D2), an unscheduled ask is withdrawn (D3), and a scheduled or accepted person is never
changed without a warning naming them (D4).

The walker finalizes as the **bishop**, who is NOT the conductor, so the confirm must name somebody
else's To Do.

**Already automated:**
- `tests/routes/speakers-finalized.test.ts` — finalize to the conductor with References undecided; a
  second finalize asks nobody; no conductor refused; a speaker change deletes an untouched ask and
  closes a touched one; re-finalize asks only the new person; GET names who is scheduled and who
  accepted; un-finalize keeps a scheduled ask; a decline does not un-finalize; a scheduled ask is
  unlinked on a speaker change; a new talk with a speaker un-finalizes; audit rows carry ids only
- `tests/lib/askImpact.test.ts` — every warning sentence, the time in Denver, no pronoun guessed
- `tests/lib/talkAsks.test.ts` — the Talks check's states without a References lock
- `tests/lib/speakersFinalizeSites.test.ts` — every speaker write path un-finalizes; a decline never does

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver), a whole calendar from this month through the month after next |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura), `counselor2` (David Okafor) |
| Sunday **A** | First ordinary Sunday at least a week out. **Peter** conducts. Slot 1 **Maria Lopez** (phone), slot 2 **Tomas Reyes** (no phone), slot 3 visitor **Brother Kent Walker**. References **not decided** |
| Sunday **B** | The next ordinary Sunday. **David** conducts. Slot 1 **Ana Silva**, slot 2 **Rosa Diaz** |
| Spare | **Lucas Moreno** speaks nowhere |
| Not seeded | No finalize stamp and no asks — finalizing is what this walks |

**Sign in with:** `bishop@`, `counselor1@`, `counselor2@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-085-finalize-speakers-reaches-todo`, and note A's and B's dates.
2. `npm run dev`, open http://localhost:3000, and sign in as `bishop`.
3. Open **Sacrament** and find A's card. Read the check attached to its **Talks** pill, then press it.
   Read the confirm, then press **Finalize speakers**.
4. Do the same for B.
5. Sign out, sign in as `counselor1`, and open **To Do**. Read Maria's ask. Press **Schedule this** on
   Maria's ask and give it Saturday before A at **7:00 PM**.
6. Sign out, sign in as `bishop`. On A's **Topics** screen, add a reference to Maria's talk (**Refs**
   pill → Search or Add manually, e.g. *Alma 32:21*).
7. Sign in as `counselor1` again and reread Maria's ask on **To Do**.
8. Sign in as `bishop`. On A's **Topics** screen, tap Maria's **speaker** line, choose **Lucas
   Moreno**, and press **Save** once. Read what appears. Press it again.
9. On the hub, read A's Talks check. Press it and **Finalize speakers** again.
10. Press B's Talks check, read the confirm, and press **Un-finalize**.
11. Sign in as `counselor2` and open **To Do**.

## Verification Checklist

### Machine-checkable

- [ ] Step 3: before finalizing, A's check reads **3 to ask** — not dimmed, though References is undecided
- [ ] Step 3: the confirm says **"The 3 asks go to Peter Nakamura's To Do."**; afterwards the check reads **Asks sent**, and read back `sundays.speakers_finalized_at` is set for A
- [ ] Step 3: there is no **Send asks** button anywhere on the hub or the Topics screen
- [ ] Step 5: Peter's To Do has three asks — *Ask Maria Lopez to speak*, *Ask Tomas Reyes to speak*, *Ask Brother Kent Walker to speak* — each showing its topic; Maria's shows *Phone: 801-555-0142* and no References line yet
- [ ] Step 7: Maria's ask now shows **References** *Alma 32:21* — without anything being re-sent (read back: still one ask row for that talk)
- [ ] Step 8: the first Save **warns instead of saving**: *"Peter Nakamura has an appointment with Maria Lopez on Sat, …, 7:00 PM to ask them to speak — it stays on the list, so cancel it or use it for something else."* — Peter's name, not "You", because the bishop is reading; the time in Denver; the button reads **Save anyway**
- [ ] Step 8: after the second press, talk 1 is Lucas Moreno; read back: Maria's to-do is still open with its time, `ask_assignment_id` null, and a *Speaker changed* line; `speakers_finalized_at` is null for A
- [ ] Step 9: A's check reads **1 to ask**; the confirm says one ask goes to Peter; afterwards Peter has a new *Ask Lucas Moreno to speak*, and Tomas's and Brother Walker's asks are the same rows as before
- [ ] Step 10: the un-finalize confirm says asks only on To Do are removed, with no warning (nobody on B is scheduled or accepted)
- [ ] Step 11: David's To Do has no asks for Ana or Rosa (read back: the two to-dos are deleted, not closed); B's check reads **2 to ask**
- [ ] `audit_log` has `sunday_speakers_finalized` and `sunday_speakers_unfinalized` rows with ids only — no title, no names
- [ ] 375px: the Talks check stays attached to its pill; the confirm fits without horizontal scroll

### Needs a human eye

- [ ] Is "finalized = I've prayed about it and decided" clear from the control and the confirm's wording?
- [ ] Does the D4 warning read as a helpful heads-up rather than an error?
- [ ] Does the kept appointment on My Appointments (Maria, after the change) make sense to Peter?

## Walkthrough record

**2026-09-30, by the user.** Reported "tests pass" after testing. No defects reported.
