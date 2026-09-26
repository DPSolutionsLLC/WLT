---
name: Send the asks and hear back
scope: p4-sacrament-f1
part: 1
tags: [sacrament, talks, todos, full, P4]
prerequisites: none
---

## Purpose

Sacrament slice `f1` joins the hub and To Do. Once a Sunday's References are finalized or skipped,
the Talks pill offers **Send asks (N)**. Each speaker not yet asked becomes an "Ask ___ to speak"
to-do on the list of whoever **conducts** that Sunday. The speaker's answer is recorded **on the
to-do** with Accepted or Declined, and it reaches the talk: a decline reopens the slot and goes
into speaker history with its reason.

Reaching "References decided, three speakers, one of them a visitor" by hand takes many steps, so
the seed builds it. The walk then crosses three pages (the hub, To Do, and the member page) as the
conductor, and checks that the bishop sees none of it on their own list.

**Already automated:**
- `tests/lib/talkAsks.test.ts`: every "needs an ask" combination, the pill's precedence and lock
  reasons, the ask's text (phone, no phone, visitor, the UTC Sunday) and the history label
- `tests/routes/talk-asks.test.ts`: the gate, one ask per speaker, a second Send sends nothing,
  accept and decline with history, a visitor's decline writing no history, the 404 / 409 / 400
  refusals, a speaker change closing the ask, the panel's answer closing it too, and no text in
  any audit row
- `tests/rls/todos.test.ts`: the ask is invisible to the other two members of the bishopric
- `tests/components/sacrament/SundayCard.test.tsx`: where the check and Send asks render

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver) |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura, 1st counselor), `counselor2` (David Okafor) |
| Members | Maria Lopez (phone 801-555-0142), Tomas Reyes (**no phone**), Ana Silva (phone, speaks nowhere) |
| Sunday **A** (+1 week) | Conducted by **counselor1**, References **skipped**. Slot 1 Maria (one reference, Alma 32:21), slot 2 Tomas, slot 3 **Brother Kent Walker, a visitor** |
| Sunday **B** (+2 weeks) | References **not decided**, one speaker (Maria) |
| To-dos | **None.** Sending them is the first step |

**Sign in with:** `counselor1@`, `bishop@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-078-send-the-asks-and-hear-back`, and note the two dates it
   prints.
2. `npm run dev`, open http://localhost:3000, and sign in as `counselor1`.
3. Open `/sacrament` (move to the next month if A or B is there). Read A's and B's Talks pills
   before touching anything. Hover B's dimmed check.
4. On **A**, press **Send asks (3)**.
5. Open **To Do**. Open each of the three asks and read its notes.
6. On any ask, try the **✕**, then confirm it.
7. On **Maria's** ask, press **Accepted**. Switch to **Done** and open it.
8. On **Tomas's** ask, press **Declined**. Keep **Not available**, type a short note, and press
   **Record decline**.
9. Go back to `/sacrament` and read A's Talks pill.
10. Open `/roster`, find **Tomas Reyes**, and open his speaking history.
11. On A, press the **Topics** pill to open `/assignments/[A]`. Give slot 2 (now open) the speaker
    **Ana Silva**. Save.
12. Back on `/sacrament`, press **Send asks (1)** on A.
12b. Open **To Do**. On **Ana Silva's** ask, press **Schedule**. Read the window, pick any day and
     time, and save.
12c. Open **My Appointments**. On Ana's row, press **Accepted**.
13. Sign out. Sign in as `bishop` and open **To Do**.
14. Resize to **375px** and repeat step 5 on one ask.

## Verification Checklist

The hub

- [ ] Step 3: **B's** Talks check is dimmed, and hovering it reads **"Finalize or skip References
      first"**
- [ ] Step 3: **A's** Talks check reads **"3 not yet asked"** with **Send asks (3)** beside it
- [ ] Step 4: the button goes away, and A's check reads **Asks sent** in gold

The asks, on the conductor's To Do

- [ ] Step 5: there are **exactly three** asks, each tagged **Sacrament**, each titled "Ask ___ to
      speak", each with a source line "Talk on <A's date> · <speaker>"
- [ ] Maria's notes read **Phone: 801-555-0142**, the Sunday in words, the topic, and
      **References: - Alma 32:21**
- [ ] Tomas's notes read **"No contact on file"**
- [ ] Brother Kent Walker's notes read **"Not on the roster — no contact on file"**
- [ ] Each open ask shows **Accepted** and **Declined** and **no checkbox**
- [ ] Each open ask shows its **Topic** and its **contact line** on the card itself, without being
      opened: Maria "Phone: 801-555-0142", Tomas "No contact on file", Brother Kent Walker "Not on
      the roster — no contact on file" *(added 2026-09-25, the user's request)*
- [ ] Schedule, Edit and ✕ sit in a **row under the card's text**, before Accepted and Declined, so
      the title runs across the card. Every to-do has this layout, not only asks *(added
      2026-09-25)*
- [ ] Step 6: the ✕ is refused with **"Record their answer instead — Accepted or Declined."**, shown
      beside the card, and the ask stays
- [ ] Step 7: Maria's ask moves to **Done**, and its timeline reads **"Accepted"**
- [ ] Step 8: Tomas's ask moves to Done, and its timeline reads **"Declined — Not available"**. The
      note you typed is **not** in the timeline

The talk and the member

- [ ] Step 9: A's Talks check turns **rust** and reads **"1 declined"**
- [ ] Step 10: Tomas's speaking history shows **"Declined — Not available · Talk"** for A's date
- [ ] Step 11: slot 2 was **open** (no speaker) before you chose Ana
- [ ] Step 12, before pressing: A's check reads **"1 not yet asked"**, no longer "1 declined".
      Choosing Ana cleared the talk's outcome, so the rust state gives way to the ask she needs.
      *Added 2026-09-24 by walking it:* the checklist said nothing about this state, which is what
      the page actually shows at step 12.
- [ ] Step 12: **Send asks (1)** sends one ask, for **Ana Silva only**. Nobody already asked is
      asked again

Schedule and My Appointments *(added 2026-09-25, the user's request)*

- [ ] Step 12b: the Schedule window shows Ana's **topic and phone**, and **With** already names
      **Ana Silva**
- [ ] Step 12c: My Appointments shows Ana's row **with Ana Silva**, her **topic and phone**, and
      **Accepted / Declined**
- [ ] Step 12c: pressing **Accepted** there records it on the talk (`request_outcome` accepted) and
      closes the ask in To Do with **"Accepted"**

Privacy

- [ ] Step 13: the bishop's To Do shows **none** of the counselor's asks

Mobile

- [ ] Step 14: at 375px the Accepted / Declined buttons sit under the title, and the title is not
      squeezed to a word per line

The record

- [ ] `audit_log` shows `talk_asks_sent` twice and `talk_ask_answered` twice, and no title, note or
      phone number in any detail

Judgement

- [ ] Is **"Send asks (N)"** clear about what it will do before it is pressed?
- [ ] Does the rust **"1 declined"** read as needing action?

## Failure Behavior

| Check | Test |
|---|---|
| Needs-an-ask rule, precedence, lock reasons, ask text, history label | `tests/lib/talkAsks.test.ts` |
| Send, second Send, answer, refusals, speaker change, the panel's answer, audit privacy | `tests/routes/talk-asks.test.ts` |
| Owner-only ask, no authenticated insert, one open ask per talk per person | `tests/rls/todos.test.ts` |
| Timeline sentences for every new kind | `tests/lib/todoLogLines.test.ts` |
| The check and Send asks on the card | `tests/components/sacrament/SundayCard.test.tsx` |

## Walkthrough record

**2026-09-24: driven by an agent** (Claude, Playwright MCP against `npm run dev` on :3000, as
`counselor1` and `bishop`). Every write was read back through the service-role client
(`.walk078/read.mjs`; snapshots `db-after-send.json`, `db-after-answers.json`,
`db-after-send1.json`, `db-final.json`). The judgement checks were handed to the user as
screenshots on one review page (https://claude.ai/artifact/EhuQHkGFNukkroKYCPTQjE). **No person has
used the app for this scenario yet.** Evidence is in `.walk078/` (git-excluded).

Seeded Sundays: A 2026-09-27 (conducted by Peter Nakamura), B 2026-10-04.

Observed:
- B: the Talks tab is dimmed (opacity 0.6), its title reads "Finalize or skip References first",
  and there is no Send button.
- A before sending: "3 not yet asked" plus **Send asks (3)**, a 96×44px button.
- After Send asks (3): 3 `todos` rows, all `user_id` counselor1, `assigned_by` counselor1, tag
  Sacrament, `do_date` 2026-09-24. Notes: Maria "Phone: 801-555-0142 … References: - Alma 32:21";
  Tomas "No contact on file"; Brother Kent Walker "Not on the roster — no contact on file". One
  `talk_asks_sent` audit row with ids only.
- To Do: 3 cards, **0 checkboxes**, each with Accepted and Declined and "Talk on Sun, Sep 27 · …".
- ✕ then confirm: 409 with "Record their answer instead — Accepted or Declined." beside the card
  (it arrived about 3s after the click). The ask was kept and no audit row was written.
- Accepted (Maria): `request_outcome` accepted, the to-do completed, log `ask_accepted`. The
  timeline reads "Sep 24, 11:32 PM · Accepted" (the ward's zone).
- Declined, Not available, with a note (Tomas): `request_outcome` declined, `member_id` null,
  stage plan, the note stored in `request_notes` only. Log `ask_declined` "Not available".
  History: 1 row, declined, `not_available`. The timeline reads "Declined — Not available", and
  the note is absent from it.
- Hub: rust "1 declined" (`border-rust text-rust`), Talks 2/3.
- Tomas's member page: "Sunday, September 27, 2026 · Sacrament talk · Declined — Not available ·
  Talk".
- Slot 2 read "No speaker yet". After Ana Silva was chosen, the outcome was reset to null and the
  audit shows `assignment_updated` with `outcomeReset: true`. The hub then read "1 not yet asked".
- Send asks (1): exactly one new ask, "Ask Ana Silva to speak" with her phone. The card updated in
  place 4.1s after the press.
- Bishop: To Do reads "Nothing on your list." with 0 cards. Their hub shows "Asks sent" with no
  Send button.
- 375px: no horizontal overflow. Accepted and Declined are 77×44 and 72×44. The title is 102px wide
  and wraps to 3 lines, the same as any to-do with three icons. Light and dark captured.
- Audit: `talk_asks_sent` ×2, `talk_ask_answered` ×2, `assignment_updated` ×1. No note, title or
  phone in any detail.

**Findings, reported and NOT fixed during the walk:**
- **078-D1 (minor).** After the POST returns, Send asks shows "Send asks (3)" again, enabled, until
  `router.refresh()` lands. It was observed 1.5s after "Sending…" cleared. A second press there
  shows a red 400 ("Everyone on this Sunday has been asked."); nobody is asked twice.
- **078-D2 (product call).** On a speaker change the outcome is cleared but `request_notes` is
  kept, so Tomas's decline note now sits on Ana's talk.
- Observation: an answered decline's source line loses the speaker's name ("Talk on Sun, Sep 27"),
  because the decline cleared the speaker. The title still names him.

**Checklist correction:** added the step-12 "1 not yet asked" line above. The checklist had no line
for the state the page actually shows at that point.

**The user's answers, 2026-09-24/25.** Judgement 1 ("Send asks (N)" is clear) passed. Judgement
2 (rust reads as needing action) passed. The dimmed tick reads as "not yet": passed. The "· Talk"
label on history: keep it. The phone layout: the buttons are easy enough to find, but the user
asked for a layout rework and more on the card (below).
- **078-D1 FIXED.** `router.refresh()` now runs in a transition and the button stays "Sending…"
  until it lands. Re-walked after reseeding: sampled every 150ms, the button read only
  "Sending…(disabled)" until the card showed "Asks sent" at 6.0s. Zero enabled "Send asks (3)"
  samples.
- **078-D2 FIXED, by the user's decision.** A speaker change clears `request_notes` together with
  the outcome. `tests/routes/talk-asks.test.ts` asserts it.
- **Built from the user's answer to judgement 4, folded into f1 (2026-09-25), and re-walked by the
  agent after reseeding:**
  - Every to-do's Schedule / Edit / ✕ now sit in a row under the text, and an open ask's Accepted
    / Declined are one group at its right. At 360px that is one 44px-high row. The first version
    was indented under the title and wrapped "Declined" onto a line of its own; that was found on
    this walk and fixed before recording. Title widths are 197 / 204 / 242px (they were 102px);
    "Ask Brother Kent Walker to speak" takes 2 lines (it took 3).
  - The card shows "Topic …" and the contact line, read live from the talk: Maria "Phone:
    801-555-0142", Tomas "No contact on file", the visitor "Not on the roster — no contact on
    file".
  - Schedule on Ana's ask showed her topic and phone, with **With** pre-filled "Ana Silva".
    Scheduled for Sat 7:00 PM.
  - My Appointments: "7:00 PM · Ask Ana Silva to speak · With Ana Silva · Topic The Power of
    Covenants · Phone: 801-555-0188 · Accepted · Declined". Accepted there left
    `request_outcome` accepted, the to-do completed, log `scheduled` then `ask_accepted`, and one
    `talk_ask_answered` audit row. The talk's `request_notes` was **null**, so D2 is confirmed in
    the real app as well as in the test.
  - Walk artifact, not a defect: Next.js's development-only "N" indicator covered the bottom-left
    Schedule icon, so it was hidden with a style tag for the rest of the walk.
