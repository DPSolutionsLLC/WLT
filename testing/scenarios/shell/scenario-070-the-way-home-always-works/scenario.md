---
name: The way home always works
scope: P3
part: 1
tags: [shell, smoke]
prerequisites: none
---

## Purpose

The chrome-bar back link is the regression the phase file names as **the one most likely to be
reintroduced**. The prototype made it dynamic — following one step of history — and got genuinely
stuck: that mechanism tracks one step, overwritten on every navigation, so after a couple of hops
it ping-pongs between the last two pages and **permanently loses the path home**. Build note
§`dashboard-back-link-regression-fix` calls it "a real design flaw, not an edge case".

`tests/components/layout/ChromeBar.test.tsx` asserts the link is `/dashboard` from several
pathnames, and that is worth having — but it renders one component with a mocked pathname. **No
unit test can reproduce "after a couple of hops"**, because the failure needs a real session
accumulating real history.

The collapsing header is here for the same reason: the stutter it is built to avoid is a frame
-timing problem, and `plans/prototype/decisions.md` §6 still lists the prototype's version as
KNOWN UNFIXED after two attempts, with the note to *re-verify in the real environment*. This is
that environment.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop@harness.wardleadershiptools.test` (bishop) |
| Households | Brooks, 2201 Canyon Road |
| Members | Rachel Brooks (adult), Ethan Brooks (youth, Young Men) |
| Sundays | 2026-10-04, 2026-10-11 |

**Sign in with:** `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- shell/scenario-070-the-way-home-always-works`
2. `npm run dev`, then open http://localhost:3000 and sign in as the bishop.
3. From the dashboard, navigate **at least five hops deep across different modules**, for example:
   Roster → the Brooks household → Youth → Ethan's page → Calendar → 4 October → Program.
4. **At each stop**, read the chrome-bar back link's target (hover it, or read the status bar),
   then note it. Do not click it yet.
5. After the fifth hop, use the back link. Then walk a different five-hop path and use it again.
6. On any long page, scroll down slowly, then quickly, then back up.
7. Repeat the scroll at 375px and at desktop width, in both themes.

## Verification Checklist

### Machine-checkable

- [ ] The chrome-bar back link reads "Dashboard" and points at `/dashboard` at **every** stop,
      on both paths
- [ ] Using it from the fifth hop lands on `/dashboard`, not on the fourth
- [ ] It never alternates between the last two pages
- [ ] The chrome bar **does** render on `/dashboard`, carrying Report an issue, Help, the bell and
      the account menu — but with **no back link**, since a "← Dashboard" link there does nothing.
      *(Corrected during the walk of 2026-09-22: this read "does not render on /dashboard", which
      was the defect scenario 069 found — returning null took the whole icon row with it.)*
- [ ] The sticky title and search box stay visible through a full-page scroll, at 375px **and** at
      desktop width
- [ ] The calling line and the ward switcher collapse on scroll down and reveal on **any** upward
      scroll — not only at the top of the page
- [ ] **A single fast flick collapses it and it STAYS collapsed.** The collapse removes height from
      the document, the browser clamps the scroll position, and that fires a scroll event the hook
      must not read as the reader scrolling up
      *(the `900, 876, 900` feedback loop found on this walk)*
- [ ] No horizontal scrollbar at 375px on any page visited, including the chrome bar with all
      five of its controls
- [ ] `/admin` shows **exactly one** "← Dashboard" link, in the chrome bar — not one there and a
      second in the page's own header
      *(Corrected during the walk: this asked for `/admin/users` to carry a back link to `/admin`.
      That page is not rendered through `SubDashboard` — P3 converted only `/admin` itself — so the
      check described a state the app cannot reach. Nesting deeper than one level is a later
      phase's job, and `SubDashboard` takes an optional `backHref` for when it arrives.)*

### Needs a human eye

- [ ] The collapse is smooth **with no stutter on a fast scroll**, and the extras do not flicker
      back open a moment after collapsing. This is the one the prototype never fixed, and the walk
      of 2026-09-22 found WHY: the collapse was feeding its own scroll listener
- [ ] The reveal feels immediate rather than grudging — scrolling up a little brings the extras
      straight back
- [ ] With "reduce motion" on in the OS, the extras appear and disappear instantly rather than
      animating
- [ ] Both themes: the chrome bar and the sticky header read as raised surfaces belonging to the
      page, **not as holes cut into it**
- [ ] One-handed at 375px, the back link is reachable without shifting grip

## Failure Behavior

- [ ] Signing out from the account menu lands on `/login` and the back link is gone with the shell
- [ ] Opening a deep URL directly (no history at all) still shows a back link to `/dashboard` —
      it is computed from nothing, which is the whole point
- [ ] Automated: `tests/components/layout/ChromeBar.test.tsx` fails if the link is ever computed
      from `usePathname()`, `router.back()`, or a `backHref` prop

## Walkthrough record

**2026-09-22 — driven by Claude (agent) in a real browser.** Agent-driven evidence: the back-link
and scroll measurements are machine-read, not eyeballed.

### Observed

- **The back link was `/dashboard` at every one of seven stops**, across four modules:
  `/roster` → `/roster/household/{id}` → `/youth` → `/youth/profiles` → `/calendar` → `/program` →
  `/program/{id}`. `history.length` reached 21, then 26 on a second path.
- Using it from seven hops deep landed on `/dashboard`. Used again from `/visits/all-organizations`
  on a second path: also `/dashboard`. **It never alternated between the last two pages.**
- The sticky bar holds: `getBoundingClientRect().top` goes 77 → 0 and stays 0 through a full-page
  scroll; the search box stays visible throughout. At 375px and at 1280px.
- 375px: `scrollWidth 360 === clientWidth 360`, no horizontal scroll.
- `/admin` now renders exactly one "← Dashboard" (in the chrome bar); `mainBackArrows` = 0.

### Defect found and FIXED — the collapse was feeding its own scroll listener

Incremental scrolling collapsed and revealed correctly, but **a single large jump did not collapse
at all**. Instrumenting the scroll events showed the cause: one downward jump produced the sequence
**`900, 876, 900`**.

Collapsing removes the extras' height from the document; the browser clamps `scrollY` by that
amount; the hook read the clamp as a 24px UPWARD scroll, which is past `REVEAL_AFTER`, so it
revealed — restoring the height and the position. It settled back open, so a fast flick looked like
a header that simply refused to collapse. A small, consistent scroll hid it: 60px steps outrun a
24px rebound.

**This is almost certainly the bug `plans/prototype/decisions.md` §6 still lists as KNOWN UNFIXED in
the prototype after two attempts.**

**Fixed** in `components/layout/useCollapsingHeader.ts`: after the state flips, movement is ignored
for `SETTLE_MS` (250ms, covering the caller's 200ms transition) and `lastY` is re-baselined to
wherever the browser has left the page.

Re-verified in the browser — one jump from 0: collapses to `h: 0` and **stays** collapsed through
settling; an upward scroll of 56px reveals (`h: 24`); scrolling down again re-collapses.

⚠️ **No jsdom test could have found this.** jsdom has no layout, so nothing clamps and the second
event never fires. The regression test reproduces the rebound by hand with a controllable clock,
and says so in its header — it is a regression test, not a discovery tool.

### Defect found and FIXED — `/admin` rendered "← Dashboard" twice

Once in the chrome bar and once in `SubDashboard`'s own sticky header, about fifty pixels apart.
`SubDashboard`'s `backHref`/`backLabel` are now optional and `/admin` passes neither; the props
remain for a page nested deeper than one level, where the parent genuinely is not the dashboard.

### Checklist corrections made during the walk

Three, all recorded inline above: the chrome bar now renders on `/dashboard`; the ward line moved
to the chrome bar so the extras carry the calling line and switcher; and the `/admin/users` back
link check described a state the app cannot reach.

### Not walked

- The fast-scroll **feel** and the `prefers-reduced-motion` behaviour were not judged by eye — the
  collapse was measured, not watched. Worth one human look on a real phone.
- One-handed reachability at 375px is a device judgement and was not made.
- Both-themes reading of the chrome bar was covered by scenario 069's walk, not repeated here.

## Notes

**The hops must cross MODULES**, not just pages within one. The prototype's bug needed different
parents to ping-pong between; five stops inside `/roster` would not have caught it.

The fast-scroll stutter is easiest to see on a phone or with the browser devtools' CPU throttling
turned on. If it looks clean on a desktop at full speed, try it at 4× slowdown before ticking the
box.
