---
id: music-review-submit-and-approve
status: best-yet
commit: 4c0ce53
date: 2026-10-04
area: music-review
related_retros: [sacrament-music-submit-review, sacrament-music-people]
supersedes: null
---

## What was tested

Scenario 087 (`talks/scenario-087-music-submit-and-review`), all 14 steps, on **localhost**
against the hosted project.

**Who drove it:** an AGENT (Claude, through the Chrome extension) drove the app as Hannah (music
coordinator), Peter (conductor) and Mark (bishop). It read every write back from the database with
the service role, through `testing/infrastructure/walkReadback.ts`. The user reviewed the screenshots
on the walk page (https://claude.ai/artifact/JVPAe4vZJtXrxa5dMjUffA) and answered five judgement
questions.

**Not verified:**
- The deployed build was not opened.
- No real device: the 375px checks ran in a 375px same-origin frame, because the browser window
  would not resize.
- Dark mode was not looked at.
- **The send-back change in `4c0ce53` was never walked in a browser.** The conductor's review now
  stays open after a send-back and takes the resubmission, which answers judgement question 5. It
  was built after the walk and is covered only by `tests/routes/music-review.test.ts`.
- The reconcile paths (conductor handover, lost meeting) were proved by route tests, not walked.

## Result

What works, as observed on 2026-10-04 (seeded dates: A 2026-10-11, B 2026-10-18, C 2026-10-25):
- **Submit gate.** Submit was `disabled`, reading "1 left: Organist". After the organist "Brother
  Visiting" was typed, A became `submitted` by Hannah. Her "Choose the music" closed with a
  `music_submitted` line, and Peter got exactly one "Review the music for Sunday, October 11, 2026".
- **Nobody approves their own.** On C, which the bishop submitted, the bishop saw Approve and Send
  back `disabled`, with "You submitted this music, so another member of the bishopric approves it."
  On B both were enabled.
- **Music to-dos close themselves.** Removing one was refused with "This comes from a Sunday's music
  and closes itself when the music moves on."
- **Send back.** With an empty note the window's button was `disabled: true`. After sending, B was
  `draft` / `sent_back` with the note stored verbatim. The card read `6/6 picked · Sent back`, and
  the banner read "Sent back by the conductor: Please swap the closing hymn for one about the
  Savior."
- **Approve.** A and C became `approved`, and their reviews closed with `music_approved`.
- **Reopen.** A hymn change on approved A and a chorister change on submitted B both returned to
  `draft` / `music_changed`, with "Changed after it was submitted — submit again when it's ready."
  B's open review closed as `music_reopened`.
- **Programme.** The page showed "Music not approved yet — the conductor approves it on Music." with
  Build still enabled. The built draft read Organist "Brother Visiting" and Chorister "Ruth Hale".
- **Audit.** Two `sunday_music_submitted` rows, two `sunday_music_approved` rows, and one
  `sunday_music_sent_back` row carrying `returnedWithMessage: true` and no note text.
- **375px.** No horizontal scroll (357px of content in a 372px viewport). The workflow pill wraps
  under the date, which the user judged acceptable.
- **Tests.** The full suite passed in chunks: 302 files and 4,628 tests before the send-back change.
  After it, `music-review` passed 21 of 21, and conductor handover, To Do, hymn select and all of
  `tests/lib` passed together (137 files, 2,507 tests).

Judgement answers: wrapping at 375px is acceptable; Submit is clear enough; "the conductor" is fine
in the banner; the programme notice is quiet enough; question 5 was **changed**, and the review now
stays open after a send-back.

Still to do before `confirmed`:
- Re-walk steps 8 and 11 in a browser for the open-review behaviour.
- Open the deployed build.
- Slice `mc` (topic hand-off and email) will extend this same scenario.
