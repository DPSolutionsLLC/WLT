---
id: fast-sunday-by-the-calendar
type: bugfix
iter: null
commits: ["5e0ac2d"]
date: 2026-09-28
files:
  - lib/calendar/resolveFastSunday.ts
  - lib/calendar/generateSundays.ts
  - lib/calendar/queries.ts
related: [sacrament-f2-asks-follow-the-conductor, sacrament-f2c-cancelled-sunday-work, calendar-b-month-view]
fixes: calendar-a-rules-and-api
---

*Written 2026-09-30, after the fact, from the commit and scenario 079's walk record.*

## What was broken
Saving an ordinary Sunday in the editor could turn it into Fast Sunday, zero its speaking slots,
and warn nobody. This happened whenever that month's earlier Sundays had not been created as rows.
Walking scenario 079 found it, on a seed that created only four Sundays.

## Root cause
There were two faults, and it took both to make it silent.
1. `resolveFastSunday()` picked the first Sunday **that existed as a row**, not the first Sunday on
   the calendar. A missing row was treated as if the Sunday did not exist.
2. `updateSunday()` skipped the "Fast Sunday moves" warning whenever the edited Sunday was the
   target. `SundayEditor` re-sends the unchanged type on every save, so a plain save could move
   Fast Sunday onto itself with no warning.

## What fixed it
1. `resolveFastSunday(candidates, anyDayInMonth)` walks every calendar Sunday of the month and
   counts one with no row as ordinary. **The month is a required argument**, so no caller can
   forget it (the ITER-005 idiom: a missing argument is a compile error, not a default).
2. The warning now skips the edited Sunday only when the edit's own impact is already recorded.
3. `tests/db/fast-sunday-collision.test.ts` and `tests/lib/fastSunday.test.ts` cover a month
   with missing rows. Scenario 079 was re-walked: September 27, alone in its month, saved as
   "Saved." and stayed Standard with 3 slots.

## Pattern
A rule about the calendar must be decided by the calendar, not by which rows exist. "The first
row" and "the first Sunday" agree only when generation has run in full, and every test fixture
that builds a partial month breaks that assumption quietly.
