---
id: music-collapsed-list-and-rolling-year
type: feature
iter: null
commits: ["5e9ff0c", "a5d1e72"]
date: 2026-09-23
files:
  - lib/calendar/queries.ts
  - app/(app)/calendar/page.tsx
  - lib/music/sundayWindow.ts
  - app/(app)/music/page.tsx
  - app/(app)/music/MusicSundayList.tsx
  - app/(app)/music/SundayMusicCard.tsx
  - components/layout/ContextualBackLink.tsx
  - lib/sacrament/sundayStatus.ts
related:
  - p4-sacrament-music-month
  - p4-sacrament-a-hub-and-reskin
  - calendar-c-rotation-cadence
  - calendar-b-month-view
  - roster-b-picker-and-orgs
  - p3-shell-and-tile-dashboard
fixes: p4-sacrament-music-month
---

## What was done

Two independent slices with one root cause — **a Sunday that does not exist yet.** Slice 1 gives
the calendar a **rolling 12-month horizon** (`ensureHorizonGenerated()`), so every Sunday-keyed
module can reach a date a year out without the round trip through `/calendar` a user had to make
before. Slice 2 **reverses `06910f8`**: `/music` goes back to a rolling list, now the prototype's
**collapsed list of 8 Sundays you click into**, with the jumped-to Sunday **inserted in date
order** — which is the prototype's own fix for defect 072-D1 and the reason a month board is not
needed. `components/layout/ContextualBackLink.tsx` is the first of the ~17 contextual back links
module-map §6.3 catalogues.

## Key decisions

- **GENERATE AND NEVER REPAIR, and that split is the whole design.** `ensureMonthGenerated()` does
  two jobs and its repair passes are month-scoped for reasons that do not survive a wider range:
  `needsFastSunday` asks *"does THIS MONTH have no Fast Sunday at all?"*, and over a year that is
  meaningless — a year always has one, so a genuinely half-generated month inside the range would
  test `false` and never be repaired. **Widening the range would silently disable the repair.** So
  the calendar page calls both, horizon first; two functions, two jobs, do not merge them. The
  coverage check (`head: true` count vs `sundaysInRange().length`) comes first and is what stops a
  read becoming a 52-row upsert on every page view — `calendar-c`'s bug class exactly.

- **THE REVERSAL WAS OF THE MECHANISM, NOT THE DIAGNOSIS.** `p4-sacrament-music-month` closed
  072-D1 correctly and shaped it wrong. Kept from it: `sundayPillHrefs()` in
  `lib/sacrament/sundayStatus.ts` (moving the href rule out of the page was right, and its tests
  stay), the `#sunday-<id>` anchor, and the two-empty-states insight. Gone: `MonthNavigation` on
  `/music`, `parseMonthParam` there, the month range, and `?month=` — now dead and **ignored
  silently, with a comment saying so**, because `roster-b`'s rule is that a quietly ignored
  parameter is a trap for the next reader.

- **SINGLE-OPEN, AND NO "EXPAND ALL" — module-map §6.1's rule is `single-open ⇔ jump target`.**
  `openSundayId` is **one value, never a `Set`**: a `Set` on a page somebody is deep-linked into
  loses the answer to "which one did I come here for". The user asked for **Collapse all** while
  reviewing the walk and said of the other half *"I don't know if you'd ever want to expand all"* —
  which is right, and the asymmetry is now written down so it is not "completed" later.

- **The query parameter and the fragment are not redundant.** `?sunday=` OPENS the card;
  `#sunday-<id>` SCROLLS to it with no JavaScript. Dropping either leaves half a jump. `?sunday=`
  is resolved in **its own query**, not looked for in the window's range, because a Sunday a year
  out is the case it exists for.

- **NO ORIGIN MEANS NO BACK LINK — changed by the user after the walk.** It first shipped with the
  prototype's "Back to Dashboard" fallback, and the walk showed the result: WLT's chrome bar
  already carries an **unconditional** `← Dashboard`, so a page reached from the navigation
  rendered **two stacked back links to the same place**. The prototype needs its fallback because
  its global link is broken; WLT's is not, which is the same fact that makes a per-page link safe
  at all. `from` resolves through an **allowlist held in a `Map`** — a plain object returns a
  truthy `Object.prototype.toString` for `?from=toString` and the link renders `href={undefined}`.

- **Two things deferred on purpose, recorded rather than missed.** The prototype's `Topics pending`
  dimmed card and its `Draft`/`Pending approval`/`Approved` workflow pill are **P4 slice `b`'s**:
  there is no `topics_finalized` anywhere in WLT, and `decisions.md` §1.15 says finalize is *"a
  conductor's deliberate click, **not** derived from every slot happening to have a topic"* — so
  inferring it would tell a coordinator the topics were settled when nobody had said so.

## What the walk found that the tests could not

3,879 passing tests, `lint`, `typecheck` and `build` all green, and **none of them could see any
of the following.** No test in this repo imports the Music page, which is the gap the plan
declares on purpose — the walk is the instrument for it.

1. **072-D3 — the horizon costs ~14 s EVERY MONTH, not once. OPEN, and accepted after measurement.**
   The plan asked for the first run to be measured; it is 8,996 ms against a 2,720 ms baseline. But
   the interesting number is the **roll-forward**: deleting one month from inside the horizon —
   exactly the state the window moving on the 1st leaves it in — costs **14,216 ms**, which is
   **slower than starting from nothing**. `ensureHorizonGenerated()` regenerates the *whole* range
   when the count falls short; the four missing inserts are cheap, but `resolveMonth()` then runs
   for all twelve months and the two conducting passes sweep the whole year against a fuller table.
   **The contained fix is to generate only the MISSING months** and is deliberately NOT applied —
   the user accepted the cost once the shape was clear: it falls on one `calendar.manage` holder,
   once a month, and nothing else can trigger it (**there is no DELETE route for `sundays` and
   nothing in app code deletes one**, so the monthly roll is the only way the count can fall short).
   Do not "fix" this by shrinking the horizon.

2. **An empty-state ordering bug, found while writing the page rather than by a test.** Branching on
   `sundays.length === 0` first hides a jumped-to card whenever the near window is empty — which is
   scenario 072's seed exactly. `entries.length > 0` is tested **first**, and that ordering is
   load-bearing.

3. **`key={openSundayId}` on the list.** `initialOpenSundayId` is a `useState` INITIAL value, so
   arriving at `?sunday=A` then `?sunday=B` without leaving the route would render B's entries with
   A still open — 072-D1's symptom from a different cause.

4. **Two checklist defects, both written from the plan rather than from the running app.** The
   horizon assertion asked for `date > current_date` ≥ 50 and **would have failed a correct build**:
   the horizon runs in whole months from `monthStart(today)`, so it deliberately includes this
   month's past Sundays (52 total, 49 future) — and the whole-month shape is precisely what makes
   the coverage arithmetic exact. And **scenario 072 cannot test the `calendar.manage` gate at all**:
   its only non-manager is an `org_president` holding *neither* calendar permission, so `/calendar`
   refuses them one gate earlier and writes nothing for the wrong reason. Moved to scenario 036,
   which seeds the `music_coordinator` that is the exact fixture.

## Pattern

**A deep link is two halves, and this is the second time that sentence has been the lesson on this
exact feature** — `p4-sacrament-music-month`'s "Pattern" section said it, and was still right when
its own mechanism was reversed. The href was never the hard part; the DESTINATION honouring it is.
Both times the unit tests were green on the half they could see.

The new half: **a green suite says nothing about a page no test imports.** The three real bugs in
this work — the empty-state order, the `key`, and the 14-second roll-forward — all lived in
`app/(app)/music/page.tsx` and `app/(app)/calendar/page.tsx`, and two were found by writing
carefully while the third needed a stopwatch and a deliberately damaged database. When a plan
declares "no page-render test, deliberately", it is also declaring which findings can only come
from a walk.
