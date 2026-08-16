---
id: auth-a-session-shell
type: feature
iter: null
commits: ["253ec0c"]
date: 2026-08-16
files:
  - supabase/migrations/020_users_ward_read.sql
  - lib/auth/session.ts
  - lib/auth/navigation.ts
  - lib/validation/auth.ts
  - lib/supabase/middleware.ts
  - middleware.ts
  - app/layout.tsx
  - app/page.tsx
  - app/(app)/layout.tsx
  - app/(app)/dashboard/page.tsx
  - app/(auth)/login/LoginForm.tsx
  - app/(auth)/reset-password/ResetPasswordForm.tsx
  - app/api/auth/login/route.ts
  - app/api/auth/logout/route.ts
  - components/layout/Sidebar.tsx
  - components/layout/TopNav.tsx
  - components/layout/ThemeToggle.tsx
  - components/ui/Button.tsx
  - types/domain.ts
  - testing/infrastructure/manifestGenerator.ts
related: [foundation-a-scaffold, foundation-b-schema, foundation-c-services]
---

## What was done

Delivered milestone M1 of Phase 1: an adult with an existing `users` row signs in through the
Supabase browser client, lands on a role-appropriate shell, sees only the navigation their role
permits, toggles the theme, and signs out — with `login` and `logout` rows in `audit_log`.
Migration 020 replaced the self-only `users` SELECT policy with a ward-scoped one, closing the
gap foundation-b handed to phase 1. 132 tests pass. Creating accounts is `auth-b` and `auth-c`.

## Key decisions

- **`users` SELECT is ward-scoped, not a definer-side view.** The admin user list (auth-b) and
  every "conducting: Bro. Smith" lookup need it, and the helper functions are `SECURITY DEFINER`
  so a ward-scoped policy here cannot recurse into them. Accepted trade-off: RLS grants rows and
  never columns, so any ward member can read another ward member's email. A genuinely private
  column added to `users` later goes in its own table instead.
- **Deactivation is checked on every request in `getSessionUser()`, not by revoking the token.**
  `auth.admin.signOut()` needs the user's JWT, which the server never holds. Reading `is_active`
  alongside the role costs nothing — it is the same row. Consequence: it takes effect on the
  user's *next* request, so an open page that makes no further requests keeps rendering.
- **`POST /api/auth/login` is verification, not credential exchange.** The browser client does the
  password exchange directly and writes the session cookies (01-auth-rbac.md §Step 2). The route
  exists for the two things that must not be client-side: refusing a deactivated or half-created
  account, and writing the audit row. It accepts no body — anything a client could send is either
  already in the cookie or is something it must not be allowed to assert.
- **Middleware does session refresh and the unauthenticated redirect, and no role checks.** It
  runs on the edge with no cheap database access, so a role check would be a second round trip on
  every request. `updateSession` now returns `{ response, user }` so the redirect decision costs
  nothing extra. Enforcement lives in `app/(app)/layout.tsx` and each page's `assertCan()`.
- **`getSessionUser` throws on a database error but returns `null` when signed out.** Silently
  returning `null` on a failed read would bounce a signed-in user to `/login` with no explanation
  and no trace. `AuthSessionMissingError` is the ordinary signed-out path and is not logged.

## Pitfalls for next time

- **`cache()` is inert outside a Server Component render.** React memoizes against a per-request
  dispatcher; with none present it calls straight through. That is why `tests/lib/session.test.ts`
  can read the same client twice and get two different answers across a deactivation — convenient
  here, but do not rely on `cache()` for correctness anywhere.
- **A recovery session is a real session.** After `updateUser({ password })` the user is signed
  in, so redirecting to `/login` bounced straight back to `/dashboard` and the confirmation was
  never seen. The reset form now signs the recovery session out before leaving, which also makes
  the next sign-in the proof that the new password works.
- **`redirectTo` from a query string is an open-redirect vector.** `LoginForm` only accepts a
  same-site absolute path — anything starting `//` or a full URL falls back to `/dashboard`. Any
  later feature that reads a redirect target from the URL needs the same guard.
- **The manifest generator silently truncated every scenario section at the first letter "z".**
  `extractSection` used `\Z` for end-of-input, which JavaScript has no escape for, so it was a
  literal `Z` — and under the `i` flag it matched lowercase `z`. Scenario 001 lost 4 of its 13
  checks at the word "squeezed". Fixed to `(?![\s\S])`. Worth remembering that a hand-rolled
  regex over markdown fails quietly: the manifest looked perfectly well-formed.
- **API routes must be excluded from the middleware redirect.** Redirecting `/api/*` turns a 401
  the caller can handle into an HTML login page it cannot.
- **Supabase CLI auth expires independently of the project link.** `db push` failed with a 401
  `LegacyDbConfigLoginRoleStatusError` while `supabase/.temp/project-ref` was still correct. The
  fix is `supabase login`, which is interactive — worth knowing before a session that needs a
  migration pushed.

## Known gaps handed to later phases

- **`users_update_self` has no column restriction, so a user can rewrite their own `role`.** The
  policy from migration 019 is `using (id = auth.uid()) with check (id = auth.uid())`, which
  permits `UPDATE users SET role='bishop' WHERE id = auth.uid()`. RLS grants rows, never columns,
  so closing this needs column-level `GRANT UPDATE (theme_preference, …)` rather than a policy
  change. This plan was scoped to leave `users_update_self` alone, and `ThemeToggle` is the first
  code to depend on that write. **auth-b should close it** when it builds admin user management.
- **JWT custom claims are deferred out of Phase 1.** A broken `custom_access_token` hook breaks
  *every* sign-in on a hosted project holding real data, and the performance win is on the roster
  and visit tables, which have no UI until phases 2 and 7. The `SECURITY DEFINER` helpers are
  correct today.
- **Session revocation on role change is superseded** by the per-request `is_active` check. A role
  change takes effect on the user's next request for the same reason deactivation does.
- **Route handlers are not unit-tested.** There is no local server in this setup and standing one
  up for two routes is not worth it; the harness scenarios exercise them instead. `auth-b` should
  test invite logic at the library layer for the same reason.
- **Password reset is not covered by a scenario.** It needs working outbound SMTP on the hosted
  project, which is not configured. The pages are built and the no-session path is verified;
  verify the emailed round trip manually once SMTP exists.
- **The nav list has no Roster entry.** The plan's module list omitted it and both scenario
  checklists corroborate; Phase 2 adds it. A **Goals** entry was added beyond the plan's list
  because the EQ-president checklist requires it.
- **`TopNav` falls back to `username`, not the email local part.** `SessionUser` carries no
  `email` field, so the fallback the plan described was not reachable without widening the type.
- **Real role dashboards are Phase 11.** `/dashboard` is a deliberate placeholder that greets the
  user and lists what they can reach.
- **`next build` warns that the `middleware` file convention is deprecated in favour of `proxy`**
  (Next 16). Pre-existing from foundation-a; not migrated here.
