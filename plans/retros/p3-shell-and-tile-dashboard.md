---
id: p3-shell-and-tile-dashboard
type: feature
iter: null
commits: []
date: 2026-09-22
files:
  - lib/auth/navigation.tsx
  - components/layout/ChromeBar.tsx
  - components/layout/AccountMenu.tsx
  - components/layout/WardSwitcher.tsx
  - components/layout/DashboardGrid.tsx
  - components/layout/DashboardHeader.tsx
  - components/layout/useCollapsingHeader.ts
  - components/layout/SubDashboard.tsx
  - components/layout/QuickLinksButton.tsx
  - components/layout/ReportIssueButton.tsx
  - components/layout/HelpButton.tsx
  - components/ui/Tile.tsx
  - app/(app)/layout.tsx
  - app/(app)/dashboard/page.tsx
  - app/(app)/admin/page.tsx
  - app/api/issue-reports/route.ts
  - app/api/session/quick-links/route.ts
  - lib/issues/writeIssueReport.ts
  - lib/users/userSettings.ts
  - lib/validation/issueReport.ts
  - lib/validation/quickLinks.ts
  - supabase/migrations/076_issue_reports.sql
  - supabase/migrations/077_user_settings.sql
  - types/domain.ts
related:
  - design-system-tokens-and-primitives
  - p2-admin-and-access
  - ward-callings-model
  - unit-hierarchy-and-ward-switch
  - notification-trigger-drift
  - youth-follow-up-controls
  - youth-g-occasions-and-event-detail
---

## What was done

P3: the sidebar is deleted and the dashboard **is** the navigation — four sections of tiles, a
chrome bar on every page whose back link is unconditionally `/dashboard`, Report an issue, Help,
pinnable quick links, and the ward switcher P2 built the API for and deliberately left unbuilt.
Two migrations, both purely additive: `issue_reports` (076) and `users.settings` (077).

It also closed the **standing broken-link bug CLAUDE.md §9 had carried for several phases** —
mechanically rather than by care. `NavigationItem` gained `built`, `visibleNavigationItems()`
filters on **built AND permitted in that order**, and `tests/lib/navigationRoutesExist.test.ts`
reads `app/` from disk and fails if any `built: true` href has no `page.tsx`. No assertion about a
rendered component can catch a dead route: the failure is a FILE THAT IS NOT THERE.

## Key decisions

- **A PERSON SEES ONLY WHAT THEY CAN OPEN — decided by the user mid-walk, and it REVERSED what
  this phase first shipped.** The grid initially rendered every module somebody lacked as a locked
  tile with a sentence naming it. The walk showed what that produces: a music coordinator with 4
  usable tiles and **11 locks**, and a stake officer with **15 locks and nothing to do**, each
  advising them to ask a bishopric that cannot grant it. A grid is a place to start work from, not
  an inventory of the app. `Tile.locked` was removed outright rather than left unused — dead code
  with an elaborate rationale invites somebody to restore it — and its two tests were **replaced by
  the inverse guarantee asserted on SHAPE**: the root element is always an `<a>`, keyboard
  reachable, with no `opacity-` dimming. That last clause is the real catch, because a future
  "disabled" tile would be reached for as an anchor at 50% opacity, which still focuses and still
  navigates.
- **`built: false` IS NOT "THERE IS NO PAGE".** `/sacrament` has a page — in the YOUTH shell, whose
  layout redirects an adult back to `/dashboard`, so a bishop's click silently did nothing, which
  is harder to report than a 404. It is unbuilt **for the app shell**, which is the only thing this
  list feeds. `/admin/audit-log` is the genuine no-page case and is the **anchor** the route-exists
  test uses to prove it can fail; that test was flipped red deliberately before being believed.
- **The chrome bar's back link is STATIC and the title is a PROP.** No `usePathname()` arithmetic,
  no `router.back()`, no `backHref`. A pathname → title lookup would be a second copy of the module
  list (`notification-trigger-drift`), so the layout passes what it honestly knows: the **ward being
  acted in**, which CLAUDE.md §7 requires the frame to name under the calling model. Each page keeps
  its own `<h1>`.
- **`issue_reports` has the most open INSERT policy in the app, and that is the feature.** Any
  authenticated member of the ward may file one; there is no `issues.*` permission and there must
  not be one, because `role_access` could take it from the role most likely to hit a bug. RLS is the
  only boundary. The READ is the ward's admins — a report is typed freely and may name a household.
- **`users.settings` is user-writable, so NOTHING may read authorization out of it.** Migration 077
  says so in capitals. The column GRANT is load-bearing and easy to forget: column privileges are
  checked BEFORE policies, so a missing grant fails as *"permission denied"* rather than as the
  zero-row denial RLS produces — the distinction `unit-hierarchy-and-ward-switch` lost time to on
  `active_ward_id`. A `pg_column_size < 4096` CHECK is what makes the open grant safe.
- **Quick-link persistence answered a `decisions.md` §6 open question**: `users.settings` jsonb, per
  USER not per device, mirroring `wards.settings`. Every write MERGES; a wholesale write would
  delete every other key the moment a second exists.
- **`lib/auth/navigation` became `.tsx`** because `icon` holds `<Mic />`, not `Mic`. A component
  REFERENCE is a function and functions do not cross the Server → Client boundary; a rendered
  element does. That is what lets the server compute the grid and hand it to a client header.

## What the walk found

Four defects across three scenarios, **all in the seam between a layout and a page**, and **none
visible to a green suite** — `p2-admin-and-access` predicted exactly this, because route tests call
handlers directly and never render a layout.

1. **There was no way to sign out from the dashboard.** `ChromeBar` returned `null` on
   `/dashboard` — specified, to drop a back link that does nothing there — but that took the whole
   icon row with it: no Sign out, no theme toggle, no bell, no Report an issue, no Help, on the page
   sign-in lands on. **`ChromeBar.test.tsx` asserted `toBeEmptyDOMElement()` and passed**: the test
   pinned the bug as if it were the specification. Only the back link is conditional now.
2. **A role with no permissions got 15 locked tiles instead of the empty state**, so the sentence
   the plan asked to keep was dead code. Removing locked tiles made it reachable again. Found only
   because the walk seeded a **stake officer** — `STAKE_OFFICER_PERMISSIONS` is the one genuinely
   empty list, and the scenario had originally used `resource_center_specialist`, which stopped
   being empty when proto-d gave it `program.view` + `program.distribute` on 2026-09-21.
3. **⚠️ THE COLLAPSING HEADER WAS FEEDING ITS OWN SCROLL LISTENER, and this is almost certainly the
   bug `plans/prototype/decisions.md` §6 lists as KNOWN UNFIXED in the prototype after two
   attempts.** Incremental scrolling worked; a single flick did not collapse at all. The event
   sequence from one downward jump was **`900, 876, 900`**: collapsing removes the extras' 24px of
   height, the browser CLAMPS `scrollY` by 24, the hook reads that as a 24px upward scroll past
   `REVEAL_AFTER`, re-expands, the height returns, and it settles open. Small steps hid it because
   60px outruns a 24px rebound. Fixed with a 250ms settle window that re-baselines `lastY` after a
   state flip. **NO jsdom TEST COULD HAVE FOUND IT** — jsdom has no layout, so nothing clamps and
   the second event never fires; the regression test reproduces the rebound by hand with a
   controllable clock and says in its header that it is a regression test, not a discovery tool.
4. **`/admin` rendered "← Dashboard" twice**, once in the chrome bar and once in `SubDashboard`.
   Its `backHref`/`backLabel` are now optional and a section index whose parent is home passes
   neither.

**A fifth was caught by the RLS suite before any walk, and it would only ever have failed in
production.** `writeIssueReport` used this codebase's universal `.insert(...).select(...)` idiom.
PostgreSQL applies the SELECT policy to a RETURNING clause, and the read is the ward's admins — so
filing a report raised `42501` for exactly the ordinary leaders the feature exists for, while a
bishop testing it sailed through. The writer now generates the id and never reads back;
`tests/rls/issue-reports.test.ts` pins the trap so nobody tidies it away. Adding
`reported_by = auth.uid()` to the SELECT policy is NOT the fix — that column is nullable so
`on delete set null` can fire, which is the `talks-d` hole, seventh sighting.

**Four checklist corrections**, including one describing a state the app cannot reach (`/admin/users`
is not a `SubDashboard`; P3 converted only `/admin`).

## What to watch

- **`NAVIGATION_ITEMS` is now the single list behind the grid, the sub-dashboards, the quick-links
  modal and the route-exists test.** Nothing may keep a second copy — not a pathname → title table,
  not a CHECK constraint naming hrefs. P4 edits its rows; P5/P10 flip `built: true` on the Tasks &
  Communication modules, which is the moment that section starts rendering.
- **The `/admin/audit-log` anchor.** When P12 builds the viewer and flips it built, the route-exists
  test needs another genuinely unbuilt href or it starts passing trivially.
- **`AccountMenu` does not link to `/account`** — P8 owns that page, and linking to it would be the
  dead-link bug this phase closed. P8 attaches beside the name.
- **Not judged by a human**: the fast-scroll *feel* and `prefers-reduced-motion` (the collapse was
  measured, not watched), one-handed reachability at 375px, and Report an issue's offline path —
  only the 400 refusal was exercised.
- **Scenario 065 should be re-walked.** The ward switcher now exists, so its "invisible to a
  one-calling ward" guarantee is observable rather than theoretical for the first time.
