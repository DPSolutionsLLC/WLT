---
name: Partly reached, and a call that did not connect
scope: visits
part: 1
tags: [visits, full, ITER-055]
prerequisites: Migration 101 applied; Visits released for the Harness Test Ward.
---

## Purpose

ITER-055 slice **bv3**. Recording a visit now has three answers — **Visited**, **Visited — still
needs a visit** (with a reason) and **Attempted** — and each household card has a **Contact**
window with tap-to-call phone numbers, a way to log a call that did not connect, and a way on to
scheduling.

The rule worth seeing: a visit that **still needs a visit does not reset the household's clock**.
The band stays where it was and a "Partly reached" line says why. A phone call is only ever an
attempt.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | bishop (Mark Andersen), EQ president (Miguel Cortez) |
| Goal | Elders Quorum: every 6 months, 1 month's notice |
| Abernathy | Done 2026-09-01. Grace has a phone |
| Bellamy | Done 2026-05-15, then **partly reached 2026-10-25 — spouse absent** |
| Carver | Never done; **partly reached 2026-10-28 — someone wasn't home** |
| Dunmore | A **phone call, no answer**, 2026-10-30. Paul and Ivy both have phones |
| Eastwood | Never visited, **no phone on file** |

## Steps

1. Sign in as the **EQ president**, open **Visits**, **Households** tab.
2. Press **Contact** on **Dunmore**.
3. Choose **Left a message** under *How the call went*, type `Will try again Sunday` in the shared
   notes, press **Record the call**. Close the window.
4. Press **Contact** on **Eastwood**.
5. Press **Contact** on **Carver**, then **Schedule an appointment**.
6. Close it. Press **Log visit** on **Abernathy**, choose **Visited — still needs a visit**, and
   press **Log visit** without choosing a reason.
7. Choose **Asked us to come back**, press **Log visit**. Close the window.
8. Open the **Feed** tab.
9. Sign in as the **bishop**, open **Visits**, **All orgs** tab.
10. Repeat steps 1–2 at **375px** wide, in light and dark.

## Verification Checklist

- [x] Step 1: **Bellamy** reads *Approaching* (*Overdue* after 2026-11-15), *Last visited May 15,
      2026*, and **Partly reached Oct 25, 2026 — spouse absent** in the attention colour
- [x] Step 1: **Carver** reads *Never visited* and **Partly reached Oct 28, 2026 — someone wasn't
      home**
- [x] Step 1: **Dunmore** reads *Never visited* and *1 attempt since*; no "Partly reached" line
- [x] Step 1: every card has a **Contact** button beside **Log visit** and **Cadence**
- [x] Step 2: the window is titled **Contact — Dunmore** and lists **Paul Dunmore (801) 555-0104**
      and **Ivy Dunmore +1 801 555 0114**, each a link to `tel:8015550104` / `tel:+18015550114`
- [x] Step 3: "Call recorded as an attempt." appears; Dunmore now reads *2 attempts since*
- [x] Step 3: the new row in `visit_logs` has `visit_type = phone`, `outcome = attempted`,
      `attempt_detail = left_message`, the note as shared notes (read back from the database)
- [x] Step 4: **No phone number on file for the Eastwood household.** — and the call form is
      still offered
- [x] Step 5: the **Appointments** window opens with **Carver** already chosen
- [x] Step 6: "Choose why the household still needs a visit." and nothing is saved
- [x] Step 7: "Visit logged. The household stays on the list as partly reached."; Abernathy still
      reads *Last visited Sep 1, 2026* and now **Partly reached {today} — asked us to come back**;
      its band did not change
- [x] Step 8: the feed tiles read **Visited — still needs a visit · Asked us to come back** for
      Abernathy and **Attempted by phone · Left a message** for Dunmore; the earlier done visit to
      Abernathy carries no outcome label
- [x] Step 9: on **All orgs**, Bellamy's last visit is **May 15, 2026**, not October 25, followed by
      **Last attempted Oct 25, 2026**; Carver reads **Never visited · Last attempted Oct 28, 2026**;
      Dunmore **Never visited · Last attempted {today}** (the call in step 3); Eastwood plain
      **Never visited** (decided walking this scenario: this page names the newest attempt, not
      "partly reached")
- [x] Step 10 (375px): the three buttons fit on each card's title line or wrap cleanly under the
      name, and the Contact window's phone rows are at least 44px tall

## Edge Cases

- A phone call recorded as a done visit is refused with *"A phone call is recorded as a contact
  attempt…"*, and an edit that would turn one into a done visit is too — automated in
  `tests/routes/visits.test.ts` ("visit outcomes (migration 101)"), together with the database
  CHECKs themselves.
- A reason sent with an attempt, or how-it-went sent with a done visit, is refused with a sentence
  — `tests/lib/visitValidation.test.ts`.
- A phone number too short to dial (fewer than 7 digits) is left off the list rather than shown as
  a broken link — `tests/components/visits/ContactPanel.test.tsx`.

## Walkthrough record

### 2026-11-09 — driven by the agent (Playwright, `/walk`), screenshots for the user's review

Local dev server on :3000 against the hosted project; seeded fresh. Every write was read back
with the service-role client, not from the screen. Screenshots in `review-shots/scenario-100/`
(git-excluded).

**Passed, with observed values**
- Step 1: Carver *Never visited* + "Partly reached Oct 28, 2026 — someone wasn't home";
  Dunmore *Never visited* + "1 attempt since", no partly line; Bellamy *Approaching*, "Due Nov 15,
  2026", "Last visited May 15, 2026", "Partly reached Oct 25, 2026 — spouse absent"; Abernathy
  *On track*, "Last visited Sep 1, 2026". Partly lines `text-warning` = rgb(180, 83, 9) light,
  rgb(251, 191, 36) dark. Every card: Contact · Log visit · Cadence. No console errors.
- Step 2: window "Contact — Dunmore"; links `tel:+18015550114` (Ivy, listed first) and
  `tel:8015550104` (Paul); each row 44px tall.
- Step 3: "Call recorded as an attempt."; card "2 attempts since". Row: `visit_date 2026-11-09`,
  `visit_type phone`, `outcome attempted`, `attempt_detail left_message`, shared notes
  "Will try again Sunday", recorded by Miguel. Audit `visit_logged` with ids and field values only.
- Step 4: "No phone number on file for the Eastwood household.", 0 `tel:` links, call form offered.
- Step 6: "Choose why the household still needs a visit."; window stayed open; no row written.
- Step 7: "Visit logged. The household stays on the list as partly reached."; row
  `completed`, `needs_another_visit true`, `needs_another_reason asked_to_return`; audit row
  written. Card still *On track*, "Last visited Sep 1, 2026", plus "Partly reached Nov 9, 2026 —
  asked us to come back".
- Step 8: Abernathy tile "Visited — still needs a visit · Asked us to come back"; Dunmore tile
  "Attempted by phone · Left a message"; the Sep 1 done visit carries no outcome label.
- Step 9 (bishop, All orgs): Bellamy last seen "May 15, 2026"; Abernathy "Sep 1, 2026".
- Step 10 (375px, light and dark): no horizontal overflow; the three buttons wrap onto one row
  under the name, each 44px tall; Contact phone rows 44 × 343px.

**FAILED — defect 100-D1: Step 5.** *Schedule an appointment* closes the Contact window and the
Appointments window never opens (reproduced three times; no window open for 1s afterwards).
Cause: `onSchedule` switches `openWindow` from `contact` to `appointments` in one state change;
`Modal` then calls `dialog.close()` on the Contact dialog, whose native `close` event fires
afterwards and runs its `onClose` → `setOpenWindow(null)`, wiping the Appointments window.

**Defect 100-D2 (wording):** Recent visits on the Households tab reads "Phone call · Dropped in ·
Attempted by phone" for every call. `arrangement` is NOT NULL with only `appointment`/`drop_in`,
and `ContactPanel` sends `drop_in`, so a call always claims somebody dropped in.

**Not a bv3 defect, noted:** the Log a visit window shows its heading twice (Modal title + the
form's own `<h2>`) — present since bv2.

**Checklist corrections:** none. Step 5 describes a reachable state; the app failed it.

### 2026-11-09 (later) — re-walk after the fixes, driven by the agent

The user chose to fix both defects before committing bv3.
- **100-D1 fixed.** Each window in `HouseholdsPanel` now closes only itself
  (`closeWindow(kind)` leaves a window that has already replaced it alone). Step 5 re-walked:
  Contact on Carver → Schedule an appointment → **Appointments** open for 1s straight, Household
  **Carver** chosen; Escape still closes it. `tests/components/visits/HouseholdsPanel.test.tsx`
  fakes a dialog that fires `close` after closing, as a browser does; it fails with the old
  one-line close and passes with the fix.
- **100-D2 fixed.** Recent visits shows no arrangement for a phone call: "2026-11-09 · Phone call ·
  Attempted by phone · Left a message"; in-home rows still read "In-home visit · Dropped in · …".
  Not unit-tested — `RecentVisits` lives in the page file, which cannot export it; proven on the walk.
- No console errors. **All 14 checklist items now pass.**

### 2026-11-09 (later still) — the user's answers to the review questions

- **Q1 (no phone on file, call form still offered):** keep it.
- **Q2 (All orgs showed Carver as "Never visited"):** name the newest attempt instead of "partly
  reached". Built and step 9 re-walked as the bishop, desktop and 375px, no overflow:
  Carver "Never visited · Last attempted Oct 28, 2026"; Dunmore "Never visited · Last attempted
  Nov 9, 2026"; Eastwood "Never visited"; Bellamy "May 15, 2026 · Elders Quorum · Nobody recorded
  as visiting · Last attempted Oct 25, 2026"; Abernathy "Sep 1, 2026 · … · Last attempted Nov 9,
  2026". Step 9's check rewritten to match.
- **Q3 (feed outcome lines), Q4 (375px, both themes):** look good.

## Notes

- The call form records the call as made **today** by the person signed in; there is no date
  field, because a call is logged as it is made.
- Contact and Log visit are absent on a **do-not-contact** household; none is seeded here.
