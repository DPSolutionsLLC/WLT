---
id: release-sacrament-tile-alone
type: feature
iter: ITER-044
commits: []
date: 2026-10-23
files:
  - types/domain.ts
  - lib/access/releasedModules.ts
  - lib/auth/navigation.tsx
  - supabase/migrations/092_split_sacrament_release.sql
  - testing/scenarios/admin/scenario-090-a-ward-that-released-some-modules/seed.ts
  - testing/scenarios/admin/scenario-092-the-sacrament-tile-alone/seed.ts
related: [released-modules-per-ward]
---

## What was done
The released-modules catalog's `sacrament` entry, which released five tiles, was split so
"Sacrament meeting" releases the Sacrament tile alone. Topic history, Program, Music and Calendar
are now their own keys, and the never-built `speakers` placeholder is gone. Migration 092 strips
`speakers` from saved lists (no list is widened), re-keys the `programs` and rotation-table
policies to `program` and `calendar`, and drops the policies on the three music tables.

## Key decisions
- **Topic history owns a route and nothing else.** Its page reads the talks, which stay
  Sacrament's, so `isReachable()` in `lib/auth/navigation.tsx` now also checks the tile's ROUTE
  module. Without it, can() alone would offer the tile everywhere.
- **Music owns no table.** `hymn_selections`, `musical_numbers` and `sunday_music` are written by
  Sacrament (cancelling a lost meeting's music) and read by Program. Restricting them to Music would
  make that cancellation a silent zero-row UPDATE, so Music is refused through `can()` alone.
- **The hub's links to unreleased modules were accepted, not fixed.** The walk found that each
  Sunday's date (to `/program/<id>`) and Music pill are built unconditionally in
  `app/(app)/sacrament/page.tsx`, so in a ward without them they open "Not permitted … limited to
  ward leadership" for a bishop. The user chose to leave it, because ITER-045 replaces the hub.

## Pitfalls met
- **A key removed from the catalog breaks tests that `tsc` cannot see.** `["speakers", …]` inside
  `toEqual()` and request bodies type-checks fine, and `tests/routes/released-modules.test.ts`
  (not named in the plan) would have started getting a 400. Grep for the string literal, not only
  the compile errors.
- **A checklist naming one place where links appear passes while another place still links.** The
  scenario checked the shortcut row only; the per-card links needed their own item.
- **The release state was decided in code; only the table refusal needed the migration.** The
  walk could run every UI check before 092 was applied, and the one RLS check was recorded as
  blocked rather than failed.
