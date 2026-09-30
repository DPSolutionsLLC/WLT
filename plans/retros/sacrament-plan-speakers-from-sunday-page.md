---
id: sacrament-plan-speakers-from-sunday-page
type: bugfix
iter: null
commits: ["722523f"]
date: 2026-09-28
files:
  - app/(app)/assignments/[sunday_id]/page.tsx
  - app/(app)/assignments/SundaySlotList.tsx
  - app/(app)/assignments/AssignmentEditButton.tsx
  - app/(app)/sacrament/page.tsx
related: [music-collapsed-list-and-rolling-year, talks-b-month-planner, sacrament-topics-t3-the-screen]
fixes: p4-sacrament-a-hub-and-reskin
---

*Written 2026-09-30, after the fact, from the commit and scenario 082's walk record. The page
this fixed was replaced one day later by the Topics screen (`sacrament-topics-t3-the-screen`); the
hub half survives.*

## What was broken
The Sacrament hub had replaced the Talks tile, but it was a dead end in two places.
1. Its Talks pill opened `/assignments/[sunday_id]`, which listed only existing talks. It told the
   reader to plan from the month view and gave no link there.
2. The hub showed no upcoming Sundays at all until somebody had opened `/calendar`.

## Root cause
When the hub claimed the front door to planning, the pages behind it kept their old roles.
`/assignments/[sunday_id]` was a read-out of the month planner, not a place to plan. The hub was
deliberately "reads only", for fear of racing `/calendar`'s generation. That fear was unfounded:
`sundays` is unique on `(ward_id, date)` and generation inserts with `ignoreDuplicates`.

## What fixed it
1. The Sunday page lists **every slot**. Filled slots keep their card and Edit; open ones read
   "Slot N — open" with **Plan**, which opens the month planner's own window. A talk outside the
   slots is listed after them rather than dropped.
2. The hub runs `ensureHorizonGenerated()` + `ensureMonthGenerated()` under the same
   `calendar.manage` gate as `/calendar`, reversing its "reads only" rule. It inherits defect
   072-D3 (about 14s on the first visit of each month), which was accepted knowingly.
3. `tests/components/assignments/SundaySlotList.test.tsx`. Scenario 082 was walked in the
   browser: a reader without `calendar.manage` generates nothing and sees no buttons.

## Pattern
When a page becomes the front door, walk every door behind it as a first-time user would. Each
destination was correct for how it used to be reached, and wrong for the new way in.
