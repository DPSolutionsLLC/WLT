---
id: role-access-overrides
type: bugfix
iter: [ITER-005]
commits: []
date: 2026-08-22
files:
  - lib/auth/permissions.ts
  - lib/auth/navigation.ts
  - lib/calendar/orgRotationScope.ts
  - app/api/conducting-rotation/route.ts
  - app/(youth)/sacrament/page.tsx
  - app/(app)/layout.tsx
  - tests/helpers/seed.ts
  - testing/infrastructure/seedUtils.ts
  - CLAUDE.md
  - plans/11-notifications-admin.md
related: [foundation-c-services, calendar-c-rotation-cadence, talks-a-pipeline-core, route-tests-and-realtime, auth-b-invites-admin, roster-b-picker-and-orgs]
fixes: foundation-c-services
---

## What was broken

`wards.settings.role_access` lets a ward change what a role may do. 37 of the app's 62 permission
checks honoured it; the other **25 read the hardcoded `ROLE_PERMISSIONS` defaults and silently
ignored the ward's configuration** — including every `admin.manage_users` check in the app.

Latent, because nothing writes `role_access` yet. It would have gone live the moment Phase 11
shipped the admin screen that owns the matrix, and it fails in **both** directions: a ward that
removed a permission would find the route still allowing the write (fail-open), and a ward that
granted one would find the route still refusing it (fail-closed).

Two smaller defects rode along. The stored shape was replace-the-list, so any ward with an override
for a role would never receive permissions added in later phases. And `PATCH /api/conducting-rotation`
resolved the override on one branch of an `if` and not the other, with a comment calling that a
carry-forward rather than a decision.

## Root cause

Chronological drift made invisible by a default parameter.

```ts
export function can(user, permission, roleAccess: RoleAccess = ROLE_PERMISSIONS): boolean
```

`can()` and `assertCan()` shipped with `foundation-c-services`. `resolveRoleAccess()` arrived much
later, with `calendar-c` and `talks-a`. Every route written in between was correct when written and
was never retrofitted — and **nothing failed when a new one forgot**, because the third parameter
defaulted to the very thing the feature exists to override. The compiler was satisfied, lint was
satisfied, and every test passed, because the defaults are what the tests asserted against.

The same trap was copied into two more helpers that take `RoleAccess`: `manageableOrgIds()` had
`= ROLE_PERMISSIONS`, and `visibleNavigationItems()` had `roleAccess?: RoleAccess`.

## What fixed it

1. **Deleted the default from all four signatures**, making a missing argument a type error. The
   compiler then produced the worklist: exactly 25 errors across 19 files, matching the audit.
   This is the whole fix — the retrofit was mechanical once the compiler was allowed to speak.
2. **Retrofitted all 25 call sites** to create the client, resolve the override into a local, and
   pass it — with `assertCan` still ahead of every row read, so a refusal stays a 403 and never
   becomes a 404.
3. **Added `NON_OVERRIDABLE_PERMISSIONS`**, derived from the `admin.` and `sacrament.` prefixes
   rather than hand-listed. `mergeRoleAccess` restores the code default for those in both
   directions.
4. **Changed the stored shape to per-role add/remove deltas**, resolved against the current code
   defaults, and parsed per role so one malformed value no longer discards every sibling's valid
   configuration.
5. **Enforced bishop/counselor equivalence inside `mergeRoleAccess`** — a delta naming either role
   is unioned and applied to both.
6. Corrected the doc comments that said an override "can only ever *narrow* access" — untrue
   before this change and plainly untrue after it.

Proven by `tests/routes/role-access-overrides.test.ts` (9 cases over real handlers against the
hosted project) and 30-odd new unit cases. Scenario 014 walked end to end: the ward secretary's
granted write succeeded, and the bishop **and the unnamed counselor** both lost the Sunday editor.

## Pattern

**A defaulted parameter whose default is the thing being overridden cannot fail loudly.** It is not
a convenience with a small correctness cost; it is a silent opt-out from a security feature, and it
recruits every future call site automatically. The 25 sites were not careless — each was correct
when written. Drift was the mechanism, and the default is what made drift invisible.

The fix generalises: **when a parameter carries a policy decision, make it required and let the
compiler enumerate the call sites.** A required argument converts an unbounded audit problem into a
finite, mechanical worklist that cannot be incomplete. Ban the default in the comment too, or the
next person restores it as a kindness.

Two corollaries this change leaned on:

- **Lock what a settings blob must not reach.** `admin.*` runs through the service-role client, so
  `assertCan` is the only boundary and RLS is not behind it — a ward widening `admin.manage_users`
  would be self-escalation. Locking removal as well delivered, structurally, a guard
  `11-notifications-admin.md` had asked the UI to implement by hand.
- **Store deltas, not replacements, for anything the code will keep adding to.** Replace-semantics
  silently freezes a ward's configuration at the moment it was written.

**A caveat about the walkthrough, worth remembering.** Scenario 014's first run looked like a
permissions bug: the member page errored, then hung. It was a Turbopack dev-server worker that had
been crashing for nine hours — 77 crashes logged, the earliest predating the change and hitting a
different member id. The app was never involved. Two lessons: **read the dev log's first error, not
its last**, since a wedged dev server buries the real one under hundreds of identical follow-ons;
and **rule out the tooling before editing the code** — signing in as the fixture user and running
the page's six queries directly took two minutes and proved RLS was never the problem. See
[[route-tests-and-realtime]] for the sibling case of a test that passed while the feature was dead.

## Deliberately not done

- No admin UI. Phase 11 owns the matrix screen; this makes its promises keepable.
- No change to any role's default permissions. The two open judgement calls from
  [[foundation-c-services]] stay open.
- `audit.view` stays overridable — it grants reading, not writing.
- The extra `wards` read per guarded request was accepted over an exception-carrying rule. If it
  ever measures, the fix is role access in the JWT claims, which Phase 11 already implies.
