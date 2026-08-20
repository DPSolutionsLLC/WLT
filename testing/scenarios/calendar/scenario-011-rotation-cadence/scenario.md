---
name: Monthly cadence and an organization rotation
scope: calendar-c-rotation-cadence
part: 1
tags: [calendar, full, rotation, permissions]
prerequisites: none
---

## Purpose

Two things no unit test can reach.

First, that switching the bishopric to monthly and then generating a month produces **one name
across every Sunday** — the visible shape of the requirement, and the thing scenario 010 revealed
was wrong. The rule itself is pinned by `tests/lib/rotationCadence.test.ts`; what a walkthrough
proves is that the control reads as a sentence a bishopric can set correctly without a plan in
front of them, and that the month they are already looking at does not silently re-shuffle.

Second, that an Elders Quorum president can manage their own rotation and is genuinely stopped —
**by RLS, from the browser console, not just by a hidden button** — from touching the sacrament
rotation or another organization's.

The permission boundary is the higher-risk half. This is the first org-scoped write in the app,
and a route that forgot its scope check would look completely normal on screen.

May 2026 has five Sundays and opens on a Friday, so the grid has leading blanks and the monthly
cadence has to hold across five Sundays rather than four — both cases scenario 010's March cannot
show.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) — holds everything |
| | `counselor1` (counselor, position 1, Peter Nakamura) and `counselor2` (counselor, position 2, Daniel Okafor) — rotation targets and notification recipients |
| | `eqpres` (org_president, Elders Quorum, Tomas Ruiz) — holds `calendar.manage_org_conducting` for **one** organization |
| | `eqcounselor` (org_counselor, Elders Quorum, Andre Whitfield) — the notification recipient |
| | `rspres` (org_president, Relief Society, Claire Bennett) — the other-org seat |
| | `secretary` (ward_secretary, Ruth Kaufman) — holds `calendar.manage` but **no** org rotation rights |
| Rotations | Bishopric, **weekly**, effective 2026-01-04: bishop → counselor1 → counselor2 |
| | Elders Quorum, **monthly**, effective 2026-01-04: eqpres → eqcounselor → *nobody* |
| Sundays | May 2026 generated: 05-03, 05-10, 05-17, 05-24, 05-31 |
| | 05-03 is `fast_sunday`, `speaking_slots = 0`; the rest `standard`, `speaking_slots = 3` |
| | Every May Sunday carries the `conducting_user_id` the weekly cycle produces |
| | **No** `sunday_org_conducting` rows — generating June is what creates them |
| Notification triggers | all, including `org_conducting_rotation_changed` |

**Sign in with:** `bishop@`, then `eqpres@`, `eqcounselor@`, `rspres@`, `secretary@` — all
`@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- calendar/scenario-011-rotation-cadence`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop`. Open `/calendar?month=2026-05` and read the whole month.
4. Open **Conducting rotation**. Read the cadence control and the forward-only sentence before
   touching anything.
5. Set the cadence to the monthly option, set Effective from to **2026-06-01**, and save.
6. Go back to `/calendar?month=2026-05` and read who conducts each Sunday.
7. Open `/calendar?month=2026-06`, then `/calendar?month=2026-07`.
8. Open **Elders Quorum conducting rotation** (the bishopric manages every organization's).
   Read it, then close it without saving.
9. Open a June Sunday's detail page and read the **Organization meetings** section.
10. Sign out. Sign in as `eqpres`. Open `/calendar?month=2026-06`.
11. Open the Elders Quorum rotation panel, reorder it, set Effective from to **2026-08-01**, save.
12. Open a June Sunday and change the Elders Quorum conductor. Save that one row.
13. Reload the month, then re-open that Sunday and the two Sundays either side.
14. Run the three refused writes from the browser console (see **Failure Behavior**).
15. Sign out. Sign in as `eqcounselor` and open the notification centre.
16. Sign out. Sign in as `rspres`, open `/calendar` and a June Sunday.
17. Sign out. Sign in as `secretary`, open `/calendar` and a June Sunday.
18. In the Supabase dashboard, read `notifications`, `audit_log` and `sunday_org_conducting`
    for this ward.

## Verification Checklist

Monthly cadence

- [ ] Every Sunday in a freshly opened month shows a conductor — **no month reads "Not set" on
      every row**, and every month has exactly one Fast Sunday (or none, if every Sunday is
      displaced). Both are the half-generated state `ensureMonthGenerated()` repairs; if
      re-opening the month does not fix it, say so
- [ ] The month you were looking at when you signed in keeps its **weekly** conductors after the
      switch — it was generated before the change. This is the forward-only rule, not a fault
- [ ] The cadence control reads as a **sentence** — "One person for the whole month" — not the
      bare word "Monthly"
- [ ] The forward-only sentence mentions the **cadence**, not just the order
- [ ] The position labels change with the cadence: "First month of the cycle", not "First Sunday
      of the cycle", once monthly is selected
- [ ] Switching to monthly effective 2026-06-01 leaves **May unchanged** — still a different
      conductor each Sunday: bishop, counselor1, counselor2, bishop, counselor1
- [ ] June's four Sundays (06-07, 06-14, 06-21, 06-28) all show the **same** conductor
- [ ] July's Sundays all show the **next** person in the order
- [ ] August's show the third
- [ ] Saving a second rotation on 2026-06-01 shows the server's message — "A sacrament meeting
      rotation already takes effect on 2026-06-01." — not a 500
- [ ] Saving a rotation effective **mid-month** (try 2026-09-16) governs the rest of September at
      position 1, and October at position 2

Organization rotation

- [ ] `bishop` sees an **Elders Quorum conducting rotation** panel beside the bishopric one
- [ ] `bishop` sees a **Relief Society** panel that says nobody in Relief Society has an account
      yet, rather than a form of empty selects
- [ ] `eqpres` sees an Elders Quorum rotation panel and **no** bishopric panel
- [ ] `eqpres` sees **no** Relief Society panel
- [ ] Saving the Elders Quorum rotation succeeds and says the rest of the presidency were notified
- [ ] `eqcounselor` receives an `org_conducting_rotation_changed` notification; `eqpres` does not;
      **the bishop does not**; **`rspres` does not**
- [ ] A June Sunday detail page has an **Organization meetings** section listing Elders Quorum and
      its conductor
- [ ] Relief Society is **absent** from that section — it has no rotation, so it has nothing to
      show
- [ ] The third rotation position is empty in the seed, so the third month reads **"Not set"** and
      never a raw uuid
- [ ] `eqpres` can override one Sunday's Elders Quorum conductor, one row at a time — there is no
      "save all" button
- [ ] Saving says the change is for that Sunday only and the rotation is unchanged
- [ ] That override survives re-opening the month, and the Sundays either side are **unchanged**
- [ ] Re-generating the month (open July, then come back) does **not** revert the override
- [ ] `rspres` sees the Elders Quorum conductor **read-only**, with no select and no Save button

Permissions — the half that matters

- [ ] `secretary` sees **no** organization rotation panel at all, and no Organization meetings
      select on a Sunday — the rows are read-only
- [ ] `eqpres` sees no Calendar settings input and cannot edit any Sunday's type or sacrament
      conductor
- [ ] `eqpres` PATCHing `/api/conducting-rotation` with `orgId: null` gets **403**
- [ ] `eqpres` PATCHing it with the **Relief Society** org id gets **403**
- [ ] `eqpres` PATCHing `/api/sundays/<id>/org-conducting` with the Relief Society org id gets
      **403**
- [ ] All three refused writes leave `audit_log` **untouched**
- [ ] With the route bypassed entirely, a direct PostgREST insert into `conducting_rotation` for
      another org from `eqpres`'s session is refused by **RLS** — this is the check that proves
      the boundary is the policy and not the route
- [ ] The same direct insert with `org_id: null` is refused too — this is the one migration 024's
      `org_id is not null` clause exists for

Reading the month

- [ ] May 2026 opens on a **Friday**, so the grid shows five leading blank cells before the 1st
- [ ] All five May Sundays appear, in the correct week rows
- [ ] At 375px the grid is replaced by a card list — no horizontal scrolling anywhere
- [ ] Dark mode: the cadence select, the Organization meetings rows and every badge are legible
- [ ] No cell or row anywhere shows a raw uuid
- [ ] The month grid is **unchanged** by this slice — no organization conducting appears in a
      Sunday cell or card

## Failure Behavior

Run these from the browser console while signed in as `eqpres`, substituting real ids from the
Supabase dashboard.

- [ ] The bishopric rotation through the route — **403**:
      `await (await fetch('/api/conducting-rotation', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: null, cadence: 'weekly', effectiveFrom: '2026-10-04', positions: [{ position: 1, userId: null }, { position: 2, userId: null }, { position: 3, userId: null }] }) })).json()`
- [ ] Another organization's rotation through the route — **403**:
      the same call with `orgId: '<relief society id>'`
- [ ] Another organization's Sunday conductor through the route — **403**:
      `await (await fetch('/api/sundays/<sunday id>/org-conducting', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId: '<relief society id>', userId: null }) })).json()`
- [ ] A Sunday id that does not exist — **404**, not 500
- [ ] `/calendar/sunday/<a uuid that does not exist>` renders the 404 page, not a 500
- [ ] Nothing appears in `audit_log` for any refused request

## Notes

**Steps 5 onwards change data.** `createSunday` and `createConductingRotation` use stable ids, so
re-seeding restores May and the two original rotations — but June, July and August, and every
rotation set you saved at a new effective date, are **not** in the seed and survive. Run
`npm run seed:clean` to clear the ward entirely, then re-seed.

**The current month is generated the moment you sign in, before you change anything.** Opening
`/calendar` lands on today's month and generates it immediately, under whatever rotation is
active at that instant. So the month you land on will keep the WEEKLY assignment even after you
switch to monthly — that is the forward-only rule, not a bug. Judge the cadence on months you
open AFTER saving the change. Expect exactly one odd month in the middle of the run.

**If a whole month reads "Not set", or a month has no Fast Sunday, that is a bug — report it.**
Generation writes the Sunday rows, resolves Fast Sunday, and assigns conductors in three separate
statements with no transaction around them, and Next.js prefetches the prev/next month links —
so a cancelled prefetch can abandon a month half-built. `ensureMonthGenerated()` now repairs both
on the next real view, so re-opening the month should be enough. If it is not, say so.

**Switching the cadence does not re-populate a month that is already generated, by design.** If
you generate June *before* switching to monthly, June keeps its weekly assignment and the switch
appears to have done nothing. That is the forward-only rule working exactly as the sentence
promises — `conducting_user_id` is stored, and `populateConducting()` only fills rows that are
still null (03-calendar.md Step 3). Generate June *after* the switch, as step 5 does. A
"re-apply the rotation to this month" action would fix the confusing case, and it is its own
decision about destroying overrides; `plans/calendar-c-rotation-cadence.md` records it as a known
gap rather than building it here.

**Why `secretary` and `rspres` are separate seats.** `calendar.manage` and
`calendar.manage_org_conducting` are two different gates, and "my own organization" is a third
narrowing on top of the second. Collapsing them into one account would hide the two most likely
wiring mistakes: a rotation panel a ward secretary can open, and a select an org president gets on
somebody else's organization.
