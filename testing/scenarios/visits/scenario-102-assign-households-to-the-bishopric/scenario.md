---
name: Assign households to the bishopric
scope: visits
part: 1
tags: [visits, todos, full, ITER-055]
prerequisites: Migrations 103 and 104 applied; Visits released for the Harness Test Ward.
---

## Purpose

ITER-055 slice **bv5**. The bishopric divides its households among the bishop and the two
counselors. Assigning a household puts **Visit the ___ family** on that person's **To Do**. That
to-do has **no checkbox** and cannot be removed while open. It closes itself:

- when anyone in the bishopric records a **finished** visit to the household ("Visited."),
- when the household is **reassigned** ("Reassigned to …") or **unassigned**,
- when the bishopric **ends the goal**, completed or set aside ("The visit goal ended").

A visit that **still needs a visit** keeps the to-do open and adds a line naming the reason. An
Elders Quorum visit does **not** close the Bishopric's assignment, because it doesn't count toward the
Bishopric's goal either. Each member has a **My visits** tab, and the progress shows each person's
share ("Bishop 0 of 3 · 1st Counselor …").

Decided with the user at bv5 start: assigning needs an active Bishopric goal; only a finished
Bishopric visit closes an assignment; ending a goal closes every open assignment either way.

**bv6 (Part 2 below)** adds companions and invites. Booking a visit can bring companions along: a
leader with an account is **invited** and accepts or declines, while a roster member or a typed name
is just **recorded**. **Schedule** on a *Visit the ___ family* to-do books a real visit appointment
for that assignment, so the visit shows once on My Appointments. Pending invites appear at the top of
**My Appointments**, above the tabs on **Visits**, and in the bell. Decided at bv6 start: any ward
leader can be invited; an invite is answered once, while pending; cancelling or rescheduling notifies
nobody.

## Seed Data

Dates are relative to the day the scenario is seeded.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | bishop (Mark Andersen), 1st counselor (Aaron Pike), 2nd counselor (Lena Ortiz), Elders Quorum president (Tom Reyes) |
| Active goal | Bishopric, *See every family by spring* — **sweep, started 30 days ago** |
| Households | Abbott, Brooks, Carver, Dalton, Ellis, Foster, Garcia, Hughes — one adult each, phone 555-0100 |
| Ellis | **Already assigned to the 2nd counselor**, with *Visit the Ellis family* open on their To Do and a visit they **scheduled for 3 days from now** |

## Steps

1. Sign in as the **bishop**, open **Visits**, **Households** tab (Bishopric selected).
2. Press **Assign**. Choose **2nd Counselor — Lena Ortiz**, tick Abbott, Brooks and Carver, press
   **Assign**.
3. Press **Assign** again. Choose **Bishop — Mark Andersen**, tick Dalton and Foster, press **Assign**.
4. Press **Assign**. Choose **1st Counselor — Aaron Pike** and tick **Ellis**. Read the window, then
   press **Assign**.
5. Open **To Do**.
6. Sign in as the **2nd counselor**. Open **To Do**, then try to delete *Visit the Abbott family*.
7. Open **Visits** → **My visits**.
8. From the **Abbott** card press **Log visit** and record a finished visit.
9. From the **Brooks** card press **Log visit**, choose *Visited — still needs a visit*, reason
   **Spouse absent**, and save.
10. Open **To Do** and expand *Visit the Brooks family*.
11. Sign in as the **Elders Quorum president**. Open **Visits** and log a finished visit to **Carver**.
12. Sign back in as the **bishop**. Open **Visits** → **Households**, press **Assign**, tick **Carver**
    and press **Unassign 1 household**.
13. Press **Visit goal** → **End goal** → **Set aside**.
14. Repeat steps 1–2 and 7 at **375px** wide, in light and dark.

## Verification Checklist

- [ ] Step 1: an **Assign** button sits beside Appointments; the Ellis card reads **Assigned to 2nd
      Counselor**; under the banner **Bishop 0 of 0 · 1st Counselor 0 of 0 · 2nd Counselor 0 of 1**
- [ ] Step 1: the tabs are Households · **My visits** · Feed · All orgs · Past goals · Sharing
- [ ] Step 2: Abbott, Brooks and Carver read **Assigned to 2nd Counselor**; the line reads
      **2nd Counselor 0 of 4**. Three `visit_assignments` rows and three to-dos owned by the 2nd
      counselor, `assigned_by` = the bishop (read back). Audit `visit_households_assigned` carries ids
      and counts and no family name
- [ ] Step 3: the bishop's own two to-dos have `assigned_by` **null** (they assigned themselves)
- [ ] Step 4: with Ellis ticked the window says what **each** button does: **Assign gives Ellis to 1st
      Counselor**, *Ellis moves from 2nd Counselor, and their to-do closes*, the **scheduled visit by
      Lena Ortiz** **stays on their appointments**; and **Unassign 1 household gives Ellis back to
      nobody, and 2nd Counselor's to-do closes**
- [ ] Step 4: ticking **Garcia** as well adds *Garcia isn't assigned to anyone, so Unassign leaves it as
      it is* (untick it again before pressing Assign)
- [ ] Step 4: after Assign, the 2nd counselor's *Visit the Ellis family* is closed with
      `closed_reason = reassigned` and a line **Reassigned to Aaron Pike**; the 1st counselor has a new
      open one; the appointment row is unchanged (read back)
- [ ] Step 5: the bishop's To Do shows *Visit the Dalton family* and *Visit the Foster family* with a
      house icon, **no checkbox**, and an **Open visit** button that lands on **My visits**
- [ ] Step 6: deleting is refused with **This closes itself once a finished visit to this household
      is recorded…**, and the to-do is still there
- [ ] Step 7: **My visits** lists Abbott, Brooks and Carver only — not Ellis
- [ ] Step 8: Abbott leaves **My visits**; its to-do is closed with **Visited.**; the assignment ends
      `visited` (read back)
- [ ] Step 9: Brooks **stays** on My visits, marked **Partly reached**
- [ ] Step 10: the to-do is still open and its timeline ends **Visited — still needs a visit (Spouse
      absent)**
- [ ] Step 11: the Carver assignment is **still open** and its to-do still open (read back) — another
      organization's visit does not count for the Bishopric
- [ ] Step 12: Carver no longer reads *Assigned to …*; its to-do closed with `closed_reason =
      unassigned` and the line **No longer assigned to anyone**
- [ ] Step 13: after **End goal** the window adds *4 households are still assigned. Ending the goal
      closes their 4 "Visit the ___ family" to-dos.*
- [ ] Step 13: every open assignment (Brooks, Dalton, Foster, Ellis) ends `goal_ended`, each to-do
      closes with **The visit goal ended**; Assign disappears and My visits reads *The bishopric has no
      visit goal right now…*
- [ ] Step 13: the Elders Quorum president never saw **Assign**, **My visits** or the share line
- [ ] Step 14 (375px): six tabs scroll sideways rather than wrapping; the Assign window's household
      rows are at least 44px tall and the warning box wraps cleanly; the share line wraps without
      overflow

## Part 2 — companions and invites (bv6)

Reseed first (`npm run seed -- visits/scenario-102-assign-households-to-the-bishopric`), so Ellis is
the 2nd counselor's again.

### Steps

15. Sign in as the **2nd counselor**. Open **To Do** and press the calendar button on *Visit the
    Ellis family*.
16. Give a day next week and **7:30 PM**. Under **Going with you**, choose **A leader → Aaron Pike**
    and **A leader → Tom Reyes**, then **Someone else → "Sister Ortiz"**. Press **Book visit**.
17. Open **My Appointments**.
18. Sign in as the **1st counselor**. Open **My Appointments**, then **Visits**. (The bell is a
    placeholder until P12, so the notification is read back from the database rather than looked at.)
19. On the invite press **Accept**. Look at My Appointments again.
20. Sign in as the **Elders Quorum president**. Open **Visits** and press **Decline** on the invite.
21. Sign back in as the **2nd counselor**. Open **To Do**, expand *Visit the Ellis family*, then open
    **My Appointments**.
22. Repeat steps 15–16 and 19 at **375px**, in light and dark. Ellis is booked now, so the calendar
    button asks first: press **Book another**.
23. Back at full width as the **2nd counselor**, press the calendar button on *Visit the Ellis family*
    once more and press **Keep just that one**.

### Verification Checklist

- [ ] Step 15: the window is titled **Book this visit**, names *The Ellis family* rather than offering a
      household list, and the **A leader** list starts with the bishopric (Mark Andersen, Aaron Pike)
      and does not include Lena Ortiz
- [ ] Step 16: the window **stays open** reading *Visit booked. 2 invites have been sent.* with a
      **Done** button that closes it (defect 102-D1). One `visit_appointments` row with
      `assignment_id` = the Ellis assignment and `scheduled_for` = **7:30 PM in the ward's zone**
      (read back); three `visit_appointment_companions` rows — Aaron and Tom `pending`, "Sister Ortiz"
      with status null. Audit `appointment_booked` has `invitedCount: 2`,
      `recordedCompanionCount: 1` and no names
- [ ] Step 16: the to-do now reads **Visit booked {day}, 7:30 PM**, its first chip is **Upcoming**
      rather than *Someday* (defect 102-D3), and it still has no checkbox
- [ ] Step 17: the visit appears **once**, reading *With Aaron Pike (invited), Tom Reyes (invited),
      Sister Ortiz*. There is no invite panel for the 2nd counselor
- [ ] Step 18: a `visit_companion_invited` notification row for Aaron and for Tom reads *Visit invite —
      Lena Ortiz invited you to visit the Ellis family on …* (ward-zone time; read back — the bell has no
      feed until P12); **My Appointments** and **Visits** both show *A visit invite* above the list or
      tabs, with Accept and Decline
- [ ] Step 19: the panel is gone; the visit is on Aaron's My Appointments, reading *With Lena Ortiz*,
      with **no Cancel button**; the row is `accepted` with `responded_at` set (read back)
- [ ] Step 20: the panel is gone. The Elders Quorum president cannot see the Ellis appointment (read back
      through their own session: zero rows). That the invite never opens the visit log is
      `tests/rls/visit-companions.test.ts`'s job — this seed has no visit logs, so a hand check of it
      could not fail
- [ ] Step 21: the timeline ends **Tom Reyes can't come**; My Appointments reads *With Aaron Pike
      (coming), Tom Reyes (can't come), Sister Ortiz*
- [ ] Step 17 and 21: companions read leaders first, then everyone else, each A to Z, whatever order
      they were picked in (defect 102-D2)
- [ ] Step 22 (375px): **Book another visit?** names the booked visit in the ward's time and says it
      stays; **Book another** opens *Book this visit*, which does not close by itself. The Day and Time
      fields share a row; the companion chips wrap; Accept and Decline fit beside the invite text or
      wrap below it, with 44px targets and no page overflow
- [ ] Step 22: the to-do names the **soonest** booking and adds *· and 1 more booked*; both visits stay
      on My Appointments
- [ ] Step 23: **Keep just that one** closes the question and books nothing (no new
      `visit_appointments` row)

## Edge Cases

- Assigning with no active goal is a 409 with a sentence; assigning to someone outside the
  bishopric or another ward is a 400; a household from another ward is a 400. Covered by
  `tests/routes/visitAssignments.test.ts` rather than by hand.
- No authenticated client can write `visit_assignments`, the bishop included:
  `tests/rls/visit-assignments.test.ts`.
- Inviting yourself, inviting a leader from another ward, answering somebody else's invite (404),
  answering twice (409) and booking for an assignment from outside the bishopric (403):
  `tests/routes/visitInvites.test.ts`. An invite never shows a companion another appointment or the
  visit log: `tests/rls/visit-companions.test.ts`.

## Walkthrough record

**2026-11-11 (evening, ward zone; 00:1x UTC on the 12th). Driven by Claude** in Playwright against
the local dev server, signed in through the real login form as `bishop`, `counselor-2` and
`eq-president`. Every write was read back with the service-role client
(`testing/infrastructure/walkReadback.ts`, git-excluded). Screenshots are in
`review-shots/scenario-102/`, and five judgement questions went to the user on one review page.
**The user reviewed the screenshots and answered all five** (below).

Observed values:

- Step 1: the tabs are `Households · My visits · Feed · All orgs · Past goals · Sharing`; Assign
  sits after `Appointments · 1`; Ellis reads `Assigned to 2nd Counselor`; the share line is
  `Bishop 0 of 0 · 1st Counselor 0 of 0 · 2nd Counselor 0 of 1`.
- Step 2: POST 201 `{assignedCount: 3, reassignedCount: 0}`; share line `2nd Counselor 0 of 4`;
  3 open rows to Lena, by Mark; 3 to-dos with `assigned_by` = Mark and a `visit_assigned` line;
  audit `visit_households_assigned` holds orgId, goalId, assignedTo, assignmentIds and counts only.
- Step 3: Dalton and Foster to-dos have `assigned_by` null. Save 5.5s; the page caught up about
  4.3s after the window closed (dev server).
- Step 4: the warning reads "1 household moves from somebody else. / Ellis — from 2nd Counselor /
  Ellis has a visit scheduled by Lena Ortiz. It stays on their appointments." POST 201
  `{assignedCount: 1, reassignedCount: 1}`. Lena's Ellis to-do closed `reassigned` with
  `visit_reassigned(Aaron Pike)`; Aaron has an open one; appointment `eda7fb90…` is unchanged
  (`scheduled`, made_by Lena, no visit_log_id).
- Step 5: the bishop's two visit to-dos have 0 checkboxes and `Open visit` →
  `/visits?tab=my_visits&from=todos`. They also show the ✕, which the server refuses (as music and
  Zoom do).
- Step 6: DELETE 409 "This closes itself once a finished visit to this household is recorded. To give
  it to somebody else, reassign the household on Visits."; the to-do is still listed.
- Step 7: My visits lists Abbott, Brooks and Carver.
- Step 8: POST /api/visits 201; Abbott left My visits about 5.4s later. Assignment `ENDED visited`;
  to-do closed with `closed_reason` null (the to-do did its job) and `source_completed(Visited.)`.
- Step 9: Brooks stays, reading "Partly reached Nov 12, 2026 — spouse absent"; the row has
  `needs_another_visit` true, reason `spouse_absent`.
- Step 10: the timeline is "Assigned to you" then "Visited — still needs a visit (Spouse absent)";
  the to-do is open.
- Step 11: the EQ president sees only Households · Feed, with no Assign, share line or "Assigned
  to"; `?tab=my_visits` falls back to Households. Their Carver visit was stored with the EQ
  `org_id`; the Carver assignment and to-do are still open.
- Step 12: PATCH 200; the assignment ended `unassigned`, the to-do closed `unassigned` with
  `visit_unassigned` ("No longer assigned to anyone"); audit `visit_household_unassigned` holds
  ids only. Share line `2nd Counselor 1 of 2`.
- Step 13: PATCH 200; Brooks, Dalton, Foster and Ellis(Aaron) ended `goal_ended`, and each to-do
  closed `goal_ended` with `visit_goal_ended`; the goal is `set_aside`. Assign and the share line
  are gone, and My visits reads "The bishopric has no visit goal right now, so no households are
  assigned."
- Step 14 (after a reseed, because step 13 had ended the goal): at 375px, in light and dark, page
  overflow is 0; the 6 tabs sit on one row and scroll (`overflow-x: auto`), each 44px; the share
  line wraps to 2 lines inside 328px; the Assign window's 8 household rows are 44px with nothing
  overflowing; My visits (counselor-2, Ellis) has 0 overflow and 44px buttons.

**Found, from before bv5:** `app/(app)/visits/page.tsx` sets the form's date with
`formatDateOnly(new Date())` (UTC), so from about 5pm in the ward's zone a visit logged "today" is
saved as tomorrow. Every visit in this walk was stored as 2026-11-12. Reported, not fixed.

No checklist corrections were needed. The user's answers to the five questions:

1. **Assign/Unassign warning — changed.** It was unclear what each button would do. The box now
   appears whenever a ticked household is held by anyone, and has one line per button, including
   that Unassign leaves a ticked household nobody holds as it is. The step 4 checks above were
   rewritten to match; this change has not been re-walked in the browser
   (`tests/components/visits/AssignWindow.test.tsx` covers the wording).
2. **"0 of 0" in the share line — fine as it is.**
3. **End goal — changed.** The confirmation now says how many assignment to-dos it will close (new
   step 13 check; `tests/components/visits/VisitGoalPanel.test.tsx`).
4. **Dark-mode tab scrollbar at 375px — acceptable as it is.**
5. **✕ on an open visit to-do — fine**, because pressing it explains why it is refused.

### Part 2 (bv6) — 2026-11-15 (evening, ward zone; ~06:00 UTC on the 16th)

**Driven by Claude** in Playwright against the local dev server, signed in through the real login
form as `counselor-2`, `counselor-1` and `eq-president`. Every write was read back with the
service-role client (`walkReadback.ts`, now with `companions` and `notes`); the Elders Quorum
president's view was read back through **their own** anon-key session. Screenshots:
`review-shots/scenario-102/bv6-*.png`. Browser console: 68 messages, 0 errors, 0 warnings. **The
user has not yet answered the judgement questions** (see the review page).

Observed values:

- Step 15: dialog "Book this visit"; "The Ellis family" with no household select; Day (`date`) and
  Time (`time`) inputs; leader options `Mark Andersen, Aaron Pike, Tom Reyes` (no Lena).
- Step 16: POST `/api/visit-appointments` 201. Appointment `b0ed049a…`, `assignment_id` = the Ellis
  assignment `07133185…`, `scheduled_for` `2026-11-21T02:30:00Z` (= Fri Nov 20, 7:30 PM Denver).
  Companions: Aaron `pending`, Tom `pending`, label "Sister Ortiz" status null. Audit
  `appointment_booked` `{invitedCount: 2, recordedCompanionCount: 1}` plus ids, no names. The to-do
  reads "Visit booked Fri, Nov 20, 2026, 7:30 PM", 0 checkboxes. **The success sentence was never
  shown (defect 102-D1).**
- Step 17: the new visit appears once (the other Ellis row, Wed 10:56 PM, is the seed's own
  appointment from before bv6, which has no `assignment_id`). It read *With Sister Ortiz, Tom Reyes
  (invited), Aaron Pike (invited)* — **not the checklist's order (defect 102-D2)**. No invite panel.
- Step 18: notification rows for Aaron and Tom: "Visit invite | Lena Ortiz invited you to visit the
  Ellis family on Fri, Nov 20, 2026, 7:30 PM. Open My Appointments to accept or decline." Both pages
  show "A visit invite — Lena Ortiz asked you to visit the Ellis family — Fri, Nov 20, 2026, 7:30 PM"
  with Accept / Decline; on My Appointments it sits above "Nothing scheduled."
- Step 19: POST `/api/visit-invites/…` 200 `{status: "accepted"}`; Aaron's row `accepted`,
  `responded_at 06:01:35Z`; audit `visit_invite_answered {accepted: true}` with ids. My Appointments
  (also after reload): "With Lena Ortiz", 0 Cancel buttons.
- Step 20: before, Tom's Visits showed the invite and `Appointments · 1`; Decline 200
  `{status: "declined"}`; after, no panel and `Appointments` with no count. Through Tom's session:
  Ellis appointment rows **0**, Bishopric visit logs 0 (none exist), his own companion row readable
  (`declined`).
- Step 21: the to-do's timeline is one line, "Nov 15, 11:02 PM — Tom Reyes can't come"
  (`visit_companion_declined(Tom Reyes)`); My Appointments reads *With Sister Ortiz, Tom Reyes
  (can't come), Aaron Pike (coming)*.
- Step 22 (375px): the booking window in light and dark (dark verified by body
  `rgb(27, 29, 31)` after a reload) — page and window overflow 0; Day `16,174×44` and Time
  `202,142×44` on one row; chips wrap to two rows; every button ≥ 44×44. Second booking Tue Nov 24,
  7:30 PM → `2026-11-25T02:30:00Z`, 201. The invite at 375px on both pages in both themes: text wraps,
  Accept 62×44 and Decline 65×44 below it, overflow 0. Accept 200; on Visits the panel took between
  2.5 s and 8 s to leave (dev server), and stayed gone after a reload.

Defects found (reported, not fixed):

- **102-D1 — the booking's success sentence is never seen.** `ScheduleVisitWindow` calls `onClose()`
  straight after `onBooked()` (`ScheduleVisitWindow.tsx` ~line 273), so the form's "Visit booked. 2
  invites have been sent." is set and unmounted in the same moment. Every caller of the window.
- **102-D2 — companions list in no meaningful order.** `listCompanionsForAppointments()` orders by
  `created_at, id`; one booking inserts every row in one statement, so the order is the random UUID
  order. Observed three different orders across two bookings.

Found and put to the user, not a defect against the plan:

- Schedule stays on a booked visit to-do, and a second booking **adds** an appointment rather than
  moving the first: the Ellis assignment now has two (Nov 20 and Nov 24), both on My Appointments,
  while the to-do names only the later one.

Checklist corrections made during this walk:

- Step 18 asked to look at the bell; the bell is a placeholder until P12
  (`components/layout/NotificationBell.tsx`), so the check now reads the notification row back.
- Step 20's "still sees no Bishopric visit log" could not fail — the Part 2 seed has no visit logs —
  and now points at `tests/rls/visit-companions.test.ts`, which proves it.

**The user's answers (2026-11-15):** D1 — keep the window open on the sentence with a Done button;
D2 — leaders first, then everyone else, each A to Z; a second booking — allowed, after a confirm;
"Someday" beside a booked visit — confusing, and on inspection a defect (**102-D3**: the to-do's
state read only its own dates, never the booked visit, which is 077-D2 by a second route); the
pending invite above "Nothing scheduled" and the 375px dark screens — fine as they are.

**Fixed, then re-walked by Claude the same evening** (Lena, full width, then 375px light and dark),
on the data the walk above left behind (Ellis booked Nov 20 and Nov 24):

- The card read **Upcoming** and "Visit booked Fri, Nov 20, 2026, 7:30 PM · and 1 more booked" —
  the SOONEST booking, where it had named the latest.
- The calendar opened **Book another visit?**: "The Ellis family already has a visit booked Fri, Nov
  20, 2026, 7:30 PM. Booking another keeps that one as it is." **Book another** opened *Book this
  visit*, which stayed open (100-D1 not repeated). Booked Fri Nov 27, 6:00 PM with Tom then Mark:
  201, stored `2026-11-28T01:00:00Z`; the window then read "Visit booked. 2 invites have been sent."
  with **Done**, which closed it (0 open dialogs). The card then read "· and 2 more booked".
- My Appointments: "With Aaron Pike (coming), Tom Reyes (can't come), Sister Ortiz", "With Aaron Pike
  (coming), Tom Reyes (invited), Sister Ortiz", "With Mark Andersen (invited), Tom Reyes (invited)".
- 375px, light and dark: the question window has 0 overflow; Close 62×44, Book another 121×44, Keep
  just that one 154×44.
- One console error during the re-walk, `compareCompanions is not defined`, came from the dev
  server compiling `lib/visits/companions.ts` between the edit that called it and the edit that
  imported it; four fresh page loads afterwards logged none.

- Step 23: **Keep just that one** was pressed at 375px in light and in dark; each closed the question,
  and the Ellis household still has exactly 4 `visit_appointments` rows (read back).
