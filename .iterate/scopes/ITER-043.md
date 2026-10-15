# ITER-043: Keep the screen on while the tithing calculator is open

**Type:** Feature
**Status:** Backlogged
**Created:** 2026-10-15

## Summary
While the tithing calculator is open and on screen, the phone's screen stays on instead of
dimming and locking — the way the user's everyday phone calculator app behaves.

## Context
Tithing is counted on Sunday, on a phone, often with the phone set down between envelopes. Today
the screen dims and locks after the phone's normal timeout, so the counter has to unlock it and
get back to the page mid-count. Raised by the user 2026-10-15 from their own use of a regular
calculator app that keeps the screen awake.

## Desired Outcome
- Opening the tithing calculator keeps the screen awake automatically — nothing to tap, no setting.
- It lasts only while the calculator is open **and visible**. Leaving the calculator, switching to
  another app or tab, or locking the phone by hand returns the phone to its normal sleep behaviour.
- Coming back to the calculator (e.g. switching back from another app) keeps the screen on again
  without the user doing anything.
- Works on both iPhone and Android — the ward's counters use a mix of both.
- Done when: on a real iPhone and a real Android phone, the calculator can sit untouched past the
  phone's normal screen timeout and the screen is still on; and the rest of the app still dims
  normally.

## Scope Notes
- **Tithing calculator only.** No other page in the app keeps the screen on.
- Nothing is stored and nothing is written — this is purely about the page's behaviour while open
  (no schema, no audit, no permission change).
- Must be verified on real devices, not just in a desktop browser — desktop dev tools cannot show
  whether a phone actually stays awake. Check both in-browser and opened from a home-screen icon,
  since phones can behave differently between the two.
- Battery: holding the screen on only while visible is what keeps this from draining a phone left
  on a table with another app open.

## Open Questions
- **When a phone or browser cannot keep the screen on** (some older devices): should the
  calculator (a) quietly behave as it does today, or (b) show a small, unobtrusive note that the
  screen may dim? Asked during discovery and not yet answered — settle at the start of planning.
  Note the project's "no silent failures" principle leans toward (b), but this is not an error the
  user can act on, so the user should decide.
