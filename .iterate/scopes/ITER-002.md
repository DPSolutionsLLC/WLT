# ITER-002: No Conductor on Sundays With No Meeting, and Skip Them in the Rotation

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-08-19

## Summary

A Sunday with no sacrament meeting gets no conductor — for the sacrament meeting and for every
organization — and the rotation skips it entirely rather than spending a turn on it.

## Context

Found while walking scenario 011. Stake conference and general conference Sundays were showing a
conducting assignment for a meeting that does not happen.

The turn-spending half is the part that actually costs somebody something: on a weekly cadence,
whoever the rotation lands on for general conference simply loses their turn, roughly twice a
year. Under a monthly cadence it is nearly invisible, which is why it survived this long.

## Current Behavior

Every Sunday receives a `conducting_user_id` from the rotation regardless of its type, including
`stake_conference`, `general_conference` and `holiday`. `sunday_org_conducting` does the same for
each organization that has a rotation.

`resolveConductingUser()` works out whose turn it is by counting Sundays forward from the
rotation's anchor (`countSundaysBetween`) or months forward (`countMonthsBetween`). It is pure
date arithmetic and looks at nothing else, so a Sunday with no meeting consumes a position in the
cycle exactly like any other.

`FAST_SUNDAY_DISPLACING_TYPES` — `stake_conference`, `general_conference`, `holiday` — is
currently doing double duty. It answers "this Sunday cannot BE Fast Sunday", and
`assessEditedSunday()` also reads it as "this Sunday holds no sacrament meeting" to raise the
`meeting_cancelled` warning. The two ideas coincide today, which is why one list has worked.

## Desired Outcome

- A Sunday whose type holds no sacrament meeting has **no conductor**, for the sacrament meeting
  and for **every organization's** meeting. There is no block that day at all.
- Those Sundays read **"No meeting"** on screen — not blank, and not "Not set". A blank is
  indistinguishable from an unfilled rotation position, which is exactly the ambiguity that sent
  the last debugging session sideways.
- The rotation **skips** them: a cancelled Sunday does not spend a turn. Applies independently to
  the bishopric rotation and to each organization's.
- **`holiday` holds a meeting.** Only `stake_conference` and `general_conference` cancel one. A
  ward marking Christmas Sunday as a holiday still meets, often with a shortened or music-focused
  service.
- Conductors **already stored** on cancelled Sundays are cleared. This is a correction, not a
  rotation change, so the forward-only rule does not apply to it.

Done looks like: a general conference Sunday reads "No meeting" for sacrament meeting and for
every organization; the person the old cycle would have wasted on it conducts the next real
meeting instead; and marking a Sunday as a holiday no longer warns that its speakers are being
orphaned.

## Scope Notes

- **The single list has to split into two.** "Cannot be Fast Sunday" keeps `holiday`; "holds no
  sacrament meeting" does not. Both concepts need their own name in `types/domain.ts` — do not
  leave one list serving both, because the next person to add a type will have to guess which
  meaning applies.
- **This is the expensive part: conducting stops being pure date arithmetic.** Skipping means the
  offset depends on which Sundays between the anchor and the target were cancelled, and that
  history spans months generated long ago. `resolveConductingUser()` currently needs only two
  dates. It will need the intervening Sundays' types, from somewhere. Since
  `conducting_user_id` is STORED and assigned once at generation, a sequential walk over
  meeting-holding Sundays may fit better than modular arithmetic — decide at planning time.
- **Interacts directly with calendar-c's generation path.** `generateSundayRange()` now resolves
  the conductor from the candidate date and writes it as part of the INSERT, which is what made a
  new month arrive complete in one statement. Anything that needs prior months' types must not
  quietly undo that.
- The `meeting_cancelled` warning in `assessEditedSunday()` changes behaviour for `holiday`.
  `tests/db/fast-sunday-collision.test.ts` and calendar-b's warning dialog both touch this.
- `special` already holds a meeting and is already absent from the displacing list. No change.
- Doubling onto organizations is the same rule applied twice, not a second decision — but it is
  a second code path (`sunday_org_conducting`, `populateOrgConducting`) and a second set of tests.

## Open Questions

- Under a **monthly** cadence, what does skipping mean? A single cancelled Sunday inside a month
  changes nothing, since one person holds the whole month. But if an entire month held no
  meetings at all, should that month spend a turn? Rare enough to decide late, but it needs an
  answer before the monthly branch is written.
- Should clearing existing conductors happen as a one-off migration, or lazily whenever a month
  is next read? The lazy path reuses the repair already in `ensureMonthGenerated()`.
- Does "No meeting" belong in the month grid too, or only on the Sunday detail page?
  `SundayCell` and `SundayCard`'s three reserved regions belong to Phase 4 and are
  contract-tested — check before touching.
