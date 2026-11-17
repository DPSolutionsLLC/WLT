# ITER-061: Place on Sunday from the person window on Who's Next

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-11-15

## Summary
Give the person window on Who's Next (opened by tapping a name) the same **Place on Sunday** button
the tick-box panel already has, so one person can skip Pray About and go straight onto a Sunday.

## Context
Raised by the user (2nd counselor) 2026-11-15 while using the Sacrament Planner on a phone. They
remembered ITER-056 shipping "skip Pray About" and could not find it: they were tapping a name, and
the window that opens offers only **Add to Pray About**. ITER-056 (commit 9853e5a) put Place on
Sunday on the **tick-box selection panel only**. Tapping a name is the natural way to act on one
person, so the shortcut is effectively missing for the most common case.

## Current Behavior
- Tapping a name on Who's Next opens a person window: phone, history, a talk/prayer choice, a When
  choice (defaulting to "Any Sunday in [the reader's month]"), a topic idea, and **Add to Pray
  About**, then the Record / Defer section. There is no way to place the person on a Sunday from it.
- Ticking the person's checkbox instead opens the selection panel, which has **Place on Sunday**
  beside Add to Pray About. That button is greyed out until a specific Sunday is chosen under When,
  and the When choice starts on a month, so it starts greyed out.

## Desired Outcome
- The person window gains a **Place on Sunday** button beside Add to Pray About (same name as the
  tick-box panel and Pray About cards: same act, same words).
- Same rules as the tick-box panel:
  - Usable only with a **specific Sunday** chosen under When; with "Any Sunday in [month]" it is
    greyed out. The user confirmed this: bypassing Pray About means you have a date in mind.
  - Uses the window's talk/prayer choice and topic idea.
  - The person is **penciled in**; nothing is finalized.
  - **No Pray About card** is created.
  - Refused with a stated reason when the person is already on that Sunday, on the do-not-ask list,
    both prayers are filled, the Sunday is already in the agenda history, or the Sunday has unsaved
    edits on the Sundays tab.
- Done when: tap Amy's name, choose a talk and a specific Sunday, press Place on Sunday, and she
  appears penciled in on that Sunday with nothing added to Pray About.

## Scope Notes
- A deliberate, user-requested edit to the imported Planner code (`lib/sacramentPlanner/assets/`),
  the same category as GROUP-04.
- Reuse the one placement rule the tick-box panel and Pray About cards already share — no second copy.
- The window is already long on a phone; the new button must not push Add to Pray About or the
  Record section further out of reach than necessary.
- Consider whether the greyed-out button should say why (the tick-box panel only has a tooltip,
  which a phone never shows). The user found the existing one hard to notice.
- Related: ITER-056 (tick-box Place on Sunday), ITER-062 (Sunday summaries in the same When picker).

## Open Questions
- Should the person window close after a successful placement, or stay open showing the result?
