# Plan: Foundation C — Cross-Cutting Services and Tests

**Created:** 2026-08-15
**Type:** feature
**Source:** [plans/00-foundation.md](00-foundation.md) Steps 5–6
**Structure:** Sequential — plan 3 of 3 (A → B → C)

> **Prerequisite:** [foundation-a-scaffold.md](foundation-a-scaffold.md) and
> [foundation-b-schema.md](foundation-b-schema.md) are complete. The schema is applied and
> `types/database.ts` is generated from the real database.
> **Completes Phase 0.** Unlocks [01-auth-rbac.md](01-auth-rbac.md).

---

## Overview

Build the four services every later phase depends on, then prove the security model works.

These four exist before any feature code because they are cross-cutting **write paths** —
every module emits notifications and writes audit rows from its first commit. This is
exactly why [plans/INDEX.md](INDEX.md) pulled them forward out of SPEC.md's build order:
retrofitting them across fifteen modules means touching every route twice.

The RLS tests here are the highest-value tests in the codebase. They are not optional and
they do not get deferred.

**Success criteria**

- `scopedQuery`, `can`/`assertCan`, `writeAuditLog`, `emitNotification` all exist and are tested
- All six RLS test files pass
- `bishop` and `counselor` resolve identically for every admin permission
- The bishop **cannot** read a counselor's private visit note — asserted explicitly
- The `anon` role reads the two public views and gets zero rows from everything else

---

## Relevant Files

| File | Action | Purpose |
|---|---|---|
| `lib/supabase/scoped.ts` | create | Ward-scoped query builder |
| `lib/auth/permissions.ts` | create | Role matrix, `can()`, `assertCan()` |
| `lib/auth/errors.ts` | create | `ForbiddenError` thrown by `assertCan` |
| `lib/audit/writeAuditLog.ts` | create | Audit write path — never throws |
| `lib/notifications/emitNotification.ts` | create | Notification emit path — never throws |
| `lib/notifications/notifyOtherBishopric.ts` | create | Helper used by every admin change |
| `tests/helpers/asRole.ts` | create | Returns a client authenticated as a given role |
| `tests/helpers/seed.ts` | create | Service-role fixtures: two wards, two orgs, users |
| `tests/rls/ward-isolation.test.ts` | create | Ward A cannot touch ward B, every table |
| `tests/rls/org-isolation.test.ts` | create | Cross-org visibility on and off |
| `tests/rls/private-notes.test.ts` | create | **The most important test in the suite** |
| `tests/rls/tithing-access.test.ts` | create | Bishopric only |
| `tests/rls/sacrament-access.test.ts` | create | Manager can update assignments, not pools |
| `tests/rls/public-views.test.ts` | create | `anon` reaches the views and nothing else |
| `tests/lib/permissions.test.ts` | create | Table-driven over all roles × permissions |
| `tests/lib/audit.test.ts` | create | Writes a row; never throws on failure |
| `tests/lib/notifications.test.ts` | create | Recipient resolution including opt-out |
| `tests/smoke.test.ts` | delete | Plan A placeholder; real tests now exist |

---

## Dependencies

No new packages. Uses the clients from plan A and the schema from plan B.

**Test isolation:** these tests write to the local database. Run them against
`npm run db:reset` state, and have each suite clean up its own fixtures in `afterAll`. Do
not point them at a hosted project.

---

## Tasks

### Task 1: `scopedQuery` — defence in depth

**File:** `lib/supabase/scoped.ts` (create)

```ts
export async function scopedQuery<T extends keyof Database['public']['Tables']>(
  table: T,
): Promise<PostgrestFilterBuilder<...>>
```

Returns a query builder pre-filtered by the session's `ward_id`.

**Details:**
- **RLS is the real boundary.** This is defence in depth, and it removes a whole class of
  forgotten `.eq('ward_id', …)` filters. Say that in the module, because a future reader
  will otherwise assume one of the two is redundant and delete it.
- Reads `ward_id` from the session, **never from an argument.** conventions.md: never trust
  a client-supplied `wardId`, `role`, `orgId`, or `userId`.
- `hymns` has no `ward_id` — either overload for it or document that it is queried directly.

---

### Task 2: The permission matrix

**Files:** `lib/auth/permissions.ts`, `lib/auth/errors.ts` (create)

```ts
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]>;
export function can(user: SessionUser, permission: Permission): boolean;
export function assertCan(user: SessionUser, permission: Permission): void;  // throws ForbiddenError
```

Derive the matrix from [FEATURES.md](../FEATURES.md) §User Roles. Permission strings are
`module.action` — `visits.create`, `assignments.approve`, `admin.manage_users`.

**Details:**
- **Bishop and counselor must resolve identically for every admin permission.** CLAUDE.md
  §7: *"Never build a check that grants the bishop something a counselor lacks."* The
  matrix is the one place this can go wrong, and Task 8 asserts it exhaustively.
- `sacrament_manager` gets exactly one module (FEATURES.md §Module 17) — assignment view
  and update. Nothing else. Not the roster, not the calendar.
- `ward_secretary` and `executive_secretary` have **no** access to visit trackers, the
  tithing calculator, or org-internal data.
- Store the matrix in `wards.settings.role_access` with the code constant as the fallback
  default, so phase 11's admin Role Access page can edit it without a deploy. Read order:
  database value if present, code constant otherwise.
- `assertCan` throws `ForbiddenError`; route handlers map it to a 403. Do not return a
  boolean and hope the caller checks — the throwing version is what makes step 2 of
  conventions.md's route shape non-negotiable.

---

### Task 3: `writeAuditLog`

**File:** `lib/audit/writeAuditLog.ts` (create)

```ts
export async function writeAuditLog(params: {
  wardId: string; userId: string; action: string;
  module: string; detail?: Record<string, unknown>;
}): Promise<void>
```

**Details:**
- **Never throws.** An audit failure must not fail the user's action. Catch, log to the
  server console with context, continue.
- This is one of exactly two sanctioned exceptions to CLAUDE.md rule 7 (the other is
  `emitNotification`). It still logs — it does not swallow silently.
- **Never log a token, key, PIN, private note, or member note** into `detail`. Callers pass
  IDs and short descriptions. Consider a small denylist on key names as a backstop.
- Called from every mutating route (CLAUDE.md rule 6). Never inline the insert.

---

### Task 4: `emitNotification`

**Files:** `lib/notifications/emitNotification.ts`, `notifyOtherBishopric.ts` (create)

```ts
export async function emitNotification(params: {
  wardId: string; triggerKey: string;
  title: string; body: string;
  recipientUserIds?: string[];
}): Promise<void>
```

Resolution order when `recipientUserIds` is omitted:

1. Look up `notification_settings` for the trigger. If `is_globally_enabled` is false, stop.
2. Resolve `default_roles` to user IDs within the ward.
3. Remove anyone with a `notification_user_prefs` row where `is_enabled = false`.
4. Insert one `notifications` row per remaining recipient.

**Details:**
- **Never throws.** Same rule as the audit log.
- Step 3 is the user-level opt-out from FEATURES.md §Module 14. An opt-out is **personal** —
  it must not affect other users holding the same role. Task 10 tests this.
- `triggerKey` must match a seeded row from plan B exactly. An unknown key should **log a
  warning**, not fail silently and not throw — a notification that never fires with no
  trace is the worst of the three outcomes.
- Realtime delivery is automatic once clients subscribe (phase 11). Nothing to do here.
- `notifyOtherBishopric(actingUserId, description)` notifies the other two bishopric
  members, per FEATURES.md §Module 15: *any* admin change notifies the other two. Used by
  every admin route. Exclude the acting user.

---

### Task 5: Test helpers

**Files:** `tests/helpers/seed.ts`, `tests/helpers/asRole.ts` (create)

`seed.ts` uses the **service-role** client to create fixtures: two wards (A and B), two
organisations within ward A (Elders Quorum and Relief Society), and one user per role.

`asRole(role, orgId?)` returns a Supabase client **authenticated as that user** — anon key
plus a real session, so RLS actually applies.

**Details:**
- This helper is what makes the six RLS suites readable. Build it properly first.
- **Seed with service-role, assert with an authenticated client.** Asserting with the
  service-role client tests nothing — it bypasses RLS entirely. This is the single easiest
  way to write six suites that pass while the app leaks.
- Clean up in `afterAll` so suites can run repeatedly without `db:reset` between them.

---

### Task 6: Ward and org isolation

**Files:** `tests/rls/ward-isolation.test.ts`, `tests/rls/org-isolation.test.ts` (create)

**Ward isolation** — for **every** table: a user in ward A gets zero rows from ward B on
SELECT, and is rejected on INSERT/UPDATE/DELETE targeting ward B.

- Drive it from a table list so a table added in a later phase is covered automatically.
- `hymns` is the one deliberate skip — assert the skip list has exactly one entry, so a
  future `ward_id`-less table fails the test instead of quietly joining the skip list.

**Org isolation** — an Elders Quorum president:
- cannot read Relief Society visit logs when `cross_org_visibility` is off
- **can** read shared notes when it is on
- **can never write** another org's records, regardless of the setting

---

### Task 7: Private notes — the critical test

**File:** `tests/rls/private-notes.test.ts` (create)

00-foundation.md calls this *"the single most important test in the suite."*

Assert explicitly:
- A counselor writes a `visit_private_notes` row
- **The bishop reads zero rows.** Not redacted — zero
- An org president reads zero rows
- The service-role client is *not* used to assert the negative case
- The same four assertions for `activity_private_notes`
- The author reads their own note successfully (or the policy is over-tight and useless)

**Details:**
- CLAUDE.md rule 5: *"Not by the bishop. Not by an admin. Not by a support query."*
- Test UPDATE and DELETE too, not just SELECT. A read-blocking policy that allows a
  bishopric UPDATE still violates the rule.

---

### Task 8: Tithing, sacrament, and public-view access

**Files:** `tests/rls/tithing-access.test.ts`, `sacrament-access.test.ts`,
`public-views.test.ts` (create)

**Tithing** — only `bishop` and `counselor` reach `tithing_sessions` and `tithing_entries`.
Assert `ward_secretary`, `executive_secretary`, and an org president all get zero rows and
rejected writes. Also assert no column links to `members` (CLAUDE.md rule 10).

**Sacrament** — the active manager can UPDATE `sacrament_assignments` but **not**
`sacrament_rotation_pools`. An **inactive** manager can do neither. Bishopric can do both.

**Public views** — `anon` can read `public_sacrament_assignments` and `public_program`, and
gets **zero rows** from `members`, `visit_logs`, `programs`, and `sacrament_assignments`.
Also assert the views expose no phone, no address, no notes, and no full last name.

**Details:**
- The public-views test is the guard on the app's only unauthenticated surface. Assert on
  the **column list**, not just row counts — a leak arrives as a new column, not a new row.

---

### Task 9: Permission matrix tests

**File:** `tests/lib/permissions.test.ts` (create)

Table-driven over **all roles × all permissions**. Generate the cases from `ROLES` and the
permission list so a new role cannot be added without a decision for every permission.

Must-have assertions:
- **`bishop` and `counselor` produce identical results for every admin permission.** Loop
  the whole admin set and compare — do not spot-check.
- `sacrament_manager` has exactly its one module and nothing else.
- `assertCan` throws `ForbiddenError` where `can` returns false — the two never disagree.
- The `wards.settings.role_access` override takes precedence over the code default.

---

### Task 10: Service tests

**Files:** `tests/lib/audit.test.ts`, `tests/lib/notifications.test.ts` (create)

**Audit:**
- A successful call writes exactly one `audit_log` row with the right shape
- **A failing insert does not throw** — simulate a database error and assert the promise
  resolves and the failure is logged
- `detail` containing a key named like a secret is not persisted verbatim

**Notifications:**
- Recipients resolve from `default_roles` correctly
- `is_globally_enabled = false` produces **zero** rows
- A user with `notification_user_prefs.is_enabled = false` is excluded — **and their
  same-role colleague still receives it** (the opt-out is personal)
- An unknown `triggerKey` logs a warning, inserts nothing, and does not throw
- `notifyOtherBishopric` notifies exactly the other two, never the acting user

---

## Testing Strategy

This plan *is* the testing task for Phase 0. Priority follows CLAUDE.md §8:

1. **RLS policies** (Tasks 6–8) — the highest-value tests in the codebase
2. **Permission helpers** (Task 9) — table-driven over the role matrix
3. **Service behaviour** (Task 10) — especially the never-throws contracts

Boundary conditions over middles (conventions.md): cross-org visibility on **and** off, the
active **and** inactive manager, the opted-out user **and** their colleague.

## Test Scenarios (Harness)

**Bootstrap the harness after this plan, not during it.** Run `/init-testing` once Phase 0
closes — there is now a schema to seed and services to exercise, but no login and no UI
until [01-auth-rbac.md](01-auth-rbac.md). The first genuinely useful scenarios are phase 1's
(invite acceptance, youth PIN login, role-appropriate shell), because those are the states
that are tedious to set up by hand.

---

## Validation Commands

```bash
npm run db:reset
npm test
npm run typecheck
npm run lint
npm run build
```

Then the full Phase 0 Definition of Done from [00-foundation.md](00-foundation.md):

```sql
-- Zero rows: every table has RLS
SELECT tablename FROM pg_tables t
JOIN pg_class c ON c.relname = t.tablename
WHERE t.schemaname = 'public' AND NOT c.relrowsecurity;
```

- [ ] `npm run dev` serves a page; build and typecheck pass
- [ ] All 19 migrations apply cleanly to a fresh database
- [ ] `types/database.ts` generated and committed
- [ ] RLS enabled on every table
- [ ] All six RLS test files pass
- [ ] Seed loads hymns, topics, notification triggers, dev ward
- [ ] All four services exist and are tested
- [ ] `.env.local.example` lists every required variable
- [ ] Service-role client throws if imported client-side

---

## Integration Notes

- **Depends on** plans A and B.
- **Unlocks everything.** Every subsequent phase calls `writeAuditLog`, `emitNotification`,
  `can`/`assertCan`, and `scopedQuery`. Their signatures are effectively frozen once phase
  1 starts — get them right here.
- **Route handlers come next, not now.** conventions.md's six-step route shape references
  `requireSessionUser()`, which belongs to phase 1. This plan builds `assertCan`; phase 1
  builds the session resolution that feeds it a `SessionUser`.
- **Do not** build login, invites, guards, or UI here. That is
  [01-auth-rbac.md](01-auth-rbac.md).
- **Do not commit.** The user commits manually.

---

## Pitfalls

- **Asserting with the service-role client.** It bypasses RLS. Every RLS suite would pass
  while the app leaks. Seed with service-role, assert with `asRole()`.
- **Testing only SELECT.** A policy that blocks reads but allows UPDATE still leaks. Cover
  all four operations, especially on the private-notes tables.
- **Spot-checking the bishop/counselor equivalence.** Loop the full admin permission set.
  This is a stated product requirement, not an implementation detail.
- **A service that throws.** If `writeAuditLog` or `emitNotification` ever throws, a
  notification outage becomes an app outage. Test the failure path, not just the happy one.
- **Trusting an argument for `wardId`.** All of `wardId`, `role`, `orgId`, and `userId` come
  from the session. Never from a request body.
- **Freezing the wrong signature.** These four functions get called from every route in the
  app. A signature change in phase 6 is a fifteen-module refactor.
