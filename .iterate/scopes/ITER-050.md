# ITER-050: Calls history — look back at past Sundays

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-10-24
**Group:** GROUP-04 — Sacrament Planner refinements

## Summary
Keep the Sacrament Planner's Calls tab showing upcoming Sundays by default, and add a filter to
view past Sundays' calls — all of them or a date window, sorted either way, searchable by name —
with a 9-day grace period after a Sunday passes during which its calls can still be corrected.

## Context
Raised by the user 2026-10-24 while using the Planner (ITER-045). Once a Sunday passes it
disappears from Calls, so there is no way on that tab to verify how a call went (who accepted, who
declined and why, messages left, swaps). The same facts can be found on other Planner pages, but
the user wants the convenience of doing it from Calls. The grace period exists so a call mis-marked
on the day can be fixed before it is recorded wrong in the history.

## Current Behavior
The Calls tab lists every finalized Sunday (people whose status is "calling" or "accepted", plus
emptied slots that have a decline/removal history) whose date is **today or later**, sorted oldest
first, filtered by the **Whose calls** menu. A Sunday leaves the list when its date passes, **and
also as soon as it is in the agenda history** (`DATA.meetings`), even before its date. Sundays
where everyone has accepted fold up on their own. There is no past view, no date range, no sort
control and no search on this tab. (Planner source: `lib/sacramentPlanner/assets/body.html`,
`callItems()` and `renderCalls()`.)

## Desired Outcome
- **Default unchanged:** Calls opens on the upcoming view exactly as today.
- **A filter switches to past Sundays**, showing:
  - **everything** the Planner holds, or a **window** set by a **start date and end date**;
  - sorted **newest first or oldest first**, the user's choice;
  - a **search box** that narrows the past Sundays shown to those containing a matching name (e.g.
    type a name → every past Sunday that person was on).
- **Whose calls** keeps working in the past view.
- **9-day grace period:** for 9 days after a Sunday's date, its calls stay **editable** (the existing
  Accepted / Declined / Left message / Undo / Swap / Remove controls), so a mistake can be fixed.
- **After the grace period: read-only.** Past calls are shown with their outcome (accepted by whom,
  decline reason, message left, swaps/removals) and no controls. Read-only "for now" — may be
  revisited.
- Done when: the default view is unchanged; the past view shows a passed Sunday with its outcomes;
  date window, sort and search each narrow or reorder it; a Sunday 5 days past is editable and one
  10 days past has no controls.

## Scope Notes
- Edits the imported Planner (`lib/sacramentPlanner/assets/`), otherwise left untouched — a
  user-requested change; record it in the plan's list of Planner edits. Match its existing controls
  (the History tab already has filters to borrow from).
- Remember the chosen filter, window and sort per the remember-page-view preference, if the Planner
  has a place for that; otherwise decide in planning.
- Dates are the Planner's browser-local date math (`TODAY`), as everywhere else in the Planner; no
  server rendering is involved (CLAUDE.md rule 12 note in the ITER-045 entry).
- The 9-day boundary needs one clear definition (e.g. editable through Sunday + 9 days) and must
  apply to every control on the card, including Swap and Remove.
- Practice mode: past view reads the practice layer over real data, as the rest of the Planner does.

## Open Questions
- A Sunday already moved into the **agenda history** (`DATA.meetings`): does it appear in the past
  view, and does the 9-day grace still allow edits to it, given its record is now in the history?
- Does an emptied slot (declined, nobody replaced) show in the past view as "Needs someone", or as
  its decline record?
- Does search match only people's names, or topics too?
