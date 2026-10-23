---
name: The Sacrament tile alone
scope: ITER-044
part: 1
tags: [admin, released-modules, full]
prerequisites: none
---

## Purpose

"Sacrament meeting" on the released-modules list used to release five tiles: Sacrament, Topic
history, Program, Music and Calendar. Now it releases the Sacrament tile only, and the other four
are separate tickboxes. This scenario seeds the ward exactly as Buffalo will be after this ships
(Sacrament meeting and Tithing, nothing else). It proves the four split-off modules are hidden,
bounced and refused, and that the hub still renders without them. Seeding matters because it needs
a saved list, a super admin, and programme, music and rotation data that would be visible without
the list, so that "empty" means refused rather than nothing there.

## Seed Data

| Entity | Detail |
|---|---|
| Wards | 1: "Harness Test Ward", under "Harness Test Stake" |
| Released modules | `sacrament`, `tithing` |
| Users | `bishop` (bishop), `admin` (1st counselor **plus** app-wide super admin) |
| Sundays | Every Sunday this month and next; first Sundays are pinned Fast Sundays |
| Talks | One talk on each of the first three ordinary Sundays (Ruth Hallam, Owen Pryce, Lena Moss) |
| Programme | A draft on the first ordinary Sunday |
| Music | Opening hymn #2 "The Spirit of God" on the first ordinary Sunday |
| Rotation | admin, nobody, bishop, from the month's first Sunday |

**Sign in as:** `bishop@` or `admin@harness.wardleadershiptools.test`

## Steps

1. As `bishop`: open the dashboard.
2. Open the Sacrament tile (`/sacrament`). Open a Sunday's Talks pill, then `/prayers`.
3. Type `/music`, `/program`, `/calendar` and `/talks/topics` into the address bar, one at a time.
4. As `admin`: open the dashboard.
5. Open `/admin/stakes`. Press **Edit released modules** on Harness Test Ward. Tick **Music**, save.
6. As `bishop` again: reload the dashboard, then open `/music`. Type `/program` and `/calendar`.
7. As `admin`: set the ward's list back to **Everything (no list)** and save. As `bishop`: reload
   the dashboard.

## Verification checklist (machine-checkable)

- [ ] The bishop's dashboard shows exactly two tiles, Sacrament and Tithing, plus "More tools are
      on the way for Harness Test Ward."
- [ ] `/sacrament` renders with no error; its shortcut row has no Topic history, Program, Music or
      Calendar link
- [ ] No Sunday card on `/sacrament` links to `/program/…` or `/music…` (the date heading and the
      Music pill) — a link here would open "Not permitted" for a bishop *(added by the 2026-10-23
      walk, which found both)*
- [ ] `/assignments/<a Sunday id>` and `/prayers` open
- [ ] Typing `/music`, `/program`, `/calendar` and `/talks/topics` each lands on `/dashboard`
- [ ] The bishop's own client reads **no** row from `programs` or `conducting_rotation`, but
      **does** read the hymn selection; the service client reads all three
- [ ] `admin`'s dashboard shows every tile, with "Hidden from this ward" on Topic history, Program,
      Music and Calendar (and the other unreleased modules), and none on Sacrament or Tithing
- [ ] Stakes & Wards reads "Released: Sacrament meeting, Tithing"; the editor lists Topic history,
      Program, Music and Calendar as separate tickboxes and no Speakers & Prayers; at 375px there is
      no sideways scroll
- [ ] After ticking Music: `ward_release_settings.released_modules` is
      `["sacrament","music","tithing"]` and a `released_modules_updated` audit row names it
- [ ] The bishop then sees a Music tile (after a reload) and `/music` opens; `/program` and
      `/calendar` still land on `/dashboard`
- [ ] After setting Everything, the row is gone and the bishop sees every tile again (Topic
      history, Program, Music and Calendar included) with no "coming soon" line

## Needs a human eye

- [ ] Does the Sacrament hub, with no Calendar, Music or Program, read as a simpler page rather
      than a broken one? (It is temporary: ITER-045 replaces it.)
- [ ] In the release editor, do the five sacrament-area tickboxes read as one family, and is it
      clear that "Sacrament meeting" is now just the Sacrament tile?

## Walkthrough record

### 2026-10-23 — agent-driven (Claude, Playwright), screenshots for human review

**Driven by the agent** at 375px, signing in as each seeded user; every write read back with the
service client, and table reads made with the bishop's own signed-in client. **Migration 092 was
NOT applied** (still pending on the hosted project), so one check is blocked, not failed.
Screenshots in `testing/walk-screenshots/scenario-092/` (git-excluded).

Observed:
- Bishop dashboard tiles `["/sacrament","/tithing"]`; line "More tools are on the way for Harness
  Test Ward."
- `/sacrament`: h1 "Sacrament — October 2026", 4 Sundays, no error, scrollWidth 360 = clientWidth
  360, no shortcut row (every shortcut module is unreleased). **But each card links to
  `/program/<id>` (the date heading) and `/music?sunday=<id>` (the Music pill)** — see defect 1.
- `/assignments/<Oct 11>` opened ("What still needs to happen", Ruth Hallam listed); `/prayers`
  opened ("Prayers — October 2026").
- Typed `/music`, `/program`, `/calendar`, `/talks/topics` → each ended on `/dashboard`.
- Bishop's client vs service, harness ward: `programs` 1/1, `conducting_rotation` 3/3,
  `hymn_selections` 1/1, `assignments` 3/3. **Programmes and rotation still readable — BLOCKED on
  migration 092**, whose policy re-key is what hides them. `session_context().released_modules =
  ["sacrament","tithing"]`, `is_super_admin` false.
- Admin dashboard: 17 tiles; "Hidden from this ward" on all but `/sacrament` and `/tithing`.
- Stakes & Wards card "Released: Sacrament meeting, Tithing". Editor: 15 tickboxes in catalog order
  (Topic history, Program, Music, Calendar separate), no Speakers & Prayers, no "Not built yet";
  360 = 360 at 375px.
- Tick Music → Save: row `["sacrament","music","tithing"]`, `updated_by` = admin, audit
  `released_modules_updated` `{ modules: [same], targetWardId: <harness ward> }`. Bishop then saw
  `["/sacrament","/music","/tithing"]`; `/music` opened (h1 "Music"); `/program`, `/calendar` →
  `/dashboard`.
- Everything → Save: row gone, audit `modules: null`. Bishop then saw all 16 of their tiles, no
  "coming soon" line, no badge.

**Defects found:**
1. **The hub links to Program and Music where they are unreleased.** Clicking a Sunday's date
   (client-side) opened "Not permitted — Sacrament programs are limited to ward leadership"; the
   Music pill opened "Sacrament meeting music is limited to ward leadership". Both refuse, so
   nothing leaks, but they are offered-then-refused links (youth-a-D1) with a false reason for a
   bishop. Cause: `app/(app)/sacrament/page.tsx` builds `programHref` and the music pill href
   unconditionally. The plan (D2) expected them gone.

**Checklist corrected:** added the per-card link check above. The original item named only the
shortcut row, so it passed while the cards still linked out.

**The user's review (2026-10-23):** "Everything looks fine" on all four questions
(<https://claude.ai/artifact/CSsR16inV8iWiPQTpvfihL>). Defect 1 is **accepted, not fixed**: the
hub's programme and Music links stay until ITER-045 replaces the hub (D2 already said not to
polish it). The tile's description, the stripped-down hub and the release editor read as intended.
The per-card link check above therefore stays unticked for this hub on purpose.
**Re-checked after migration 092 was applied (2026-10-23, after the `dba1825` deploy):** the
bishop's own client read `programs` 0 (service 1) and `conducting_rotation` 0 (service 3), while
`hymn_selections` 1/1 and `assignments` 3/3 stayed readable. The blocked check passes.
`types/database.ts` regenerated unchanged.

Two element-only screenshots of the editor were retaken as one viewport shot: they were identical
(the app follows the account's saved theme, not the browser's emulated one), so they were not the
light/dark pair their names claimed.
