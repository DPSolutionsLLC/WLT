---
name: A sweep, partly reached, and goal history
scope: visits
part: 1
tags: [visits, full, ITER-055]
prerequisites: Migration 102 applied; Visits released for the Harness Test Ward.
---

## Purpose

ITER-055 slice **bv4**. A visit goal is now one of two kinds: **Visit every household once** (a
*sweep*, with a finish line) or **Keep visiting on a schedule** (the cadence every goal was
before). A goal can be **ended** as *Completed* or *Set aside*. It is never deleted: it moves to
the **Past goals** tab, with its numbers worked out again as of the day it ended. Only one goal per
organization can be active.

The **Bishopric** is back in the Organization picker. Its progress now counts the bishopric's own
visits (stored with no organization), so it no longer reads "never visited" for everyone.

Two rules worth seeing:
- Only visits **on or after the sweep's start** count.
- **Once done, done for this sweep.** A later "still needs a visit" shows on the card but does not
  undo it (decided with the user at bv4 start).

## Seed Data

Dates are relative to the day the scenario is seeded.

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | bishop (Mark Andersen), 1st counselor (Aaron Pike) |
| Ended goal | Bishopric, *Every household every year* — cadence, started 200 days ago, **set aside 40 days ago** |
| Active goal | Bishopric, *See every family by spring* — **sweep, started 30 days ago** |
| Abbott | Done 25 days ago, then **partly reached 5 days ago — asked us to come back** |
| Brooks, Carver, Dalton | Done in the sweep |
| Ellis | Partly reached — **spouse absent** |
| Foster | Partly reached — **someone wasn't home** |
| Garcia | An **attempt** only |
| Ivers | Done **45 days ago**, before the sweep started |
| Hughes, Jensen | Nothing |

All Bishopric visits are stored with no organization. The addresses sit on three streets plus one
blank, for bv8.

## Steps

1. Sign in as the **bishop**, open **Visits**, **Households** tab.
2. Read the banner and the cards.
3. Press **Visit goal**.
4. Press **Edit**, then **Cancel**. Press **End goal**, then **Keep it**.
5. Open the **Past goals** tab.
6. Back on **Households**, press **Visit goal**, then **End goal** → **Completed**.
7. Open **Past goals** again.
8. On **Households**, press **Visit goal** → **Set a goal**, choose **Visit every household once**,
   and save.
9. As the **1st counselor**, open **Visits** and press **Visit goal**.
10. Repeat steps 1–2 and 5 at **375px** wide, in light and dark.

## Verification Checklist

- [ ] Step 1: the **Organization** picker lists **Bishopric first** and opens on it
- [ ] Step 2: the banner reads **Every household once, from {30 days ago}.** and
      **4 of 10 done · 2 partly reached · 4 not yet.**, with Not yet / Partly reached / Done tiles
- [ ] Step 2: cards are ordered **Not yet** (Garcia, Hughes, Ivers, Jensen), then **Partly reached**
      (Ellis, Foster), then **Done** (Abbott, Brooks, Carver, Dalton)
- [ ] Step 2: **Ivers** reads *Not yet* and *Not yet visited in this sweep.* even though it shows a
      last visit 45 days ago
- [ ] Step 2: **Garcia** reads *Not yet* with *1 attempt since*
- [ ] Step 2: **Ellis** reads *Partly reached* and **Partly reached {date} — spouse absent**;
      **Foster** names **someone wasn't home**
- [ ] Step 2: **Abbott** reads **Done**, *Done in this sweep · {25 days ago}*, and still shows
      **Partly reached {5 days ago} — asked us to come back** below
- [ ] Step 2: no card has a **Cadence** button
- [ ] Step 3: the window lists only the active sweep, *Bishopric · Every household once, from
      {date}*, and says **End the current goal to set a new one.** instead of *Set a goal*
- [ ] Step 4: the edit form shows the kind chosen and greyed out, a **Starts** date, and no
      *Visit every* / *Start warning* fields, and **no End goal button** while editing (101-D1).
      After Cancel, End goal shows *How did this goal end? It stays on the
      Past goals tab with its numbers.* with **Completed**, **Set aside** and **Keep it**
- [ ] Step 5: **Past goals** lists **Bishopric · Every household every year**, *Every year ·
      {200 days ago} to {40 days ago} · Set aside*, and **10% on track (1 of 10)**
- [ ] Step 6: the goal window reads **No active goal. Ended goals are on the Past goals tab.**
- [ ] Step 6: the banner changes to *No visit goal is set for this organization.* and the
      `visit_goals` row for the sweep now has `ended_at` and `end_reason = completed` (read back
      from the database). An audit row `visit_goal_ended` names the goal
- [ ] Step 7: the sweep is listed first, *Every household once · … · Completed*, with
      **4 of 10 done · 2 partly reached · 4 not yet**
- [ ] Step 8: the new goal saves, starts **today** (the ward's date) and the banner reads
      **0 of 10 done · 0 partly reached · 10 not yet** — none of the earlier visits count
- [ ] Step 9: the counselor sees the same active goal and the same *End the current goal…*
      sentence (bishopric authority is shared)
- [ ] Step 10 (375px): the five tabs scroll sideways rather than wrapping; the three banner tiles
      wrap cleanly; the goal window's radio rows are at least 44px tall

## Edge Cases

- A second active goal is refused by the database too (migration 102's index); covered by
  `tests/rls/visit-goals-history.test.ts` rather than by hand.
- **All orgs** shows no sweep organization as a steward: a sweep has no band to put on a chip.
  This is a known limit of bv4, not a defect.

## Walkthrough record

**2026-11-10, driven by Claude** (Playwright, against the dev server and the hosted database; the
user reviews screenshots on the review page). Seeded on 2026-11-10, so the sweep started Oct 11,
2026 and the set-aside goal ran Apr 24 → Oct 1, 2026. Sign-in used the browser's saved login with
only the email changed, so the harness password never entered the transcript.

Observed (every write read back with the service role):
- Steps 1–2: picker `Bishopric, Elders Quorum, Primary, Relief Society, Sunday School, Young Men,
  Young Women`, opening on Bishopric. Banner "Every household once, from Oct 11, 2026." and
  "4 of 10 done · 2 partly reached · 4 not yet.". Order Garcia, Hughes, Ivers, Jensen / Ellis,
  Foster / Abbott, Brooks, Carver, Dalton. Ivers "Last visited Sep 26, 2026". Garcia "1 attempt
  since". Abbott "Done in this sweep · Oct 16, 2026" plus "Partly reached Nov 5, 2026 — asked us to
  come back". No Cadence button.
- Step 4: kind radios disabled (sweep checked), Starts `2026-10-11`, radio rows 44px tall. Keep it
  left the row unchanged (read back).
- Step 5: "Every year · Apr 24, 2026 to Oct 1, 2026 · Set aside", "10% on track (1 of 10)".
- Step 6: `ended_at 2026-11-10T07:30:35.485Z`, `end_reason completed`. Audit `visit_goal_ended`
  `{visitGoalId, orgId, kind: "sweep", endReason: "completed"}`.
- Step 7: the completed sweep is listed first, "Every household once · Oct 11, 2026 to Nov 10, 2026 ·
  Completed", "4 of 10 done · 2 partly reached · 4 not yet".
- Step 8: new sweep stored with `started_on 2026-11-10`, cadence null. Audit `visit_goal_created`
  with `kind: "sweep"`. Banner "0 of 10 done · 0 partly reached · 10 not yet.".
- Step 9: counselor-1 sees the same goal and "End the current goal to set a new one.".
- Step 10 (reseeded first): tabs on one line (overflow-x auto, 420px of content in 328px), page
  360px ≤ 375px, banner tiles wrap 2 + 1. Light and dark captured.

Found:
- **101-D1:** End goal stays live while the edit form is open, so the end question and the edit
  form show together (Visit goal → Edit → End goal). Nothing is written wrongly.
- After a goal ends, the window still says "No visit goals yet." (an older sentence that bv4 made
  untrue).
- Questions for the user: Done cards repeat the date under Last visited; tiles wrap 2 + 1 at
  375px; the bright tab scroll bar in dark mode (from bv2).

No checklist corrections were needed. Screenshots are in `review-shots/s101-*.png`.

**User review, 2026-11-10:** fix 101-D1 (End goal is now hidden while editing, and pressing Edit
closes an open end question). Take the empty-state wording, which now reads "No active goal. Ended
goals are on the Past goals tab." for the bishopric and "No active goal." for anyone without that
tab. Keep the repeated date on Done cards. The 2 + 1 tile wrap, the dark tab scroll bar and the Past
goals line all look fine. Both fixes are covered in `tests/components/visits/VisitGoalPanel.test.tsx`
and were not re-walked in the browser. The checklist items for steps 4 and 6 above were updated to
match.
