# P11 — Sacrament Administration

**Depends on:** P3. **Size:** Medium. **Status:** Stub — flesh out with `/planning` when approached.

**Load with this:** the retired [10-sacrament-admin.md](10-sacrament-admin.md) for the ordinance model and rotation reasoning.

> **This is a stub on purpose.** It carries the scope, the dependencies and the known traps, so
> `/planning` can write the real plan against what the code actually looks like by then rather
> than against a guess made on 2026-09-20. Do not treat the absence of detail as absence of scope.

Monthly ordinance assignments — bread blessing, water blessing, setup and takedown, bread
provider — managed by a designated youth account, with bishopric oversight and a public link.

**Carried forward from retired Phase 10**, whose file still holds the ordinance model and the
rotation reasoning. Read it for those; do not plan from it.

## What changed since it was written

- **The public names contradiction is this phase's to settle.**
  `lib/program/publicProjection.ts` publishes names **in full** by a product decision of
  2026-08-24, while migration 019's `public_sacrament_assignments` view still shortens to a last
  initial (`left(last_name, 1)`). CLAUDE.md §9 hands that question here by name. Two public pages
  disagreeing is the thing to fix.
- **The `sacrament_manager` youth account now sits inside the unit hierarchy** from P2. It has
  its own shell (`app/(youth)/`), deliberately mutually exclusive with the app shell — keep it
  that way.
- The prototype has a `sacrament-ordinance-coordinator` role with nothing behind it. Reconcile
  that with `sacrament_manager` rather than adding a second concept.

## Known traps

- Every field added to a public page is a privacy decision. Phone numbers, addresses, emails,
  member ids and the leadership contacts array are **absent** from the public projection type,
  not nulled — so publishing one is a type error rather than a review miss. Keep that shape.
- The page is served `noindex`. That is deliberate and smaller than the old shortening rule.
