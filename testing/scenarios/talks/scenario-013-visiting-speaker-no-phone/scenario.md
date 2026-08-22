---
name: A visiting speaker with no phone number
scope: talks-b-month-planner
part: 2
tags: [talks, full, external-speaker, iter-004]
prerequisites: none
---

## Purpose

The precise failure ITER-004 exists to prevent: a pipeline sitting in a stuck state waiting for a
confirmation that was never going to arrive, because the speaker was invited from outside the
ward and nobody was ever going to text them.

`tests/lib/externalSpeaker.test.ts` proves the waiver satisfies exactly four gates and no others,
and `tests/components/assignments/ContactStagePanel.test.tsx` proves a waived panel renders no
disabled action. Neither can judge the thing that actually matters: whether a waived stage
**reads** as "not applicable" to somebody scanning a Sunday, or still reads as an unfinished
task. That is a human judgement and it is the whole point of this scenario.

The second half is speaker history. An external speaker must never enter `assignment_history` —
their talk says nothing about whose turn it is in this ward's rotation, and a row there would
quietly suppress a real member instead.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Peter Nakamura) |
| Members | Sarah Whitfield (adult, active, phone on file) |
| | Andre Bell (adult, active, **no phone**) — the contrast case |
| Topics | "Faith in Jesus Christ", "The Sabbath Day" |
| Sundays | April 2026 generated: 04-05, 04-12, 04-19, 04-26 |
| | 04-05 `fast_sunday` with 0 slots; 04-12 `standard` with **2** slots; the rest 3 |
| Assignments | 04-12 slot 1 — **Sarah Whitfield**, a ward member, at stage `notify`, message approved |
| | 04-12 slot 2 — **external**, "Mark Andersen", title "President", at stage `approve`, **no waiver set** |
| | 04-19 slot 1 — **Andre Bell**, a member with no phone, at stage `notify` |
| Notification triggers | all |

**Sign in with:** `bishop@` and `counselor1@` — both `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-013-visiting-speaker-no-phone`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open `/assignments?month=2026-04` and read the 04-12 card.
4. Open 04-12's detail page and read **both** slots side by side before acting.
5. Read the **Contacting the speaker** section on slot 2 (the visiting speaker).
6. Press **Mark not applicable**. Read the explanation first.
7. Read all four contact stages on slot 2 again.
8. Move slot 2 forward one stage at a time: Requested → Confirmed → Notified → Speaking.
9. At Speaking, press **Confirm the meeting happened**, then move to Appreciation, then to
   Complete.
10. Read slot 1 again and confirm it is untouched.
11. Press **Edit** on slot 2 and switch the speaker from outside the ward to a ward member.
12. Read the name and title fields, then cancel without saving.
13. Open `/assignments?month=2026-04` and read the 04-12 card, then `/calendar?month=2026-04`.
14. Open 04-19 and read slot 1 — a ward member with no phone number.
15. In the Supabase dashboard, read `assignments` for this ward — the waiver columns on slot 2.
    `assignment_history` and `audit_log` no longer need checking by hand; see Failure Behavior.

## Verification Checklist

The visiting speaker

- [ ] Slot 2 shows the name and title **as they would print** — "President Mark Andersen", in
      that order, on the month card, the detail page and the calendar cell
- [ ] **No phone number, no household link, and no contact affordance** is offered for them
      anywhere — not a greyed-out one, none at all
- [ ] The month card does not show them as a member of the roster in any way

The waiver

- [ ] **Mark not applicable** appears with a **one-line explanation of what it does**, before it
      is pressed
- [ ] The explanation says it does **not** move the assignment on
- [ ] Once waived, REQUEST, CONFIRM, NOTIFY and APPRECIATE all read **"Not applicable — invited
      outside the ward"**
- [ ] The waiver names **who** recorded it and **on what date**
- [ ] **Nothing on the Sunday looks outstanding**: no progress bar, no "pending", no "waiting",
      no "not started", and no disabled-but-present button
- [ ] The waiver control disappears once it is set — it is not offered twice
- [ ] SPEAK is **not** waived: confirming the meeting happened is still a real step, because
      whether the meeting happened is a fact about the meeting and not about who spoke in it

Still explicit

- [ ] The waiver **moved nothing** — slot 2 is still at Approved immediately afterwards
- [ ] Every step to Complete requires its own **Move to …** press; nothing chains

The `assignment_history` half of this is automated:
`tests/routes/assignment-detail.test.ts` proves that reaching Complete writes a `completed` row
for a member and **no** row for an external speaker, and that a decline writes `declined` for a
member and nothing for an external one. What is left for a human here is whether the *screen*
makes the chaining explicit.

The member in slot 1

- [ ] Slot 1 shows its **real** contact stages throughout — never "Not applicable"
- [ ] Slot 1 is completely unaffected by everything done to slot 2
- [ ] Slot 1 offers **no** Mark not applicable control — the waiver is external-only
- [ ] At NOTIFY, slot 1 shows an **Open in Messages** link on a phone **and** a **Copy message**
      button, side by side with equal weight
- [ ] On a desktop browser the link is **absent** and Copy carries a line explaining why
- [ ] **Mark as sent** says plainly that nothing can tell whether the message arrived

A member with no phone

- [ ] 04-19 slot 1 offers **Copy message** and **no link at all** — never a dead or disabled
      anchor
- [ ] It says there is no number on file, rather than looking broken

Switching sides

- [ ] Switching slot 2 from outside-the-ward to a ward member **clears the name and the title**
- [ ] Switching back clears the chosen member
- [ ] The title field's hint says to type it exactly as it should print, and nothing derives a
      title from anything

Mobile and theme

- [ ] Every screen works at **375px** in both themes
- [ ] The waived stages are legible in dark mode and do not read as disabled
- [ ] No raw uuid appears anywhere

## Failure Behavior

**Automated — nothing to do by hand.** Every check that used to live here is a route test in
`tests/routes/assignment-detail.test.ts`, run by `npm test`:

| Retired check | Replaced by |
|---|---|
| Waiving a ward member → 409 | "refuses a waiver on a ward member, and says what to do instead" |
| A member and an external name together → 400 | "refuses an edit setting a member and an external speaker together" |
| Skipping a stage → 409 naming the next one | "refuses a skipped stage, naming the legal next one" |
| Speaking → Appreciation with no confirmation → 409, waiver notwithstanding | "refuses speak -> appreciate with no confirmation, waiver or not" |
| Every refusal leaves `audit_log` untouched | "leaves audit_log untouched on every refusal" |

The two ITER-004 facts these prove — that the waiver refuses a roster member, and that it
deliberately does **not** satisfy the APPRECIATE gate — are now asserted on every run rather than
whenever somebody remembers to paste a `fetch` into a console.

## Notes

**Steps 6 onwards change data.** `createAssignment` uses stable ids, so re-seeding restores both
slots — but the waiver and the stage moves survive a re-seed only in the sense that the row is
overwritten. Run `npm run seed:clean` and re-seed for a clean run.

**Why "Mark Andersen" is both the bishop's name and the visiting speaker's.** It is deliberate.
An external speaker is a plain text name with no account behind it, and a system that quietly
matched the two — linking the assignment to the bishop's user row, or refusing the name as a
duplicate — would be a real bug. Nothing should connect them.

**Why 04-12 has two slots and not three.** The contrast is the whole scenario: one member and one
outside speaker, on the same Sunday, side by side. A third slot would add nothing but scrolling.

**Judge the reading, not the mechanics.** The stage moves are already proven by unit tests. What
this scenario is for is the sentence: does a waived stage look like something nobody needs to do,
or does it look like something nobody has done yet? If it reads as the second, say so even if
every checkbox above technically passes.
