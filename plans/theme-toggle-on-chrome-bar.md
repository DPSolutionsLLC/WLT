# Plan: Theme toggle on the chrome bar

**Created:** 2026-10-30
**Type:** feature
**Scope refs:** ITER-047

## Overview

Move the light/dark control out of the ☰ account menu and onto the chrome bar itself, as an icon
button between **Help** and the **notification bell**, on every page that has the bar (all of
`app/(app)`, including `/dashboard`). This matches the prototype: its `AppChrome` carries a
Sun/Moon icon button in the same row as Report an issue, Help and Account.

### Decisions (settled with the user 2026-10-30)

| # | Decision |
|---|---|
| D1 | **Move, not copy.** The ☰ menu loses its "Appearance" row. One control, so two copies can never disagree. |
| D2 | **Keep all three states.** Light → Dark → System → Light, exactly as today. The icon shows the CURRENT choice: `Sun` = Light, `Moon` = Dark, `Monitor` = System. This departs from the prototype's two-state flip on purpose: a two-state button would take "follow my phone" away from anyone who taps it once. |
| D3 | **Arrow-only back link on phones.** Below the `sm` breakpoint, "← Dashboard" shows only "←"; the word "Dashboard" stays in the accessible name (`sr-only`). From `sm` up, nothing changes. |

### Why D3 is needed (the arithmetic)

At 375px the header has `px-4`, leaving ~343px. On a module page today:
back link ≈ 102px + two `gap-2` = 16px + four 44px controls with three `gap-1` = 188px → the ward
name gets ~37px. A fifth 44px control adds 48px → **~11px overflow even with the ward name at zero
width**. Arrow-only back link ≈ 44px frees ~58px, so the ward name ends with ~47px — slightly more
than today. `/dashboard` has no back link and fits either way.

This bar has overflowed once before from one added pill (`released-modules-per-ward`: 419px against
360px, found only by measuring in a browser). **Measure it in a real browser at 375px; jsdom has no
layout and no test here can catch an overflow.**

### Success criteria

- [ ] The theme button is on the bar on `/dashboard` and on a module page, between Help and the bell
- [ ] Tapping it cycles Light → Dark → System, the page changes theme instantly, and the icon follows
- [ ] The choice survives a reload (localStorage, read by the pre-paint script) and a sign-in on another device (`users.theme_preference`)
- [ ] The ☰ menu no longer has an Appearance row
- [ ] The Sacrament Planner still follows the app's theme when the button is tapped while it is open
- [ ] At 375px on a module page: no horizontal overflow, the ☰ button fully on screen, every control 44×44
- [ ] From `sm` up the back link still reads "← Dashboard"
- [ ] Lint, typecheck, the tests below and the production build pass

## Relevant Files

- `components/layout/ThemeToggle.tsx` — modify — becomes a 44×44 icon button (Sun / Moon / Monitor) with an accessible name; the cycle, the instant local apply, localStorage and the save to `users` are unchanged
- `components/layout/ChromeBar.tsx` — modify — render `<ThemeToggle initialPreference={user.themePreference} />` between `HelpButton` and `NotificationBell`; arrow-only back link below `sm`; header comments updated ("five controls" → six)
- `components/layout/AccountMenu.tsx` — modify — remove the "Appearance" block and the `ThemeToggle` import; update the header comment that says "the chrome bar has five controls"
- `tests/components/layout/ThemeToggle.test.tsx` — create — the toggle had no tests
- `tests/components/layout/ChromeBar.test.tsx` — modify — assert the theme button is on the bar (dashboard and module page) and the back link's phone-width classes
- `tests/components/layout/AccountMenu.test.tsx` — modify — assert the menu no longer carries a theme control

**Not touched, on purpose:**
- `app/layout.tsx`: the pre-paint `THEME_SCRIPT` and its `localStorage.theme` key do not change.
- `app/(app)/sacrament-planner/PlannerFrame.tsx`: the bar's height is unchanged at 44 + 16 + 1, so `CHROME_BAR_HEIGHT_PX = 61` stays right. Its `MutationObserver` on `<html>`'s class keeps the Planner in step.
- `app/(youth)/layout.tsx` and `app/(tithing)/layout.tsx`: they have their own shells and no ChromeBar. The scope's "every page" means every page with the bar.
- No migration, no route, no RLS change, no new dependency (`lucide-react` is already installed and exports `Sun`, `Moon` and `Monitor`).

## Dependencies

- `lucide-react` (installed, `^1.47.0`). Import per icon: `import { Monitor, Moon, Sun } from "lucide-react";`, never `import * as`.
- Existing: `createBrowserSupabaseClient`, `ThemePreference` from `@/types/domain`, `SessionUser.themePreference`.

## Known Pitfalls (from retro context)

- **released-modules-per-ward:** one added pill overflowed this bar at 375px and pushed the account button off-screen, and every component test still passed. Measure the bar's `scrollWidth` against its `clientWidth` in a real browser at 375px, on a module page **and** on `/dashboard`, before calling it done.
- **p3-shell-and-tile-dashboard:** `ChromeBar.test.tsx` once pinned a bug as the spec (`toBeEmptyDOMElement()` on `/dashboard`). Change the assertions here deliberately and keep the comments that explain why the bar renders on `/dashboard`.
- **youth-g-occasions-and-event-detail:** the title `<p>` needs `min-w-0` to shrink at all. Keep it.
- **sr-only spacing (HANDOFF gotcha):** an `sr-only` word beside visible text needs an explicit `{" "}`, or the accessible name runs together ("←Dashboard" is fine because the arrow is `aria-hidden`, but check the computed name in the test).
- **p4-sacrament-a:** a small control on a phone must be a 44px tap target (`min-h-11 min-w-11`). The `Pill` padding case found 19px targets.

## Tasks

### Task 1: Turn ThemeToggle into an icon button
**File:** `components/layout/ThemeToggle.tsx` (modify)
**Action:** Replace the bordered text button with an icon button in the same style as `HelpButton` / `ReportIssueButton`.
**Details:**
- Keep `NEXT_PREFERENCE`, `LABELS`, `applyPreference()` and `handleClick()` exactly as they are: local apply first, then the save, with errors logged and nothing swallowed silently.
- Add `const ICONS: Record<ThemePreference, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };` (`import type { LucideIcon } from "lucide-react"`) and render `<Icon aria-hidden="true" className="size-5" />`.
- Button classes: copy `HelpButton`'s exactly: `inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`.
- Accessible name: keep the existing sentence, `<span className="sr-only">Change theme. Currently {LABELS[preference]}.</span>`. Remove the visible text span.
- Add `title={`Theme: ${LABELS[preference]}`}` so a mouse user can hover to learn what the icon means. The prototype used `title` on these buttons too.
- Named export stays `ThemeToggle`; props unchanged (`initialPreference`).

### Task 2: Put it on the bar, and make room on phones
**File:** `components/layout/ChromeBar.tsx` (modify)
**Action:**
- Import `ThemeToggle` and render `<ThemeToggle initialPreference={user.themePreference} />` inside the `shrink-0` controls `div`, between `<HelpButton />` and `<NotificationBell />`. That is the prototype's order: report, help, theme, then the rest.
- Back link (D3): wrap the word in `<span className="sr-only sm:not-sr-only">Dashboard</span>` and give the link `min-w-11 justify-center` so the arrow-only form is still a 44×44 target. Keep `<span aria-hidden="true">←</span>`. The accessible name must remain "Dashboard" at every width, which the existing `getByRole("link", { name: /Dashboard/ })` tests depend on.
- Leave the `href="/dashboard"` logic, `isDashboard`, the Admin view pill and the title `<p>` untouched.
- Update the header comment ("the five controls that belong to the app") to six and add a short note on D3 with the arithmetic in one line, so a later reader knows why the word disappears on a phone.

### Task 3: Remove it from the account menu
**File:** `components/layout/AccountMenu.tsx` (modify)
**Action:** Delete the `<div>` holding "Appearance" and `<ThemeToggle …/>`, and the `ThemeToggle` import. Update the header comment: the menu now carries who you are, which ward, and the way out; the theme moved to the bar (ITER-047). Nothing else changes.

### Task 4: Tests for the toggle
**File:** `tests/components/layout/ThemeToggle.test.tsx` (create)
**Details:** `// @vitest-environment jsdom`. Mock `@/lib/supabase/browser` with a hoisted `vi.fn()` returning a client whose `auth.getUser()` resolves a user and whose `from("users").update().eq()` resolves `{ error: null }`. Stub `window.matchMedia` (jsdom lacks it). Cases:
- Starting at `light`, the button's name is "Change theme. Currently Light." Clicking moves it to Dark, then System, then Light: assert the name each time.
- After clicking from `light`, `document.documentElement` has class `dark` and `localStorage.theme === "dark"`.
- The click calls `update({ theme_preference: "dark" })` on `users` filtered by the user's id.
- When the save returns an error, the preference shown is **still** the new one (local first) and `console.error` was called. Spy on it and restore it after.
- It is one button with no visible text, and its svg is `aria-hidden`.
- Reset `document.documentElement.className` and `localStorage` in `afterEach`.

### Task 5: Update the bar and menu tests
**Files:** `tests/components/layout/ChromeBar.test.tsx`, `tests/components/layout/AccountMenu.test.tsx` (modify)
**Details:**
- ChromeBar: in "still renders on the dashboard, carrying its controls", add `expect(screen.getByRole("button", { name: /Change theme/ })).toBeInTheDocument()`. Add a module-page case (`/visits`) asserting the same. Add one case asserting the back link's word sits in `span.sr-only` with class `sm:not-sr-only` (jsdom applies no CSS, so the class is what is asserted, as the Admin view pill test already does). The bar now renders `ThemeToggle`, which imports the browser Supabase client at module load, so mock `@/lib/supabase/browser` in this file if the import fails under jsdom.
- AccountMenu: one case, open the menu and assert `queryByRole("button", { name: /Change theme/ })` is null and `queryByText("Appearance")` is null.

### Task 6: Measure at phone width
**Action:** Not a file. Stop any running dev server before the build (7.7 GB RAM). Then run `npm run dev` and sign in as any adult. At 375×812, open `/dashboard` and one module page (e.g. `/todos`). In the browser console, check `document.querySelector("header").scrollWidth <= document.querySelector("header").clientWidth`, check that the ☰ button's `getBoundingClientRect().right <= 375`, and check each control is 44×44. Repeat on the longest ward name available. Then tap the theme button through all three states with the Sacrament Planner open, and confirm the Planner follows. Record the measured numbers in the retro.

## Testing Strategy

- **Create:** `tests/components/layout/ThemeToggle.test.tsx` (Task 4)
- **Modify:** `tests/components/layout/ChromeBar.test.tsx`, `tests/components/layout/AccountMenu.test.tsx` (Task 5)
- **Must stay green:** the five `points at /dashboard from …` cases and the one-session case in `ChromeBar.test.tsx` (the back link's accessible name must still match `/Dashboard/`), plus `tests/rls/users-column-grant.test.ts` (the `theme_preference` write is unchanged).
- **Not testable in jsdom:** overflow at 375px, real icon rendering and the Planner following the theme. These are Task 6.

## Test Scenarios (Harness)

None. Any signed-in adult reaches the bar on every page, so there is no hard-to-reach state to seed. The checks a person must make by eye are the Task 6 measurements and the success criteria above. A `/walk` against an existing scenario that lands on a module page (e.g. scenario 096) covers them.

## Validation Commands

```bash
# Linting
npm run lint

# Type checking
npm run typecheck

# Tests (the touched files, then the layout folder)
npx vitest run tests/components/layout

# Full suite is NOT needed: no route, RLS, migration or lib change. Run it only if the layout folder surprises you.

# Production build (stop the dev server first)
npm run build
```

## Integration Notes

- No data, schema, permission or route change. `users.theme_preference` is written exactly as before by the same code, from a new place on the screen.
- `ChromeBar` is client-rendered from `app/(app)/layout.tsx` with `user` already passed in, so `user.themePreference` is available with no new prop.
- `PlannerFrame.tsx`'s height constant depends on the bar staying one row of 44px controls. It does.
- The ☰ menu gets shorter, and nothing else reads from it.
- Docs: no SPEC/FEATURES change (`SPEC.md` already lists `ThemeToggle.tsx` under `components/layout`). Retro written by `/execute`. Close ITER-047 on `/commit`.
