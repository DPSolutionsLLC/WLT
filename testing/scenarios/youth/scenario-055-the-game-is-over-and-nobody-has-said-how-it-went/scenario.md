---
name: The game is over and nobody has said how it went
scope: youth
part: 5
tags: [youth, full, follow-up, privacy]
prerequisites: none
---

## Purpose

The whole follow-up loop, end to end, including the two things a green suite cannot check:
whether a leader can **find out there is anything to write**, and whether the **shared/private
boundary is legible on the screen where it matters**.

The arithmetic is pinned by `tests/lib/youthFollowUp.test.ts`, the policies by
`tests/rls/activity-logs.test.ts` and `tests/rls/activity-private-notes.test.ts`, and the wire
format by `tests/routes/youthPrivateNote.test.ts` — which scans three endpoints' serialized bodies
for the note's text. What none of them can answer is whether the panel on `/youth` is **findable**,
whether the shared-note label reads as a fact rather than a warning, and whether a tile that says
*"Nobody recorded as taking part"* reads as a bug.

Seeding matters because four of the five events have to sit at specific distances **in the past**,
and because a second leader's follow-up with a private note on it has to exist before anybody
touches the app — otherwise the only run that checks the privacy boundary is the run where the
tester happened to use the private box.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, `cross_org_visibility: false`, `home_venues: ["Lincoln High School"]` |
| Users | `bishop@…` (bishop), `ym-president@…` (Young Men president), `ym-secretary@…` (Young Men **secretary** — holds `.view` and `.log`, **not** `.manage`) |
| Households | Brooks (2201 Canyon Road), Chen (418 Meadowlark Lane) |
| Members | 2 youth — Ethan Brooks (Young Men), Ava Chen (Young Women) |
| Activity profiles | 2, **both owned by the Young Men** — *Varsity basketball* (Ethan), *Concert choir* (Ava) |
| Events | 5, placed relative to the seed time — see below |
| Attendees | 5 rows |
| Follow-ups | 2 — one from the president, one from the **secretary** |
| Private notes | 1, belonging to the **secretary**, on their own follow-up |

The five events, and what each must read **for `ym-president`**:

| Event | When | Status | President down for it? | President's follow-up? | Must read |
|---|---|---|---|---|---|
| Game against Roosevelt | −3 days | upcoming | yes | **no** | **Waiting on your follow-up** |
| Game against Jefferson | −5 days | upcoming | yes (confirmed) | yes | **Follow-up recorded** |
| Game against Washington | −4 days | **cancelled** | yes | no | **no badge at all** |
| Winter concert | −6 days | upcoming | **no** | no (the *secretary* wrote one) | **no badge at all** |
| Game against Madison | +5 days | upcoming | yes | no | **no badge at all** |

**Sign in with:** `ym-president@harness.wardleadershiptools.test` first, then
`bishop@harness.wardleadershiptools.test`.
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- youth/scenario-055-the-game-is-over-and-nobody-has-said-how-it-went`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `ym-president@…` and open **/youth**. Read the **Waiting on your follow-up** panel
   before reading anything else.
4. Press **Say how it went** on *Game against Roosevelt*. Answer **I went**, write a shared note,
   write a private note, and save. Watch the panel, the schedule and the attendee line **without
   reloading** — press **Show past events** to see the schedule half.
5. Find *Game against Jefferson* under **Show past events** and press **Change what you wrote**.
   Confirm the form opens with the existing note and with **I went** already selected, and that the
   **ward council** control is present here and was **absent** on the new follow-up in step 4.
6. Open **/youth/feed**. Read the sentence under the heading that says which mode the ward is in.
7. Tap the new report. Then tap the star on it and read the confirmation.
8. Sign out. Sign in as `bishop@…`, open **/youth/feed**, and find the **Winter concert** report —
   the one the secretary wrote. Read its shared note, then go looking for the private note by every
   route you can think of.
9. Read `/youth` and `/youth/feed` at 375px, in both themes.

## Verification Checklist

### Machine-checkable

- [ ] `/youth` shows **exactly one** event waiting on the president: *Game against Roosevelt*.
      Not the logged one, not the cancelled one, not the *Winter concert* they were never down for,
      not the upcoming one.
- [ ] The heading counts what the list shows — **Waiting on your follow-up (1)** — and the count
      disappears entirely when the list is empty rather than reading "(0)".
- [ ] The **cancelled** past event appears nowhere as waiting, and carries **no follow-up badge**.
- [ ] The form asks **"Did you go?"** — and it asks it *because the president has an attendee row*.
- [ ] On *Winter concert*, opened by the **secretary**, the same question appears; opened by
      somebody with no attendee row it is **absent**, not disabled.
- [ ] The shared-note field says **who can read it** and names them — with cross-org visibility
      **off** it must say the activity's own organization and the bishopric.
- [ ] The private-note field says it is the author's alone, in a **visually distinct block**
      (dashed border), and posts to `/api/youth/logs/[id]/private-note` — a **separate request**
      from the follow-up itself. Check the network panel: there are two.
- [ ] Saving updates the **panel** and the **schedule badge** with no reload, and the network panel
      shows all three cache keys refetching (`/api/youth/logs`, `/api/youth/events`,
      `/api/youth/attendees`).
      CORRECTED 2026-08-28: this line used to claim the **attendee line** updates too. It cannot —
      `AttendeeControls` renders "Going: ⟨name⟩" and never displays `confirmed_attendance`, so
      there is nothing on that line for a saved answer to change. The attendee query *is*
      invalidated and the column *is* written; both are checked above and in the database.
- [ ] A second follow-up on the same event is refused with *"You have already recorded a follow-up
      for this event. Open it to change what you wrote."* — a 409, not a 500, and not a second row
      in `activity_logs`.
- [ ] The **ward council** control is absent while creating a follow-up and present when editing
      one. There is nothing to flag until the row exists.
- [ ] `/youth/feed` shows the new report, **unread**, and the sentence beneath the heading names
      the cross-org mode.
- [ ] The dropdown's first option reads **Every activity**, not "Every organization".
- [ ] Tapping a tile marks it read **for the president only** — sign in as the bishop and confirm
      the same report is still unread for them.
- [ ] The tile's date is the **event's** date, rendered `Aug 25, 2026` — month name, no weekday,
      never `8/25/2026` — and it is the day of the game, not the day the follow-up was written.
      It must also be the day in the **ward's** zone: *Game against Roosevelt* is stored
      `2026-08-26T01:00Z`, so a UTC-formatted tile would wrongly say Aug 26.
      CORRECTED 2026-08-28: this line used to say `Sat, 2 Jan 2027` style. `ReportTile`'s
      `REPORT_DATE_FORMAT` carries no weekday — it is visits-c's format, shared and unchanged.
- [ ] The tile preview is **one line** of the **shared** note, ending in an ellipsis at a word
      boundary. The secretary's note is long enough to be cut.
- [ ] A follow-up that confirms **I did not go** shows *"Did not attend"* on its tile; one that
      confirms **I went** shows no outcome line at all.
- [ ] The bishop **can** read the secretary's shared note on `/youth/feed`.
- [ ] The bishop **cannot** read the secretary's private note — not on the feed, not on `/youth`,
      not by opening the follow-up, and not from `GET /api/youth/logs/[id]/private-note`, which
      answers `{"note": null}` rather than a 403.
- [ ] `audit_log` holds `youth_activity_followup_logged` and
      `youth_activity_private_note_saved` rows, and **neither `detail` contains the note text**.
- [ ] `notifications` holds one `youth_followup_submitted` row addressed to the Young Men
      presidency, and its body names the activity and the event and **no note text**.
- [ ] No horizontal overflow at 375px. Every button is at least 44×44.

- [ ] **"Say how it went" is offered only on events this reader may actually write against.**
      ADDED 2026-08-28 after the walk found the opposite — scenario 056 reproduces it: the control
      is gated on the permission and the clock alone, so it appears on other organizations' events
      and the save is then refused. Scenario 055 seeds only Young Men activities, so it cannot
      reach the bug; the check is recorded here so the two scenarios agree about what is expected.

### Needs a human eye

- [ ] Is the **Waiting on your follow-up** panel *findable*? `youth-c` found the uncovered banner
      correct and unfindable, and the fix there was to name the events rather than count them.
      This panel names them from the start — does that land?
- [ ] Does *"Nobody recorded as taking part"* on a youth tile read as a **bug**? It is true —
      `activity_logs` has no participants table — and probably useless here. If it reads badly the
      fix is in `components/visits/ReportTile.tsx` **in place**, with `/visits/feed` re-verified in
      the same session, and never a youth-only component.
- [ ] Does the shared-note label read as a **fact about who can see it** rather than as a warning?
      `visits-a` moved this emphasis off the private field onto the shared one; check it landed.
- [ ] Do the two note fields look **different enough** that you would not type the wrong thing into
      the wrong one on a phone, in a hurry?
- [ ] With nothing waiting, does the panel's empty state read as *"you are up to date"* or as
      *"something failed to load"*?
- [ ] Is *"Follow-up recorded"* on a logged event useful, or is it noise on a row nobody has to act
      on?
- [ ] Does the feed's ordering — **newest report first**, while each tile shows the **event's**
      date — read as deliberate, or as a broken sort? The sentence under the heading is meant to
      answer that; does it?
- [ ] Legible one-handed at 375px, in both light and dark mode?

## Failure Behavior

- [ ] Saving a follow-up with the dev server stopped mid-tap shows a sentence rather than failing
      silently.
- [ ] An empty private note is refused with *"Write something, or delete the note instead."* rather
      than saving a blank row.
  Automated: `tests/routes/youthPrivateNote.test.ts` → *"refuses an empty note…"*.
- [ ] Clearing the private note box and saving **deletes** the note rather than leaving the old one.
- [ ] A follow-up filed against another organization's event is refused with a sentence naming the
      boundary — not a 500.
  Automated: `tests/routes/youthLogs.test.ts` → *"answers 403 with a sentence for another
  organization's event"*.
- [ ] A malformed feed cursor answers *"That page marker is not valid. Reload the feed."*

## Walkthrough record

**2026-08-28 — driven by Claude in a real browser (Playwright), against the hosted project.**
Every value below was read back with the SERVICE CLIENT, never from the screen alone. Machine zone
America/Denver; the seed placed events at −5.74d, −4.74d, −3.74d, −2.74d and +5.26d from
`now = 2026-08-28T18:46:35Z`.

**Every follow-up badge is correct**, checked against the stored row rather than the seed script:

| Event | stored | past? | attendee | own log | badge | follow-up control |
|---|---|---|---|---|---|---|
| Winter concert | upcoming | −5.74d | secretary, not president | none (secretary's) | **none** | **"Say how it went"** |
| Game against Jefferson | upcoming | −4.74d | president, confirmed | yes | Follow-up recorded | "Change what you wrote" |
| Game against Washington | **cancelled** | −3.74d | president | none | **none** | **absent** |
| Game against Roosevelt | upcoming | −2.74d | president | none | Waiting on your follow-up | "Say how it went" |
| Game against Madison | upcoming | +5.26d | president | none | none (Covered · 1) | absent |

- **The panel showed exactly one row.** `Waiting on your follow-up (1)` — *Game against Roosevelt*
  only. After saving, the heading lost its count and read *"Nothing is waiting on you…"*.
- **Decision 5 is live.** *Winter concert* — an event the president was never down for — carries a
  **"Say how it went"** button. That is the button the discarded `state !== "not_due"` gate would
  have hidden, and it is why `isFollowUpWritable()` was split out during the build.
- **Two requests, not one.** Saving produced `POST /api/youth/logs → 201` then
  `POST /api/youth/logs/4e7e6750…/private-note → 200`. The log POST's body was
  `{"eventId":"0a2020f3…","sharedNotes":"We won by four…","attended":true}` — **no `loggedBy`, no
  private text**. Then `/api/youth/logs`, `/api/youth/events` and `/api/youth/attendees` all
  refetched: `FOLLOW_UP_MUTATION_INVALIDATES`, all three keys.
- **Written and read back.** `activity_logs` row created 18:49:26.272289+00; `activity_attendees`
  `confirmed_attendance = true`; `activity_private_notes` gained the president's note. Editing to
  *I did not go* moved `updated_at` to 18:52:06.763+00 and set `confirmed_attendance = false`.
  The unchanged private note was **not** re-saved — one `private_note_saved` audit row, not two.
- **Audit carries ids and keys, never text.** `youth_activity_followup_logged` →
  `changed:["eventId","sharedNotes","attended"], attended:true, attendanceRecorded:true`.
  `youth_activity_private_note_saved` → `{"activityLogId":"4e7e6750…"}` and nothing else.
- **One notification**, `youth_followup_submitted` → `ym-secretary`, body
  `"Varsity basketball — Game against Roosevelt"`. No note text. The author was excluded, which is
  `notifyOrgLeadership`'s `neq("id", actingUserId)`.
- **The 409.** A second `POST /api/youth/logs` for the same event returned
  `409 "You have already recorded a follow-up for this event. Open it to change what you wrote."`
  and `activity_logs` still held **1** row for that event.
- **The feed.** Three tiles ordered *Roosevelt, Winter concert, Jefferson* — **newest report
  first**, deliberately not event-date order (Aug 25, Aug 22, Aug 23). Dropdown read
  **"Every activity"**. Roosevelt's tile showed **"Did not attend"**; the other two showed no
  outcome line. Dates rendered `Aug 25, 2026` — the **ward's** day for a row stored
  `2026-08-26T01:00Z`. Preview cut at a word boundary with an ellipsis.
- **Per-user read state.** Tapping a tile took the president from "3 unread reports." to
  "2 unread reports." and wrote exactly one `report_read_status` row. The bishop then saw
  **3 unread** — unaffected.
- **The privacy boundary, from the bishop's own session.** He read the secretary's *shared* note,
  and reached **neither** private note by any of four routes — page HTML, `/api/youth/feed`,
  `/api/youth/logs`, `/api/youth/events`. `GET /api/youth/logs/{id}/private-note` answered
  **`200 {"note":null}`**, not a 403: the policy denies the row, so "not yours" and "none yet" are
  the same answer.
- **Bookmark wording.** *"Bookmarked Winter concert for yourself. Nobody else can see this, and
  nobody has been notified."*
- **375px.** `scrollWidth 360 = clientWidth 360`, no horizontal overflow. Every `<button>` ≥44px.
  The only sub-44px targets were two inline prose links, the same pattern `/visits/feed` ships.
  Light and dark both legible.

**One defect found, not fixed** — see the review page:

- **"Did you go?" conveys its answer by colour alone.** "I went" renders `bg-primary` and "I did
  not go" `bg-surface`, and **neither carries `aria-pressed`, `aria-checked`, or a role**. A screen
  reader hears two identical buttons. `CoverageBadge`, `ReportTile` and `VisitProgressTable` each
  state "colour is never the only signal", and `ReportTile`'s bookmark uses `aria-pressed` for the
  same shape of control.

Corrections made to this file during the walk:

1. **"the attendee line" updates on save** — it cannot. `AttendeeControls` never renders
   `confirmed_attendance`, so there is nothing there to change. The line now checks the three
   refetches instead, which is what is actually observable.
2. **The tile date format** was written as `Sat, 2 Jan 2027` style. `ReportTile` renders
   `Aug 25, 2026` — no weekday. That is visits-c's shared format, unchanged by this slice.
3. **Added a check that "Say how it went" appears only on writable events**, because scenario 056
   found it does not. This scenario seeds only Young Men activities and cannot reach the bug; the
   check is recorded here so the two scenarios agree.

Not walked: every "needs a human eye" line — those are the review questions, with screenshots in
`walk-youth-d/`. Also not re-walked: clearing the private note to delete it, which is covered by
`tests/routes/youthPrivateNote.test.ts`.

## Notes

- **Why the cancelled event is still in the schedule.** A cancelled game can be reinstated, so it
  stays on the list, marked. What must be true is only that it never asks for a follow-up — and
  that rule lives in `lib/youth/followUp.ts`, which tests `cancelled` **before** it consults the
  clock, so it holds at every distance rather than on the day the test was written.
- **"Past" is the START instant.** This schema has no duration column, so a game that kicked off an
  hour ago already asks for a follow-up. That is a known limitation, named in both
  `lib/youth/followUp.ts` and `lib/youth/coverage.ts`, and not a bug to raise.
- **The tile's date is the ward's day, not yours.** `occurredOn` is a property of the event and
  must be the same string for every reader, so it is computed in `wards.settings.timezone`. If you
  are testing from a different zone, a 7:30pm game still shows the ward's date — that is correct.
- The notification bell in the header is an inert placeholder until Phase 11
  (`components/layout/NotificationBell.tsx` says so in its first line). Read the `notifications`
  table instead.
