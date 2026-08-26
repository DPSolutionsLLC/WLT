# Plan: Visits B — Progress Dashboard and Household Status

**Created:** 2026-08-25
**Type:** feature
**Structure:** Sequential — plan 2 of 3 for Phase 7 ([07-visits.md](07-visits.md))
**Depends on:** `visits-a` ([visits-a-goals-logs-and-notes.md](visits-a-goals-logs-and-notes.md))
and `visits-d`
([visits-d-attempts-appointments-and-participants.md](visits-d-attempts-appointments-and-participants.md)),
both built. This plan adds the dashboard to `app/(app)/visits/page.tsx` and reads the goals and
logs their data layers create.

**`/visits` IS NO LONGER A PLACEHOLDER — read §The page already has three panels before Task 4.**
This plan was written when the page held a plain list and a form. `visits-d` added two more
panels, one of which is the only way to log a visit at all.

---

## Overview

Turn `/visits` into the progress dashboard: a sortable per-organization list of households
with a computed visit status, and a progress banner whose denominator is correct.

Phase 7 §Step 4.

### Key requirements

1. `lib/visits/householdStatus.ts` — a pure function returning `Visited`, `Due Soon`,
   `Overdue`, `Attempted, Never Reached` or `Not Yet Visited`.
2. A sortable list: household name, last visited, **last attempted**, visit count this period,
   status, **conducted by**.
3. A progress banner — "X of Y households visited — Z remaining" — where **Y excludes
   moved-out and do-not-contact households**.
4. `GET /api/visits/progress` returns the dashboard summary.
5. Map view stays **out**. See §Deferred.

### Success criteria

- All five statuses correct at their boundaries, proven by a table-driven test.
- An `attempted` visit is VISIBLE on its household's row and counts towards nothing, proven by
  test.
- A household whose members have all moved out is absent from the denominator, proven by
  test.
- `npm run lint`, `typecheck`, `test` and `build` all pass.

---

## The denominator trap — read this first

This is the one genuinely dangerous line in this slice, and the codebase is laid out so that
the obvious approach is wrong.

**`listHouseholds()` returns every household in the ward**, including one whose members have
all moved out. It filters *members*, not households — [lib/roster/queries.ts](../lib/roster/queries.ts#L342)
says so explicitly, and that behavior is deliberate (roster-b Decision 4: the household count
must not move underneath someone applying a category filter).

So this is wrong:

```ts
const total = households.length;          // ← counts moved-out households
```

and this is right:

```ts
// DEFAULT_MEMBER_STATUSES is ["active"], so `members` already excludes moved_out AND
// do_not_contact. A household with none left is not a household this org can visit.
const visitable = households.filter((household) => household.members.length > 0);
const total = visitable.length;
```

`DEFAULT_MEMBER_STATUSES` in that same file names *"a visit-goal denominator"* as its reason
for existing. Reuse the default — pass no `statuses` option — rather than re-deriving a
status list here.

§Pitfalls of the phase file: *"Counting moved-out households makes every org look behind and
erodes trust in the number."*

**`visits-a` already shipped this filter** in `app/(app)/visits/page.tsx`, found by walking
scenario 038: the household picker filters on `members.length > 0` and carries the reasoning
in a comment. **The dashboard denominator must match it exactly.** Two places computing "which
households can this org visit" that disagree is worse than either being wrong on its own — a
household offered in the picker but absent from the denominator, or the reverse, is a progress
number nobody can reconcile against the list beside it.

---

## What `visits-d` changed underneath this plan

`visits-d` shipped BEFORE this slice and changed what a visit is. Three consequences, all of
them load-bearing here:

1. **`visit_logs.outcome` is `completed` or `attempted`.** An attempt is a first-class record: a
   leader knocked and got no answer. **It counts towards nothing.** `lastVisitedOn` and
   `visitCountThisPeriod` must both filter `outcome = 'completed'`, or a ward that cannot catch a
   family at home will read as having visited them.

2. **An attempt must still be VISIBLE.** The whole reason attempts are recorded is that a
   household nobody can catch at home should stop being invisible. So the dashboard row carries
   `lastAttemptedOn` as its own column, and `householdStatus()` gains a fifth state —
   *attempted, never reached* — for a household with attempts in the period and no completed
   visit. Filtering attempts out of the numbers without surfacing them somewhere would make the
   feature pointless.

3. **`visit_logs.visited_by` is gone.** It was replaced by `recorded_by` (who typed it in) plus
   the `visit_participants` table (who actually went). The dashboard's `loggedBy` column becomes
   **`conductedBy`**, built from `VisitLogWithContext.conductedByLabel` — which is **null when
   nobody is recorded as having gone**, and must render as words rather than falling back to the
   recorder. Read `lib/visits/participants.ts` before building this column.

---

## Relevant Files

### Create

- `lib/visits/householdStatus.ts` — the pure status function. **Client-importable.**
- `lib/visits/progress.ts` — assembles the dashboard rows and the banner totals.
- `app/api/visits/progress/route.ts` — `GET`.
- `app/(app)/visits/VisitProgressTable.tsx` — `"use client"`. Sortable table.
- `app/(app)/visits/VisitProgressBanner.tsx` — the X-of-Y banner.
- `tests/lib/householdStatus.test.ts` — `household-status`.
- `tests/lib/visitProgress.test.ts` — `progress-denominator`.
- `tests/routes/visitsProgress.test.ts` — route auth and org scoping.
- `testing/scenarios/scenario-040-*`

### Modify

- `app/(app)/visits/page.tsx` — ADD the dashboard and REPLACE only the "Recent visits" list.
  Three other panels stay; see §The page already has three panels.
- `types/domain.ts` — `HouseholdVisitStatus` and `HOUSEHOLD_VISIT_STATUS_LABELS`.
- `lib/visits/queries.ts` — add `listVisitLogsForPeriod()` if the progress read needs a shape
  `visits-a` did not provide. Extend; do not restructure.

---

## Dependencies

No new libraries.

- `listHouseholds()` — [lib/roster/queries.ts](../lib/roster/queries.ts). Pass **no**
  `statuses` option so the `["active"]` default applies.
- `addMonths`, `formatDateOnly`, `parseDateOnly` — [lib/calendar/dates.ts](../lib/calendar/dates.ts).
- `lib/visits/queries.ts`, `lib/validation/visit.ts` — from `visits-a`, including the
  cadence→months map (`annual: 12`, `biannual: 6`).
- `assertCan`, `resolveRoleAccess`, `requireSessionUser`, `respondToRouteError`.

---

## Known Pitfalls (from retro context)

- **[roster-b / this plan's §Denominator trap]** — `listHouseholds()` counts households the
  org cannot visit. Filter on `members.length > 0`.
- **[talks-d]** — **`goalStatus()` needed a fourth parameter the plan did not anticipate.**
  "Never visited counts as overdue once the interval has passed" is unanswerable from a null
  last-visit date alone — a goal created this morning and one created three years ago look
  identical. `householdStatus()` has the same hole, and §Task 1 closes it with
  `goalPeriodStart` as the anchor.
- **[talks-d]** — **`asOf` must be a parameter, never `new Date()` inside the function.**
  That is what makes the function testable at its boundaries and what let the calendar render
  per-Sunday statuses. Same rule here.
- **[talks-d]** — **Compute on read; never trust a status column.** `goals.status` is a cache
  nothing in the UI reads. There is no status column on `visit_logs` and none should be added.
- **[talks-d]** — **A formatter's correctness is a property of its context.**
  `formatSundayLabel()` renders no year, which was right on a calendar and a bug in a
  multi-year history table. A "last visited" column spans years — use a formatter that
  renders one.
- **[talks-d]** — **Client-only state the server renders around is a flash, not a detail.**
  Measured at 268 ms unthrottled and 3.8 s at 20x CPU. If the banner gets a dismiss control,
  put the value in a **cookie** so the Server Component decides. Do not reach for
  `localStorage`.
- **[route-tests-and-realtime]** — **Order any query you then index into**, and **never run
  `npm run seed` while the suite runs**.
- **[roster-b]** — a sort/filter param the handler does not read is silently ignored, not an
  error. Parse with Zod using the exact names the table sends.

---

## Tasks

### Task 1: `lib/visits/householdStatus.ts`

**File:** create

**Action:** The pure status function. Model it closely on
[lib/goals/goalStatus.ts](../lib/goals/goalStatus.ts) — same shape, same reasoning, same
`DUE_SOON_FRACTION`.

**Details:**

```ts
export const DUE_SOON_FRACTION = 0.8;

export function householdVisitStatus(
  lastVisitedOn: string | null,   // date-only
  cadenceMonths: number,
  asOf: Date,
  goalPeriodStart: string,        // date-only — the anchor when never visited
): HouseholdVisitStatus
```

Rules, in evaluation order:

| Status | Condition |
|---|---|
| `attempted_never_reached` | No COMPLETED visit in the period, but at least one **attempt** |
| `not_yet_visited` | No completed visit and no attempt **within the current goal period** |
| `overdue` | `asOf >= addMonths(anchor, cadenceMonths)` |
| `due_soon` | `elapsed / interval >= 0.8` |
| `visited` | Otherwise — visited within the period and not yet due |

- **`lastVisitedOn` and every count are `outcome = 'completed'` ONLY** (§What `visits-d`
  changed). The signature therefore takes `lastAttemptedOn` as well, and
  `attempted_never_reached` is evaluated FIRST — it is the more specific statement about a
  household than "not yet visited", and it is the one that tells a leader to try something other
  than knocking again.

- **`goalPeriodStart` is the fourth parameter and it is not optional.** It is the anchor when
  `lastVisitedOn` is null. Without it, a goal that started last week and one that started two
  years ago produce the same answer for a never-visited household — exactly the hole
  `talks-d` found in `goalStatus()` and closed with `createdAt`.
- **Day-level throughout.** Compare date-only strings via `formatDateOnly` / `parseDateOnly`,
  as `goalStatus()` does. Do not compare `timestamptz` milliseconds.
- **Guard `interval <= 0`** — a zero or negative cadence cannot divide. Return `overdue`, the
  honest reading of an interval that has already elapsed. `lib/validation/visit.ts` refuses
  such a goal, so this only reaches you from a row written outside it.
- **A date before the anchor** (clock skew) comes out negative and reads as `visited`. Correct
  — nothing is due yet.
- **Add the client-importable header** that `goalStatus.ts` and `reliabilityFlags.ts` carry:
  this file imports types and date helpers only. One import of `lib/visits/queries.ts` would
  pull `next/headers` into the client bundle and break the table.

### Task 2: `lib/visits/progress.ts`

**File:** create

**Action:** Assemble the dashboard rows and the banner totals. Server-side.

**Details:**

- `buildVisitProgress({ households, logs, goal, asOf })` — **a pure function taking already
  fetched data**, so `tests/lib/visitProgress.test.ts` needs no database. A thin
  `readVisitProgress(wardId, orgId, client)` does the fetching and calls it.
- Denominator: `households.filter((h) => h.members.length > 0)` — §The denominator trap.
- Per row: `householdId`, `familyName`, `lastVisitedOn`, `lastAttemptedOn`,
  `visitCountThisPeriod`, `attemptCountThisPeriod`, `status`, `conductedBy` (the
  `conductedByLabel` from the most recent COMPLETED visit in the period).
- **Every visit number filters `outcome = 'completed'`.** `lastVisitedOn`, `visitCountThisPeriod`
  and `visitedCount` all exclude attempts; `lastAttemptedOn` and `attemptCountThisPeriod` are
  the only fields that see them. An attempt folded into a visit count is a ward being told it
  reached a family it did not.
- **`conductedBy` is NULL when nobody is recorded as having gone**, and the column renders
  "Nobody recorded" rather than the recorder's name. `visits-d` split those two roles precisely
  so this column cannot quietly credit the wrong person.
- **`visitCountThisPeriod` counts only logs inside `[goalPeriodStart, goalPeriodEnd]`**, but
  `lastVisitedOn` is the most recent visit **of all time** — a leader wants to know a family
  was last seen fourteen months ago, not that the count is zero. The status uses the period;
  the column shows the truth. Comment the distinction.
- Banner totals: `visitedCount` = rows with status `visited`, `total` = the filtered
  denominator, `remaining` = `total - visitedCount`.
- **No goal configured** → return rows with a `null` status and a banner of `null`, and let
  the page render "No visit goal set for this organization" with a link to the goal panel.
  Do not invent a default cadence; a made-up denominator is worse than an absent one.

### Task 3: `GET /api/visits/progress`

**File:** `app/api/visits/progress/route.ts` (create)

**Details:**

- `assertCan(user, "visits.view", roleAccess)`.
- Accepts an optional `orgId`. Default it from the session: bishopric → require it or return
  a per-org breakdown; org leadership → their own `user.orgId`, ignoring any other value in
  the query string. **A caller cannot name another org's progress into existence** — RLS
  would return no logs anyway, and returning an empty dashboard for another org is a
  confusing way to say "not yours".
- Session resolved **outside** the `try` — `requireSessionUser()` redirects by throwing.
- No audit row: this is a read.

## The page already has three panels

**This plan used to say "replace the placeholder body", and that was wrong by the time anyone
would have read it.** It was written on 2026-08-25 against a `/visits` that held one goal panel,
one form and one flat list; the wording has been corrected wherever it appeared, and this section
is why. `visits-d` shipped the same day and left the page carrying **four** things:

| Panel | Came from | What this plan does with it |
|---|---|---|
| `VisitGoalPanel` | `visits-a` | **Keep.** Task 5 moves it above the banner |
| `AppointmentPanel` | `visits-d` | **Keep.** Untouched by this plan |
| `VisitLogForm` | `visits-a`, extended by `visits-d` | **Keep.** See the warning below |
| "Recent visits" `<ul>` | `visits-a` | **This is the only thing the dashboard replaces** |

**`VisitLogForm` IS THE ONLY WAY TO LOG A VISIT.** Deleting or orphaning it while "replacing the
placeholder body" would leave a module that reports progress against visits nobody can record.
It also carries state this plan must not disturb:

- the outcome and arrangement controls, and the `Who went` participants field;
- a `key` on the component in `page.tsx`, which is load-bearing — it remounts the form when
  `?appointment=` changes, and without it the appointment prefill silently stops working
  (`plans/retros/visits-d-attempts-appointments-and-participants.md`);
- `appointment={appointmentPrefill}`, resolved from the query parameter by
  `lib/visits/appointmentLink.ts`.

**`AppointmentPanel` reads `?appointment=` too**, via the same module. Any change to how
`page.tsx` handles `searchParams` has to keep both halves of that protocol working — and the
constant must keep coming from `appointmentLink.ts`, never from the panel, because a value
imported from a `"use client"` module reaches a Server Component as a client-reference proxy
rather than as a string. That cost this feature a silent dead flow once already.

### Order on the page

Progress first, because the dashboard is what a president opens `/visits` to see:

1. Progress banner + dashboard table
2. `VisitGoalPanel` (Task 5 — the cadence driving the numbers sits beside them)
3. `AppointmentPanel`
4. `VisitLogForm`

Four stacked panels is a lot for one screen, and at 375px it is a long scroll. **Raise tabs or a
split before building rather than after, rather than deciding it silently by stacking.**
`visits-c` then adds a tab across to `/visits/feed` from this same page, so whatever navigation
shape you land on has to hold that too — it is cheaper to choose it once, here, than to retrofit
it around four panels that were stacked because nobody stopped.

---

### Task 4: The dashboard UI

**Files:** `app/(app)/visits/page.tsx` (modify), `VisitProgressTable.tsx`,
`VisitProgressBanner.tsx` (create)

**Details:**

- `page.tsx` stays a Server Component: session, `resolveRoleAccess` once, `can()` not
  `assertCan()` (a `ForbiddenError` escaping a Server Component becomes a 500 whose message
  Next strips in production — `auth-b`), `NotPermitted` otherwise. It fetches the initial
  progress payload and seeds the client component, following
  [app/(app)/goals/page.tsx](<../app/(app)/goals/page.tsx>).
- `VisitProgressTable` is `"use client"` with TanStack Query, seeded from the server payload
  and refetching on sort/org change — the `GoalBoard` pattern.
- Sortable on every column. Sorting is **client-side over the already fetched rows**; the
  dashboard is one org's households, not a paginated set.
- Status renders as a `Badge`-style pill with a distinct treatment per status, `dark:`
  variants included. Colour alone must not carry the meaning — keep the text label.
  **There is a working precedent to copy:** `AppointmentPanel`'s state badges follow
  `components/assignments/StageBadge.tsx` and add a MARK as well as a colour
  (`○ Scheduled`, `✓ Kept`, `✕ Cancelled`, `! Missed`), so they separate in greyscale. That
  shape was reviewed by the user and chosen over a bare coloured line, which did not stand out.
- The "last visited" column uses a formatter **that renders the year** (§Known Pitfalls).
  **`AppointmentPanel.formatScheduledFor` currently does NOT** — a 2099 appointment renders
  identically to a 2026 one, recorded as an open minor defect in `visits-d`'s walkthrough. One
  shared formatter closes both; put it somewhere `AppointmentPanel` can import it.
- Mobile-first: the table collapses to stacked cards at small widths, as the roster does.
- The org switcher appears only for the bishopric.

### Task 5: Wire the goal panel to the dashboard

**File:** `app/(app)/visits/page.tsx` (modify)

**Details:** `VisitGoalPanel` from `visits-a` moves above the banner, so the cadence driving
the statuses is visible next to them. Editing a goal invalidates the progress query. No new
route.

---

## Testing Strategy

### `tests/lib/householdStatus.test.ts` — `household-status`
Table-driven, pure, no database. **Assert at the boundaries, not in the middle of the range** —
this is the whole point of taking `asOf` as a parameter.

For a 12-month cadence anchored at `2026-01-01`:

| `asOf` | Expected | Why |
|---|---|---|
| `2026-01-01` | `visited` | day of visit |
| `2026-10-21` | `visited` | 0.799 of the interval |
| `2026-10-22` | `due_soon` | crosses 0.8 exactly |
| `2026-12-31` | `due_soon` | one day short |
| `2027-01-01` | `overdue` | interval elapsed exactly |

Plus: never-visited anchors on `goalPeriodStart`; a never-visited household inside a
just-started period is `not_yet_visited` rather than `overdue`; `cadenceMonths` of 0 and -1
return `overdue`; an `asOf` before the anchor returns `visited`; `biannual` (6) and a custom
cadence each produce their own boundary.

### `tests/lib/visitProgress.test.ts` — `progress-denominator`
Pure, against hand-built fixtures. The single most important assertion in this slice:

- A household whose members are all `moved_out` → **absent from `total`**.
- A household whose members are all `do_not_contact` → **absent from `total`**.
- A household with one active and two moved-out members → **present, counted once**.
- A household with zero members at all → absent.
- `remaining === total - visitedCount`, on every fixture.
- `visitCountThisPeriod` ignores a log dated before `goalPeriodStart`, while
  `lastVisitedOn` still reports it.
- No goal → `null` banner, no invented cadence.

### `tests/routes/visitsProgress.test.ts`
Via `tests/helpers/routeClient.ts`.

- Org president gets their own org's progress; passing another org's `orgId` does not return
  that org's data.
- Bishop can read any org.
- `org_secretary` gets 200 — they hold `visits.view`. **Check the matrix before asserting a
  403.**
- A role without `visits.view` (`ward_secretary`, `music_coordinator`) gets 403.

---

## Test Scenarios (Harness)

Numbering assumes `visits-a` took 038 and 039. **Verify against
`testing/scenarios/manifest.json` before writing** — `talks-d` recorded exactly this
collision.

### Scenario 040: The dashboard and its denominator
**Tags:** `visits`, `smoke`, `dashboard`
**Purpose:** Every status boundary and the moved-out exclusion need a household sitting at a
precise distance from a precise goal start. That is unreasonable to arrange by hand and is
exactly what the numbers on this page depend on.
**Seed data summary:**
- `organizations` — 2 — Elders Quorum, Relief Society
- `users` — 3 — bishop, EQ president, RS president
- `visit_goals` — 1 — EQ, `all_households`, annual, period started 10 months ago
- `households` — 7:
  - 2 visited inside the period → `Visited`
  - 1 visited at 82% of the cadence → `Due Soon`
  - 1 visited 13 months ago → `Overdue`
  - 1 never visited → `Not Yet Visited`
  - 1 **all members `moved_out`** → must not appear in the denominator
  - 1 **all members `do_not_contact`** → must not appear in the denominator
- `visit_logs` — 5, dated to land each household on its status

**Tester action:** Log in as the EQ president and open `/visits`. Sort by each column. Then
log in as the bishop and switch organizations.
**Verification checklist:**
- [ ] The banner reads "3 of 5 households visited — 2 remaining" (not 7)
- [ ] Each of the four statuses appears on the household seeded for it
- [ ] The moved-out and do-not-contact households are absent from the list and the count
- [ ] "Last visited" shows a **year** on the 13-month-old visit
- [ ] Sorting by status groups rather than scrambling; sorting by last-visited puts
      never-visited at one end consistently
- [ ] The RS president sees the RS dashboard, not the EQ one
- [ ] The RS org, which has no goal, shows "no goal set" rather than a zero denominator
- [ ] Dark mode: status pills stay distinguishable, and not by colour alone
- [ ] At 375 px width the table is readable

---

## Deferred — do not build in this slice

- **Map view.** FEATURES.md §Module 9 marks it optional and CLAUDE.md §9 records that **no
  geocoding provider is chosen**. `households.latitude` / `longitude` exist and are null.
  §Step 4: build the list first, and put the map behind a toggle that hides itself when
  coordinates are absent. That toggle is not in scope here — the list is.
- **The `visit_overdue` notification.** §Step 4 asks for a nightly emit when a household
  crosses into overdue, once per household per period rather than nightly. **There is nowhere
  to run it.** This project has no `supabase/functions/` directory and **`pg_cron` is not
  enabled** — `talks-d` recorded the same blocker for `refresh_goal_status()`. The trigger is
  seeded and fires from nothing today.

  This slice makes overdue *computable* (`householdVisitStatus`), which is the prerequisite.
  Choosing the mechanism — Vercel Cron hitting an authenticated route, a Supabase Edge
  Function, or enabling `pg_cron` — is a real decision with hosting consequences, and it is
  not the dashboard's to make. **Raise it before starting `visits-c`;** if the answer is
  Vercel Cron, the emit is a small follow-up slice rather than part of the feed.

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm run harness:typecheck

# Do NOT run `npm run seed` concurrently — same hosted ward
npm run test

npm run build
```

No migration in this slice, so no `db:push` / `db:types`.

---

## Integration Notes

- **No schema change.** Everything reads tables `visits-a` and Phase 0 already established.
- **`visits-c` reuses `householdVisitStatus`** for nothing, but **Phase 8 will** — youth
  activity coverage has the same "due/overdue against a cadence" shape. Keep the function
  free of visit-specific vocabulary in its parameter names where that costs nothing.
- **Open question inherited from `visits-a`, still unanswered:**
  `visit_goals_select` has **no cross-org branch** while `visit_logs_select` does
  ([019_rls.sql](../supabase/migrations/019_rls.sql) L358 vs L379). With cross-org visibility
  on, a leader reads another org's logs but **not the goal that supplies the denominator for
  them**. So a cross-org progress view cannot compute "X of Y" today.

  This slice sidesteps it by scoping the dashboard to one org at a time — the bishopric
  switches orgs and reads each org's own goal, which RLS allows. **If `visits-c` puts a
  cross-org summary on the feed, this must be settled first**, and settling it means either
  adding `or ward_allows_cross_org_visibility()` to `visit_goals_select` in a new migration,
  or accepting that cross-org readers see logs without progress. Do not add the policy branch
  speculatively here.
- **Documentation:** record any deviation from the status table in the retro `/execute`
  generates, particularly if `householdVisitStatus` grows a fifth parameter the way
  `goalStatus()` did.
