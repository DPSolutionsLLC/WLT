---
name: Assign households to the bishopric
scope: visits
part: 1
tags: [visits, todos, full, ITER-055]
prerequisites: Migration 103 applied; Visits released for the Harness Test Ward.
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

bv6 extends this scenario with companions and invites.

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

## Edge Cases

- Assigning with no active goal is a 409 with a sentence; assigning to someone outside the
  bishopric or another ward is a 400; a household from another ward is a 400. Covered by
  `tests/routes/visitAssignments.test.ts` rather than by hand.
- No authenticated client can write `visit_assignments`, the bishop included:
  `tests/rls/visit-assignments.test.ts`.

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
