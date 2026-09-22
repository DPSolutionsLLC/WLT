# Plan: P3 — Shell & Tile Dashboard

**Created:** 2026-09-22
**Type:** feature
**Phase:** P3 (see [P3-shell-and-ia.md](P3-shell-and-ia.md))
**Structure:** Five slices, five commits — `p3-a` … `p3-e`

---

## Overview

Replace the sidebar shell with the prototype's tile dashboard and chrome bar.

**The decision this executes** (taken 2026-09-20, recorded in the phase file): *tiles only, the
sidebar is deleted*. The dashboard is home, the chrome bar gets you back, every page is one click
from the grid.

### Key requirements

1. `NAVIGATION_ITEMS` gains `section`, `blurb`, `icon`, `accent` and `built`. Purely additive —
   `visibleNavigationItems()` keeps its signature.
2. **No tile points at a route with no page.** This is the standing bug CLAUDE.md §9 records, and
   it is closed *mechanically* by a test that reads `app/` from disk, not by care.
3. The tile dashboard replaces the placeholder list dashboard: four sections, sticky title+search,
   collapsing extras, locked tiles that say why in words.
4. The chrome bar wraps every page. **Its back link is unconditionally `/dashboard`.**
5. The sidebar and `TopNav` are deleted; their contents move into the chrome bar.
6. Report an issue (capture-only) and Help.
7. Quick links — pinnable, reorderable, persisted per user.

### Success criteria

- Every tile a bishop can see opens a real page. Zero console errors on `/dashboard`.
- The chrome-bar back link lands on `/dashboard` from five pages deep, every time.
- The sticky title+search holds through a full-page scroll at 375px and at desktop width.
- The ward switcher appears only for somebody holding a calling in more than one ward.
- `npm run lint`, `npm run typecheck`, `npm run test` and `npm run build` all clean.

### Explicitly NOT in this phase

**P3 changes how modules are presented, never which modules exist.** The prototype's module
*names* and *merges* — Sacrament absorbing Talks + Prayers + Topics, Youth Activities becoming
Youth Support — are **P4's**, not P3's. This phase assigns today's 17 navigation items to four
sections and renders them as tiles. Renaming or merging a module here would make P4's re-skin
diff unreadable.

---

## Decisions taken before planning

Three forks were put to the user on 2026-09-22 and answered. All three are recorded here because
each one changes the work.

| Fork | Answer | Why |
|---|---|---|
| Icons — the grid needs ~25 and the repo has none | **Add `lucide-react`** | It is the prototype's own library; build note §`global-stylesheet-nav-consistency` names specific lucide icons (Church, Music2, CalendarDays, ClipboardList, Calendar). Tree-shakes per-import. CLAUDE.md §7 required the ask; it was asked and granted. |
| Quick-link persistence — `decisions.md` §6 says *do not guess* | **`users.settings` jsonb** | A pin follows the person, not the device. Mirrors `wards.settings`. |
| Report an issue — build now or defer to P12 | **Build capture in P3** | Gives a real place to record defects while walking P4–P13. The review screen stays P12's. |

---

## Relevant Files

### Slice p3-a — navigation sections and the built gate

- `lib/auth/navigation.ts` — **modify** — add `section`, `blurb`, `icon`, `accent`, `built`; add
  `NAVIGATION_SECTIONS`; filter unbuilt out of `visibleNavigationItems()`
- `tests/lib/navigation.test.ts` — **modify** — extend for the new fields; update the two
  assertions the `built` filter changes
- `tests/lib/navigationRoutesExist.test.ts` — **create** — reads `app/` from disk and asserts
  every `built: true` href has a `page.tsx`
- `package.json` — **modify** — add `lucide-react`

### Slice p3-b — the tile dashboard

- `app/(app)/dashboard/page.tsx` — **modify** — replace the placeholder list with the grid
- `components/layout/DashboardGrid.tsx` — **create** — the four sections of `Tile`
- `components/layout/DashboardHeader.tsx` — **create** — sticky title+search, collapsing extras
- `components/layout/useCollapsingHeader.ts` — **create** — rAF-throttled scroll direction
- `tests/components/layout/DashboardGrid.test.tsx` — **create**
- `tests/components/layout/useCollapsingHeader.test.ts` — **create**

### Slice p3-c — the chrome bar, and the sidebar deleted

- `components/layout/ChromeBar.tsx` — **create**
- `components/layout/AccountMenu.tsx` — **create** — name, calling, ward switcher, theme, sign out
- `components/layout/WardSwitcher.tsx` — **create** — P2 built the API and never built the control
- `app/(app)/layout.tsx` — **modify** — `ChromeBar` replaces `Sidebar` + `TopNav`
- `components/layout/Sidebar.tsx` — **delete**
- `components/layout/TopNav.tsx` — **delete**
- `lib/units/queries.ts` — **no change** — `listSwitchableWards()` is already correct
- `tests/components/layout/ChromeBar.test.tsx` — **create** — the back-link regression test
- `tests/components/layout/WardSwitcher.test.tsx` — **create**

### Slice p3-d — report an issue, and help

- `supabase/migrations/076_issue_reports.sql` — **create**
- `lib/validation/issueReport.ts` — **create**
- `lib/issues/writeIssueReport.ts` — **create**
- `app/api/issue-reports/route.ts` — **create** — POST only
- `components/layout/ReportIssueButton.tsx` — **create**
- `components/layout/HelpButton.tsx` — **create**
- `types/database.ts` — **regenerate** (`npm run db:types`)
- `types/domain.ts` — **modify** — `IssueReport`
- `tests/rls/issue-reports.test.ts` — **create**
- `tests/routes/issue-reports.test.ts` — **create**

### Slice p3-e — sub-dashboards and quick links

- `supabase/migrations/077_user_settings.sql` — **create**
- `lib/validation/quickLinks.ts` — **create**
- `lib/users/userSettings.ts` — **create**
- `app/api/session/quick-links/route.ts` — **create** — GET + PUT
- `components/layout/QuickLinksButton.tsx` — **create** — button with live count + modal
- `components/layout/SubDashboard.tsx` — **create**
- `app/(app)/admin/page.tsx` — **modify** — render through `SubDashboard`
- `tests/rls/users-column-grant.test.ts` — **modify** — add the `settings` cases
- `tests/routes/quick-links.test.ts` — **create**
- `tests/components/layout/QuickLinksButton.test.tsx` — **create**

---

## Dependencies

- **New library: `lucide-react`** — approved 2026-09-22. MIT. Import per-icon
  (`import { Church } from "lucide-react"`) so the bundle carries only what the nav names.
  Do not `import * as Icons`.
- **Existing, reuse — do not rebuild:**
  - `components/ui/Tile.tsx` — P1 built it *to this phase's stated needs*. Its header says so:
    *"P3 should consume it, not redesign it."* `locked`, `lockedReason`, `pinned`, `accent`,
    `icon` and `blurb` are all already there.
  - `components/ui/Modal.tsx` — native `<dialog>`, focus trap, Escape, body-scroll lock. Quick
    links, Report an issue and Help all use it.
  - `components/ui/SearchBox.tsx` — the dashboard search box.
  - `components/ui/SectionHeader.tsx` — section headings (Fraunces via `font-display`).
  - `lib/units/queries.ts` → `listSwitchableWards()` (returns `[]` for one calling — that is the
    whole "invisible to an ordinary ward" requirement) and `isSuperAdmin()`.
  - `app/api/session/active-ward/route.ts` — GET lists, PATCH switches. Already audited both
    ways. **The switcher control is the missing half** and its header says so.
  - `lib/callings/callingLabel.ts` → `readCallingLabel()`.
  - `lib/auth/permissions.ts` → `can`, `resolveRoleAccess`.
  - `lib/audit/writeAuditLog.ts`, `lib/auth/routeErrors.ts`.
- **Two migrations**, 076 and 077. Both purely additive → **no `HELD_BACK_UNTIL_DEPLOYED`
  entry**, and per 073's header an unnecessary entry actively hides a real migration from the
  "everything on disk is applied" assertion.

---

## Known Pitfalls (from retro context)

- **`p2-admin-and-access`** — *a screen gated on a structural role must not sit behind a layout
  gated on a ward permission*. Stakes & Wards is **deliberately absent from `NAVIGATION_ITEMS`**:
  that file gates on a permission and `super_admin` holds all of them, so no permission shows it
  to a super admin without also showing it to every bishop. The dashboard must therefore resolve
  `isSuperAdmin(supabase)` **separately** and append that tile structurally. Do not add a
  `units.*` permission — `role_access` could widen it and a ward could grant itself the right to
  create the stake above it.
- **`p2-admin-and-access`** — *route tests call handlers directly and never render a layout.*
  Two of that phase's three walk defects lived in the seam between a Server Component gate and a
  route gate, and 3700 passing tests saw neither. **This phase is almost entirely layouts.**
  The harness scenarios are the only thing that will catch its equivalent.
- **`p2-admin-and-access`** — `unit_assignments` has two FKs to `users`, so `users!inner(…)` is
  ambiguous and PostgREST refuses it. If any new query embeds `users`, name the constraint.
- **`unit-hierarchy-and-ward-switch`** — `users` had to have a **column GRANT** opened before any
  policy could guard `active_ward_id`; column privileges are checked *before* policies, so a
  missing grant fails with "permission denied" rather than a zero-row RLS denial.
  `tests/rls/users-column-grant.test.ts` pins both halves. **Migration 077 must grant
  `settings` and extend that test.**
- **`design-system-tokens-and-primitives`** — a **static `Record`, never an interpolated class
  name**: `border-l-${accent}` compiles and produces no CSS. `Tile` already does this correctly;
  any new accent mapping must too.
- **`youth-g-occasions-and-event-detail`** — a flex item's default `min-width: auto` refuses to
  shrink below its content, so a control in a flex row overflows at 375px. The chrome bar is a
  flex row holding a title and five icons. **`min-w-0` on the title.**
- **`roster-b` / `visits-b` / `visits-f` / `youth-g`** — *a count beside a filtered list counts
  the unfiltered rows.* The quick-links button carries a **live count**; it counts the pins, not
  the pins currently matching the dashboard's search box.
- **`youth-follow-up-controls`** — `--surface` inverts meaning between themes; a panel built on
  it reads as an inset in light and a hole in dark. The chrome bar and the sticky header both sit
  on a surface. Check both themes.
- **`notification-trigger-drift`** — one list hand-maintained in more than one place always
  drifts. `NAVIGATION_ITEMS` is about to become the single list behind the sidebar (deleted), the
  dashboard grid, the sub-dashboard, the quick-links modal and the route-exists test. **Nothing
  may hardcode a second copy of a module list.**
- **CLAUDE.md rule 12 / `explicitTimeZone.test.ts`** — this phase renders no dates, but the test
  reads source across `app/`, `components/` and `lib/`. If anything added here formats a date it
  must name its `timeZone`. Expect the test to stay green; if it goes red, that is the mechanism
  working.

---

## Tasks

### Slice p3-a — navigation sections and the built gate

> One commit. No UI changes. It closes the standing broken-link bug on its own, because the
> surviving sidebar reads the same filtered list.

#### Task 1: Add `lucide-react`

**File:** `package.json` (modify)
**Action:** `npm install lucide-react`
**Details:**
- Import per icon at each use site. Never `import * as`.
- Icons are decorative — the tile label names the module — so every one gets `aria-hidden`.
  `Tile` already wraps `icon` in an `aria-hidden` span, so pass the bare element.

#### Task 2: Extend `NavigationItem`

**File:** `lib/auth/navigation.ts` (modify)
**Action:** Add five fields and a sections constant. Keep `visibleNavigationItems()`'s signature.
**Details:**

```ts
export type NavigationSection = "meetings" | "people" | "tasks" | "finance";

export type NavigationItem = {
  label: string;
  href: string;
  permission: KnownPermission;
  section: NavigationSection;
  blurb: string;
  icon: ReactNode;
  accent: TileAccent;          // from components/ui/Tile
  built: boolean;
};

export const NAVIGATION_SECTIONS: readonly {
  id: NavigationSection;
  label: string;
  accent: TileAccent;
}[] = [
  { id: "meetings", label: "Meetings & Programs",  accent: "pine" },
  { id: "people",   label: "People & Care",        accent: "rust" },
  { id: "tasks",    label: "Tasks & Communication", accent: "gold" },
  { id: "finance",  label: "Finance & Admin",       accent: "pine" },
] as const;
```

- **`accent` is per item and equals its section's accent.** It is duplicated on the item so a
  tile rendered outside the grid (quick links, sub-dashboard) still carries its colour without
  the caller having to look the section up. `NAVIGATION_SECTIONS` is the source; a test asserts
  they agree, so the duplication cannot drift.
- **The accent carries no meaning** — `Tile`'s header states this and it must stay true. It is a
  find-the-same-tile-twice aid, exactly like `CONTEXT_TONES`. Nothing reads a state out of it.

#### Task 3: Assign every item to a section, with a blurb and an icon

**File:** `lib/auth/navigation.ts` (modify)
**Action:** Fill in the 17 existing items. **Do not add, remove, rename or merge any module.**
**Details:** verified against disk on 2026-09-22 —

| Label | href | Section | `built` | Suggested icon |
|---|---|---|---|---|
| Talks | `/assignments` | meetings | yes | `Mic` |
| Prayers | `/prayers` | meetings | yes | `HandHeart` |
| Topics | `/talks/topics` | meetings | yes | `Lightbulb` |
| Program | `/program` | meetings | yes | `FileText` |
| Music | `/music` | meetings | yes | `Music2` |
| Calendar | `/calendar` | meetings | yes | `CalendarDays` |
| Agendas | `/agendas` | meetings | yes | `ClipboardList` |
| Roster | `/roster` | people | yes | `Users` |
| Visits | `/visits` | people | yes | `Home` |
| Youth Activities | `/youth` | people | yes | `Trophy` |
| Goals | `/goals` | people | yes | `Target` |
| Tithing | `/tithing` | finance | yes | `Calculator` |
| Knowledge Base | `/knowledge` | finance | yes | `BookOpen` |
| AI Settings | `/ai-settings` | finance | yes | `Sparkles` |
| Admin | `/admin` | finance | yes | `Settings` |
| **Audit Log** | `/admin/audit-log` | finance | **NO** | `ScrollText` |
| **Sacrament** | `/sacrament` | meetings | **NO** | `Church` |

> **Two corrections to CLAUDE.md §9's standing note, verified on disk — say so in the commit.**
> That note lists *three* broken links. `/agendas` **is now built**
> (`app/(app)/agendas/page.tsx`, landed in `797672e`), so the note is stale by one. The two that
> are genuinely broken are `/admin/audit-log`, which has no page at all, and `/sacrament`.
>
> **`/sacrament` is subtler and must not simply be marked built.** The page exists — but at
> `app/(youth)/sacrament/page.tsx`, inside the youth shell, whose layout redirects anybody who is
> not a `sacrament_manager` back to `/dashboard`. So a bishop's click silently does nothing. It
> is `built: false` **for the app shell**, which is the only thing this list feeds; P11 owns the
> adult sacrament-administration screen and will re-point the href when it exists.

- **Tasks & Communication is empty.** To Do, My Appointments, Message and Zoom are P5 and P10.
  Do **not** add placeholder items for them — that is the exact bug this slice closes. The
  section constant stays (P5 flips the first item to `built: true` in one line) and the grid
  renders nothing for a section with no visible tiles (see p3-b Task 2).
- Blurbs come from the module's own purpose, one short line. Example: Visits —
  *"Who is due a visit, and what happened last time."*

#### Task 4: Filter unbuilt out of `visibleNavigationItems()`

**File:** `lib/auth/navigation.ts` (modify)
**Action:**

```ts
export function visibleNavigationItems(
  user: SessionUser,
  roleAccess: RoleAccess,
): NavigationItem[] {
  return NAVIGATION_ITEMS.filter(
    (item) => item.built && can(user, item.permission, roleAccess),
  );
}
```

**Details:**
- **BUILT *and* PERMITTED, in that order.** Permission alone is what produced the standing bug.
- The signature is unchanged, so the surviving `Sidebar` and the existing `app/(app)/layout.tsx`
  keep compiling and immediately stop offering the two dead links. That is why this slice ships
  first and alone.
- `NAVIGATION_ITEMS` keeps carrying the unbuilt rows deliberately: the list is the forward map,
  and a later phase flips one boolean rather than re-deriving where a module belongs.
- **Hiding a link is still cosmetic, never a security boundary.** The existing header comment
  says so and must survive verbatim. Every guarded page still calls `assertCan()`; RLS still
  blocks the query behind it.

#### Task 5: Extend the navigation test

**File:** `tests/lib/navigation.test.ts` (modify)
**Action:** Add coverage for the new fields; fix the two assertions the `built` filter changes.
**Details:**
- **`it("gives the bishop every item")` will now fail** — it compares against all of
  `NAVIGATION_ITEMS`. Change it to compare against `NAVIGATION_ITEMS.filter((i) => i.built)`, and
  add a sibling asserting a bishop is offered **none** of the unbuilt ones. Two assertions, not
  one, so the first cannot go green by everything becoming unbuilt.
- **`it("gives a sacrament_manager exactly one item, under /sacrament")` will now fail**, because
  `/sacrament` is `built: false`. Re-point it at `NAVIGATION_ITEMS` (unfiltered) so the
  *invariant* — a youth account reaches exactly one module — is still asserted, and add a comment
  saying why the filtered list is empty: a `sacrament_manager` never renders the app shell at all
  (`app/(app)/layout.tsx` redirects them), so an empty app-shell list is correct rather than a
  regression.
- New: every item has a non-empty `blurb`; every item's `accent` equals its section's accent;
  every `section` is a member of `NAVIGATION_SECTIONS`; no duplicate hrefs (already there).

#### Task 6: The test that makes "no dead tile" mechanical

**File:** `tests/lib/navigationRoutesExist.test.ts` (create)
**Action:** Read `app/` from disk; assert every `built: true` href resolves to a `page.tsx`.
**Details:**
- **This is the highest-value test in the phase.** No assertion about a rendered component can
  catch a dead route, for the same reason `explicitTimeZone.test.ts` reads source: the failure is
  a *file that is not there*. Follow that file's shape.
- Route groups are invisible in a URL, so resolve group-agnostically: for href `/talks/topics`,
  accept any `app/**/talks/topics/page.tsx`. Use a recursive `fs.readdirSync`; no new dependency.
- **It must also assert the negative** — that at least one item is `built: false` and its href
  has no page. Without that, the test passes trivially the day somebody marks everything built.
  Today `/admin/audit-log` is that anchor. The same anchor-key discipline
  `notification-triggers-seed.test.ts` used.
- **Prove it can fail before believing it.** Temporarily flip `/admin/audit-log` to
  `built: true`, watch it go red, flip it back. `notification-trigger-drift`'s lesson: a
  both-directions assertion passed on two empty arrays until an anchor was added.

---

### Slice p3-b — the tile dashboard

#### Task 1: The collapsing-header hook

**File:** `components/layout/useCollapsingHeader.ts` (create)
**Action:** `"use client"` hook returning whether the extras are collapsed.
**Details:**

```ts
export function useCollapsingHeader(collapseAfter = 48): boolean;
```

- **rAF-throttled, direction-accumulating.** Build note §`dashboard-header-scroll` and the phase
  file both name this: a raw scroll listener with a small threshold flips state faster than the
  CSS transition can follow and reads as a stutter.
- Accumulate movement **only while the direction is consistent**; reset the accumulator the
  moment direction changes.
- Collapse when accumulated downward movement exceeds `collapseAfter` **and** `scrollY >
  collapseAfter`. Reveal on any accumulated upward movement over a much smaller threshold (~8px)
  — *"reveals immediately on any real upward scroll, not just at the very top of the page"*.
- `{ passive: true }` on the listener; cancel the pending frame and remove the listener on
  unmount.
- **`decisions.md` §6 lists this pattern as KNOWN UNFIXED in the prototype** — the message thread
  still stutters on a fast scroll after two attempts, and the note says *"re-verify in the real
  environment"* and that *"a transform-based slide rather than `max-height` is the likely clean
  rebuild"*. **Take that advice up front: animate with `transform`/`opacity`, never
  `max-height`.** A transform is compositor-driven and cannot fight a layout pass.
- Honour `prefers-reduced-motion` — collapse instantly, no transition.

#### Task 2: The grid

**File:** `components/layout/DashboardGrid.tsx` (create)
**Action:** Render the four sections of `Tile`.
**Details:**
- Props:
  `{ items: NavigationItem[]; lockedItems: NavigationItem[]; searchTerm: string; pinnedHrefs: string[] }`.
- Section heading via `SectionHeader` (`headingLevel={2}`); tiles in a
  `grid gap-3 sm:grid-cols-2 lg:grid-cols-3`. Mobile-first: one column at 375px.
- **A section with no visible tiles renders NOTHING** — not an empty heading. An empty
  "Tasks & Communication" heading reads as a section that failed to load, which is the `youth-h`
  defect (a card with no pills read as data that had not arrived).
- **Locked tiles.** `locked` = **built AND NOT permitted**. Pass a real `lockedReason` naming the
  module — `Tile` renders it as text, because greying out is a colour-only signal and this app
  does not use those. An **unbuilt** module is not locked; it is **absent entirely**.
- `searchTerm` filters on label and blurb, case-insensitively. Filtering is the *only* thing it
  does — see Task 3.
- `pinnedHrefs` sets `pinned` on the matching tiles (p3-e populates it; pass `[]` until then).

#### Task 3: The header

**File:** `components/layout/DashboardHeader.tsx` (create)
**Action:** `"use client"`. Sticky title+search; collapsing extras.
**Details:**

> **THE STRUCTURAL TRAP, and it is the one thing in this slice most likely to be got wrong.**
> `position: sticky` only holds an element while **its own direct parent** is still in view. The
> prototype's first version nested the sticky bar inside the collapsing wrapper; once the extras
> collapsed to near-zero height that parent's box was barely taller than the sticky bar itself,
> so it released almost immediately and scrolled away.
>
> **The sticky bar and the collapsing extras must be SIBLINGS**, both direct children of the page
> body, each spanning the full width. Do not wrap them together "for spacing" — put the padding
> and the border on each section directly.

- **Sticky (always visible):** the Fraunces page title (`font-display`) and the `SearchBox`.
  Later, the quick-links button joins this bar (p3-e).
- **Collapsing extras:** the ward/stake line, the calling line, the ward switcher, and the
  quick-links description.
- `searchTerm` is this component's `useState`, lifted to the page or held here and passed down —
  either is fine, but it lives in **one** place.
- The search box **filters tiles only**. It is not a global search across modules; nothing in
  this phase builds one. Say so in the component header so a later reader does not "finish" it.
- `min-w-0` on the title (`youth-g`).

#### Task 4: The page

**File:** `app/(app)/dashboard/page.tsx` (modify)
**Action:** Replace the placeholder list. Server Component; hand data down.
**Details:**
- Resolve, in this order: `requireSessionUser()` → `createServerSupabaseClient()` →
  `resolveRoleAccess(supabase, user.wardId, user.orgType)` → `readCallingLabel(user, supabase)` →
  ward name.
- **Compute both lists here**, on the server:
  - `items` = `visibleNavigationItems(user, roleAccess)`
  - `lockedItems` = `NAVIGATION_ITEMS.filter(i => i.built && !can(user, i.permission, roleAccess))`
- **The super-admin tile is appended structurally, not by permission.** Call
  `isSuperAdmin(supabase)` and, when true, append a Stakes & Wards tile (`/admin/stakes`,
  `finance`, `Building2`) to `items`. **Do not put it in `NAVIGATION_ITEMS`** — the
  `p2-admin-and-access` retro states why in terms: that file gates on a permission and
  `super_admin` holds all of them, so no permission shows it to a super admin without also
  showing it to every bishop.
- **Keep the existing no-`assertCan()` comment.** Every role may see their own dashboard; it is
  the only page in the app for which that is true.
- Keep the empty-state sentence for a role with nothing at all
  (`resource_center_specialist` holds an empty list on purpose, and `STAKE_OFFICER_PERMISSIONS`
  is empty).
- `resolveRoleAccess` throws on a read failure, deliberately — **do not add a fallback to
  `ROLE_PERMISSIONS`** (an override can widen as well as narrow; ITER-005).

#### Task 5: Tests

**Files:** `tests/components/layout/DashboardGrid.test.tsx`,
`tests/components/layout/useCollapsingHeader.test.ts` (create)
**Details:** see Testing Strategy.

---

### Slice p3-c — the chrome bar, and the sidebar deleted

#### Task 1: The chrome bar

**File:** `components/layout/ChromeBar.tsx` (create)
**Action:** `"use client"`. Back link, page title, then the icon row.
**Details:**

> **THE BACK LINK IS STATIC — ALWAYS `/dashboard`, UNCONDITIONALLY.**
> The prototype made it dynamic, following one step of history, and got genuinely stuck: that
> mechanism tracks one step, overwritten on every navigation, so after a couple of hops the link
> ping-pongs between the last two pages and **permanently loses the path home**. Build note
> §`dashboard-back-link-regression-fix` calls it *"a real design flaw, not an edge case"*.
> **This one link is a guaranteed escape hatch.** Do not read `usePathname()` to compute it, do
> not call `router.back()`, do not accept a `backHref` prop. A test asserts it (Task 6).
>
> Per-page "Back to wherever you came from" links are fine and safe **because** this one is
> unconditional — each page captures its previous page once at mount via a ref, so it cannot
> cycle. This phase builds none of those; the rule is recorded for the pages that will.

- Icon row, left to right: **Report an issue** (p3-d), **Help** (p3-d), `NotificationBell`,
  `ThemeToggle`, **Account menu**.
- The page title is a prop with no default. It is *not* derived from the pathname — a pathname
  lookup table is a second copy of the module list (`notification-trigger-drift`).
- `min-w-0` on the title (`youth-g`), and the icon row `shrink-0`.
- **It does not render on `/dashboard`** — the dashboard is home, and a "← Dashboard" link on the
  dashboard is a control that does nothing.

#### Task 2: The account menu

**File:** `components/layout/AccountMenu.tsx` (create)
**Action:** `"use client"`. A menu, **not a link**.
**Details:**
- Holds: the person's name and `callingLabel`; the ward switcher (Task 3); `ThemeToggle`; Sign
  out (lift `handleSignOut` out of `TopNav` verbatim — `POST /api/auth/logout`, then
  `router.replace()` + `router.refresh()`).
- **It does not link to `/account`.** The Account page is **P8's** and does not exist. Linking to
  it would be precisely the dead-link bug this phase closes. Say so in the header so P8 knows
  where to attach.
- Built on `Modal` (or a `<details>`), so focus handling comes from the platform rather than
  being hand-written.

#### Task 3: The ward switcher

**File:** `components/layout/WardSwitcher.tsx` (create)
**Action:** `"use client"`. **P2 built the API and deliberately left the control to P3** — the
header of `app/api/session/active-ward/route.ts` says so by name.
**Details:**
- Data comes from **`GET /api/session/active-ward`**, never from a direct table read:
  `wards_select` is `id = current_ward_id()`, so an ordinary read returns only the ward you are
  already standing in and the control could never offer the one you want.
- **It renders nothing at all when the list is empty.** `listSwitchableWards()` returns `[]` for
  somebody holding one calling — deliberately `<= 1`, so a session with no calling also gets
  nothing rather than an empty control. Everybody holds a calling in their own ward, so this is
  what keeps a pointless switcher off every ordinary leader's chrome bar. **Scenario 065 is the
  cheap proof and should be re-walked after this lands.**
- Switching: `PATCH` with `{ activeWardId }`, then `router.refresh()`. The route already writes
  the audit row in both directions and already maps the refusal to a 403 with a sentence —
  **surface that sentence**; do not invent a second one.
- **Do not import any constant from the route file.** Its header warns that a `"use client"`
  component importing from it would pull `next/headers` into the browser bundle, which **only
  `npm run build` catches** (`youth-b`, `youth-c`). Labels live in `types/domain.ts`.

#### Task 4: Rewire the layout

**File:** `app/(app)/layout.tsx` (modify)
**Action:** `ChromeBar` replaces `Sidebar` + `TopNav`.
**Details:**
- Keep every existing resolution: the `sacrament_manager` redirect (it is the mirror that makes
  the two shells mutually exclusive **by construction**), `resolveRoleAccess`, `readCallingLabel`,
  the ward-name read and its error log.
- `QueryProvider` stays wrapping `{children}` — the authenticated shell is the only place with a
  client fetch, and the `(auth)` and `(youth)` shells must not acquire one.
- `visibleNavigationItems()` is **no longer needed here** (the dashboard computes its own). Drop
  the import if nothing else uses it.
- Main padding: the sidebar's `pb-24` existed to clear the mobile drawer FAB. **The FAB is
  gone**, so drop it — otherwise every page carries 96px of dead space at the bottom forever.

#### Task 5: Delete the sidebar

**Files:** `components/layout/Sidebar.tsx`, `components/layout/TopNav.tsx` (delete)
**Action:** Delete both. Remove every import.
**Details:**
- Grep for `Sidebar` and `TopNav` across the repo afterwards — including `tests/` — and confirm
  zero references.
- **Check the other three shells separately and change none of them.** `(auth)`, `(youth)` and
  `(tithing)` each own their chrome for a stated reason, and **none of them should gain the
  chrome bar's account or ward controls**:
  - `(youth)` is deliberately mutually exclusive with the app shell and has no bell and no theme
    toggle — the youth account is the only account in this app not held by ward leadership.
  - `(tithing)` owns the whole viewport on purpose: *"no accidental navigation away"* on a phone
    held in one hand while the other counts cash. There is exactly one way out and it asks first.
    **Adding a chrome bar there would break the module's central requirement.**
  - `(auth)` has no session to hang an account menu on.

#### Task 6: The back-link regression test

**File:** `tests/components/layout/ChromeBar.test.tsx` (create)
**Action:** Assert the back link is `/dashboard` from *any* pathname.
**Details:**
- Mock `usePathname` to return several different deep paths in turn
  (`/visits`, `/youth/events/abc`, `/admin/users`, `/program/xyz`) and assert the back link's
  `href` is `/dashboard` **every time**.
- This is the single most valuable test in the slice: it is the regression the phase file names
  as the one most likely to be reintroduced.

---

### Slice p3-d — report an issue, and help

#### Task 1: The migration

**File:** `supabase/migrations/076_issue_reports.sql` (create)
**Action:** One table, its policies, one index.
**Details:**

```sql
create table issue_reports (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  reported_by uuid references users (id) on delete set null,
  page_path   text not null,
  role        text not null,
  calling_id  uuid references ward_role_assignments (id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);
```

- **`ward_id` IS NOT NULL** — rule 1. There are four documented exceptions and this is not one.
- **`reported_by` is nullable only so `on delete set null` can fire**, and — like
  `access_requests.requested_by` — it **must never appear in a policy predicate**: a null author
  column makes a predicate NULL rather than false and the row becomes invisible to the person who
  needs it. That is the `talks-d` hole, now seven sightings.
- **`role` is plain `text`, not a CHECK against a list.** `ROLES` is a TypeScript constant that
  grows every phase; a CHECK here would be another copy to keep in step
  (`notification-trigger-drift`). Zod validates it at the boundary against the real constant.
- **The FK on `reported_by` is single-column, not composite `(reported_by, ward_id)`.** Migration
  069 narrowed 48 of those precisely because a person may now write in a ward their account does
  not belong to. Do not reintroduce one — `tests/db/user-author-fks.test.ts` fails if you do.
- Policies:
  - `insert` — `ward_id = current_ward_id() and reported_by = auth.uid()`. Any authenticated
    member of the ward may report; that is the point of the feature.
  - `select` — `ward_id = current_ward_id()` AND the ward's admin readers, following the shape
    the ward's other admin-read tables use. Nothing in the app reads it until P12.
  - **No `update`, no `delete`.** A report is a record of what somebody said; nothing in this
    phase edits one, and RLS denies by default.
- Purely additive → **no `HELD_BACK_UNTIL_DEPLOYED` entry**, and adding an unnecessary one hides
  a real migration from the "everything on disk is applied" assertion (073's header).

#### Task 2: Types and validation

**Files:** `types/database.ts` (regenerate via `npm run db:types`), `types/domain.ts` (modify),
`lib/validation/issueReport.ts` (create)
**Details:**
- **Rule 9:** the route writes new fields, so the types change **in the same commit**. A column
  the frontend model does not know about is silently dropped.
- Zod: `body` trimmed, min 1, max ~2000; `pagePath` a string starting `/`; `role` validated
  against `ROLES`.
- **Reject an empty body at the boundary** — a report with no words is not a report, the same
  argument `access_requests.reason` carries.

#### Task 3: The route

**File:** `app/api/issue-reports/route.ts` (create) — **POST only**
**Details:**
- Follow `app/api/ward-settings/home-venues/route.ts` exactly: session resolved **outside** the
  `try` (`requireSessionUser()` redirects by *throwing*, and catching it turns a redirect into a
  500), `readJsonBody`, Zod parse, `respondToRouteError` on the way out.
- **No `assertCan()`.** There is no `issues.*` permission and there must not be one: reporting a
  problem is not a ward-configurable privilege, and putting it in `PERMISSIONS` would let
  `role_access` take it away from the very role most likely to hit a bug. RLS is the boundary
  (rule 2).
- **`role` and `calling_id` come from `SessionUser`, never from the request body** — that is the
  whole point of the feature ("a report carries real context without the person re-explaining
  where they were"), and a client-supplied role would be a claim rather than a fact.
- `writeAuditLog({ action: "issue_reported", module: "admin", … })` — rule 6.
- **Never swallow the error** (rule 7). The modal surfaces a real sentence; a report that
  silently vanished is worse than no button.

#### Task 4: The two buttons

**Files:** `components/layout/ReportIssueButton.tsx`, `components/layout/HelpButton.tsx` (create)
**Details:**
- Report: `Modal` + textarea + submit. On success, close and confirm in words. On failure, keep
  the modal open **with the text still in it** and show the error.
- Help: a static modal that **says plainly that per-page help has not been written yet** and
  points at Report an issue. **Do not fabricate help text** — the phase file and build note
  §`issue-reporting` both insist on this.

---

### Slice p3-e — sub-dashboards and quick links

#### Task 1: The migration

**File:** `supabase/migrations/077_user_settings.sql` (create)
**Details:**

```sql
alter table users add column settings jsonb not null default '{}'::jsonb;

alter table users add constraint users_settings_size
  check (pg_column_size(settings) < 4096);

grant update (settings) on users to authenticated;
```

- **THE GRANT IS LOAD-BEARING AND EASY TO FORGET.** Migration 022 revoked blanket UPDATE on
  `users` and granted back exactly `theme_preference`; **column privileges are checked BEFORE
  policies**, so without this grant the write fails with *"permission denied"* rather than the
  zero-row success an RLS denial produces. `unit-hierarchy-and-ward-switch` hit this on
  `active_ward_id`. **`tests/rls/users-column-grant.test.ts` pins both halves and must be
  extended in this commit.**
- **The size CHECK is what makes the open grant safe.** `theme_preference` is one enum value; an
  ungated jsonb column a user may write directly is a storage hole. 4 KB is far more than a list
  of pins needs.
- **Write in the migration, in capitals: `users.settings` IS USER-OWNED PREFERENCE DATA AND
  NOTHING MAY EVER READ AUTHORIZATION OUT OF IT.** The user can write it directly, so anything
  security-relevant stored here would be self-granted. The ward's `role_access` lives in
  `wards.settings` behind a bishopric-only `wards_update` for exactly this reason.

#### Task 2: Read/write helpers and the route

**Files:** `lib/users/userSettings.ts`, `lib/validation/quickLinks.ts`,
`app/api/session/quick-links/route.ts` (create) — GET + PUT
**Details:**
- **Zod validates each pin against `NAVIGATION_ITEMS`' hrefs.** The column is directly writable,
  so this does not *secure* anything — it keeps the app's own writes coherent, and stops a pin
  surviving a module being renamed.
- Shape: `{ quick_links: string[] }` inside `settings`. **Merge, never overwrite `settings`
  wholesale** — a wholesale write would delete every other key the moment a second one exists.
  `writeCrossOrgVisibility()` carries the identical warning for `wards.settings`.
- **Write the audit row** (rule 6) — one row per save, not per pin. Rule 6 is stated absolutely
  and a pin change is a write to a core table. *(The counter-argument, recorded rather than
  silently taken: `theme_preference` writes none, on the ground that a personal display
  preference is not a ward act. If the audit log turns out to be noisy, change it here and say
  so — do not discover the reasoning was never written down.)*

#### Task 3: The quick-links control

**File:** `components/layout/QuickLinksButton.tsx` (create)
**Action:** A button in the **sticky** bar with a live count, opening a `Modal`.
**Details:**
- **A modal, not an inline section** — build note §`dashboard-header-scroll` moved it precisely
  so it stops pushing the tile grid down.
- **The count counts the pins, not the pins matching the current search.** `roster-b`, restated
  by `visits-b`, `visits-f` and `youth-g`: a count beside a filtered list counts the unfiltered
  rows. The component test is the only place that can catch it.
- Reorder with buttons, not only with drag — a drag-only reorder is unreachable by keyboard.
- Pinned tiles render with `Tile`'s existing `pinned` prop, which renders **the word "Pinned"**,
  not a bare glyph.

#### Task 4: The sub-dashboard

**Files:** `components/layout/SubDashboard.tsx` (create), `app/(app)/admin/page.tsx` (modify)
**Details:**
- **It must genuinely reuse `DashboardGrid` and `Tile`, not a lookalike.** That is the phase
  file's word and `decisions.md` §1.7 ("one mechanism, not two").
- `SubDashboard` keeps **one plain sticky header** — build note §`dashboard-header-scroll` scoped
  the collapsing behaviour to the main dashboard only, deliberately.
- Its own back link points at its **fixed parent** (`/admin`), not at wherever you came from —
  a genuine parent-child relationship, which §`app-wide-back-link-extension` got right and is
  worth copying.
- `/admin` currently resolves `isSuperAdmin` itself; **keep that**. The `/admin` *layout* admits
  a structural super admin as well as `admin.view`, and the page must stay consistent with it.

---

## Testing Strategy

Priority order per CLAUDE.md §8. This phase is mostly UI, so the usual order inverts: there is
one new table (2 suites) and a great deal of component behaviour.

| File | Kind | Covers |
|---|---|---|
| `tests/lib/navigation.test.ts` | unit (modify) | new fields; accent/section agreement; the two assertions `built` changes |
| `tests/lib/navigationRoutesExist.test.ts` | unit, reads disk (**create**) | **every `built: true` href has a page**; at least one `built: false` href has none |
| `tests/components/layout/DashboardGrid.test.tsx` | jsdom (create) | four sections render; **an empty section renders nothing**; a locked tile renders **no link** and states its reason; an unbuilt item never appears; search filters on label and blurb |
| `tests/components/layout/useCollapsingHeader.test.ts` | jsdom (create) | collapses past the threshold; **reveals on any real upward scroll**; a direction change resets the accumulator; the listener is removed on unmount |
| `tests/components/layout/ChromeBar.test.tsx` | jsdom (create) | **the back link is `/dashboard` from every pathname**; the icon row is present; it does not render on `/dashboard` |
| `tests/components/layout/WardSwitcher.test.tsx` | jsdom (create) | **renders nothing for an empty list**; renders the options for two wards; surfaces the route's 403 sentence |
| `tests/rls/issue-reports.test.ts` | RLS (create) | ward A cannot read ward B's reports; a non-admin cannot read; any ward member **can** insert; an insert naming another ward is refused |
| `tests/routes/issue-reports.test.ts` | route (create) | happy path writes the row; empty body → 400; `role` comes from the session and a body-supplied one is ignored |
| `tests/rls/users-column-grant.test.ts` | RLS (modify) | a user **can** write their own `settings`; **cannot** write another user's; the size CHECK refuses an oversized value |
| `tests/routes/quick-links.test.ts` | route (create) | an unknown href is rejected; a save **merges** and does not clear other `settings` keys |
| `tests/components/layout/QuickLinksButton.test.tsx` | jsdom (create) | **the count is of all pins, not of the filtered ones** |

**Route-test mechanics** (CLAUDE.md §8): a route handler is an exported async function taking a
`Request`. Mock only `@/lib/supabase/server` via `tests/helpers/routeClient.ts` — every query
still runs against the hosted project as a genuinely authenticated user, so a passing route test
proves the policy allowed it. Read that helper's header first; it documents the `vi.mock`
hoisting trap. Seed with `seedFixtures(handles)` and `fixtures.cleanup()` in `afterAll`.

**Assert a refused write by RE-READING the row** with the service client. An RLS-denied UPDATE or
DELETE is a zero-row success, not an error — only INSERT raises.

**Do not run the suite while a harness seed is running.** Both share the hosted project, and
seeding mid-run clears data out from under a suite already using it — `p2-admin-and-access` had
to discard and repeat a full run for exactly this.

---

## Test Scenarios (Harness)

> **Why these matter more than usual here.** `p2-admin-and-access` recorded that *two of its
> three walk defects lived in the seam between a Server Component gate and a route gate, and 3700
> passing tests said nothing about either, because route tests call handlers directly and never
> render a layout.* **This phase is almost entirely layouts.** The scenarios below are the only
> thing standing across that seam.

### Scenario 069: The grid every role actually gets

**Tags:** `shell`, `smoke`, `permissions`
**Purpose:** Prove that each role's dashboard contains only modules they can genuinely reach, and
that nothing behind a tile 404s or silently redirects. Seeding is what makes this cheap — signing
in as five roles by hand means five invite-and-register flows.
**Seed data summary:**
- `wards` — 1
- `users` — 5 — bishop, music coordinator, `ward_council_member`, `org_president` (Relief
  Society), and `resource_center_specialist` (holds an empty permission list on purpose)
- `ward_role_assignments` — 5 — one active calling each

**Tester action:** Sign in as each in turn. Read the grid. Click **every** unlocked tile and come
back. Note any 404, any redirect that lands somewhere other than where the tile said, and any
section heading with nothing under it.
**Verification checklist:**
- [ ] The bishop sees every built module and **no** Audit Log or Sacrament tile
- [ ] Every unlocked tile opens a real page — no 404, no silent bounce to `/dashboard`
- [ ] **Tasks & Communication does not render at all** — no empty heading
- [ ] The music coordinator sees Music and Talks; sees **no** Visits, Tithing or Admin tile
- [ ] A locked tile is not clickable **and states in words** why it is locked
- [ ] `resource_center_specialist` gets the empty-state sentence, not a blank page
- [ ] **Zero console errors on `/dashboard` for every one of the five**
- [ ] No ward switcher on any of them (each holds exactly one calling)

### Scenario 070: The way home always works

**Tags:** `shell`, `smoke`
**Purpose:** The regression the phase file names as most likely to be reintroduced. It needs a
browser and a real multi-hop session — no unit test can reproduce "after a couple of hops".
**Seed data summary:** reuse scenario 069's bishop; no new data.
**Tester action:** From the dashboard, navigate at least five hops deep across **different**
modules (e.g. Visits → a household → Youth → an event → Program → a Sunday). At each stop, note
the chrome-bar back link's target, then use it.
**Verification checklist:**
- [ ] The chrome-bar back link reads "Dashboard" and lands on `/dashboard` at **every** stop
- [ ] It never alternates between the last two pages
- [ ] The chrome bar does **not** render on `/dashboard` itself
- [ ] The sticky title and search hold through a full-page scroll **at 375px and at desktop**
- [ ] The ward line and switchers collapse on scroll down and reveal on **any** upward scroll,
      with no stutter on a fast scroll
- [ ] Both themes: the chrome bar and the sticky header read as raised surfaces, not as holes

### Scenario 071: A report carries its context

**Tags:** `shell`, `admin`, `full`
**Purpose:** The report must be tagged with the page and the active role automatically, and must
not leak across wards. Two wards is the part that is painful to set up by hand.
**Seed data summary:**
- `wards` — 2 — ward A and ward B
- `users` — 3 — a bishop and an `org_president` in ward A, a bishop in ward B
- `ward_role_assignments` — 3

**Tester action:** As the ward A org president, open Report an issue from **two different pages**
and submit a report from each. Then, as the ward A bishop, confirm the rows exist (via the
service client — there is no review screen until P12). Then check as ward B's bishop.
**Verification checklist:**
- [ ] Each row's `page_path` is the page the modal was opened from, not `/dashboard`
- [ ] Each row's `role` is `org_president` — the **session's** role, not anything typed
- [ ] `ward_id` is ward A on both
- [ ] Ward B's bishop can read **neither** row
- [ ] An empty report is refused with a sentence, and the typed text is not lost
- [ ] A `writeAuditLog` row exists for each submission
- [ ] Help says plainly that per-page help has not been written, and offers Report an issue

**Not seeded, deliberately:** quick-link pinning. It is a single-user, single-ward interaction
with no cross-role or cross-ward dimension, so a scenario would seed nothing a tester cannot
create in two clicks. Its risky parts — the count, and the merge that must not clear other
`settings` keys — are covered by a component test and a route test respectively, which is where
those failures are actually visible.

---

## Validation Commands

Run in this order, after **each** slice:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

**The production build is not optional here.** Lint, typecheck and tests all pass while a build
fails — and this phase carries the exact failure mode that only `npm run build` catches: a
`"use client"` component importing a module that reaches `next/headers`, which pulls server-only
code into the browser bundle. `youth-b` and `youth-c` both hit it. The chrome bar, the account
menu, the ward switcher and the quick-links control are all client components sitting next to
server modules.

After 076 and 077:

```bash
npm run db:push
npm run db:types    # rule 9 — regenerate in the SAME commit as the route that writes the field
```

---

## Integration Notes

### Order, and what is safe to stop after

Each slice is a commit and each leaves the app working:

1. **`p3-a`** — data only. The surviving sidebar immediately stops offering the two dead links.
   **Safe to stop here indefinitely.**
2. **`p3-b`** — the dashboard becomes the grid. The sidebar is still present, so navigation is
   unaffected either way.
3. **`p3-c`** — the sidebar is deleted and the chrome bar replaces it. **This is the
   irreversible-feeling one**; after it, the grid *is* the navigation. Do not land it before
   scenario 070 can be walked.
4. **`p3-d`** — additive (migration 076).
5. **`p3-e`** — additive (migration 077).

### Breaking changes

- **`components/layout/Sidebar.tsx` and `TopNav.tsx` are deleted.** Grep the whole repo,
  `tests/` included, before committing `p3-c`.
- **`visibleNavigationItems()` returns fewer items** from `p3-a` on — by design. Its *signature*
  is unchanged, so nothing fails to compile; two existing assertions in
  `tests/lib/navigation.test.ts` change and both are named in p3-a Task 5.
- `app/(app)/layout.tsx`'s `pb-24` goes with the mobile FAB. Check a long page at 375px
  afterwards.

### Documentation to update in the same change

- **CLAUDE.md §9** — the "three links" note is **stale by one**: `/agendas` is built. Correct it
  to name the two that remain, and record that both are now `built: false` rather than dead
  links, so the standing "two console errors on every page a bishop opens" cost is gone.
- **CLAUDE.md §3** — add `lucide-react` to the stack table.
- **`plans/prototype/decisions.md` §6** — quick-link persistence is no longer open. Record the
  answer (`users.settings`) and why.
- **`plans/P3-shell-and-ia.md` Step 4** — strike the `> **Open:**` block; it is answered.
- **`plans/INDEX.md`** — mark P3 shipped once `p3-e` lands; status is sourced from
  `plans/retros/INDEX.md`, so the retro is what actually closes it.

### Handed forward

- **P4** renames and merges modules (Sacrament absorbing Talks/Prayers/Topics; Youth Activities →
  Youth Support). It edits `NAVIGATION_ITEMS` rows — not the sections, not the grid.
- **P5/P10** flip `built: true` on To Do, My Appointments, Message and Zoom, which is the moment
  Tasks & Communication starts rendering.
- **P8** owns the Account page; `AccountMenu` is where its link attaches.
- **P11** owns the adult sacrament screen and re-points `/sacrament`.
- **P12** owns the Audit Log page (flipping `/admin/audit-log` to `built: true`) and the review
  screen for `issue_reports`.
