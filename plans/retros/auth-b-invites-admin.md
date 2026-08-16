---
id: auth-b-invites-admin
type: feature
iter: null
commits: ["b6a5e69"]
date: 2026-08-16
files:
  - lib/validation/invite.ts
  - lib/validation/adminUser.ts
  - lib/auth/invites.ts
  - lib/auth/adminUsers.ts
  - lib/auth/routeErrors.ts
  - app/api/auth/invite/route.ts
  - app/api/auth/register/route.ts
  - app/api/admin/users/route.ts
  - app/api/admin/users/[id]/route.ts
  - app/(auth)/invite/[token]/page.tsx
  - app/(auth)/invite/[token]/RegisterForm.tsx
  - app/(app)/admin/layout.tsx
  - app/(app)/admin/page.tsx
  - app/(app)/admin/NotPermitted.tsx
  - app/(app)/admin/users/page.tsx
  - app/(app)/admin/users/UserRow.tsx
  - app/(app)/admin/users/InviteForm.tsx
  - app/(auth)/login/LoginForm.tsx
  - types/domain.ts
related: [auth-a-session-shell, foundation-b-schema, foundation-c-services]
---

## What was done

Milestone M2 of Phase 1: how an adult account comes to exist, and how the bishopric manages
accounts afterwards. A bishopric member generates a role-bearing invite link; the recipient opens
it unauthenticated, sets a name and password, and gets exactly the role the invite carried. Plus
the minimum viable admin surface — list, change role/organization/active status — with a guard
that stops the ward locking itself out of its own last active bishop. 152 tests pass, and both
halves were driven end to end in a browser. No migration.

## Key decisions

- **Claim the invite first, then create the auth user.** 01-auth-rbac.md specified the reverse
  with a compensating delete. That closes the orphaned-auth-user case but leaves the single-use
  race open: two people opening the same link both pass a read-then-check and both get an
  account. One conditional UPDATE (`used_at is null and expires_at > now`) closes both, because
  the second claim matches zero rows. `releaseInvite` puts it back on every failure path.
- **Role, organization, counselor position, and ward come off the invite row, and the type makes
  it impossible to do otherwise.** `RegisterInput` has no role field, so `redeemInvite` has
  nothing else to read. Zod stripping unknown keys is the first control; the function signature
  is the second. Verified at the HTTP boundary, not just in a unit test: a POST carrying
  `role:"bishop"`, `orgId`, and another ward's `wardId` produced a `music_coordinator` in the
  invite's ward with a null org.
- **`updateWardUser` writes with the service-role client, so `assertCan` is the effective
  boundary.** `users` has no UPDATE policy for other people's rows — only `users_update_self` —
  so RLS cannot be the guard here. This is the one place in the phase where the API route rather
  than the policy is what stops an unauthorized write, which is why the permission check in that
  route can never be skipped. Confirmed by driving an `org_president` session at all three
  endpoints: 403 from every one.
- **Invite email is required, not optional.** The phase plan sketched it optional, but an invite
  with no email creates an account with no way to sign in. Creation is the only place to catch
  that; by redemption the invite has already been claimed.
- **Permission refusals are rendered, not thrown.** A `ForbiddenError` escaping a Server
  Component is a 500 whose message Next.js strips in production, so `/admin` gates with `can()`
  and renders `NotPermitted`. `assertCan` still guards every API route, where a 403 is the right
  answer.
- **`sacrament_manager` is excluded from both role dropdowns** (`INVITABLE_ROLES`). It is a
  username + PIN youth account with no email, so an emailed invite could never produce a working
  one — that flow is auth-c.
- **Nobody can change their own role or active status.** The last-bishop guard does not fire
  while a second bishop exists, so a self-demotion would be a silent one-way trip out of the
  admin surface that no server-side check would catch.

## Pitfalls for next time

- **`invites` carries the same composite foreign key as `users`**, so the plan's way of forcing a
  failed `users` insert — pointing the invite at another ward's organization — is impossible: the
  database rejects the invite one step earlier. Testing both compensations needed an injected
  client whose `users` insert fails. Any future "make the second write fail" test on a table with
  a mirrored FK will hit the same wall.
- **`await request.json()` throws a `SyntaxError`, which becomes a 500 unless it is translated.**
  A malformed body is the caller's mistake; reported as 500 it looks like the server's. All
  bodies now go through `readJsonBody()`, which raises a typed error the response mapper turns
  into a 400. Only the parse site is translated — a `SyntaxError` from anywhere else is still a
  real bug and still a 500.
- **Next.js's dev logger renders an object argument to `console.error` as `{}` regardless of its
  contents.** `console.error("msg", { error })` writes `msg {}` to
  `.next/dev/logs/next-development.log`, so the error never reaches the log. Anything that must
  survive belongs in the message string. This affects every existing call site in the repo —
  `writeAuditLog`, `session.ts`, `emitNotification` — not just this phase.
- **`requireSessionUser()` must sit outside the try block in a route handler.** It redirects by
  throwing an internal Next.js error, and a catch-all around it turns the redirect into a 500.
- **The registration audit row has to be written with the service client.** The registrant has no
  session, and `audit_log_insert` requires `ward_id = current_ward_id()`, which is null without
  one. Written through the default client the insert is silently refused — and `writeAuditLog`
  never throws, so it would have been a silent hole in the trail.
- **A verification fix can look right and do nothing.** The first attempt at the logging fix
  moved the error into the payload object; re-driving it showed the log still read `{}`. Worth
  re-running the exact observation that produced a finding, not just the code path.

## Known gaps handed to later phases

- **`users_update_self` still has no column restriction**, so a user can rewrite their own role
  directly against the API. auth-a handed this to auth-b, but closing it needs column-level
  `GRANT UPDATE (theme_preference, …)` rather than a policy change, and this plan carries no
  migration. The admin UI disables self-edits, which is a UI guard, not a boundary. **Whichever
  phase next opens a migration should close it.**
- **Zod validation failures return a message with no field name** — "Invalid input: expected
  string, received undefined". Both forms validate client-side so no user sees it, but a
  programmatic caller gets nothing actionable. One line in `respondToRouteError` to prefix
  `issue.path`.
- **Notifications cannot be verified in the UI.** `NotificationBell` is a Phase 11 placeholder
  with no query behind it, so both harness scenarios check the `notifications` table directly.
- **A ward created outside `supabase/seed/ward.sql` still has no `notification_settings` rows.**
  Nothing in v1 creates a ward through the app, so this stays open for whichever phase adds ward
  creation. Every test and scenario here seeds the triggers explicitly.
- **The last-bishop guard is check-then-act.** Two simultaneous demotions could in principle both
  read a count of 2 and both proceed. Accepted: recovery is a one-row service-role fix, and a
  database constraint on the bishop count would block every legitimate bishopric transition.
- **The own-row marker reads as "Mark Andersen(you)" to a screen reader** — spaced visually by
  `ml-2`, but the text nodes concatenate.
- **Full admin surface** — role access matrix, ward settings, notification management, audit
  viewer — is Phase 11. `/admin` is an index page with one entry so the nav item resolves.
