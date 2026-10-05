---
name: Finalizing topics tells the music coordinator, and a topic change reopens the music
scope: sacrament-music-handoff-and-approval
part: 3
tags: [talks, music, todos, full, P4]
prerequisites: none
---

## Purpose

ITER-038 `mc` (plans/sacrament-music-handoff-and-approval.md). When the bishopric **finalizes a
Sunday's topics**, every active music coordinator gets **Choose the music for …** on To Do, with
that Sunday's **topic titles** in its notes (never a speaker's name), plus a notification row and an
email if they switched email on. The Finalize control says what happened in one line.

**Un-finalizing** topics returns submitted or approved music to **Draft** with *"The topics changed
after this was submitted…"* and closes the conductor's open review. It tells nobody. **Finalizing
again** tells the coordinator the topics changed: a done to-do reopens as **Topics changed — check
the music for …**, and an open one gets a *"The topics changed — check the music"* line.

It also re-walks the `mb` change made after scenario 087's walk: **the conductor's review stays open
after a send-back**, with a *"Sent back: <note>"* line, and the resubmission lands on that same to-do.

**Already automated:**
- `tests/routes/music-handoff.test.ts`:
  - one to-do per active coordinator, with topic titles and no speaker name; a deactivated coordinator gets none;
  - finalizing an already-finalized Sunday adds nothing and tells nobody;
  - un-finalizing returns submitted music to draft and closes the review; finalizing again reopens with "Topics changed";
  - editing a talk's topic, or turning the Sunday into Fast Sunday, returns submitted music to draft;
  - email only to the coordinator who opted in; "not set up" is reported, not thrown; a send-back emails the submitter;
  - no coordinator → the finalize stands and says nobody was told; a failed handoff → the finalize stands and says so.
- `tests/routes/music-email-preference.test.ts`: the toggle writes both rows for the caller only and never touches the in-app opt-out.
- `tests/lib/musicTopicSites.test.ts`: every place that clears the topics stamp reopens the music (read from the source).

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward (America/Denver), a whole calendar from this month through the month after next |
| Users | `bishop` (Mark Andersen), `counselor1` (Peter Nakamura), `counselor2` (David Okafor), `music` (Hannah Restrepo, music coordinator) |
| Sunday **A** | First ordinary Sunday at least a week out. **Peter** conducts. Two talks: *Faith in Jesus Christ* (speaker **Eliza Thornbury**) and *Keeping the Sabbath day holy*. Topics **not** final. No music |
| Sunday **B** | Next. Peter conducts. Topics final. 3 hymns, chorister Sister Peake, organist Brother Visiting, **submitted by Hannah**. Peter holds *Review the music for B*; Hannah's *Choose the music for B* is **done** |

Email is whatever your `.env.local` says. With no verified sending domain it is "not set up", and
the steps below say what you should see either way.

**Sign in with:** `bishop@`, `counselor1@`, `music@`, all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- talks/scenario-088-music-topics-handoff`, and note the two dates.
2. `npm run dev`, open http://localhost:3000, sign in as `music`, and open **Music**. Tick
   **Email me when topics are ready or the music is sent back**, then reload the page.
3. Sign out, sign in as `counselor1`, open **Sacrament**, and open A's **Topics** screen. Press
   **Finalize topics** and read the line beside it.
4. Press **Undo**, then **Finalize topics** again, and read the line.
5. Sign out, sign in as `music`, and open **To Do**. Expand *Choose the music for A*.
6. Sign out, sign in as `counselor1`, open **Music**, and on **B** press **Send back** with the note
   "Please choose a closing hymn about the Savior." Then open **To Do** and expand *Review the music for B*.
7. Sign out, sign in as `music`. Open **Music**, open B, change the closing hymn, and press
   **Submit for review**.
8. Sign out, sign in as `counselor1`, and reread *Review the music for B* on **To Do**.
9. Open B's **Topics** screen and press **Undo** on Finalize topics. Open **Music** and read B's card.
   Then go back and **Finalize topics** on B again, and read the line.
10. Sign out, sign in as `music`, and open **To Do**.
11. Sign out, sign in as `bishop`, and open **Music**.

## Verification Checklist

### Machine-checkable

- [ ] Step 2: the toggle is on the page for Hannah, stays ticked after the reload, and (with email not set up) reads *"Email isn't set up for this ward yet, so nothing will be sent until it is."*. Read back: two `notification_user_prefs` rows for Hannah, `music_topics_ready` and `music_sent_back`, both `email_enabled = true`
- [ ] Step 3: the line reads *"Told the music coordinator."* — or, with email not set up, *"Told the music coordinator. Email isn't set up for this ward yet, so nobody was emailed."*. Read back: one open `choose` to-do on Hannah for A, and one `music_topics_ready` notification row
- [ ] Step 4: the line reads *"Told the music coordinator the topics changed."* (plus the email sentence if not set up). Read back: still **one** `choose` to-do for A, now with a `topics_changed` line
- [ ] Step 5: the to-do is titled **Choose the music for <A>**, its notes read *"Topics: Faith in Jesus Christ; Keeping the Sabbath day holy."* and do **not** contain "Thornbury", and its timeline ends *"The topics changed — check the music"*
- [ ] Step 6: B reads **Sent back** with the banner, and Peter's review for B is **still open**, its timeline ending *"Sent back: Please choose a closing hymn about the Savior."*. Hannah's *Choose the music for B* is open again with the same line
- [ ] Step 7: B reads **Pending approval — Peter Nakamura**
- [ ] Step 8: Peter has **one** review for B — the same one — and its timeline ends *"Music submitted for review"*
- [ ] Step 9: after Undo, B's collapsed card reads **Topics pending** (that pill replaces both others while topics are not final — the `mb` rule) and, opened, shows *"The topics changed after this was submitted. Your picks are kept — check them and submit again."*, and Peter's review for B is closed (`closed_reason` `music_reopened`). After finalizing again the line reads *"Told the music coordinator the topics changed."*
- [ ] Step 10: Hannah's B to-do is open again, titled **Topics changed — check the music for <B>**, its timeline ending *"The topics changed — check the music"*
- [ ] Step 11: the bishop sees **no** email toggle on Music
- [ ] `audit_log` has `sunday_topics_finalized` / `sunday_topics_unfinalized` rows and a `notification_email_preference_changed` row whose detail is `{ triggers, enabled }` with no address
- [ ] Every date reads as the right day (no off-by-one) on the to-dos and cards
- [ ] 375px: the result line beside Finalize topics wraps inside the screen, with no horizontal scroll

### Needs a human eye

- [ ] Is the line beside Finalize topics clear about what happened, and is it quiet enough?
- [ ] Does *"Topics changed — check the music for …"* make it obvious what Hannah should do?
- [ ] Is the email toggle in the right place on Music, and does its wording say what it does?

## Walkthrough record

### 2026-10-04 — driven by Claude (Playwright), screenshots reviewed by the user the same day

Seeded fresh, dev server on :3000, desktop 1060px wide, then 375px for the width checks. Every write
read back with the service role (`testing/infrastructure/walkReadback.ts`, excluded from git).
Screenshots in `walk/` (excluded from git). Dates seeded: A 2026-10-11, B 2026-10-18. Email was
NOT set up (no verified sending domain), so every email path was the "not set up" one; real sends
are covered by `tests/routes/music-handoff.test.ts`.

**The first seed was missing the notification triggers.** The harness ward gets no
`notification_settings` rows unless a scenario calls `seedNotificationTriggers()`, and neither 087
nor this seed did — so step 3's first run wrote the to-do but no notification row, and the dev
server logged *Unknown notification trigger "music_topics_ready"*. A harness gap, not an app defect
(real wards get the rows from migration 089f and the seed file). Fixed in this seed, reseeded, and
steps 2–3 walked again from scratch; the values below are from the second run.

All 11 steps walked as written. Observed:
- Step 2: toggle present for Hannah with *"Email isn't set up for this ward yet, so nothing will be sent until it is."*; ticked, reloaded, still ticked. Rows: `music_topics_ready` and `music_sent_back`, both `email=true inApp=true`. Audit `notification_email_preference_changed {"enabled":true,"triggers":[…]}`.
- Step 3: line *"Told the music coordinator. Email isn't set up for this ward yet, so nobody was emailed."*; button became **Undo** (`aria-pressed=true`). A's stamp set; one open `choose` to-do on Hannah; one `music_topics_ready` row (*"Topics ready for music"*).
- Step 4: after Undo + Finalize, *"Told the music coordinator the topics changed. Email isn't set up…"*. Still ONE to-do for A, now with a `topics_changed` line; a second notification *"Topics changed"*.
- Step 5: *Choose the music for Sunday, October 11, 2026*; notes *"Topics: Faith in Jesus Christ; Keeping the Sabbath day holy."*; "Thornbury" absent from the page; 0 checkboxes; timeline *"Oct 4, 2:13 PM — The topics changed — check the music"*.
- Step 6: the window's Send back was `disabled` with an empty note. Sent → B `draft`/`sent_back`, note stored. The window stayed open: *"Sent back. Email isn't set up for this ward yet, so nobody was emailed."* — by design, because Hannah had opted in. After Close, B reads **Sent back** with the banner. Peter's review **stayed OPEN** with `music_sent_back(note)` — the `mb` change, walked for the first time; Hannah's B to-do reopened with the same line; `music_sent_back` notification to Hannah.
- Step 7: closing hymn changed to 172 In Humility, Our Savior (note kept through the edit), then submitted → **Pending approval — Peter Nakamura**.
- Step 8: Peter still has exactly ONE B review — the same row — its timeline `music_sent_back, music_submitted`; `music_submitted` notification to Peter.
- Step 9: Undo on B → `draft`/`topics_changed`, review CLOSED `music_reopened`; card **Topics pending** + the topics-changed banner. Finalize again → *"Told the music coordinator the topics changed…"*.
- Step 10: Hannah's B to-do OPEN, retitled **Topics changed — check the music for Sunday, October 18, 2026**, notes *"Topics: The blessings of the temple."*, timeline ending *"The topics changed — check the music"*.
- Step 11: bishop on Music — 0 checkboxes, toggle text absent.
- Audit: `sunday_topics_finalized` / `sunday_topics_unfinalized` rows for every press, each carrying the date and stamp.
- Dates: every to-do, card, notification and timeline reads Oct 11 / Oct 18 / Oct 25 as seeded; timeline times in the ward's zone (2:13–2:17 PM MDT for 20:13–20:17 UTC).
- 375px: Topics screen — page 360px in a 375px viewport, the line at x 29–331. Hub tick (October 25, a first handout) — page 360px, line at x 119–327, but it squeezes the **Topics 0/3** pill onto two lines.

Checklist corrected during the walk: step 9 said B "reads **Draft**", which the app cannot show while
topics are un-finalized (the `Topics pending` pill replaces both pills — `mb`'s unchanged rule).

Noticed, out of this slice's scope: searching the hymnbook for "193" found nothing, while "Savior"
listed *193 — I Stand All Amazed*.

Left behind: A finalized (handed out four times), B finalized with Hannah's "Topics changed" to-do
open, October 25 finalized with a first-handout to-do.

Answers to the six judgement questions (2026-10-04): 1 the Finalize line is clear and quiet enough,
the repeated email sentence included; 2 **changed** — on the hub the line must sit on its own row;
3 "Topics changed — check the music for …" is clear; 4 the banner's "submit again" is fine; 5 the
send-back window staying open to say the email could not go is useful; 6 the email box works for now.
Built the same day for 2: each hub card has a slot under its pill row and the Topics tick's line
renders into it (`resultSlotId`, `finalizeResultSlotId()`); re-checked at 375px on October 25 —
page 360px wide, the line below the pills (pills end at y 664, line starts at y 681), the Topics pill
back on one line (`walk/09-hub-line-own-row-375.png`); covered by
`tests/components/sacrament/FinalizeTopicsButton.test.tsx`, proved able to fail.
