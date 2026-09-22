---
name: The grid every role actually gets
scope: P3
part: 1
tags: [shell, smoke, permissions]
prerequisites: none
---

## Purpose

P3 deletes the sidebar and makes the dashboard the navigation, so every mistake about who may
reach what is now a mistake somebody can SEE — a tile that 404s, a heading with nothing under it,
a page that silently bounces back to `/dashboard`.

This needs a walk rather than a test for a reason `p2-admin-and-access` recorded in terms: **two
of that phase's three walk defects lived in the seam between a Server Component gate and a route
gate, and 3700 passing tests said nothing about either, because route tests call handlers
directly and never render a layout.** P3 is almost entirely layouts. `navigationRoutesExist.test.ts`
proves every `built: true` href has a `page.tsx` on disk; it cannot prove that opening one as a
music coordinator does not redirect.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | 6, one active calling each, all in the same ward |

Six roles, each answering a different question:

| Sign in as | Role | What it is for |
|---|---|---|
| `bishop@harness.wardleadershiptools.test` | bishop | Every built module, and neither unbuilt one |
| `music-coordinator@harness.wardleadershiptools.test` | music_coordinator | Locked tiles that say why |
| `ward-council@harness.wardleadershiptools.test` | ward_council_member | The widest role with no organization |
| `rs-president@harness.wardleadershiptools.test` | org_president (Relief Society) | The organization-aware matrix |
| `resource-center@harness.wardleadershiptools.test` | resource_center_specialist | Printing, never approving — exactly one tile |
| `stake-officer@harness.wardleadershiptools.test` | stake_president | The role that genuinely holds nothing |

**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- shell/scenario-069-the-grid-every-role-actually-gets`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as the bishop. Open the browser console and leave it open.
4. Read the grid. **Click every unlocked tile and come back** via the chrome bar.
5. Note any 404, any redirect landing somewhere other than where the tile said, and any section
   heading with nothing under it.
6. Sign out and repeat for each of the other five.

## Verification Checklist

### Machine-checkable

- [ ] The bishop's grid contains **no Audit Log tile and no Sacrament tile** — both are
      `built: false`, and both were the standing broken links CLAUDE.md §9 recorded
- [ ] Every unlocked tile, for every one of the six, opens a real page: no 404, and no silent
      bounce back to `/dashboard`
- [ ] **"Tasks & Communication" does not render at all** — not as an empty heading. It is empty
      until P5 builds To Do
- [ ] The music coordinator sees Music, Talks, Prayers and Calendar and **nothing else** — no
      Visits, Tithing or Admin tile at all, not even an un-clickable one
- [ ] **There is no un-clickable card anywhere on any grid.** Every tile rendered is a link the
      person can open; a module they lack is ABSENT (user decision, 2026-09-22)
- [ ] A section with nothing that person can reach **renders no heading** — the music coordinator
      sees "Meetings & Programs" alone, not three headings with gaps under two of them
- [ ] `resource_center_specialist` sees **exactly one tile — Program** — and nothing else.
      Printing, never approving (proto-d, 2026-09-21)
- [ ] `stake_president` sees **no tiles at all** and gets the empty-state SENTENCE, not a blank
      page — CLAUDE.md §7's "stake officers reach nothing", walked in the real app
- [ ] **Zero console errors on `/dashboard` for every one of the six.** Before P3 a bishop's
      console carried two on every page, from Next.js prefetching the two dead links
- [ ] **The chrome bar renders on `/dashboard` too**, carrying Report an issue, Help, the bell and
      the account menu — so **Sign out is reachable from the page sign-in lands on**
- [ ] On `/dashboard` the chrome bar shows **no back link** — a "← Dashboard" link there does
      nothing — while every other page has one
- [ ] The ward is named **once**, in the chrome bar, not twice
- [ ] **No ward switcher on any of them** — each holds exactly one calling
- [ ] No horizontal scrollbar at 375px on any of the six grids
- [ ] Every tile and every chrome-bar control is at least 44×44

### Needs a human eye

- [ ] A narrow calling's grid reads as **a place to start work**, not as a page missing most of
      its content — four tiles under one heading, with the rest of the page simply empty
- [ ] `stake_president`'s empty state reads as deliberate rather than broken — a person with
      nothing assigned should not think the page failed to load
- [ ] The four section headings group the modules the way a leader would expect to find them
- [ ] The blurb under each tile says something true and useful about the module, in one line
- [ ] Both themes: the sticky bar reads as part of the page, not as an inset in light and a hole
      in dark

## Failure Behavior

- [ ] Typing a URL the role cannot reach (e.g. `/tithing` as the music coordinator) is refused by
      the page itself, with a sentence — the grid hiding the tile is cosmetic, never the boundary
- [ ] `/admin/audit-log` typed directly is a 404, which is honest: there is no page yet
- [ ] `/sacrament` typed directly as the bishop redirects to `/dashboard` — the page exists but
      lives in the youth shell. This is the reason it is `built: false` rather than built
- [ ] Automated: `tests/lib/navigationRoutesExist.test.ts` fails if any `built: true` href loses
      its page, and `tests/lib/navigation.test.ts` fails if a role's list changes

## Walkthrough record

**2026-09-22 — driven by Claude (agent) in a real browser; screenshots reviewed by the user.**
That distinction matters: this is agent-driven evidence, not a person using the app, and the six
judgement checks were answered from screenshots rather than from a device in the hand.

Review page: https://claude.ai/artifact/2guwfWpqpNCe9zx8sU3ots
Screenshots: `.walk/scenario-069/` (excluded from git via `.git/info/exclude`, deliberately kept).

### Observed

| Role | Open | Locked |
|---|---|---|
| bishop | 15 | 0 |
| org_president (Relief Society) | 5 | 10 |
| music_coordinator | 4 | 11 |
| ward_council_member | 3 | 12 |
| resource_center_specialist | 1 | 14 |
| stake_president | 0 | 15 |

- All 15 of the bishop's tiles: HTTP `200`, `redirected: false`, final path identical to the href.
- `/admin/audit-log` → **404**. `/sacrament` → **redirects to `/dashboard`**. Both absent from every
  grid.
- **Zero console errors on `/dashboard` for all six roles** — the two-per-page cost CLAUDE.md §9
  recorded is gone.
- Locked tiles: `<div>`, zero focusable descendants, reason rendered as text.
- `/tithing` typed directly by the music coordinator → the page's own "Not permitted" refusal with a
  sentence and a link back. No chrome bar there, confirming the `(tithing)` shell was not touched.
- 375px: `scrollWidth 360 === clientWidth 360`, nothing past the viewport, **0** controls under 44×44.
- No ward switcher for any of the six.
- `/roster` reports `redirected: true` and lands on `/roster?organizationId=…` — the roster module's
  own default-organization behaviour, **not** a bounce, and not P3's.

### Defects found, and FIXED on the user's instruction the same day

1. **There is no way to sign out from the dashboard.** `ChromeBar` returns `null` on `/dashboard`,
   which was specified to drop the redundant back link but takes the whole icon row with it — so the
   page sign-in lands on has no Sign out, no theme toggle, no bell, no Report an issue and no Help.
   `document.querySelector('header')` is `null` there and non-null on every other page.
   **`tests/components/layout/ChromeBar.test.tsx` asserts this behaviour and passes** — the test pins
   the bug as if it were the spec, so a fix must change that assertion deliberately.
2. **A role with no permissions gets 15 locked tiles, not the empty state.** `lockedItems` is every
   built module the person lacks, so `DashboardGrid`'s `needle.length === 0` empty branch is
   unreachable from the dashboard — the sentence the plan asked to keep is dead code. Each of the 15
   tells a stake president to "Ask a member of the bishopric", which is wrong advice for a role whose
   intended surface (CLAUDE.md §7) is one meeting's agenda plus the prayer roll.
   **FIXED, and more broadly than the defect:** the user's decision is that **a person sees only
   what they can open**, so locked tiles are gone from the app entirely. `DashboardGrid` no longer
   takes a `lockedItems` prop, the dashboard page no longer computes one, and the empty-state
   sentence is reachable again. `Tile` keeps its `locked` support — P1 owns that primitive — with a
   header saying nothing passes it and why.

### Re-verified in the browser after the fix (2026-09-22)

| Role | Tiles | Section headings | Un-clickable cards |
|---|---|---|---|
| bishop | 15 | 3 | 0 |
| music_coordinator | 4 | 1 — "Meetings & Programs" only | 0 |
| stake_president | 0 — the empty-state sentence | 0 | 0 |

- The chrome bar renders on `/dashboard` with Report an issue, Help, the bell and the account menu
  (theme toggle + Sign out inside), and **no back link**.
- "Harness Test Ward" appears **once**, in the bar — the duplicate in the collapsing extras was
  removed, since the bar now names the ward and never collapses.
- `npm run lint`, `npm run typecheck` and `npm run build` clean; 46 layout-component tests pass.

### Checklist corrections made during the walk

- **`resource_center_specialist` is no longer an empty-permission role.** The check asked for the
  empty-state sentence; proto-d gave the role `program.view` + `program.distribute` on 2026-09-21
  (CLAUDE.md §7 records it). The check was written from a stale sentence and **the app was right**.
  Rewritten to ask for exactly one open tile.
- **A sixth account was seeded — a `stake_president`** — because `STAKE_OFFICER_PERMISSIONS` is the
  only genuinely empty list, so it is the only role that can reach the empty state. Adding it is what
  surfaced defect 2, which nothing had walked before.

### Not walked

- The "both themes" check was answered in dark on the dashboard and on `/visits` only, not across
  every role's grid.
- Tap-target and overflow measurements were taken on the bishop's grid at 375px, not on all six.
- Tiles were verified by requesting each href with the real session rather than by clicking each one;
  the hrefs themselves were read from the rendered DOM. Clicking is scenario 070's job.

## Notes

The bishop is the slowest one to walk — it has the most tiles. Do that one first; if it is clean,
the other five are mostly reading.

The ward switcher's absence is the same guarantee scenario 065 walks. That scenario predates the
control existing at all, so this is the first walk where its absence is observable rather than
theoretical.
