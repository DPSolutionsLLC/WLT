# ITER-006: A Rotation Change Does Not Apply to Already-Generated Future Months

**Type:** Bug
**Status:** Backlogged
**Created:** 2026-08-22

## Summary

Saving a conducting rotation with an `effective_from` date does not change who conducts on Sundays
that have **already been generated** on or after that date. The form reports success, and nothing
on the calendar moves. "Effective from 2027-11-01" is currently inert for any month that already
has rows.

## Context

Found during the scenario 015 walkthrough for GROUP-01 (ITER-002 / ITER-003), on 2026-08-22. The
tester switched the bishopric rotation to **monthly, effective 2027-11-01**, saw "saved", and
found November 2027 unchanged.

This is **not** the forward-only rule working as intended. That rule exists to protect the *past* —
`conducting_user_id` is a stored column precisely so last March's program does not silently start
naming whoever conducts today (03-calendar.md Step 3). Failing to apply to the **future** is a
different thing, and it makes the effective date a promise the app does not keep.

Pre-existing: it shipped with `calendar-c`, and scenario 011 recorded it as a known limitation
rather than a defect. GROUP-01 sharpened it into an inconsistency worth fixing — see below.

## Current Behavior

`PATCH /api/conducting-rotation` calls `replaceConductingRotation()`, which **only inserts** the
three new `conducting_rotation` rows. It then writes an audit row and notifies the other bishopric
members. Nothing re-resolves any `sundays` row.

Nothing else closes the gap either:

- `populateConducting()` fills **nulls only**, so a Sunday that already has a conductor is skipped.
- `ensureMonthGenerated()` only repairs a month when a meeting-holding Sunday has a *null*
  conductor, so a fully-populated month is never revisited.

The result: the new rotation governs only Sundays generated *after* it is saved.

## Why GROUP-01 makes this worth fixing now

ITER-002 added a **forward re-shift** for type changes: cancelling a Sunday re-resolves who conducts
on later Sundays, behind a confirm dialog that names how many will change. So the app now has two
edit paths that behave differently:

| Edit | Re-resolves later Sundays? |
|---|---|
| Sunday **type** change | Yes — warned, confirmed, past protected |
| **Rotation** change | No |

Both are deliberate today, but the inconsistency is not defensible to a user. A bishopric who
switches to monthly and sees nothing change has hit the second row.

## Desired Outcome

Saving a rotation re-resolves who conducts on stored Sundays on or after its `effective_from`,
behind the same confirm-and-count dialog the type path already uses.

- The horizon is `date >= max(effectiveFrom, today)` — **the past is never rewritten**, exactly as
  Decision 2 of `plans/sunday-types-meeting-split.md` defines it.
- Only rows whose recomputed conductor **differs** are counted and written, from one computation,
  so the count that warns and the rows that change cannot disagree.
- The same treatment for an organization's rotation and its `sunday_org_conducting` rows.

## Scope Notes

**Most of the machinery already exists** from GROUP-01 and should be reused rather than rebuilt:

- `seriesFor()` and `buildMeetingSeries()` — the meeting history the resolution needs
- `conductingUserFor()` / `resolveConductingUser()` — unchanged
- `applyConductingReshift()` — already batches sacrament writes by user id and upserts org rows
- `planConductingReshift()` — the closest existing shape; this needs a sibling keyed on a rotation
  change rather than a projected type

Realistically: a `planRotationReshift(supabase, wardId, effectiveFrom, orgId, today)`, a confirm
gate on `PATCH /api/conducting-rotation` mirroring the one in `updateSunday()`, the counts in the
audit detail, and tests.

**The risk is larger here than for a type change, and must be designed for.** A rotation change can
re-resolve *many months at once*, and storage **is** the override — there is no `is_override` flag
(migration 024), so a re-shift cannot tell a hand-set conductor from a rotation-assigned one. A type
change touches the Sundays after one date; a rotation change could rewrite a year. The confirm
dialog therefore matters more, not less.

A `conducting_source` / `is_override` column would let the re-shift protect hand-set conductors and
is the real fix for that risk. It is recorded as a known gap in
`plans/retros/sunday-types-meeting-split.md` and should be considered as part of this item rather
than deferred again.

## Open Questions

1. **Should the confirm dialog appear when the count is zero?** The type path only prompts when
   something actually changes. Same rule here, presumably — but a rotation save that silently
   changes nothing is exactly the confusion this item exists to remove, so it may deserve a
   "nothing changed" confirmation instead.
2. **How far forward should the horizon run?** Every generated Sunday, or a bounded window? A ward
   that has generated two years ahead would see a very large count.
3. **Does this want `conducting_source` first?** Fixing the override-protection gap before widening
   the blast radius may be the safer order.
