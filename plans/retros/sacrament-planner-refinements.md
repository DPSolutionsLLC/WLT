---
id: sacrament-planner-refinements
type: feature
iter: [ITER-057, ITER-056, ITER-048, ITER-049, ITER-050]
commits: ["9853e5a"]
date: 2026-10-30
files:
  - lib/sacramentPlanner/assets/body.html
  - lib/sacramentPlanner/assets/extra.css
  - tests/helpers/plannerSlotRules.ts
  - CLAUDE.md
  - plans/sacrament-planner-adapter.md
related: [sacrament-planner-adapter]
---

## What was done
GROUP-04: five bishopric requests, built as edits G1–G5 to the Sacrament Planner's own imported
code. On a phone, Who's Next's selection panel no longer hides the last rows, folds to one line, and
gains **Place on Sunday**, which places every ticked person with one save. Fast & Testimony Sundays
start with no speaker slots, and a type switch adds or removes only empty slots. Pray About cards
show how full a Sunday is, warn instead of quietly adding a slot, offer + / − slots and **See the
month**. Calls gains a Past Sundays view that stays editable for 9 days after a Sunday.

## Key decisions
- Every new rule sits in one block of pure functions between two marker lines in `body.html`.
  `tests/helpers/plannerSlotRules.ts` slices that block out and runs it with `new Function`, so the
  rules are unit-tested without rendering the Planner and without a TypeScript copy that could drift.
- Pray About's Place and Who's Next's Place on Sunday share `placeIntoSlots`. Its `"warn"` result is
  the one place the "full Sunday" rule lives. A batch builds one document and writes it once, because
  looping single writes would let each overwrite the last before the realtime copy arrived.
- The 9-day lock and the empty-slot rules run in the browser like every other Planner rule (ITER-045
  D1). Every call action re-checks the lock at click time, so a screen left open overnight cannot
  edit a Sunday that has just locked. View state is per device under `planner:` keys (D1).

## Walk
Scenario 096 was walked by Claude on 2026-10-30 (Playwright, every write read back from
`planner_documents`); the user accepted it. Three cosmetic defects were left open: an empty slot reads
"Open Open" in the new pop-ups, a Sunday with no speaking slots says so twice in See the month, and
the fold glyph is small inside its 44px button.
