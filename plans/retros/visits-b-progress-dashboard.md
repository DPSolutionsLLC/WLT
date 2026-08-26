---
id: visits-b-progress-dashboard
type: feature
iter: null
commits: ["b6c79f6"]
date: 2026-08-26
files:
  - lib/visits/householdStatus.ts
  - lib/visits/progress.ts
  - lib/visits/visitDates.ts
  - app/api/visits/progress/route.ts
  - app/(app)/visits/VisitProgressTable.tsx
  - app/(app)/visits/VisitProgressBanner.tsx
  - app/(app)/visits/CollapsibleSection.tsx
  - app/(app)/visits/page.tsx
  - app/(app)/visits/VisitLogForm.tsx
  - app/(app)/visits/VisitGoalPanel.tsx
  - app/(app)/visits/AppointmentPanel.tsx
  - types/domain.ts
related:
  - visits-a-goals-logs-and-notes
  - visits-d-attempts-appointments-and-participants
  - talks-d-reliability-goals
  - roster-b-picker-and-orgs
---

## What was done

`/visits` became the progress dashboard: a pure `householdVisitStatus()` with five states, a
`buildVisitProgress()` assembler whose denominator excludes households nobody can visit, a
`GET /api/visits/progress` scoped so a caller cannot name another organization's progress into
existence, and a sortable table that collapses to cards at phone width. No schema change.

The four panels the page had accumulated collapse under the dashboard rather than stacking, and
"Recent visits" was **kept** rather than replaced — it is the only place `VisitFlagButton`
renders, so deleting it would have taken `visits-a`'s ward-council flagging off the app until
`visits-c` ships the feed.

## Key decisions

- **The denominator is `members.length > 0`, and it is now one exported predicate.**
  `listHouseholds()` filters the members it *attaches*, not the households it *returns*, so a
  household whose people have all moved out arrives with `members: []`. `isVisitableHousehold()`
  is shared with the page's household picker, because two places computing "which households can
  this org visit" that disagree is worse than either being wrong alone.
- **"X of Y visited" means visited THIS PERIOD, not "rows whose status is `visited`"** — a
  deviation from the plan, which said the latter while its own scenario asked for the former. A
  household visited nine months into a twelve-month cadence reads `due_soon` and has still been
  reached; counting statuses would report a smaller number than the table directly underneath it
  plainly shows.
- **`conductedBy` describes the visit `lastVisitedOn` names**, not "the most recent completed
  visit in the period" as planned. A row reading *"last visited May 2025 · conducted by —"*
  contradicts itself, which is the same class of untruth `visits-d` removed when *"Visited by
  Miguel Cortez"* appeared under a row labelled "Attempted".
- **`attempted_never_reached` is evaluated first and anchored on the period**; every other number
  filters `outcome = 'completed'`. An attempt folded into a visit count tells a ward it reached a
  family it never got past the door of.
- **The plan's 80% boundary dates were a day or two out.** 80% of 365 is exactly 292, so the
  crossing is `anchor + 292 days`, not the dates the plan named. The test builds the boundary from
  the arithmetic the way `tests/lib/goalStatus.test.ts` does — transcribing the plan's dates would
  have been a boundary test quietly checking 80.3%.
- **Collapsed sections hide with `hidden`, not by unmounting.** `VisitLogForm` seeds its draft in
  a `useState` initializer, so unmounting on collapse would discard a half-typed visit note.
  Proven in the browser: 44 characters survived a collapse and re-expand byte-identical.

## What the walkthrough changed

Walking scenario 040 found two defects in this slice, both fixed and re-walked the same day:

1. **Logging a visit left the dashboard stale.** `router.refresh()` re-renders the Server
   Component but the table reads a TanStack query, and `initialData` is consulted only on first
   mount — so the headline number went stale on the most common action on the page. Fixed by
   invalidating `VISIT_PROGRESS_QUERY_KEY`, the pairing `VisitGoalPanel` already had.

   **The re-walk of that fix reported it still broken and was wrong.** The probe waited 3 s; the
   round trip takes ~3.7 s and the network response already held the correct payload. A short
   wait here reads exactly like a stale cache — worth knowing before anybody "fixes" it twice.

2. **The bishopric landed on Bishopric**, the one organization that will never carry household
   visit goals, so a bishop opened `/visits` on "No visit goal is set". An honest message on a
   useless default is still a useless default. Now defaults to the first organization that has a
   goal.

It also found that **there is no edit path for a visit goal anywhere in the app** — the
scenario's own step 8 assumed one that has never existed — and that the checklist had nothing
covering "logging a visit updates the dashboard", which is exactly the check defect 1 failed.

## The finding that became a redesign

A row can read **✓ Visited** while the banner counts it as not visited, whenever a goal period
starts after that household's last visit — so, at the start of every period. Raising it turned
the question from "which half do I change" into the user's answer that the `Visited` badge should
not exist at all: *"what is most valuable is knowing how close to being due it is."*

Captured as **ITER-018** rather than patched: rolling cadences with no dates, cadence in
days/weeks/months/years, editable goals, a per-household cadence override, a priority scale in
place of the five buckets, a statistics banner, and household-level do-not-contact (a genuine
schema gap — `do_not_contact` is a MEMBER status today). **The contradiction is still present in
this commit** and is expected to be dissolved by that work.

**Run ITER-018 after `visits-c` and before Phase 8** — Phase 8's youth-activity coverage is
documented here to reuse `householdVisitStatus`, so landing the redesign later leaves that module
built on the model this one already knows is wrong.
