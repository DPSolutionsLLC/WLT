# P3 — Shell & Information Architecture

**Depends on:** P1 (primitives), P2 (the access model). **Size:** Medium.
**Status:** Not started.

Replace the sidebar shell with the prototype's tile dashboard and chrome bar.

**Load with this:** [prototype/module-map.md](prototype/module-map.md) and
[prototype/build-notes-raw.md](prototype/build-notes-raw.md) §`dashboard`,
§`global-back-link-rule`, §`dashboard-back-link-regression-fix`, §`dashboard-header-scroll`.

---

## The decision

**Tiles only. The sidebar is deleted.** Chosen 2026-09-20 over keeping a desktop sidebar: the
dashboard is home, the chrome bar gets you back, and every page is one click from the grid. It
is the model the user designed and drove.

---

## Step 1 — Sections on the navigation list

[lib/auth/navigation.ts](../lib/auth/navigation.ts) holds one permission-filtered list. It gains
four fields per item — `section`, `blurb`, `icon`, `accent` — and one `SECTIONS` constant
grouping them. **Purely additive**: `visibleNavigationItems()` keeps its signature, and the rule
that *hiding a link is cosmetic, never a security boundary* survives untouched. Every guarded
page still calls `assertCan()` and RLS still blocks the query behind it.

The four sections, from the prototype:

| Section | Accent | Modules |
|---|---|---|
| Meetings & Programs | `pine` | Sacrament, Music, Conducting, Program, Agendas, Ward Calendar |
| People & Care | `rust` | Prayer Roll, Prayer Items, Youth Support, Visits, Callings, Ministering, Calling Requests |
| Tasks & Communication | `gold` | To Do, My Appointments, Orphaned Actions, Message, Zoom |
| Finance & Admin | `pine` | Receipts, Reports, Tithing Calc, Admin, Handbook |

Most of those modules do not exist yet. **A tile for an unbuilt module must not appear** — this
is the standing bug CLAUDE.md §9 records, where the sidebar offers a bishop `/agendas`,
`/admin/audit-log` and `/sacrament` and two of them 404 while the third silently redirects,
costing two console errors on every page from Next.js prefetch. Gate tiles on **built AND
permitted**, not permission alone. A `built: boolean` on the navigation item is enough.

## Step 2 — The tile dashboard

Replace [app/(app)/dashboard/page.tsx](<../app/(app)/dashboard/page.tsx>), which its own comment
marks as a placeholder for the real per-role dashboards. Four sections of `Tile` (from P1),
sticky header with the Fraunces title and a search box, ward/stake line beneath.

~~**Locked tiles** grey out with a lock icon and do not navigate — the prototype's treatment for a
module a role cannot reach. Keep it: it tells a leader the module exists and is not theirs,
which is friendlier than a tile that silently vanishes.~~

**REVERSED BY THE USER 2026-09-22, walking scenario 069. A PERSON SEES ONLY WHAT THEY CAN OPEN.**
It was built as described above and then removed, because the walk showed what "friendlier than a
tile that silently vanishes" actually produces at real permission levels: a music coordinator with
4 usable tiles and **11 locks**, and a stake officer with **15 locks and nothing to do** — each
lock advising them to ask a bishopric that has no power to grant it. A grid is a place to start
work from, not an inventory of what the app contains, and saying eleven times over what somebody
may not touch is noise on every visit to make a point that matters at most once.

So a module a person cannot reach is **ABSENT**, a section with nothing they can reach renders
**no heading**, and `Tile`'s `locked`/`lockedReason` were removed outright rather than left unused.
The one thing the old treatment protected — a role holding nothing seeing a sentence rather than a
blank page — is now genuinely reachable, which it was not while locks filled the grid.
See `plans/retros/p3-shell-and-tile-dashboard.md`.

**Header scroll:** only the title and search stay sticky; the calling line and the switcher
collapse away on scroll down and reveal on any real scroll up. (The ward line moved to the chrome
bar, which never collapses and now renders on every page; the quick-links button lives in the
STICKY row so it survives the collapse.)

> ⚠️ **The collapse feeds its own scroll listener, and this is almost certainly the prototype's
> known-unfixed stutter.** Collapsing removes the extras' height, the browser CLAMPS `scrollY` by
> that amount, and that fires a scroll event the hook reads as the reader scrolling UP — observed
> as `900, 876, 900` from one flick. It re-expands and settles open, so a fast scroll looks like a
> header that refuses to collapse. Fixed with a settle window after each state flip. **No jsdom
> test can catch this**: jsdom has no layout, so nothing clamps.

> **Two traps the prototype hit here, both worth reading before you write this.**
> `position: sticky` only holds an element while its **own direct parent** is still in view — the
> first version nested the sticky bar inside a collapsing wrapper, so it released almost
> immediately. The sticky bar and the collapsing extras must be **siblings**.
> And the scroll-direction reveal must be `requestAnimationFrame`-throttled with movement
> accumulated only while direction is consistent; a raw scroll listener with a small threshold
> flips state faster than the CSS transition can follow and reads as a stutter. There is a
> **known-unfixed** version of this bug in the prototype's message thread — see decisions.md §6.

## Step 3 — The chrome bar

Wraps every page: back link, page title, then build-notes/report-issue/help/theme/account icons.

> ⚠️ **The back link must be STATIC — always `/dashboard`.** The prototype made it dynamic,
> following one step of history, and got genuinely stuck: after a couple of hops it ping-pongs
> between the last two pages and permanently loses the path home. That is
> `dashboard-back-link-regression-fix`, and it is a design flaw rather than an edge case. **This
> one link is a guaranteed escape hatch.**
>
> Per-page "Back to wherever you came from" links are fine and safe **because** the chrome bar
> underneath them is unconditional — each page captures the previous page once at mount via a
> ref, so it cannot cycle.

**Report an issue** is worth building: it tags the report with the page and the active role
automatically, so a report carries context without the user re-explaining where they were.
Capture-only is fine; a review screen is P12's.

**Help** should say plainly that per-page help has not been written, and point at Report an
issue. Do not fabricate help text.

## Step 4 — Sub-dashboards and quick links

`SubDashboard` — the same tile grid one level down (Admin → Sources). Must genuinely reuse the
dashboard's own structure and the `Tile` primitive, not a lookalike.

**Quick links** — a pinnable, reorderable subset behind a button in the sticky bar with a live
count, opening a modal rather than pushing the grid down.

> **ANSWERED 2026-09-22 — `users.settings` jsonb, per USER.** A pin follows the PERSON, not the
> device; `localStorage` would fail the case the feature is for, which is somebody who pinned
> Visits on a laptop opening the app on a phone. Migration 077 adds the column, its size CHECK and
> the column GRANT — that grant is load-bearing and easy to forget, because column privileges are
> checked BEFORE policies and a missing one fails as "permission denied" rather than as a zero-row
> RLS denial. **Nothing may ever read authorization out of that column**, since the user writes it
> directly. See `plans/prototype/decisions.md` §6.

## Step 5 — Delete the sidebar

Remove [components/layout/Sidebar.tsx](../components/layout/Sidebar.tsx) and its use in
[app/(app)/layout.tsx](<../app/(app)/layout.tsx>). `TopNav` merges into the chrome bar.

Check the `(auth)`, `(youth)` and `(tithing)` shells separately — they have their own layouts,
the youth shell is deliberately mutually exclusive with the app shell, and none of them should
gain the chrome bar's account or ward controls.

---

## Definition of done

- [ ] `NAVIGATION_ITEMS` carries section/blurb/icon/accent/built; `visibleNavigationItems()`
      signature unchanged
- [ ] **No tile points at an unbuilt route** — verified by clicking every tile as a bishop
- [ ] Chrome-bar back link is unconditionally `/dashboard`
- [ ] Sticky header holds through a full-page scroll at 375px and desktop
- [ ] Sidebar deleted; no dead imports
- [ ] The ward switcher from P2 appears **only** for someone who can use it
- [ ] Existing page guards untouched — `assertCan()` still on every guarded page
- [ ] Zero console errors on `/dashboard` as every role

## What to verify by hand

Sign in as a bishop, a music coordinator and a `ward_council_member` in turn. Each should see a
grid containing only what they can actually reach, with no 404 behind any tile. Then navigate
four or five modules deep and confirm the chrome-bar back link still lands on the dashboard
every single time — that is the regression this phase is most likely to reintroduce.
