# ITER-044: Release the Sacrament tile on its own, and drop Speakers & Prayers

**Type:** Modification
**Status:** Completed
**Completed:** 2026-10-23
**Commit:** 00cb58d
**Plan:** plans/release-sacrament-tile-alone.md
**Created:** 2026-10-23

## Summary
On the super admin's released-modules list, "Sacrament meeting" releases the Sacrament tile and
nothing else. Topic history, Program, Music and Calendar each become their own tickbox. The
never-built "Speakers & Prayers" entry comes off the list.

## Context
Raised by the user 2026-10-23 while trying out ITER-041's released-modules control on a real ward.
With only Tithing ticked the dashboard was correct; ticking Sacrament meeting added **five** tiles
instead of one. The user's direction: a new Sacrament module they have already built elsewhere will
be brought in behind the Sacrament tile (a separate, larger item), replacing what is there today.
The other sacrament-area modules are then opened up one by one as each is connected to the new
work. So the release list needs to be granular enough to open the Sacrament tile alone.

Speakers & Prayers was a placeholder entry for ITER-042, which the user has cancelled in favour of
other plans.

## Current Behavior
- The release catalog has one module, "Sacrament meeting", that owns the permissions and pages for
  talks, topics, the programme, music and the calendar. Releasing it turns on five dashboard tiles:
  Sacrament, Topic history, Program, Music and Calendar. There is no way to release one without
  the others.
- "Speakers & Prayers" is listed as a tickbox, but the module was never built, so ticking it shows
  nothing.

## Desired Outcome
- Ticking **Sacrament meeting** releases the **Sacrament tile only**.
- **Topic history, Program, Music and Calendar are each their own tickbox.** In a ward that has not
  ticked one, it is hidden entirely: no tile, the address bounces to the dashboard, and its data is
  refused, the same as any other unreleased module.
- **Speakers & Prayers is no longer offered** on the release list.
- A ward set to **Everything** is unchanged and still sees all of them.
- Done when: a ward with only Tithing and Sacrament meeting ticked shows exactly those two tiles;
  typing the address for Music, Program, Calendar or Topic history there bounces back to the
  dashboard; and the release list offers those four as separate tickboxes and no Speakers &
  Prayers.

## Scope Notes
- **Out of scope:** replacing what sits behind the Sacrament tile with the user's already-built
  module. That is its own, larger item, still to be raised. Expect today's hub contents to be
  removed then, so don't polish them here.
- Splitting the catalog moves permission prefixes, page prefixes and tables between modules, and
  migration 091's database-level refusal is per module, so the split likely needs a migration as
  well as the catalog change. The guard tests that tie the catalog to permissions, pages and
  policies must stay green.
- `/talks/topics` (Topic history) sits under `/talks`, and the hub links into `/assignments`,
  `/prayers` and `/talks`. Planning must decide which of these pages belong to the Sacrament tile
  and which to the new modules.
- The hub today reads music, programme and calendar data. With those unreleased, parts of the hub
  may read empty in that ward. Acceptable given the hub is being replaced, but confirm nothing
  errors.
- Any ward whose saved list already includes "sacrament" or "speakers" must still load after the
  change: decide whether "sacrament" in a saved list should carry the four new modules with it (so
  nothing a ward has today disappears) or not.
- Buffalo's saved list already includes Sacrament meeting from the user's test, so it is the
  natural place to check the result.

## Open Questions
- When a ward's saved list already holds "sacrament", should the four split-off modules come with it
  automatically on the day this ships, or should that ward drop to the Sacrament tile alone? The
  user's intent for Buffalo is the tile alone.
