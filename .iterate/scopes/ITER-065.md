# ITER-065: Drop middle names, and use goes-by everywhere in the Planner

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-11-16

## Summary
The Sacrament Planner should show people as **first and last name**, never with a middle name,
unless a **goes-by** name is set, in which case the goes-by is used. This applies on the program and
on every Planner screen. A goes-by is set once and reused everywhere from then on.

## Context
Raised by the user (2nd counselor) on 2026-11-16. Ward-list names carry middle names, so the printed
program reads "Brother James Robert Smith". The user wants the program to read the way people are
actually known: first and last name, or the name they go by. Showing names the same way on every
Planner screen makes it easy to spot when a goes-by still needs setting, before the program is
printed.

## Current Behavior
- Ward-list names are stored as "Last, First Middle". The Planner turns them into "First Middle Last"
  for display, keeping the middle name.
- **The program**, built for opening prayer, closing prayer and speakers:
  - **with no goes-by**, prints that full form with "Brother" or "Sister" (none under 18)
  - **with a one-word goes-by** ("Jim"), prints the goes-by plus the last name ("Brother Jim Smith")
  - **with a goes-by containing a space** ("Jim Bob"), prints it as typed, as the whole name
- **Goes-by already persists.** It is stored per person in the Planner's shared goes-by records, set
  from the Sundays screen ("+ Goes by" / "Change"), visible to the whole bishopric, and used on every
  future program.
- **Messages already use only a first name** (the goes-by, or the first word of the first name).
- **Other Planner screens** (Who's Next, Sundays, Pray About, Calls, Follow Up, Meetings, History)
  show names in the full ward-list form or the full "First Middle Last" form. They do not apply the
  goes-by the way the program does.

## Desired Outcome
- **With no goes-by:** the program and every Planner screen show **first and last name only**, with
  no middle name. The program keeps "Brother" / "Sister" (none under 18) as today, and missionaries
  get "Elder" / "Sister" per ITER-064.
- **With a goes-by:** that name is used everywhere, with the same one-word / with-a-space rule the
  program uses today.
- **Set once, used everywhere.** A goes-by saved anywhere in the Planner is the same saved fact: it is
  shared with the bishopric, it persists, and every screen and every future Sunday uses it.
- **Double first names** ("Mary Ann", "Anna Marie") are handled by setting a goes-by once. Until then
  they show as the first word alone; the user accepted this.
- **Name pickers still list the full ward-list name**, so the right person can be chosen and a search
  can match any part of the name.
- **When two people would show the same name** (a father and son both "John Smith"), the Planner tells
  them apart with the middle name or initial, so the shortened form never makes them look like one
  person. On the program this signals that a goes-by is needed.
- **Done looks like:** "Smith, James Robert" with no goes-by prints "Brother James Smith" and shows as
  "James Smith" on Who's Next, Sundays and Meetings. After "Jim" is set once, every one of those shows
  "Jim Smith", including next month's program. Two "John Smith"s remain distinguishable everywhere.

## Scope Notes
- **The Planner is imported code** (`lib/sacramentPlanner/assets/`), changed only for deliberate,
  user-requested reasons (GROUP-04 / GROUP-06 precedent). This is one.
- **The stored person key does not change.** The ward-list name stays the identity that every record
  (history, fixes, flags, Do Not Ask, goes-by) is keyed on. Only the **display** changes, so no stored
  record is rewritten.
- **The scope is the Sacrament Planner.** The user said "everywhere … at least in the sacrament
  planning". Other modules (the old programme in `lib/program`, Visits, Zoom) are not in scope.
- **Relates to ITER-064** (missionaries), which adds Elder/Sister to the same honorific logic. The two
  should be planned so they agree, and may share a plan.
- **History rows read from imported program files** show what was printed at the time. Whether the
  "Printed" column on History keeps that wording (it is a record of the old paper) is for planning to
  confirm. The *person* those rows are counted as should follow the new display.

## Open Questions
- On the History and Name Review tabs, should the **"Printed"** column stay exactly as the old program
  printed it? It is a record of the paper, so the assumption is yes.
- When two people share the shortened name, should the program show the middle **initial**
  automatically, or only warn and leave it to a goes-by?
