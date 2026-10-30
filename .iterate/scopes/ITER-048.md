# ITER-048: Fast & Testimony Sundays start with no speakers

**Type:** Modification
**Status:** Completed
**Completed:** 2026-10-30
**Commit:** 9853e5a
**Plan:** plans/sacrament-planner-refinements.md
**Created:** 2026-10-24
**Group:** GROUP-04 — Sacrament Planner refinements

## Summary
In the Sacrament Planner, a Fast & Testimony Sunday starts with no speaker slots and no rest
hymn. Speakers can still be added by hand, and switching a Sunday's type adjusts its empty speaker
slots to match.

## Context
Raised by the user 2026-10-24 while using the Planner (ITER-045). Fast & Testimony meetings
normally have no assigned speakers, so the two empty slots on every such Sunday are noise the
bishopric has to remove or ignore.

## Current Behavior
Every new Sunday is created from one fixed layout: Opening Hymn, Opening Prayer, Sacrament Hymn,
Speaker, Rest Hymn, Speaker, Closing Hymn, Closing Prayer. The Planner already sets the first
Sunday of each month (day 1–7) to type "Fast & Testimony", but it still gets the same two empty
speaker slots and the rest hymn. Changing a Sunday's type (the meeting-type menu on its card)
changes only the type label; the slots are never touched. **+ Add speaker** works on every
Sunday. (Planner source: `lib/sacramentPlanner/assets/body.html`, `blankSunday0()`.)

## Desired Outcome
- **New Fast & Testimony Sunday:** starts with **no speaker slots and no rest hymn**. Hymns and
  prayers are unchanged. **+ Add speaker** still works.
- **Rest hymn follows the speakers:** absent when there are no speakers; when two or more speakers
  are added it appears as it does on a regular Sunday (a suggestion the bishopric can still change).
- **Switching a Sunday to Fast & Testimony** removes its **empty** speaker slots, and the rest
  hymn if no speakers remain.
- **Switching from Fast & Testimony to Regular** (or another type that normally has speakers)
  adds back the two empty speaker slots and the rest hymn.
- **Never touches work already done:** a speaker slot with a person in it is never removed or
  changed automatically. If a switch leaves a named speaker on a Fast Sunday, it stays and the
  bishopric handles it by hand.
- Done when: a new first-Sunday card shows no speaker slots; switching type back and forth adds and
  removes only empty slots; a named speaker survives every switch.

## Scope Notes
- The Planner's code is imported and edited only for listed reasons (CLAUDE.md §9, ITER-045 entry:
  "Do not 'improve' it"). This is a user-requested change, so it is a legitimate edit — record it in
  the plan's list of Planner edits.
- Slots carrying a topic or references but no name: treat as "work done" or as empty? Decide in
  planning (leaning: anything typed counts as work and is kept).
- Other types (Primary Program, conferences, Musical/Christmas) were not discussed; only Fast &
  Testimony ⇄ speaker-bearing types are in scope.
- Related: ITER-049 (slot counts when placing from Pray About) will read the same speaker slots.

## Open Questions
- Fast Sundays **already saved** with empty speaker slots: leave them as they are, or clean them up
  once? (Only empty slots would ever be removed.)
- Are switch-time adjustments applied immediately, or only when the card is saved (the Planner
  edits a card and then saves it)?
