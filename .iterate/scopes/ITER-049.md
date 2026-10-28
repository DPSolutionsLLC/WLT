# ITER-049: Pray About shows open slots before you place someone

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-10-24
**Group:** GROUP-04 — Sacrament Planner refinements

## Summary
On a Pray About card in the Sacrament Planner, show how many speaking slots (or prayers) are
filled on the chosen Sunday, warn instead of silently adding a slot when it is full, and let the
bishopric see who is already on that Sunday, adjust its speaking slots with a quick + / −, or — for
an "any Sunday in the month" card — see the whole month and place the person on a chosen Sunday.

## Context
Raised by the user 2026-10-24 while using the Planner (ITER-045). When placing someone from Pray
About it is easy, if not paying close attention, to add a speaker to a Sunday that is already full.
The user wants the state of the Sunday visible at the moment of placing, and quick fixes available
without leaving Pray About.

## Current Behavior
Each Pray About card (kind Talk or Prayer) has a Sunday drop-down — the upcoming Sundays of the
month the card targets, preselected to its specific date if it has one — and a **Place on Sunday**
button. The drop-down shows dates only; nothing says what is already on that Sunday.
- **Talk:** placing fills the first empty speaker slot. If none is empty, it **silently inserts an
  extra speaker slot** before the closing hymn and places them there — no warning.
- **Prayer:** fills the opening, then the closing prayer; if both are filled, a short toast says so
  and nothing happens.
- Placing is refused with a toast if the Sunday has unsaved edits on the Sundays tab, or is already
  in the agenda history.
- Cards are grouped by target: a specific Sunday, or "Any Sunday in <month>".
(Planner source: `lib/sacramentPlanner/assets/body.html`, `renderPray()` and `placeConsider()`.)

## Desired Outcome
**Only the relevant information, for that card's kind.** A talk card shows speaking-slot
information only; a prayer card shows prayer information only. Nothing is added to deferral cards.

**Card with a specific Sunday chosen:**
- A line such as **"2 of 3 speaking slots filled"** / **"1 of 2 prayers filled"** for the Sunday
  currently selected in the drop-down; it updates when the selection changes.
- **When full:** placing shows a warning instead of silently adding a slot, with two ways forward:
  - **Add a speaker anyway** (talk only) — adds a slot and places them, as today.
  - A link opening a **small popup listing who is already speaking (or praying) that day**, with a
    **link to that Sunday** on the Sundays tab to manage it there.
- **Tap the count → quick + / −** (talk only): add an empty speaking slot, or remove one. **− removes
  only an empty slot**, never a placed person; when every slot is filled it does nothing and points
  to the popup / the Sunday. Prayers have no + / − (there are always two).

**Card targeting "Any Sunday in <month>":**
- In the same place, instead of the count, a control that opens a **month summary**: every
  remaining Sunday of that month with its talk slots (or its two prayers) and who is in each, so the
  open spots are visible.
- **Pick a Sunday in the summary to place the person on it** directly.
- Assumed (confirm in planning): each Sunday in the summary has the same quick + / − and link to the
  Sunday as the single-Sunday popup.

Done when: a talk card for a full Sunday warns rather than adding silently; the popup lists that
Sunday's speakers and opens it; + / − changes only empty slots; a month card opens the summary and
placing from it lands the person on the chosen Sunday.

## Scope Notes
- Edits the imported Planner (`lib/sacramentPlanner/assets/`), which is otherwise left untouched —
  a user-requested change; record it in the plan's list of Planner edits. Match its existing look
  (small buttons, popups that fit their content — see the compact-UI preference).
- "Filled" must use the same definition the Planner already uses for a person in a slot (a name,
  status not `open`), so counts agree with the Sundays and Calls tabs.
- A Sunday with **unsaved edits** on the Sundays tab: + / − and placing must respect the existing
  refusal, or the quick edit would overwrite the card.
- A Sunday with no saved document yet is created from the blank layout when changed; with ITER-048
  a Fast & Testimony Sunday starts with **0** speaking slots, so it reads "0 of 0" and placing a
  speaker there should warn the same way.
- Sundays already in the agenda history stay unplaceable and should not appear as open in the
  month summary.
- Practice mode: all writes go to the practice layer as today.

## Open Questions
- Wording of the month-card control (e.g. "See the month").
- In the month summary, does each Sunday get + / − too (assumed yes)?
- Does the warning appear on pressing **Place on Sunday**, or as soon as a full Sunday is selected?
