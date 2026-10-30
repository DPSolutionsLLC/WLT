# ITER-056: Place on Sunday straight from Who's Next

**Type:** Modification
**Status:** Completed
**Completed:** 2026-10-30
**Commit:** 9853e5a
**Plan:** plans/sacrament-planner-refinements.md
**Created:** 2026-10-29

## Summary
Let a bishopric member skip the Pray About step: on Who's Next, tick one or more people and place
them directly on a chosen Sunday, penciled in, in one press.

## Context
Raised by the user (2nd counselor) 2026-10-29 while using the Sacrament Planner. Pray About is for
names you want to ponder. When you already have a feeling about someone, going through Pray About
means adding each person there and then pressing Place on Sunday on every card, one at a time —
busywork that adds nothing. The goal is just to get the names onto the Sunday, then arrange order,
roles and prayers there and finalize as usual.

## Current Behavior
- On Who's Next, ticking people opens a selection panel: talk or prayer, When (a specific Sunday or
  "Any Sunday in [month]"), optional topic idea, and **Add to Pray About** (plus a Defer row).
- The only way onto a Sunday from there is through Pray About: each person becomes a separate card,
  grouped by Sunday or by month, and each card has its own **Place on Sunday** button with a Sunday
  picker.
- Placing pencils the person in (tentative): a talk fills the first open speaker slot, or a new
  Speaker slot is added before the closing hymn/prayer when all are filled; a prayer fills Opening
  Prayer, then Closing Prayer. Placing refuses a person already on that Sunday, a Sunday already in
  the agenda history, a Sunday with unsaved edits on the Sundays tab, and a prayer when both prayers
  are filled. The topic idea is carried onto the slot. The Pray About card is removed after placing.
- "Any Sunday in [month]" only has meaning inside Pray About; there is no month holding area on the
  Sundays tab.

## Desired Outcome
- A **Place on Sunday** button in the Who's Next selection panel, beside Add to Pray About.
  (Name chosen to match the existing button on Pray About cards — same act, same words.)
- It places **every ticked person** on the chosen Sunday in one press, using the panel's talk/prayer
  choice and topic idea, with exactly the same placement rules as placing from a Pray About card.
- People land **penciled in**. Nothing is finalized and nobody reaches the call list until the
  Sunday is finalized as usual.
- **Only works with a specific Sunday chosen.** With "Any Sunday in [month]" selected, the button
  is unavailable or tells you to pick a Sunday — if you haven't settled on a date, Pray About is the
  right step.
- Nobody is added to Pray About; the step is skipped, not completed.
- If some people can't be placed (already on that Sunday, do-not-ask list, both prayers filled…),
  the rest are still placed and a message names who was skipped and why.
- Done when: tick three people, choose a talk and a Sunday, press Place on Sunday, and all three
  appear penciled in on that Sunday with no Pray About cards created.

## Scope Notes
- This is a deliberate edit to the imported Planner code (`lib/sacramentPlanner/assets/`), which
  CLAUDE.md says to change only for listed reasons. GROUP-04 already covers this category of
  user-requested edits; the adapter-vs-rebuild decision (ITER-045 D1) is still open.
- Reuse the existing placement rules rather than writing a second copy — two copies would drift.
- Placing several people writes the same Sunday several times; make sure each placement sees the
  previous one (no lost names from placing in a loop).
- Order: names fill open slots in some order; the user will reorder on the Sunday afterwards, so a
  sensible default (e.g. the order shown in the list) is enough.
- The selection panel already crowds the phone screen — see the scroll bug raised alongside this
  (ITER-057); a new button must not make that worse.
- Related: ITER-049 (Pray About shows open slots before you place someone).

## Open Questions
- Should the History/agenda log line for each person say they were placed directly (skipping Pray
  About), or read the same as a normal placement?
- When the chosen Sunday has unsaved edits on the Sundays tab, refuse the whole batch (as single
  placement does today) — confirm during planning.
