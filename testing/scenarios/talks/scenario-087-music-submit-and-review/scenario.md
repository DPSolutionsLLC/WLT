---
name: Music is submitted, reviewed by the conductor, and reopens on a change
scope: sacrament-music-handoff-and-approval
part: 2
tags: [talks, music, todos, full, P4]
prerequisites: none
---

## Purpose

ITER-038 `mb` (plans/sacrament-music-handoff-and-approval.md). The music coordinator **submits** a
Sunday's music once it is complete: 3 hymns, a chorister, an organist, and the musical number if
there is one. The **conductor** gets "Review the music for …" on To Do. Any member of the bishopric
**approves** it or **sends it back with a note**, except whoever submitted it. Sending back reopens the
coordinator's "Choose the music" with the note on it. Changing anything after submit or approve
returns it to **Draft** with a banner, and the conductor's open review closes.

The card shows two pills once the topics are final: **n/m picked** and the workflow (**Draft** /
**Pending approval — <conductor>** / **Approved** / **Sent back**). Music to-dos have no checkbox.
They close themselves, and **Open music** leads to the card.

`mc` (finalizing topics tells the coordinator, plus the email toggle) extends this scenario later.

**Already automated:**
- `tests/routes/music-review.test.ts`:
  - submit is refused when incomplete (naming what is missing), before the topics are final, and with no conductor;
  - a submit gives one review to-do and closes the choose to-do; a second submit adds nothing;
  - the coordinator cannot review; a send-back needs a note, and reopens the choose to-do with the note;
  - the audit row never carries the note; the note survives the coordinator's next edit;
  - an approval closes the review; a hymn change reopens approved music; an organist change closes an open review as `music_reopened`;
  - a bishop who submitted cannot approve, and the conductor can;
  - a conductor change moves the review; a lost meeting closes everything and resets the status; a re-save writes nothing;
  - a music to-do cannot be ticked or deleted.
- `tests/lib/musicCompletion.test.ts`: the completion rule, table-driven.
- `tests/lib/musicReopenSites.test.ts`: every music write route reopens; only `lib/music/` writes `sunday_music`.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver), a whole calendar from this month through the month after next |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura), `counselor2` (David Okafor), `music` (Hannah Restrepo, music coordinator) |
| Sunday **A** | First ordinary Sunday at least a week out. Topics final, **Peter** conducts. 3 hymns, chorister **Ruth Hale**, **no organist**. Hannah holds *Choose the music for A* |
| Sunday **B** | Next. Topics final, Peter conducts. Everything plus a musical number (The Jansen family). **Submitted by Hannah**; Peter holds *Review the music for B* |
| Sunday **C** | Next. Topics final, Peter conducts. **Submitted by the bishop**; Peter holds *Review the music for C* |
| Sunday **D** | Next. Topics **not** final, two hymns |

**Sign in with:** `bishop@`, `counselor1@`, `music@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-087-music-submit-and-review`, and note the four dates.
2. `npm run dev`, open http://localhost:3000, and sign in as `music`.
3. Open **To Do**. Read *Choose the music for A* and press **Open music**.
4. On **Music**, read the back link and A's card (open), then the collapsed pills on A, B, C and D.
5. On A, read the Submit button. Choose an organist (type "Brother Visiting"), then press **Submit for review**.
6. Sign out, sign in as `bishop`, open **Music**, and open C, then B.
7. Sign out, sign in as `counselor1`, and open **To Do**. Try to remove *Review the music for B*.
8. Open **Music**. On **B**, press **Send back**, try to send with an empty note, then send
   "Please swap the closing hymn for one about the Savior."
9. On **A**, press **Approve**. On **C**, press **Approve**.
10. Sign out, sign in as `music`. Open **To Do** and expand *Choose the music for B*.
11. Open **Music**, open B, change the closing hymn, and press **Submit for review**.
12. On **A** (approved), change the opening hymn. Then, on **B** (submitted again), change the chorister.
13. Sign out, sign in as `counselor1`, and reread **To Do**.
14. Sign in as `bishop`, open **Programs**, and open A's programme (build it if there is none).

## Verification Checklist

### Machine-checkable

- [ ] Step 3: the to-do has **no checkbox**, a music icon, and an **Open music** link. It lands on `/music?sunday=<A>&from=todos#sunday-<A>` with A open
- [ ] Step 4: the page shows **Back to To Do**. A reads **4/5 picked** · **Draft**, B **6/6 picked** · **Pending approval — Peter Nakamura**, C **5/5 picked** · **Pending approval — Peter Nakamura**, and D only **Topics pending**
- [ ] Step 5: before the organist, Submit is disabled and reads **1 left: Organist**. Afterwards A reads **5/5 picked** · **Pending approval — Peter Nakamura**, Hannah's choose to-do is closed (read back: `music_submitted` line), and Peter has one open *Review the music for A*
- [ ] Step 5: Hannah sees no Approve or Send back on any card
- [ ] Step 6: on C the bishop sees **Approve** and **Send back** disabled, with *"You submitted this music, so another member of the bishopric approves it."*. On B both are enabled
- [ ] Step 7: Peter's three review to-dos have no checkbox; removing one is refused with *"This comes from a Sunday's music and closes itself when the music moves on."*
- [ ] Step 8: the send-back window's **Send back** is disabled while the note is empty. After sending, B reads **Sent back**, its banner reads *"Sent back by the conductor: Please swap…"*, and Peter's review for B **stays open**, its timeline ending *"Sent back: Please swap…"*
- [ ] Step 9: A and C read **Approved**, and Peter's reviews for them are closed (read back: `music_approved` lines)
- [ ] Step 10: Hannah has an open *Choose the music for B* — created by the send-back, since the seed gave her none for B (an existing one would be reopened instead) — and its timeline ends **Sent back: Please swap the closing hymn for one about the Savior.**
- [ ] Step 11: the banner stays through the hymn change, and clears on submit. B reads **Pending approval — Peter Nakamura**, and Peter's SAME review gains *"Music submitted for review"* (no second review is created)
- [ ] Step 12: A returns to **Draft** with *"Changed after it was submitted — submit again when it's ready."*. B returns to Draft the same way
- [ ] Step 13: Peter has no open review for B any more; its timeline ends *"The music changed — this review is no longer needed"* (`closed_reason` `music_reopened`)
- [ ] Step 14: the programme page shows *"Music not approved yet — the conductor approves it on Music."*, with nothing disabled. Its Organist line reads **Brother Visiting** and its Chorister line **Ruth Hale**
- [ ] `audit_log` has `sunday_music_submitted`, `sunday_music_approved` and `sunday_music_sent_back` rows; the send-back's detail has `returnedWithMessage: true` and no note text
- [ ] Every date reads as the right day (no off-by-one) on the to-dos, the cards and the programme
- [ ] 375px: no horizontal scroll on /music; the summary row may wrap the workflow pill under the date (as `Fast Sunday · Topics pending` already does) but nothing overflows; the Submit / Approve / Send back rows fit inside the card

### Needs a human eye

- [ ] Do the two pills read clearly side by side, or does the workflow pill crowd the date?
- [ ] Is it clear from the card what Submit does, and who it goes to?
- [ ] Does the sent-back banner read as the conductor's words to the coordinator?
- [ ] Is "Music not approved yet" on the programme quiet enough not to read as a blocker?

## Walkthrough record

### 2026-10-04 — driven by Claude (Chrome extension), screenshots reviewed by the user: pending

Seeded fresh, dev server on :3000. Every write read back from the database with the service role
(`testing/infrastructure/walkReadback.ts`, excluded from git). Screenshots in `walk/` (excluded from
git). Dates seeded: A 2026-10-11, B 2026-10-18, C 2026-10-25, D 2026-11-08.

All 14 steps walked as written. Observed:
- Step 3: card has 0 checkboxes, a music icon, **Open music** → `/music?sunday=<A>&from=todos#sunday-<A>`, A open.
- Step 4: **Back to To Do**; A `4/5 picked · Draft`, B `6/6 picked · Pending approval — Peter Nakamura`, C `5/5 picked · Pending approval — Peter Nakamura`, D `Topics pending` only.
- Step 5: Submit `disabled`, reason **1 left: Organist**; after typing "Brother Visiting" and submitting, A row `submitted` by Hannah, her choose to-do closed with `music_submitted`, one open review for Peter. Hannah sees 0 Approve/Send back buttons.
- Step 6: bishop on C — both buttons `disabled` + *"You submitted this music, so another member of the bishopric approves it."*; on B both enabled.
- Step 7: Peter's 3 review to-dos, 0 checkboxes; Remove refused with *"This comes from a Sunday's music and closes itself when the music moves on."*
- Step 8: send-back window's button `disabled: true` with an empty note; sent → B `draft`, `sent_back`, note stored; card `6/6 picked · Sent back`, banner verbatim.
- Step 9: A and C `approved`, reviews closed with `music_approved`.
- Step 10: B choose to-do open, timeline `Sent back: Please swap…` (Oct 4, 1:09 AM, ward zone).
- Step 11: closing hymn → 193 I Stand All Amazed; banner stayed; resubmit cleared it; B `Pending approval — Peter Nakamura`; Hannah's to-do closed `music_submitted`, one fresh review on Peter.
- Step 12: A opening hymn → 6 Redeemer of Israel → A `draft`/`music_changed`, banner *"Changed after it was submitted…"*; B chorister → Sister Jansen → B `draft`/`music_changed`.
- Step 13: Peter's open list empty; B's review closed `music_reopened`, line *"The music changed — this review is no longer needed"*.
- Step 14: programme page shows *"Music not approved yet — the conductor approves it on Music."*, Build enabled; built draft has Organist **Brother Visiting**, Chorister **Ruth Hale**.
- Audit: `sunday_music_submitted` ×2, `sunday_music_approved` ×2, `sunday_music_sent_back` ×1 (`returnedWithMessage: true`, no note text).
- 375px (measured in a 375px same-origin frame — the window would not resize): no horizontal scroll (357px in 372px); the workflow pill wraps under the date; the review row and its sentence fit.

Checklist corrected during the walk: step 10 said "open again" but the seed gives Hannah no B
to-do, so the send-back creates one; the 375px item claimed both pills fit on one line, which is
false and was never the design (the row wraps).

Answers to the five judgement questions (2026-10-04): 1 wrapping at 375px acceptable; 2 Submit clear
enough; 3 "the conductor" fine in the banner; 4 the programme notice quiet enough; 5 **changed** —
the conductor's review must show he sent it back until the music is resubmitted. Built the same day:
the review now stays open with a "Sent back: <note>" line and a resubmission lands on it (steps 8
and 11 updated); not yet re-walked in the browser, covered by `tests/routes/music-review.test.ts`.

Left behind: B is `submitted` by the bishop (submitted from the 375px frame to measure the review row).
