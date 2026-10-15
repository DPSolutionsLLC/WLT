---
name: A ward that has released only some modules
scope: ITER-041
part: 2
tags: [admin, access, full]
prerequisites: none
---

## Purpose

A ward's released-modules list changes what people see from the same data. The bishop of a ward
that released only Speakers & Prayers and Tithing sees Tithing and a "coming soon" line. A typed
URL to anything else lands on the dashboard, and the database hides the rows. The super admin
sees everything, with the unreleased tiles marked, and is the only person who can change the list.

## Seed Data

| Entity | Detail |
|---|---|
| Wards | 1: "Harness Test Ward", under "Harness Test Stake" |
| Released modules | `speakers`, `tithing` |
| Users | `bishop` (bishop), `admin` (counselor **plus** app-wide super admin), `secretary` (ward secretary) |
| Data | 2 members, 1 bishopric agenda dated 2026-10-18 |

**Sign in as:** `bishop@`, `admin@` or `secretary@harness.wardleadershiptools.test`

## Steps

1. As `bishop`: open the dashboard.
2. Type `/roster`, `/agendas`, `/todos` and `/admin` into the address bar, one at a time.
3. Open `/tithing`.
4. As `admin`: open the dashboard. Look at the chrome bar and the tiles.
5. Open `/agendas`, then `/admin/stakes`.
6. On Stakes & wards, press **Edit released modules** on Harness Test Ward, tick **Agendas**, save.
7. As `bishop` again: open the dashboard, then Agendas.

## Verification checklist (machine-checkable)

- [ ] The bishop's dashboard has only the Tithing tile, and reads "More tools are on the way for
      Harness Test Ward."
- [ ] Each typed URL in step 2 ends on `/dashboard`; `/tithing` opens
- [ ] `GET /api/agendas` as the bishop answers **403**
- [ ] The bishop's own client reads **no** row from `agendas`; the service client reads one
- [ ] `admin` sees every tile; the unreleased ones carry "Hidden from this ward" and still open
- [ ] `admin`'s chrome bar shows **Admin view**; the bishop's does not
- [ ] `admin` opens `/agendas` (the agenda is listed) and `/admin/stakes` in this ward
- [ ] Stakes & wards reads "Released: Speakers & Prayers, Tithing" before the edit
- [ ] After the edit, `ward_release_settings.released_modules` includes `agendas`, and a
      `released_modules_updated` audit row names the ward and the keys
- [ ] The bishop then sees the Agendas tile and the 2026-10-18 agenda
- [ ] The secretary (who holds Tithing) sees the same as the bishop: the Tithing tile and the
      "coming soon" line, and nothing else

## Needs a human eye

- [ ] Does "More tools are on the way" read as a promise rather than as something broken?
- [ ] Is "Hidden from this ward" clear on a tile the super admin can still open? (Changed from "Not released here" after the 2026-10-15 walk.)
- [ ] Is the "Admin view" pill noticeable without being alarming?
- [ ] At 375px and in dark mode, do the release editor's checkboxes and the pill stay usable?

## Walkthrough record

### 2026-10-15 — agent-driven (Claude, Playwright), screenshots for human review

**Driven by the agent**, signing in as each seeded user; every write read back with the service client
and each user's own signed-in client. The judgement items are awaiting the user's review
(<https://claude.ai/artifact/KrpQ9RYZmXS5ibgmY4mSNT>). Screenshots in
`testing/walk-screenshots/scenario-090/` (git-excluded).

Observed:
- Bishop dashboard: tiles `["/tithing"]`; line "More tools are on the way for Harness Test Ward."; no
  Admin view pill. Secretary: identical. 375px dark: scrollWidth 375 = clientWidth 375.
- Typed `/roster`, `/agendas`, `/todos`, `/admin` → final URL `/dashboard`; `/tithing` → `/tithing`.
  One real address-bar navigation to `/roster` also landed on `/dashboard`.
- `GET /api/agendas` as bishop → 403 "You do not have permission to do that."
- `agendas` read: service 1 row (2026-10-18); bishop 0; secretary 0; admin 1. `members` read 2 for
  all three. `session_context()`: `released_modules = ["speakers","tithing"]` for all three,
  `is_super_admin` true only for admin.
- Admin dashboard: 17 tiles, 16 with "Not released here" (all but `/tithing`), none dimmed, all `<a>`;
  Admin view pill present; no coming-soon line. `/agendas` listed the Oct 18 agenda; `/admin/stakes`
  opened; card read "Released: Speakers & Prayers, Tithing".
- Edit → tick Agendas → Save: row `["speakers","tithing","agendas"]`, `updated_by` = admin,
  `updated_at` 2026-10-15T16:04:49Z; audit `released_modules_updated`
  `{ targetWardId: <harness ward>, modules: [same] }`. Bishop then saw tiles `["/agendas","/tithing"]`
  and, via the tile, the Oct 18 agenda; their own client read 1 agenda.

**Defects found:**
1. **Admin view pill overflows the chrome bar at 375px.** Dashboard: ward name truncated to "Har…"
   (clientWidth 41 of scrollWidth 128). Other pages: account button's right edge at 419px vs a 360px
   viewport, so the page scrolls sideways. Control: the bishop's bar on `/agendas` fits (375 = 375).
2. **Minor:** the card lists released modules in tick order ("…, Tithing, Agendas").

**Not from this work:** 28 `wlt-test` units and 12 wards from 7 test runs (2026-09-22 → 10-04) remain
in the hosted DB and appear on Stakes & Wards.

No checklist corrections were needed; the secretary item had been corrected before the walk (the
ward secretary holds Tithing).

### 2026-10-15 (later) — fixes re-checked, agent-driven

The user answered all five judgement questions **yes** and chose the fixes, plus a wording change:
the badge now reads **"Hidden from this ward"** (was "Not released here"), because "not released" on
a tile the super admin can still open read as a contradiction.

Re-walked at 375px dark as `admin`:
- Dashboard: ward name shown in full (not truncated), Admin view pill hidden, badges read "Hidden
  from this ward"; scrollWidth 360 = clientWidth 360.
- `/agendas`: account button's right edge at 359px inside 375px; no sideways scroll (375 = 375).
- Account menu: "Admin view. You see modules this ward has not released." (screenshot
  `06-fix-account-menu-375-dark.png`).
- Ticking Agendas on a ward holding `["speakers","tithing"]` stored `["speakers","agendas","tithing"]`
  (catalog order) and the card read "Released: Speakers & Prayers, Agendas, Tithing".

**Not from this work:** on inner pages the ward name beside "← Dashboard" is truncated for everybody
at 375px — the bishop's bar showed 31px of 128 on `/agendas`. The super admin's bar now matches it.
