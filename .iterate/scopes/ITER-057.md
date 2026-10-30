# ITER-057: Who's Next selection panel hides the bottom of the list on a phone

**Type:** Bug Fix
**Status:** Completed
**Completed:** 2026-10-30
**Commit:** 9853e5a
**Plan:** plans/sacrament-planner-refinements.md
**Created:** 2026-10-29

## Summary
On a phone, once one or more people are ticked on Who's Next, the selection panel covers the last
names in the list and they cannot be scrolled into view. Fix the scrolling, and make the panel
collapsible to one line.

## Context
Raised by the user (2nd counselor) 2026-10-29 while using the Sacrament Planner on a phone. They
searched a last name, ticked one result, and could not scroll the remaining results up from behind
the panel to tick more. It affects every Who's Next list with a selection, searched or not.

## Current Behavior
- At phone width the selection panel (`.bulk`) is pinned to the bottom of the screen above the tab
  bar (`position: fixed`), up to about 55% of the screen height, scrolling internally.
- The list behind it reserves no extra space at its bottom for the panel, so the last rows can
  never scroll above it — they stay hidden underneath, unreadable and untickable.
- A short (searched) list makes it obvious because most of it is "the bottom", but it happens on any
  list.
- On a computer screen the panel is not pinned; it sits above the list in normal flow, so the bug
  does not occur there.

## Desired Outcome
- With the panel showing, every name — including the very last — can be scrolled into view above
  it and ticked, with or without a search.
- The panel keeps its current size when open (the user finds it fine).
- The panel is **collapsible** on a phone: folded, it is one line showing how many are selected and
  the main actions (e.g. "3 selected · Place on Sunday · Add to Pray About ▸"); tapping opens the
  full panel (When, topic idea, Defer row, Clear selection).
- The space reserved at the bottom of the list follows the panel's actual size, open or folded.
- The folded/open choice is remembered, so the panel opens the way it was last left (user's
  standing "reopen as I left it" preference).
- No change at computer-screen widths.
- Done when: on a 375px-wide screen, search a last name, tick one result, and scroll — the last
  result sits fully above the panel, open and folded.

## Scope Notes
- A deliberate edit to the imported Planner code (`lib/sacramentPlanner/assets/`), the same
  category as the rest of GROUP-04.
- ITER-056 adds a **Place on Sunday** button to this same panel; the folded line must show it, and
  the two should be planned together.
- The panel sits above the bottom tab bar and the phone's safe area; the reserved space must account
  for both.
- "Remember my choice": the Planner already keeps per-device view state (fold state, `planner:`-
  prefixed storage keys); decide in planning whether this stays per-device or goes on the account
  like the app's other remembered views.

## Open Questions
- Does the panel start open or folded the very first time (before any remembered choice)? Default
  suggestion: open.
