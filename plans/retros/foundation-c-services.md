---
id: foundation-c-services
type: feature
iter: null
commits: ["5ccf83a"]
date: 2026-08-16
files:
  - lib/supabase/scoped.ts
  - lib/auth/permissions.ts
  - lib/auth/errors.ts
  - lib/audit/writeAuditLog.ts
  - lib/notifications/emitNotification.ts
  - lib/notifications/notifyOtherBishopric.ts
  - tests/helpers/seed.ts
  - tests/helpers/asRole.ts
  - vitest.config.ts
related: [foundation-a-scaffold, foundation-b-schema]
---

## What was done

Built the four cross-cutting services every later phase depends on — ward-scoped queries, the
role/permission matrix, the audit write path, and the notification emit path — then proved the
security model with six RLS suites plus three service suites. 108 tests pass against the linked
hosted project. Completes Phase 0 and unlocks [01-auth-rbac.md](../01-auth-rbac.md).

## Key decisions

- **`emitNotification` uses the service-role client, not the caller's session.** Resolving
  `default_roles` to user ids means reading *other* users, and the `users` SELECT policy is
  self-only — the gap foundation-b handed to phase 1. It is a server-only module that reads ids
  to address rows and returns none of that data to the caller. `writeAuditLog` deliberately does
  **not** do this: it inserts through the caller's authenticated client, which proves the
  `user_id = auth.uid()` insert policy actually works.
- **The per-user opt-out applies to explicitly addressed recipients too.** The plan scoped it to
  the role-resolution path, but FEATURES.md §Module 14 promises a user can opt out of any
  individual notification; honouring that only when `recipientUserIds` is omitted would make a
  product promise depend on the shape of the calling code.
- **`can()` stays synchronous and takes the effective matrix as an optional third argument.**
  The `wards.settings.role_access` override needs a database read, and an async `can()` would
  make every route handler await an authorization check. `resolveRoleAccess()` does the read and
  merges per role — a stored list overrides that role, unnamed roles keep the code default.
- **`resolveRoleAccess` throws on a read failure rather than falling back.** An override can only
  *narrow* access relative to the code constant, so substituting the defaults on error would fail
  open and could grant a role something the ward deliberately removed.
- **`asRole(fixtures, handle)`, not `asRole(role, orgId?)`.** Ward A holds two org presidents in
  different organizations; the org-isolation suite is meaningless unless it can tell them apart,
  and a bare role cannot.

## Pitfalls for next time

- **An async function cannot return a PostgrestFilterBuilder.** The builder is thenable, so the
  returned promise *adopts* it: `await scopedQuery(t)` executes the query and resolves to
  `{data, error}`, and the caller never gets a builder to chain onto. The plan specified
  `Promise<PostgrestFilterBuilder<…>>`, which is not expressible in JavaScript. `scopedQuery` now
  returns `{ wardId, query }`. Any future helper that awaits something and then hands back a
  query builder must wrap it the same way.
- **A generic table parameter over all 51 tables exhausts the TypeScript heap.** `scopedQuery<T
  extends WardScopedTable>(table, columns)` made tsc instantiate PostgREST's recursive select
  parser once per table and die at 2 GB — on a machine with 7.7 GB, `tsc --noEmit` simply
  crashed. Fixing the column list to `"*"` brought it back to a normal compile. Keep generic
  table names away from generic column strings.
- **`wards` has no `ward_id` either.** The ward-less skip list is two tables, not one: `wards` is
  keyed by `id` because it *is* the ward, and `hymns` is the documented rule 1 exception. Both
  need their own assertions — `wards` cross-ward isolation drops straight out of the generic
  sweep and would otherwise go untested.
- **An RLS-denied UPDATE or DELETE succeeds with zero rows; it does not raise.** Asserting
  `error).toBeNull()` proves nothing on its own. Every negative write assertion has to re-read the
  row with the service client and check it is unchanged or still present. INSERT is the only one
  of the four that comes back as an error.
- **Vitest must not run these files in parallel.** Six suites signing in concurrently burst the
  hosted project's auth rate limit, and every assertion is a network round trip.
  `fileParallelism: false` with a 30 s test timeout and a 120 s hook timeout is what makes the
  suite reliable. Sign-ins are also cached per fixture set for the same reason.
- **Delete the wards before the auth users in teardown.** Wards cascade to `public.users` and to
  every ward-scoped row; several of those rows reference `users` through a no-action foreign key
  (`visit_goals.created_by`, `sundays.conducting_user_id`), so deleting the auth user first fails.

## Known gaps handed to later phases

- **`requireSessionUser()` does not exist yet.** `assertCan` takes a `SessionUser`; phase 1 builds
  the session resolution that produces one. Until then `scopedQuery` resolves the ward itself from
  `auth.getUser()` plus the self-readable `users` row.
- **The permission list is derived from FEATURES.md §User Roles, and two grants are judgment
  calls.** `roster.view` for both secretaries (agendas and programs name people) and
  `agendas.view` for `ward_council_member` (they receive `agenda_published`, and a notification
  they cannot open is useless). Phase 11's Role Access page is where the ward settles these.
- **`scopedQuery` selects every column.** A projection needs a per-module query function in
  `lib/<module>/queries.ts`, which is where conventions.md puts query logic anyway.
- **The `notification_settings` seed is per ward and runs at seed time only.** A ward created
  later — including every test fixture ward — has no trigger rows until something inserts them.
  Phase 1's ward-creation path must seed them, or `emitNotification` will warn on every key.
