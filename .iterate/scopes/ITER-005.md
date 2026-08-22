# ITER-005: Ward Role-Access Overrides Are Ignored by 25 of 62 Permission Checks

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-08-22

## Summary

`wards.settings.role_access` lets a ward change what a role may do. Two thirds of the app's
permission checks honour it; the other 25 read the hardcoded defaults and silently ignore the
ward's configuration — including every `admin.manage_users` check in the app.

Nothing writes `role_access` today, so this is latent. It becomes live the moment Phase 11 ships
the admin UI that owns the role-access matrix.

## Context

Found on 2026-08-22 while checking whether scenario 008's Failure Behavior 403 claims were
accurate (they were). The grep that answered that question showed `assertCan(user, "roster.manage")`
being called with no `roleAccess` argument, which led to counting the rest.

This is chronological drift, not a decision. `resolveRoleAccess()` arrived with calendar-c and
talks-a; every route written before it was never retrofitted, and nothing fails when a new one
forgets — the parameter defaults.

## Current Behavior

`assertCan()` and `can()` take role access as an **optional third parameter defaulting to the
hardcoded `ROLE_PERMISSIONS`**:

```ts
export function can(user, permission, roleAccess: RoleAccess = ROLE_PERMISSIONS): boolean
```

A caller that omits it gets the code defaults and never learns the ward configured something
different. Across `app/`, `lib/` and `components/`:

- **37 call sites pass** a resolved `roleAccess` — the four assignment routes, the two calendar
  routes, and every page under `app/(app)/`.
- **25 call sites do not.** By permission:

| Permission | Count | Where |
|---|---|---|
| `roster.manage` | 8 | households, households/[id], members, members/[id], members/[id]/notes ×2, members/[id]/organizations, roster/bulk-assign |
| `admin.manage_users` | 5 | admin/users, admin/users/youth, admin/users/[id], admin/users/[id]/reset-pin, auth/invite |
| `calendar.view` | 3 | conducting-rotation, sundays, ward-settings/calendar |
| `roster.view` | 2 | households, members |
| `roster.import` | 2 | roster/import, roster/import/preview |
| `calendar.manage` | 2 | sundays, sundays/[id] |
| `admin.manage_ward` | 2 | conducting-rotation, ward-settings/calendar |
| `sacrament.view_assignments` | 1 | `app/(youth)/sacrament/page.tsx` |

**`mergeRoleAccess()` replaces a role's list rather than merging into it**, so an override can
widen as well as narrow. Both directions are broken by these 25:

- **Narrowed and ignored → fails open.** A ward removes `roster.manage` from a role; the route
  allows the write anyway. `resolveRoleAccess()`'s own comment says silently substituting the
  defaults "could grant a role something the ward had deliberately removed" — which is exactly
  what these 25 do.
- **Widened and ignored → fails closed.** A ward grants `talks.plan` to the executive secretary;
  the route refuses, and the admin screen says it should work.

**`PUT /api/members/[id]/organizations` and `POST /api/roster/bulk-assign` are the sharpest
cases.** Migration 019's ward-scoped policy loop grants INSERT, UPDATE and DELETE on
`member_organizations` to *every authenticated member of the ward*, so RLS is not a boundary
there at all — `assertCan(user, "roster.manage")` is the only thing standing in the way, and it
is one of the 25 reading stale defaults. CLAUDE.md rule 2 says RLS is the security boundary; this
is a documented exception where it is not, and the substitute check is the weak one.

**One route is inconsistent with itself.** `app/api/conducting-rotation/route.ts` resolves the
override on its `orgId !== null` branch and skips it on the `orgId === null` branch. The comment
there calls it a carry-forward from calendar-a rather than a decision.

## Desired Outcome

Every permission decision in the app reflects the ward's configuration, and it is not possible to
add a new check that silently does not.

Done looks like: a ward that removes `roster.manage` from `ward_secretary` finds the roster write
routes refuse it; a ward that grants an extra permission finds it works; and a new route that
forgets to resolve role access **fails to compile**.

## Scope Notes

- **Make the parameter required rather than retrofitting 25 call sites by hand.** Dropping the
  `= ROLE_PERMISSIONS` default turns every missing argument into a type error, so the compiler
  produces the worklist and no future call site can drift. Retrofitting without that change fixes
  today's 25 and leaves the trap armed. This is the same move as the discriminated union in
  `updateAssignmentSchema` — make the mistake unrepresentable instead of discouraged.
- **`resolveRoleAccess()` is a database read per call, and it is not cached.** Wrapping it in
  React `cache()` would dedupe it for pages, but **not** for route handlers: `cache()` is inert
  outside a request scope, measured during the route-tests slice (see
  `plans/retros/route-tests-and-realtime.md`). Routes that check several permissions should
  resolve once into a local and pass it, as the assignment routes already do.
- **Some routes call `assertCan()` before creating the Supabase client** (`roster/bulk-assign` is
  one). Resolving role access needs the client, so those bodies get reordered. Keep the
  permission check ahead of any row read so the refusal stays a 403 and never becomes a 404.
- **`resolveRoleAccess()` throws on a read failure rather than falling back**, which is correct
  and must stay — falling back to defaults on a failed read is the fail-open case again. Expect
  the error path to surface as a 500 on routes that currently cannot fail there.
- **The youth page is a separate risk.** `app/(youth)/sacrament/page.tsx` gates the one module a
  `sacrament_manager` can reach. Widening that by override is a real product question, not just a
  consistency fix — Phase 11 should decide whether `sacrament.*` is overridable at all.
- **Phase 11 owns the matrix** (`plans/11-notifications-admin.md`). This work should land
  **before** that UI ships, not with it: an admin screen whose settings are ignored by 25 checks
  is worse than no screen, because it makes a promise the app does not keep.
- Tests: `tests/lib/permissions.test.ts` covers `mergeRoleAccess` already. The gap is route-level
  — `tests/helpers/routeClient.ts` now makes it cheap to seed a ward whose `settings.role_access`
  narrows a role and assert the route refuses.

## Open Questions

- **Is every permission overridable, or only some?** Letting a ward grant itself
  `admin.manage_roles` is a privilege-escalation shape. A deny-list of non-overridable
  permissions may belong in `types/domain.ts` alongside `ADMIN_PERMISSIONS`.
- **Should `mergeRoleAccess` replace or merge?** Replacing means an override must restate every
  permission a role keeps, so a ward adding one permission silently drops the rest. That is
  arguably a worse footgun than the one this scope fixes, and it is invisible until Phase 11
  writes the first override.
- Does the bishop/counselor equivalence (CLAUDE.md §7) survive overrides? Nothing currently stops
  an override granting the bishop something a counselor lacks, which the project forbids
  everywhere else.
