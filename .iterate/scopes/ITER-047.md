# ITER-047: The light/dark button on the top bar

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-10-24

## Summary
Move the app's light/dark control out of the ☰ account menu onto the top bar itself, beside
"← Dashboard", on every page.

## Context
Raised by the user 2026-10-24 while reviewing the scenario 093 walk (ITER-045). The Sacrament
Planner's own theme button was removed and the Planner now follows the app's theme, so the app's
control is the only one. The user wants it "up in the banner with the dashboard", where it can be
reached in one tap. Kept separate from ITER-045 because it changes the top bar on every page.

## Current Behavior
`components/layout/ThemeToggle.tsx` renders inside `components/layout/AccountMenu.tsx` (the ☰
button). The choice is saved on the person's account (`themePreference`). The bar already carries
Report an issue, Help, the notification bell and the account menu.

## Desired Outcome
- The light/dark control is a visible button on the top bar, on every page including `/dashboard`.
- It keeps saving to the account as it does now, and the Sacrament Planner keeps following it.
- It fits at phone width (375px) beside the ward name and the existing icons, with no overflow
  and 44×44 tap targets. `released-modules-per-ward` already found the bar overflowing once, from
  one added pill.

## Scope Notes
- Decide whether it leaves the ☰ menu or appears in both places.
- `tests/components/layout/ChromeBar.test.tsx` pins the bar's contents and will need a deliberate
  update.
