---
id: theme-toggle-on-chrome-bar
type: feature
iter: [ITER-047]
commits: []
date: 2026-10-30
files:
  - components/layout/ThemeToggle.tsx
  - components/layout/ChromeBar.tsx
  - components/layout/AccountMenu.tsx
related: [released-modules-per-ward, p3-shell-and-tile-dashboard, auth-a-session-shell]
---

## What was done
The light/dark control moved out of the ☰ account menu onto the chrome bar, as a 44×44 icon
button between Help and the bell, on every page with the bar including `/dashboard`. The icon
shows the current choice (Sun = Light, Moon = Dark, Monitor = System) and still cycles through all
three; the instant local apply, the `localStorage.theme` key and the save to
`users.theme_preference` are unchanged. Below `sm` the back link shows only "←" to make room.

## Key decisions
- **Moved, not copied (D1).** One theme control, so two copies can never disagree.
- **Three states kept (D2)**, departing from the prototype's two-state flip, so "follow my phone"
  is not lost after one tap.
- **Arrow-only back link on phones (D3)**, word kept in the accessible name via
  `sr-only sm:not-sr-only` and `min-w-11` so it stays a 44×44 target.

## Measured (headless Chrome, 375×812, harness ward "Harness Test Ward")
- `/dashboard`, `/todos`, `/sacrament-planner`: header `scrollWidth` 375 = `clientWidth` 375,
  document 375, header height 61 (so `CHROME_BAR_HEIGHT_PX = 61` still holds). ☰ right edge 359.
  Every control 44×44.
- Ward name gets 99px on `/dashboard` and 47px on a module page ("Harn…"), matching the plan's
  ~47px estimate. It truncates; it cannot overflow, because the title is `min-w-0 flex-1`.
- 768px: back link reads "← Dashboard" (108px wide).
- With the Planner open, System → Light → Dark → System changed `<html>`, `localStorage.theme`
  and the Planner frame's `data-theme` and background each time; the choice survived a reload.

## Found while building
- Help renders its `<dialog>` as the next sibling of its button, so a "next element sibling"
  order assertion fails; the test compares positions in `getAllByRole("button")` instead.
- `npm run typecheck` failed on a half-written `.next/dev/types/routes.d.ts` left by an earlier
  dev run. Deleting `.next/dev` (a generated cache) fixed it; not a code problem.
