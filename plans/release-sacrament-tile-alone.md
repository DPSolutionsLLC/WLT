# Plan: Release the Sacrament tile on its own

**Created:** 2026-10-23
**Type:** feature
**Scope refs:** ITER-044

## Overview

On Stakes & Wards, the super admin's released-modules list has one entry, **Sacrament meeting**,
that owns five dashboard tiles: Sacrament, Topic history, Program, Music and Calendar. This change
splits it so **"Sacrament meeting" releases the Sacrament tile only**, and **Topic history,
Program, Music and Calendar each get their own tickbox**. The never-built **Speakers & Prayers**
placeholder (ITER-042, cancelled) comes off the list.

This prepares for ITER-045, which puts the bishopric's Sacrament Planner behind the Sacrament tile.
The other four are opened one at a time later. ITER-046 (access by title) will later replace the
per-ward checkboxes entirely, so **change the catalog shape as little as possible**: no new
mechanism, just more catalog entries.

### Decisions (settled with the user 2026-10-23)

| # | Decision |
|---|---|
| D1 | **Saved lists are NOT widened.** A ward whose saved list holds `sacrament` drops to the Sacrament tile alone (Buffalo's intended state). `speakers` is removed from every saved list by the migration. A ward with no row (Everything) is unchanged. |
| D2 | **The hub may degrade quietly** in a ward without Calendar/Music/Program released, until ITER-045 replaces it. No automatic month generation, no Sunday editor, no removing a talk (all gated on `calendar.manage`), no music or programme pills. It must **not error**: the hub already uses `can()`, never `assertCan()`. |
| D3 | **Topic history owns a route and no permission and no table.** Its page reads the talks (`assignments.topic_title`, via `listTopicHistory()`), which are Sacrament's, and `topics.manage` is used by the hub's Finalize topics and by music approval. So `topics.*` stays with Sacrament. Topic history is hidden by its **route**: the bounce already works by route, and the tile is hidden by a new route check in `isReachable()` (Task 3). |
| D4 | **Music's tables become shared (no release policy).** `hymn_selections`, `musical_numbers` and `sunday_music` are read and written by Sacrament (the hub's `listSelections`, `cancelSundayWork()` in `lib/calendar/queries.ts`, the reconcile in `lib/sacrament/conductorHandover.ts`) and by Program (`lib/program/gather.ts`, the programme page's "Music not approved yet" line), as well as by Music. Migration 091's own rule is that a table read by more than one module stays unrestricted, because refusing it with one module breaks another that is released. Restricting them to `music` would make Sacrament's cancellation of a lost meeting's hymns a silent zero-row UPDATE. Music is still refused through `can()` (every music page and route gates on `music.*`) and the bounce. |
| D5 | **Program owns `programs`; Calendar owns `conducting_rotation` and `sunday_org_conducting`.** Verified 2026-10-23: `programs` is read only by `lib/program/queries.ts` (music imports only the pure `resolveSiteUrl()`), and both rotation tables only by `lib/calendar/queries.ts` from the calendar pages, the rotation/org-conducting routes, and generation, which the hub runs only under `calendar.manage`. |
| D6 | `topics` and `topic_candidates` (retired, read by nothing) stay with Sacrament. Moving them would be churn. |

### Success criteria

- A ward with only **Tithing + Sacrament meeting** ticked shows exactly those two tiles to an
  ordinary bishopric member, and the hub's shortcut row shows no Topic history / Program / Music /
  Calendar links.
- Typing `/music`, `/program`, `/calendar` or `/talks/topics` there **bounces to `/dashboard`**.
- In that ward the hub (`/sacrament`) **renders without an error**, and `/assignments/[sunday_id]`
  and `/prayers` still open.
- The release list on Stakes & Wards offers **Topic history, Program, Music, Calendar** as separate
  tickboxes and **no Speakers & Prayers**.
- A ward set to **Everything** sees every tile as before.
- The super admin still sees every tile, with "Hidden from this ward" on each unreleased one.
- All guard tests stay green: `releasedRoutesCovered`, `module-release-policies`,
  `navigationRoutesExist`, `permissions`, `migrations`.

## Relevant Files

- `types/domain.ts` — modify — `RELEASED_MODULE_KEYS`: remove `speakers`, add `topic_history`,
  `program`, `music`, `calendar`.
- `lib/access/releasedModules.ts` — modify — split the `sacrament` entry into five, delete the
  `speakers` entry, fix comments that name Speakers & Prayers.
- `lib/auth/navigation.tsx` — modify — `isReachable()` also requires the tile's route module to be
  released.
- `supabase/migrations/092_split_sacrament_release.sql` — create — remove `speakers` from saved
  lists; move the release policies on `programs` and the two rotation tables; drop them on the three
  music tables.
- `types/database.ts` — regenerate only if `npm run db:types` shows a change (none expected; no
  columns or functions change).
- `tests/lib/releasedModules.test.ts` — create or extend (check whether a test of `moduleForPath`
  exists first; extend it if so) — path ownership after the split.
- `tests/lib/navigation.test.ts` — modify — tile hiding by route.
- `tests/lib/permissions.test.ts` — modify — the `released-module narrowing` block gains split
  cases.
- `tests/components/admin/StakesAndWards.test.tsx` — modify — line ~221 sends
  `["speakers", "tithing"]`; replace `speakers` with a key that exists, and assert the new tickboxes
  appear and Speakers & Prayers does not.
- `testing/scenarios/admin/scenario-090-a-ward-that-released-some-modules/seed.ts` and
  `scenario.md` — modify — the seed uses `["speakers", "tithing"]`, which no longer type-checks.
- `testing/scenarios/admin/scenario-092-the-sacrament-tile-alone/` — create — `scenario.md`,
  `seed.ts` (follow scenario 090's folder exactly).
- `testing/manifest.json` (or wherever `npm run manifest` writes) — regenerate.
- `SPEC.md` (§ released modules, ~line 55), `FEATURES.md` (~line 193), `CLAUDE.md` §9 (the
  "A WARD CAN RELEASE ONLY SOME MODULES" entry) — modify — record the split and D3/D4.

## Dependencies

- No new libraries.
- Reuse: `moduleForPath()`, `isModuleReleased()` (`lib/access/releasedModules.ts`),
  `module_release_policies()` RPC (migration 091) for the policy test.
- One migration to apply to the hosted DB (`supabase db push --dry-run` first, then
  `supabase db push`). It only narrows/moves restrictive policies and edits saved arrays.
- **Deploy order:** the migration is safe before or after the deploy. Old build + new DB: an
  old build reading `released_modules` without `speakers` is fine; programmes and rotation stay
  refused under the old key `sacrament` until the policy moves, and after it moves to `program`,
  an old build in a ward holding `sacrament` would read programmes empty for the minutes between
  push and deploy. Acceptable. **Apply the migration right after the deploy is live** to keep that
  window short.

## Known Pitfalls (from retro context)

- **released-modules-per-ward** — *cross-module reads read empty*, and nothing but the catalog
  review catches it. D4 and D5 are that review. Re-run the grep in Task 1's details if any table
  moves differently than planned.
- **released-modules-per-ward** — *line endings*: Python on Windows rewrote files as CRLF and broke
  the trigger-drift test that parses `SPEC.md`. Edit with the Edit tool.
- **released-modules-per-ward** — *the bounce covers typed URLs and full loads only*. Do not try
  to "fix" client navigation here; `can()` and RLS are the real boundary. For Topic history (no
  permission of its own) that means a client-side link could still render the page. That is why
  Task 3 hides the tile and every shortcut row link, so no in-app link to it exists.
- **ward-callings-model** — `HELD_BACK_UNTIL_DEPLOYED` is documentation, not a mechanism. Nothing
  here needs holding back, but do not create a second migration "for later".

## Tasks

### Task 1: Catalog keys

**File:** `types/domain.ts` (modify)
**Action:** Replace `RELEASED_MODULE_KEYS` with, in this order:
`"sacrament", "topic_history", "program", "music", "calendar", "agendas", "roster", "visits",
"youth", "tithing", "personal_tools", "knowledge", "ai_settings", "admin", "sacrament_ordinances"`.
**Details:**
- `speakers` is removed. `lib/auth/session.ts`'s `toReleasedModules()` already drops unknown keys
  with a `console.warn`, so a stale `speakers` cannot crash a session even before the migration
  runs.
- Run `npm run typecheck` immediately. Every compile error is a place that names `speakers`. The
  known ones are scenario 090's seed and the StakesAndWards test.

### Task 2: Split the catalog entry

**File:** `lib/access/releasedModules.ts` (modify)
**Action:** Replace the `sacrament` and `speakers` entries with five entries, in key order:

| key | label | description | permissionPrefixes | routePrefixes | tables |
|---|---|---|---|---|---|
| `sacrament` | Sacrament meeting | The Sacrament tile: each Sunday's talks, prayers and topics. | `talks.`, `topics.` | `/sacrament`, `/assignments`, `/prayers`, `/talks` | `assignments`, `assignment_approvals`, `assignment_comments`, `assignment_history`, `talk_references`, `prayer_assignments`, `topics`, `topic_candidates` |
| `topic_history` | Topic history | Every topic used, when, and by whom. | *(none)* | `/talks/topics` | *(none)* |
| `program` | Program | Build, approve and publish the sacrament programme. | `program.` | `/program` | `programs` |
| `music` | Music | Hymns, the chorister and organist, and music review. | `music.` | `/music` | *(none)* |
| `calendar` | Calendar | Every Sunday, who conducts, and the rotation. | `calendar.` | `/calendar` | `conducting_rotation`, `sunday_org_conducting` |

**Details:**
- All five are `built: true`.
- `/talks/topics` is longer than `/talks`, so `moduleForPath()`'s longest-prefix rule already sends
  it to `topic_history`. Keep `/talks` on Sacrament so the top-level folder `talks` stays covered by
  `tests/lib/releasedRoutesCovered.test.ts`.
- Add a short comment above `topic_history` and `music` saying why they own no table (D3, D4), in
  the style of the existing roster comment. Update the roster comment ("Speakers & Prayers reads the
  people") to say other modules read the people.
- `assertPermissionsArePlaced()` needs no change. A module with no permission prefixes is already
  allowed (the old `speakers` entry had none).

### Task 3: Hide a tile whose route is unreleased

**File:** `lib/auth/navigation.tsx` (modify)
**Action:** In `isReachable()`, add a third condition: the module owning `item.href` is released.
```ts
function isReachable(item, user, roleAccess): boolean {
  if (!item.built || !can(user, item.permission, roleAccess)) return false;
  const owningModule = moduleForPath(item.href);
  return owningModule === null || isModuleReleased(user, owningModule);
}
```
**Details:**
- Import `moduleForPath` and `isModuleReleased` from `@/lib/access/releasedModules`. Check for an
  import cycle: `releasedModules.ts` must not import `navigation.tsx` (it does not today).
- This one change covers the dashboard grid, the quick-links modal and the hub's shortcut row,
  because all three go through `isReachable()`.
- `isModuleReleased()` returns true for the super admin, so the super admin keeps every tile and
  the dashboard's existing "Hidden from this ward" badge logic (`app/(app)/dashboard/page.tsx`) is
  unchanged.
- It is needed for Topic history only (the other four are already hidden through `can()`), but it
  is correct for all of them, so do not special-case it.

### Task 4: Migration 092

**File:** `supabase/migrations/092_split_sacrament_release.sql` (create)
**Action:** Write a migration with a header comment in the style of 091 explaining D1, D4 and D5,
then:
```sql
-- D1: Speakers & Prayers was never built; nothing else in a saved list changes.
update ward_release_settings
   set released_modules = array_remove(released_modules, 'speakers')
 where 'speakers' = any (released_modules);

-- D4: shared by Sacrament, Program and Music, so no module may refuse them.
drop policy hymn_selections_module_released on hymn_selections;
drop policy musical_numbers_module_released on musical_numbers;
drop policy sunday_music_module_released    on sunday_music;

-- D5: re-key to the module that now owns them. Same shape as 091 (restrictive, to authenticated,
-- the call wrapped in (select …) so it is an initPlan).
drop policy programs_module_released on programs;
create policy programs_module_released on programs as restrictive for all to authenticated
  using ((select ward_module_released('program')))
  with check ((select ward_module_released('program')));
-- …and the same for conducting_rotation and sunday_org_conducting with 'calendar'.
```
**Details:**
- **Check the policy names first** by reading 091's `do` block: they are
  `<table>_module_released`. Use `drop policy if exists` only if you've confirmed the name. A silent
  no-op drop would leave the old `sacrament` key in place, and the policy test would then fail,
  which is the intended safety net.
- **Do not touch `updated_by` / `updated_at`** in the UPDATE. This is a catalog cleanup, not a
  super admin's decision. Write no audit row (it is a migration, not a mutation by a person).
- Leave a closing comment listing which sacrament-area tables are deliberately unrestricted after
  this, extending 091's "DELIBERATELY NOT RESTRICTED" list.
- Apply: `npx supabase db push --dry-run`, confirm only 092 is pending, then `npx supabase db push`.
  The connection may time out; retry. Then `npm run db:types` and confirm `types/database.ts` is
  unchanged.

### Task 5: Admin tickbox list

**File:** `app/(app)/admin/stakes/StakesAndWards.tsx` (read; modify only if needed)
**Action:** The tickboxes render from `RELEASED_MODULES` (line ~320), so the new entries appear and
Speakers & Prayers disappears with no change. Verify that, and that the "Not built yet" pill now
renders for nothing. If the edit dialog is now taller than a phone screen (15 tickboxes instead of
12), check it scrolls at 375px. The retro recorded a phone-width overflow on this page.

### Task 6: Tests

See Testing Strategy. Write them alongside Tasks 2–4.

### Task 7: Harness scenarios

Update scenario 090 and create scenario 092 (see Test Scenarios). Then run `npm run manifest` and
`npm run harness:typecheck`.

### Task 8: Docs

- `SPEC.md` released-modules block: list the module keys and state D3/D4 (Topic history and Music
  own no table, and why).
- `FEATURES.md` ~line 193: Sacrament meeting releases the Sacrament tile alone, and Topic history,
  Program, Music and Calendar are separate tickboxes.
- `CLAUDE.md` §9, the "A WARD CAN RELEASE ONLY SOME MODULES" entry: add one short paragraph saying
  `sacrament` was split (ITER-044, migration 092), naming D3 and D4, and that `speakers` is gone.
  Keep it short; that entry is already long.

## Testing Strategy

**Pure tests (fast, no database):**

- `tests/lib/releasedModules.test.ts` (extend if a `moduleForPath` test already exists elsewhere;
  `grep -rn "moduleForPath" tests` first):
  - `/talks/topics` → `topic_history`; `/talks` → `sacrament`; `/assignments/x` → `sacrament`;
    `/prayers` → `sacrament`; `/program/x` → `program`; `/music` → `music`;
    `/calendar/sunday/x` → `calendar`; `/sacrament` → `sacrament`; `/sacrament/ordinances` →
    `sacrament_ordinances`.
  - `isReleasedModuleKey("speakers")` is false.
- `tests/lib/permissions.test.ts`, in `released-module narrowing`:
  - A bishop in a ward with `["sacrament", "tithing"]`: `can(talks.view)` and `can(topics.manage)`
    true; `can(music.view)`, `can(program.view)`, `can(calendar.view)`, `can(calendar.manage)`
    false.
  - With `["sacrament", "music"]`: `music.manage` true and `program.view` false. This proves each
    split module is independent, not just all-or-nothing.
  - The existing "changes nothing when the ward has no list" loop covers Everything.
- `tests/lib/navigation.test.ts`:
  - A bishop with `["sacrament", "tithing"]`: `visibleNavigationItems()` hrefs include
    `/sacrament` and `/tithing` and **exclude** `/talks/topics`, `/program`, `/music`, `/calendar`.
    This is the ITER-044 done-criterion as a test.
  - With `["sacrament", "topic_history"]`: `/talks/topics` included. This proves the route check
    is not just always false.
  - The same bishop with `isSuperAdmin: true`: all five included.
  - The hub's shortcut-row helper (the function at ~line 395) with Topic history unreleased omits
    it.
- `tests/components/admin/StakesAndWards.test.tsx`: replace `speakers` in the existing send
  assertion (e.g. `["sacrament", "tithing"]`). Add one assertion that the dialog lists "Topic
  history", "Program", "Music" and "Calendar" and does **not** list "Speakers & Prayers".

**Database tests (hosted DB, after Task 4 is applied):**

- `tests/db/module-release-policies.test.ts` — **no edit**; it compares the catalog with
  `pg_policies` both ways. It must pass unchanged. That is the proof that D4/D5 match the
  migration. If it fails, fix the side that is wrong; do not loosen the test.
- `tests/db/migrations.test.ts` — no edit; it must see 092 applied.
- Negative-path RLS check (add to the existing release RLS suite if one exists:
  `grep -rln "ward_release_settings\|setReleasedModules" tests`): a bishop in a ward with
  `["sacrament"]` reads **zero** `programs` rows and **zero** `conducting_rotation` rows, while a
  bishop in a ward with `["sacrament", "program", "calendar"]` reads the seeded ones. Seed so the
  rows would be visible under every *other* policy (same ward, a bishopric role), so the release
  rule is the only reason for the refusal (CLAUDE.md global rule on negative-path data).
  Also assert `hymn_selections` **is** readable with `["sacrament"]` (D4).

## Test Scenarios (Harness)

### Scenario 090 (update): a ward that released some modules

**Change:** the seed's `setReleasedModules(TEST_WARD_ID, ["speakers", "tithing"])` becomes
`["tithing"]`. In `scenario.md`, replace every "Speakers & Prayers" with what the walk now
shows: the ward released Tithing only, and the "coming soon" line still appears. Edit the recorded
expected values (`["speakers","tithing"]`, "Released: Speakers & Prayers, Tithing") to match. Mark
in the scenario that it was revised for ITER-044 so an old walk record is not mistaken for a
failure.

### Scenario 092: The Sacrament tile alone

**Tags:** admin, released-modules, full
**Purpose:** Shows the exact ward Buffalo will be after this ships: Sacrament meeting and Tithing
released, nothing else. It proves that the four split-off modules are hidden, bounced and refused,
and that the hub still renders. Seeding matters because it needs a ward with a saved list, a
super admin, a bishop and some programme/music/rotation data that would be visible without the
list.
**Seed data summary:**
- Ward release list: `["sacrament", "tithing"]` on the scenario's test ward
- Users: a super admin with a calling in the ward; a bishop (ordinary)
- A few Sundays in the current month with a talk each, a programme draft on one, a hymn selection on
  one, and a conducting rotation. That way "empty" means refused or degraded, not just nothing
  there.
**Tester action:** Sign in as the bishop, look at the dashboard, open the Sacrament hub, type the
four addresses by hand. Then sign in as the super admin, open Stakes & Wards, edit the ward's list,
tick Music, save, and sign back in as the bishop.
**Verification checklist:**
- [ ] Bishop's dashboard shows exactly two tiles: Sacrament and Tithing, plus the "coming soon" line
- [ ] `/sacrament` renders with no error; its shortcut row has no Topic history / Program / Music / Calendar link
- [ ] Typing `/music`, `/program`, `/calendar` and `/talks/topics` each lands on `/dashboard`
- [ ] `/assignments/<a Sunday id>` and `/prayers` still open
- [ ] Super admin's dashboard shows all tiles, with "Hidden from this ward" on Topic history, Program, Music and Calendar
- [ ] Stakes & Wards card reads "Released: Sacrament meeting, Tithing"; the edit dialog lists Topic history, Program, Music and Calendar separately and no Speakers & Prayers; it fits a 375px screen
- [ ] After ticking Music and saving, the bishop sees a Music tile (after a reload) and `/music` opens; Program and Calendar are still hidden
- [ ] A ward with no list (the ordinary test ward) still shows every tile

## Validation Commands

```bash
# Linting
npm run lint

# Type checking (app, then harness)
npm run typecheck
npm run harness:typecheck

# Targeted tests first (fast)
npx vitest run tests/lib/releasedModules.test.ts tests/lib/navigation.test.ts tests/lib/permissions.test.ts tests/lib/releasedRoutesCovered.test.ts tests/lib/navigationRoutesExist.test.ts tests/components/admin/StakesAndWards.test.tsx

# After migration 092 is applied
npx vitest run tests/db/module-release-policies.test.ts tests/db/migrations.test.ts

# Full suite (≈50–75 min on the shared hosted DB; stop any dev server first; rerun timeouts alone)
npm test

# Scenario manifest still in step with the scenario files
npm run manifest
git status --short

# Production build (never while `npm run dev` is running; memory is tight)
npm run build
```

## Integration Notes

- **What moves for whom on deploy day:**
  - Wards with **no** release row (every ward except those the super admin configured): nothing.
  - **Buffalo** (saved list held `speakers`, `tithing`, and from the user's test `sacrament`): it
    becomes `sacrament`, `tithing`, so the Sacrament tile and Tithing, as intended (D1).
  - Any other ward with a saved list that included `sacrament` loses Topic history, Program,
    Music and Calendar until the super admin ticks them. Before applying, list the saved rows
    (`select ward_id, released_modules from ward_release_settings;` via the service role or the
    Supabase SQL editor) and **tell the user which wards are affected**. Do not change them
    without asking.
- **ITER-045** will replace what `/sacrament` renders. The hub's degraded state (D2) is
  temporary. Don't polish it.
- **ITER-046** will replace `ward_release_settings` with title × module levels. The five module
  keys added here are the granularity it asked for ("plan ITER-044 with it in mind"). Keep the
  keys stable, since ITER-046 will need to carry them over.
- `lib/access/accessModules.ts` (the access-request catalog) is a **different** catalog and is
  **not** changed here.
- No route handler, page or RLS policy outside the release policies changes. No new audit event:
  the existing `released_modules_updated` audit on the PUT route already records the new keys.
