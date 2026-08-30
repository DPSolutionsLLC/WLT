# ITER-032: The Date Input Still Reads the Reader's Clock

**Type:** Bug — **parked, not scheduled**
**Status:** Backlog (deferred until multi-ward or an editable ward timezone)
**Plan:** _none yet_
**Created:** 2026-08-30
**Found:** 2026-08-30, walking scenario 050 (`050-D2`), by setting the ward's zone away from the
machine's — which is the only way it can be seen.
**Related:** `c24d52b` (the reversal this is the other half of), `lib/youth/eventInstant.ts`,
`lib/youth/ics/resolveInstant.ts` (the correct pattern), `tests/lib/explicitTimeZone.test.ts`,
Phase 11 (ward admin screens), Phase 12 (multi-ward)

## The defect

`c24d52b` established that a turn-up-at `timestamptz` renders in **the ward's** zone. It moved the
display half. It did not move the input half.

With the ward on `Pacific/Honolulu` and the browser on `America/Denver` — the same event, the same
screen, three hours apart:

| | |
|---|---|
| Card reads | `Fri, Jan 15, 2027, 4:30 PM` |
| Edit field prefills | `2027-01-15T19:30` |

And on the create path — which is the question scenario 050 exists to ask — a leader typed
**19:30** and the card came back **"Fri, Mar 5, 2027, 4:30 PM"**. The hour on the card is not the
hour they typed.

**Cause.** `lib/youth/eventInstant.ts` resolves the zone from ambient process state —
`new Date(value)` and `getTimezoneOffset()` — and takes no zone parameter. Its own header calls
this a virtue ("a pure module on purpose… what makes the double-conversion bug testable without a
browser"), and under the old reader's-own-zone rule it was exactly right.

**A save left untouched is idempotent.** The stored instant was byte-identical across three writes,
because prefill and submit share the same wrong zone. So this is a wrong-number-on-screen bug, not
silent drift — the game does not walk. But a leader who types the hour the card shows moves it.

## Why this is parked rather than scheduled

**It cannot fire today.** Every ward on the project is `America/Denver`, `FALLBACK_WARD_TIMEZONE`
is `America/Denver`, and there is no UI to change the setting. The bug needs the reader's device
zone to differ from the ward's, and nothing today produces that except a leader physically
travelling and editing a game while away.

The user's judgement, 2026-08-30, and it is correct: *"another ward in another timezone is not going
to be even interacting with a ward's data."* Within one congregation in one zone, this is
unreachable.

**Do not confuse this with the rule it came from.** `c24d52b` fixed a bug that had nothing to do
with other wards: the *server* has no zone, Vercel runs UTC, and production served this ward's own
7:30pm Friday game as "Sat, Jan 16, 2027, 2:30 AM". That rule earns its keep and is not reopened
here. This item is only the narrow leftover.

## What makes it live

Any one of these, and the first two are real roadmap items:

1. **A Phase 11 admin screen for `wards.settings.timezone`.** The moment a ward can set its own
   zone, a ward can set one that differs from its leaders' devices — including by typo.
2. **Phase 12 multi-ward.** A second ward in a second zone is the case the whole setting exists for.
3. **A leader travelling** who edits a game from another zone. Real but rare, and the reversal's own
   reasoning names this person as the one it protects — so the input being wrong for exactly them is
   the sharpest version of the argument.

**Whoever does 1 or 2 must do this in the same change**, or the admin screen ships a control that
makes a second screen wrong.

## The fix

Give `eventInstant.ts` an explicit ward-zone parameter, so the input resolves in the same zone the
display does. `lib/youth/ics/resolveInstant.ts` is the pattern and is already correct — it carries a
wall clock and a zone **name** separately and is the one pure place they meet, with two
offset-correction passes because one is wrong for an hour twice a year. The ICS path is unaffected
by this bug for exactly that reason.

The module stays pure and stays testable without a browser; it gains an argument.

## The part worth doing sooner than the fix

**`tests/lib/explicitTimeZone.test.ts` cannot see this.** Its `CALL_PATTERN` matches
`Intl.DateTimeFormat`, `.toLocaleString`, `.toLocaleDateString` and `.toLocaleTimeString`. It does
not match `getTimezoneOffset` — a different mechanism for the same mistake, on the write path
instead of the read path.

That guard exists because this family of bug ships invisibly on a dev machine where both zones
agree. It currently guards one half of the round trip. **Widening it is cheap, is independent of the
fix, and is the only thing that stops a third instance** — and per that test's own header, it should
be proved able to fail before being believed.

## Deliberately not in scope

- **Rendering a time-zone marker beside the hour.** Asked and answered 2026-08-30: *"it is to be
  assumed that it is according to that ward's time zone."* A marker would suggest the reader might
  be looking at some other zone, which is what the decision rules out.
- **Reopening which zone a turn-up-at time renders in.** Settled by `c24d52b`.
- **The visits module's formatter**, still unproven on production because the harness ward has no
  appointments — a separate open item, tracked in `plans/confirmations/PENDING.md`.
