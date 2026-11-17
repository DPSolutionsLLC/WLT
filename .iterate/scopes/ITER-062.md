# ITER-062: Sunday fill summaries in the Planner's Sunday/month picker

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-11-15

## Summary
Every Sunday row in the Planner's lists for choosing a Sunday or month for someone shows a tiny
summary of how many slots are filled (e.g. **Speakers 2/3 · Prayers 1/2 · Music 0/4**). Tapping the
summary opens a small window listing who is in each slot.

## Context
Raised by the user (2nd counselor) 2026-11-15 while placing people from Who's Next. When deciding
which Sunday to put someone on, there is no way to see from the picker which Sundays still need a
speaker, a prayer or music. The user likes the picker as it is (grouped by month, showing who
conducts each month) and wants just enough extra information to decide where a person belongs,
without leaving the list.

## Current Behavior
- The pickers are plain drop-downs. On a phone they open as the phone's own built-in list: month
  groups labelled with the month and who conducts it, an "Any Sunday in [month]" row, then one row
  per Sunday showing only its date.
- Built-in list rows can only hold plain text, so nothing in a row can be tapped separately.
- ITER-049 already shows a "how full is this Sunday" line on Pray About cards, but only for the one
  Sunday already chosen, and only for that card's kind (talk or prayer).

## Desired Outcome
- **Where:** every Planner list for choosing a Sunday or month for someone: the When picker on the
  Who's Next tick-box panel, the When picker in the person window (ITER-061), and the Sunday choices
  on Pray About cards (changing When, and Place on Sunday).
- **Each individual Sunday row** carries a small one-line summary: slots with someone in them out of
  slots that exist, for **speakers, prayers and music**.
  - "Filled" means a name is in the slot. Whether that person has been asked, accepted or confirmed
    does not matter.
  - **Music** = hymns chosen out of hymns needed. It will mostly read 0 for now; it fills in once
    the music coordinator's module is connected (later, not this item).
  - **Month rows** ("Any Sunday in January") show **no** summary.
  - Must stay small: rows no taller in practice and the list no longer to scroll.
- **Tapping the summary** opens a second small window listing who is in each slot on that Sunday.
  Closing it returns to the list exactly where the user was. Tapping the Sunday itself still selects
  it, as today.
- The list becomes the Planner's own window rather than the phone's built-in picker. The user
  accepted that it may look slightly different to get the tappable summary. It keeps today's
  layout: grouped by month, showing who conducts each month, plus the "Any Sunday in [month]" rows.
- Done when: while choosing a Sunday in any of those pickers, the user can see at a glance which
  Sundays still need a speaker, a prayer or music, and can check who is on a Sunday without leaving
  the list.

## Scope Notes
- A deliberate, user-requested edit to the imported Planner code (`lib/sacramentPlanner/assets/`),
  the same category as GROUP-04.
- One summary rule shared by every picker and, ideally, by ITER-049's fill line, so the counts never
  disagree. Count from the same slots the Sundays tab shows (including unsaved-edit handling).
- The replacement list must stay usable on a phone (44px rows, scrolls within the window, no page
  scroll behind it) and accessible (keyboard, screen reader names for the summary button).
- Rule 12: the Planner renders only in the browser on the device's date. A rebuild moving any of
  this to the server would need the ward's zone.
- Related: ITER-061 (person window Place on Sunday, same picker), ITER-049 (Pray About fill line),
  ITER-038 / music coordinator module (where hymn choices will eventually come from).

## Open Questions
- **Sundays with no regular speakers** (Fast & Testimony, Stake/General/Ward Conference, Primary
  Program, Musical/Christmas): show the meeting type ("Fast Sunday") in place of the speaker count,
  and still show prayers and music? Asked 2026-11-15, not yet answered. Suggested default: name the
  meeting type and omit any count that has no slots.
- Should the Sunday window also show the conductor or the topic, or strictly the slots?
