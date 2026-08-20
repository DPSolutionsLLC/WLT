# ITER-003: Ward Conference Sunday Type

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-08-19

## Summary

Add `ward_conference` to the Sunday types. It holds a normal sacrament meeting with a conductor
and speakers, but it cannot be Fast Sunday.

## Context

Ward conference is a distinct kind of Sunday that a ward needs to be able to mark. The stake
presidency attends, the meeting is shaped differently, and the second hour is usually taken by
stake leaders. Today the calendar has no way to record that it is happening, so it looks like any
other Sunday to everyone reading the calendar or building the program.

## Desired Outcome

- `ward_conference` is a Sunday type a bishopric can set, with a label and a badge like every
  other type.
- It **holds a sacrament meeting**: a conductor is assigned from the rotation exactly as on a
  standard Sunday, and it does not skip a turn (see [ITER-002](ITER-002.md)).
- It **displaces Fast Sunday**. Ward conference is normally scheduled off the first Sunday, but
  when it does land there, Fast Sunday moves to the following week.
- **Normal speaking slots**, filled by the bishopric as usual.
- **Organizations still meet.** Stake leaders typically take the second hour, but each
  organization keeps the option to assign its own conductor. Nothing about org conducting
  changes for this type.

Done looks like: a bishopric marks a Sunday as ward conference, the badge shows on the calendar,
the conductor is assigned normally, and if it fell on the first Sunday then Fast Sunday has moved
to the second.

## Scope Notes

- **This is the type that proves the two lists must separate.** `ward_conference` is the first
  type that cannot BE Fast Sunday while still HOLDING a meeting. Today
  `FAST_SUNDAY_DISPLACING_TYPES` answers both questions with one list; adding this type to it
  without the split from [ITER-002](ITER-002.md) would wrongly cancel the meeting, blank the
  conductor, and fire the `meeting_cancelled` warning. **Plan ITER-002 first, or plan them
  together.**
- Touches the `sundays.type` CHECK constraint (migration 004), `SUNDAY_TYPES` and
  `SUNDAY_TYPE_LABELS` in `types/domain.ts`, and the badge component. `SUNDAY_TYPE_LABELS` is a
  `Record`, so a new type fails to compile until someone names it on screen — that is deliberate
  and is the guard here.
- Migration adding a CHECK value: the constraint has to be dropped and recreated, and it must
  stay in step with `SUNDAY_TYPES` or the database accepts a value TypeScript rejects
  (CLAUDE.md rule 9 territory).
- `generateSundays()` does not need to predict ward conference. Unlike general conference it has
  no fixed date — the stake schedules it, and a bishopric sets it by hand.

## Open Questions

- Should the program builder (Phase 6) render ward conference differently — a different header,
  or the stake presidency listed as presiding?
- Does `presiding_override` need to default to something for this type, given the stake president
  usually presides rather than the bishop?
