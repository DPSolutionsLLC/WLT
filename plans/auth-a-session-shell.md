# Plan: Auth A — Session, Adult Sign-In, Guards & App Shell

**Created:** 2026-08-16
**Type:** feature
**Phase:** 1 of 3 for [01-auth-rbac.md](01-auth-rbac.md) — run `auth-a` → `auth-b` → `auth-c`

## Overview

The first of three plans covering Phase 1. This one delivers **milestone M1 — Sign in**: an
adult with an existing `users` row can sign in, land on a role-appropriate shell, see only the
navigation their role permits, toggle the theme, and sign out — with both events in the audit log.

It does **not** cover creating accounts. Every account in this plan already exists (seeded by
`tests/helpers/seed.ts` or the harness). Account creation is `auth-b` (invites, admin) and
`auth-c` (youth PIN accounts).

**Key requirements**

1. `getSessionUser()` / `requireSessionUser()` resolve a `SessionUser` from the Supabase session,
   cached per request.
2. Email/password sign-in through the Supabase browser client — **not** proxied through a custom
   route (01-auth-rbac.md §Step 2).
3. A deactivated account cannot use the app, whatever its session cookie says.
4. Middleware refreshes the session and redirects unauthenticated traffic. It does **no** role
   checks (it has no cheap database access).
5. The app shell renders nav filtered by `can()`; every guarded page also calls `assertCan()`
   server-side.
6. Login and logout write audit rows.

**Success criteria**

- A seeded bishop signs in, sees the full sidebar, and reaches `/dashboard`.
- A seeded music coordinator signs in and sees four nav items, not thirty.
- A deactivated user is signed out with an actionable message.
- `login` and `logout` rows appear in `audit_log`.
- Light and dark both render correctly at 375px, with no flash of the wrong theme on load.
- `npm run lint`, `npm run typecheck`, and `npm test` all pass.

---

## Decisions Already Made

These were settled before planning. Do not re-litigate them mid-execution.

| Decision | Choice | Why |
|---|---|---|
| `users` read scope | **Ward-scoped SELECT policy** | The admin user list (auth-b) and every "conducting: Bro. Smith" lookup need it. The helper functions are `SECURITY DEFINER`, so a ward-scoped policy cannot recurse. Accepted trade-off: any ward member can read another ward member's email. |
| JWT custom claims | **Deferred out of Phase 1** | A broken `custom_access_token` hook breaks *every* sign-in on a hosted project holding real data. The performance win is on the roster and visit tables, which have no UI until phases 2 and 7. The existing `SECURITY DEFINER` helpers are correct today. Record the deferral in the retro. |
| Deactivation enforcement | **Checked on every request in `getSessionUser()`**, not by token revocation | `auth.admin.signOut()` needs the user's JWT, which the server does not hold. Reading `is_active` alongside the role costs nothing extra — it is the same row. Takes effect on the user's next request. |

---

## Relevant Files

| File | Action | What changes |
|---|---|---|
| `supabase/migrations/020_users_ward_read.sql` | create | Replace the self-only `users` SELECT policy with a ward-scoped one |
| `types/database.ts` | regenerate | `npm run db:types` after pushing 020 |
| `types/domain.ts` | modify | Add `themePreference` and `isActive` to `SessionUser`; add `username` |
| `lib/auth/session.ts` | create | `getSessionUser()`, `requireSessionUser()` |
| `lib/auth/navigation.ts` | create | Single source of truth for nav items and their permissions |
| `lib/validation/auth.ts` | create | Zod schemas for the login, forgot-password, and reset-password forms |
| `lib/notifications/emitNotification.ts` | modify | Update the now-stale comment about the self-only `users` policy |
| `lib/supabase/middleware.ts` | modify | Return the resolved user alongside the response so `middleware.ts` can redirect |
| `middleware.ts` | modify | Redirect unauthenticated traffic to `/login`; allow the public route list through |
| `app/layout.tsx` | modify | Add the pre-paint theme script |
| `app/page.tsx` | modify | Redirect to `/dashboard` (signed in) or `/login` (not) |
| `app/(auth)/layout.tsx` | create | Centred, minimal layout for the unauthenticated pages |
| `app/(auth)/login/page.tsx` | create | Server page wrapping `LoginForm` |
| `app/(auth)/login/LoginForm.tsx` | create | `"use client"` — email + password |
| `app/(auth)/forgot-password/page.tsx` | create | Server page wrapping `ForgotPasswordForm` |
| `app/(auth)/forgot-password/ForgotPasswordForm.tsx` | create | `"use client"` — sends the Supabase reset email |
| `app/(auth)/reset-password/page.tsx` | create | Server page wrapping `ResetPasswordForm` |
| `app/(auth)/reset-password/ResetPasswordForm.tsx` | create | `"use client"` — sets the new password |
| `app/api/auth/login/route.ts` | create | **Post**-sign-in verification + audit. Not credential exchange |
| `app/api/auth/logout/route.ts` | create | Audit row, then `signOut()` |
| `app/(app)/layout.tsx` | create | `requireSessionUser()`, resolve role access, render the shell |
| `app/(app)/dashboard/page.tsx` | create | Role-labelled placeholder (real dashboards are Phase 11) |
| `components/layout/Sidebar.tsx` | create | Nav filtered by `can()`; drawer on mobile |
| `components/layout/TopNav.tsx` | create | Ward name, user menu, theme toggle, notification bell |
| `components/layout/ThemeToggle.tsx` | create | `"use client"` — writes `users.theme_preference` + `localStorage` |
| `components/layout/NotificationBell.tsx` | create | Static placeholder, wired up in Phase 11 |
| `components/ui/Button.tsx` | create | Primitive |
| `components/ui/Input.tsx` | create | Primitive with label + error slot |
| `components/ui/Card.tsx` | create | Primitive |
| `components/ui/FormError.tsx` | create | Consistent inline error display |
| `tests/lib/session.test.ts` | create | `getSessionUser` against real authenticated clients |
| `tests/lib/navigation.test.ts` | create | Table-driven over the role matrix |
| `tests/rls/users-ward-read.test.ts` | create | Cross-ward read denial after the policy change |
| `testing/scenarios/auth/scenario-001-role-shell/` | create | Harness scenario (scenario.md + seed.ts) |
| `testing/scenarios/auth/scenario-002-deactivated-account/` | create | Harness scenario |
| `testing/scenarios/manifest.json` | regenerate | `npm run manifest` |

## Dependencies

No new libraries. Everything needed is already in `package.json`.

Uses, do not reimplement:
- `lib/auth/permissions.ts` — `can()`, `assertCan()`, `resolveRoleAccess()`, `ROLE_PERMISSIONS`
- `lib/audit/writeAuditLog.ts` — never throws; call it, do not check its result
- `lib/supabase/server.ts` / `browser.ts` / `service.ts` — the three client factories
- `tests/helpers/seed.ts` + `tests/helpers/asRole.ts` — fixture seeding and authenticated clients

---

## Known Pitfalls (from retro context)

- **[foundation-a-scaffold]** — `next dev` rewrites `AGENTS.md` on every start. If `git status`
  shows it modified, that is expected; do not delete the file (deleting it sends the vendor block
  into `CLAUDE.md`).
- **[foundation-a-scaffold]** — `cookies()` is async in Next 15+, and `@supabase/ssr` forbids
  `get`/`set`/`remove` — only `getAll`/`setAll`. The existing factories already do this correctly;
  copy their shape rather than inventing a new one.
- **[foundation-a-scaffold]** — Do not reach for generated types like `LayoutProps<"/">`. They are
  written into `.next/types/` by a build, so `npm run typecheck` fails on a clean tree. Type layout
  and page props explicitly.
- **[foundation-b-schema]** — Migration 019 enabled RLS by looping the catalog **at migration
  time**. It does not cover tables created later. Migration 020 creates no tables, so this does not
  bite here — but it will in `auth-c`.
- **[foundation-c-services]** — An RLS-denied UPDATE or DELETE succeeds with **zero rows**; it does
  not raise. `expect(error).toBeNull()` proves nothing. Re-read the row with the service client and
  assert it is unchanged. INSERT is the only operation that returns an error.
- **[foundation-c-services]** — Vitest runs these files serially (`fileParallelism: false`) because
  concurrent sign-ins burst the hosted project's auth rate limit. Do not add `.concurrent`, and
  reuse `asRole()` rather than signing in repeatedly.
- **[foundation-c-services]** — Delete wards before auth users in any teardown. Wards cascade to
  `public.users`; several tables reference `users` through no-action foreign keys.
- **[foundation-c-services]** — A ward created outside `supabase/seed/ward.sql` has **no**
  `notification_settings` rows. Not needed in this plan (nothing emits), but remember it in auth-b.
- **[CLAUDE.md §9]** — `npm run db:reset` **wipes the hosted database**. Use `npm run db:push` to
  apply migration 020. Never `db:reset`.

---

## Tasks

### Task 1: Ward-scoped `users` SELECT policy

**File:** `supabase/migrations/020_users_ward_read.sql` (create)

**Action:** Replace the self-only SELECT policy with a ward-scoped one and record the decision.

**Details:**

```sql
-- Phase 1A, migration 020: ward-scoped reads on `users`.
--
-- Migration 019 made users SELECT self-only and handed the decision to phase 1
-- (plans/retros/foundation-b-schema.md, "Known gaps"). The decision is a ward-scoped policy.
--
-- Safe against recursion: every policy on every other table resolves the caller's ward through
-- current_ward_id(), which is SECURITY DEFINER and therefore bypasses RLS on its own read of
-- `users`. A ward-scoped policy here cannot re-enter it.
--
-- Trade-off, accepted deliberately: RLS grants rows, never columns, so any authenticated ward
-- member can read another ward member's email. Everyone with an account is ward leadership, and
-- the alternative (a definer-side view) means every future name lookup has to remember to use it.
-- If a genuinely private column is ever added to `users`, it goes in its own table instead —
-- the same reasoning that moved member notes out of `members` in migration 003.

drop policy users_select_self on users;

create policy users_ward_select on users
  for select to authenticated
  using (ward_id = current_ward_id());
```

Leave `users_update_self` exactly as it is. Do **not** add an INSERT or DELETE policy — account
creation is a service-role operation in `auth-b` and `auth-c`, deliberately.

**Then:**
1. `npm run db:push`
2. `npm run db:types`

`tests/db/migrations.test.ts` fails if the migration is on disk but not pushed, so this must
happen before the test run.

---

### Task 2: Extend `SessionUser`

**File:** `types/domain.ts` (modify)

**Action:** Add the three fields the shell needs. Keep the existing shape otherwise —
`lib/auth/permissions.ts` already consumes `SessionUser`.

```ts
export type SessionUser = {
  id: string;
  wardId: string;
  role: Role;
  orgId: string | null;
  counselorPosition: 1 | 2 | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  themePreference: ThemePreference;
  isActive: boolean;
};
```

`ThemePreference` is already exported from this file. 01-auth-rbac.md §Step 1 types `firstName`
and `lastName` as non-null; the column is nullable, so keep them nullable and let the UI fall back.

---

### Task 3: Session resolution

**File:** `lib/auth/session.ts` (create)

**Action:** Build `getSessionUser()` and `requireSessionUser()`.

**Details:**

- Take an optional `client?: SupabaseClient<Database>` third-position parameter, exactly as
  `writeAuditLog`, `scopedQuery`, and `emitNotification` already do. This is what makes the
  function testable without mocking `next/headers`.
- Wrap the uncached implementation in React `cache()` so a page rendering ten components issues
  one query. `cache()` only applies to the no-argument path — when a client is passed in (tests),
  call through uncached.

```ts
import { cache } from "react";

async function resolveSessionUser(
  client?: SupabaseClient<Database>,
): Promise<SessionUser | null>

export const getSessionUser = cache(
  async (client?: SupabaseClient<Database>) => resolveSessionUser(client),
);

export async function requireSessionUser(
  client?: SupabaseClient<Database>,
): Promise<SessionUser>
```

`resolveSessionUser`:
1. `supabase.auth.getUser()` — on error or no user, return `null`. `AuthSessionMissingError` is
   the ordinary signed-out case and must not be logged as an error.
2. Select the `users` row by `id`, mapping snake_case → camelCase here (conventions.md
   §Data Access: map once, at this layer).
3. On a Supabase error, `console.error` with context and **throw** — a database failure is not
   the same as "signed out", and silently returning `null` would bounce a signed-in user to
   `/login` with no explanation.
4. If there is no row, return `null` (an `auth.users` row with no `public.users` row is a
   half-created account; auth-b's compensating delete is what prevents it).
5. **If `is_active` is false, return `null`.** This is the deactivation enforcement point.

`requireSessionUser` calls `getSessionUser` and, on `null`, calls `redirect("/login")` from
`next/navigation`. Note in a comment that `redirect()` throws internally — never wrap it in a
`try/catch` that swallows.

---

### Task 4: Navigation as a single source of truth

**File:** `lib/auth/navigation.ts` (create)

**Action:** One list that both the sidebar and the page guards read, so a link can never point at
a page the user will be refused.

```ts
export type NavigationItem = {
  label: string;
  href: string;
  permission: KnownPermission;
};

export const NAVIGATION_ITEMS: readonly NavigationItem[] = [ ... ];

export function visibleNavigationItems(
  user: SessionUser,
  roleAccess?: RoleAccess,
): NavigationItem[];
```

**Details:**

- Cover the modules the phase map will build: Calendar, Talks, Topics, Program, Music, Visits,
  Youth Activities, Agendas, Tithing, Knowledge, AI Settings, Sacrament, Admin, Audit Log. Use the
  `href` values from SPEC.md §Component Structure so later phases drop their pages straight in.
- Every `permission` must be a `KnownPermission` from `lib/auth/permissions.ts` — the type makes a
  typo a compile error.
- `visibleNavigationItems` filters with `can(user, item.permission, roleAccess)`.
- Add a comment: hiding a link is cosmetic. Every page still calls `assertCan()` server-side
  (01-auth-rbac.md §Pitfalls, last bullet).
- Pages for these routes do not exist yet. That is fine — a link to a not-yet-built route 404s,
  which is the correct behaviour for an unbuilt module and keeps this file from needing an edit in
  every later phase. Note that in a comment.

---

### Task 5: Auth form validation schemas

**File:** `lib/validation/auth.ts` (create)

**Action:** Zod schemas shared by the forms.

```ts
export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: ... });
export const resetPasswordSchema = z.object({ password: z.string().min(12, ...) })
  // plus a confirmation field checked with .refine()
```

Do **not** put a `min(12)` on the login password — a length rule on sign-in tells an attacker your
policy and rejects legacy passwords. Only the *reset* form enforces length.

---

### Task 6: UI primitives

**Files:** `components/ui/Button.tsx`, `Input.tsx`, `Card.tsx`, `FormError.tsx` (create)

**Action:** Four small primitives. Resist building more — later phases add what they need.

**Details:**

- Server components by default. None of these four needs `"use client"`.
- Named exports, one component per file, `Props` type above the component.
- **Theme tokens only.** `bg-surface`, `text-foreground`, `border-border`, `bg-primary`,
  `text-danger`. No hardcoded hex — the tokens in `app/globals.css` already handle dark mode, so a
  hex value silently breaks it (conventions.md §Styling).
- `Button`: `variant` of `primary | secondary | danger`, plus `type` and `disabled`. Minimum
  44×44px tap target — this app is mobile-first and the PIN keypad in `auth-c` depends on it.
- `Input`: `label`, `error`, `type`, and the usual input props. Wire `aria-describedby` to the
  error node and set `aria-invalid` when `error` is present.

---

### Task 7: Sign-in pages

**Files:** `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/login/LoginForm.tsx`
(create)

**Action:** The email/password sign-in flow.

**Details:**

`app/(auth)/layout.tsx` — a centred single-column layout with the app name. No sidebar, no session
requirement. This route group must never call `requireSessionUser()`, or signing in becomes
impossible.

`LoginForm.tsx` (`"use client"`):
1. Validate with `loginSchema`.
2. `createBrowserSupabaseClient().auth.signInWithPassword(...)` — **directly**, not through a
   route (01-auth-rbac.md §Step 2). `@supabase/ssr`'s browser client writes the session cookies
   the server will read.
3. On an auth error, show exactly **"Email or password is incorrect."** — never "no account with
   that email", which enumerates accounts (01-auth-rbac.md §Step 2).
4. On success, `POST /api/auth/login` with an empty body (the session is in the cookie). If it
   returns 403, show the message it supplies and stop — the user is already signed out server-side.
5. On 200, `router.replace(redirectTo)` and `router.refresh()`.

`page.tsx` is a thin server component rendering `LoginForm`. If a session already exists, redirect
to `/dashboard`.

---

### Task 8: Post-sign-in verification route

**File:** `app/api/auth/login/route.ts` (create)

**Action:** SPEC.md §API Routes lists `POST /api/auth/login`. It is **not** credential exchange —
the browser client already did that. This route runs the checks that must not be client-side.

**Details:**

```ts
export async function POST() {
  const supabase = await createServerSupabaseClient();
  // 1. auth.getUser() — 401 if there is no session
  // 2. Read the users row: role, ward_id, is_active
  // 3. No row, or is_active false → signOut() and 403 with an actionable message
  // 4. writeAuditLog({ action: "login", module: "auth" })
  // 5. 200 { redirectTo: "/dashboard" }
}
```

- Never accept a body. Anything a client could send here is either already in the session or is
  something it must not be allowed to assert.
- The deactivated message: **"This account has been deactivated. Contact a member of the
  bishopric."** Actionable, and it leaks nothing (the user already proved the password).
- Step 3 must call `supabase.auth.signOut()` *before* returning, so a deactivated user is not
  left holding a valid cookie.
- No row at all is the half-created-account case: log it with the user id and return the same 403.

---

### Task 9: Sign-out route

**File:** `app/api/auth/logout/route.ts` (create)

**Action:** Audit **then** sign out — the order matters.

**Details:**

Resolve the session user first, write `{ action: "logout", module: "auth" }`, then
`supabase.auth.signOut()`. Reversed, `writeAuditLog` inserts through a client that no longer has a
session and the RLS insert policy (`user_id = auth.uid()`) rejects it. `writeAuditLog` never
throws, so the failure would be a silent gap in the audit trail — exactly what rule 6 forbids.

Return 200 with `{ redirectTo: "/login" }`. If there is no session, return 200 anyway — signing
out twice is not an error.

---

### Task 10: Password reset pages

**Files:** `app/(auth)/forgot-password/` and `app/(auth)/reset-password/` (create, 2 files each)

**Details:**

- Forgot: `supabase.auth.resetPasswordForEmail(email, { redirectTo: <origin>/reset-password })`.
  **Always show the same confirmation**, success or failure: "If an account exists for that
  address, a reset link is on its way." A different message for an unknown address enumerates
  accounts just as surely as the login form would.
- Reset: the Supabase recovery link puts a session in place when the page loads, so the form calls
  `supabase.auth.updateUser({ password })`. Validate with `resetPasswordSchema`. On success,
  redirect to `/login` with a confirmation.
- If the reset page loads with no recovery session, show "This reset link has expired. Request a
  new one." with a link back to `/forgot-password`.

---

### Task 11: Middleware — session refresh and the auth redirect

**Files:** `lib/supabase/middleware.ts` (modify), `middleware.ts` (modify)

**Action:** Keep session refresh where it is; add the unauthenticated redirect. **No role checks.**

**Details:**

`updateSession` currently returns only the response. Change it to return
`{ response, user }` so `middleware.ts` can branch without building a second client. Preserve the
existing `AuthSessionMissingError` handling — that is the ordinary signed-out path, not a fault.

In `middleware.ts`, define the public prefixes:

```ts
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/invite", "/pin", "/public"];
```

`/invite` and `/pin` have no pages until auth-b and auth-c; list them now so those plans do not
have to reopen this file.

If there is no user and the path is not public → redirect to `/login?redirectTo=<pathname>`.
If there **is** a user and the path is `/login` → redirect to `/dashboard`.

Add a comment stating why role enforcement is absent: middleware runs on the edge with no cheap
database access, so a role check would mean a second round trip on every request. Enforcement
lives in the layout and the page (01-auth-rbac.md §Pitfalls).

Leave the existing `config.matcher` alone — it already excludes static assets.

---

### Task 12: Pre-paint theme script

**File:** `app/layout.tsx` (modify)

**Action:** Apply the `.dark` class before first paint.

**Details:**

`app/globals.css` defines dark mode as `@custom-variant dark (&:where(.dark, .dark *))` — a class
on the `<html>` element. Nothing sets it yet, so dark mode is currently unreachable.

Add a small inline script in `<head>` that reads `localStorage.theme`, falls back to
`prefers-color-scheme`, and toggles `document.documentElement.classList`. It must be inline and
synchronous — a deferred script paints light first and flashes.

`suppressHydrationWarning` is already on the `<html>` element, which is what makes this safe.

Keep the script under ten lines and wrap it in `try/catch` (a browser with `localStorage` disabled
must not break the page). This is the one sanctioned use of `dangerouslySetInnerHTML` in the
codebase — note why in a comment.

---

### Task 13: App shell layout and guard

**File:** `app/(app)/layout.tsx` (create)

**Action:** The authenticated boundary.

**Details:**

```tsx
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);
  const navigationItems = visibleNavigationItems(user, roleAccess);
  ...
}
```

- Read the ward name here too, for `TopNav`. One query — the `wards` SELECT policy already scopes
  it to the caller's ward.
- `resolveRoleAccess` **throws** on a read failure, deliberately (foundation-c-services.md). Do not
  wrap it in a fallback to `ROLE_PERMISSIONS`; an override can only narrow access, so falling back
  would grant a role something the ward removed. Let it hit the error boundary.
- Type the props explicitly. Do not use `LayoutProps<"/">`.
- Mobile-first: main content full-width with a bottom drawer trigger; `md:` and up puts the
  sidebar alongside.

---

### Task 14: Shell components

**Files:** `components/layout/Sidebar.tsx`, `TopNav.tsx`, `ThemeToggle.tsx`,
`NotificationBell.tsx` (create)

**Details:**

- `Sidebar` — takes `navigationItems` as a prop. It does **not** call `can()` itself; the layout
  already resolved the list. Server component. Highlight the active route with `usePathname` in a
  small client child, or compare on the server via the layout's segment.
- `TopNav` — ward name, the user's name (fall back to the email local part when `firstName` is
  null), `ThemeToggle`, `NotificationBell`, and a sign-out button that POSTs `/api/auth/logout`
  then navigates to the returned `redirectTo`.
- `ThemeToggle` (`"use client"`) — cycles light → dark → system. Writes `localStorage.theme`,
  toggles the class immediately, and persists to `users.theme_preference`. The `users_update_self`
  policy already permits that write. If the write fails, keep the local change and `console.error`
  — a failed preference save must not block the toggle.
- `NotificationBell` — a static bell icon with no count and no query. Add a comment pointing at
  Phase 11 ([11-notifications-admin.md](11-notifications-admin.md)). Do not subscribe to Realtime
  here.

---

### Task 15: Dashboard placeholder

**File:** `app/(app)/dashboard/page.tsx` (create)

**Action:** A real dashboard per role is Phase 11. This is the landing target.

**Details:**

Call `requireSessionUser()`, greet the user by name, state their role in plain words, and list the
modules they can reach. No `assertCan()` here — every role may see their own dashboard.

Add a comment pointing at SPEC.md §Role-Based Dashboards and Phase 11 so the next reader knows
this is deliberately thin, not unfinished.

---

### Task 16: Root redirect

**File:** `app/page.tsx` (modify)

**Action:** Replace the scaffold placeholder with a redirect — `/dashboard` when signed in,
`/login` otherwise.

---

### Task 17: Correct the stale comment in `emitNotification`

**File:** `lib/notifications/emitNotification.ts` (modify)

**Action:** `resolveRoleRecipients` carries a comment saying the `users` SELECT policy is self-only
and that phase 1 will revisit it. Migration 020 has now revisited it.

Update the comment to say the ward-scoped policy exists and that the module still uses the
service-role client **on purpose**: it inserts `notifications` rows addressed to other users and
reads `notification_user_prefs` rows belonging to them, neither of which the caller's own session
can do. Change no behaviour — comment only.

Leave `notifyOtherBishopric.ts` alone; its service-role use is correct for the same reason.

---

## Testing Strategy

Per CLAUDE.md §8, RLS first, then permission helpers.

### `tests/rls/users-ward-read.test.ts` (create)

Highest-value test in this plan — migration 020 widened a security policy.

Follow the shape of `tests/rls/ward-isolation.test.ts`: `seedFixtures` in `beforeAll`,
`fixtures.cleanup()` in `afterAll`, assert through `asRole()`.

Handles needed: `bishop`, `musicCoordinator` (ward A), `wardBBishop` (ward B).

- A ward A user reads the ward A `users` rows, including other people's.
- A ward A user reading `users` gets **zero** ward B rows.
- A ward B user gets zero ward A rows.
- A ward A non-bishopric user cannot UPDATE another ward A user's row. Remember: an RLS-denied
  UPDATE returns **no error and zero rows** — re-read with `fixtures.service` and assert the row is
  unchanged (foundation-c-services.md).
- A ward A user cannot INSERT a `users` row (no INSERT policy exists). This one *does* return an
  error.

### `tests/lib/session.test.ts` (create)

- `getSessionUser(client)` with an `asRole()` client returns the right `id`, `wardId`, `role`,
  `orgId`, and `counselorPosition`.
- With a bare `anonClient()` (no session) it returns `null`.
- For a user whose `is_active` was flipped to false with `fixtures.service`, it returns `null`.
  **Flip it back afterwards** — fixtures are shared within the file.
- camelCase mapping: the returned object has no snake_case keys.

### `tests/lib/navigation.test.ts` (create)

Table-driven over the role matrix — this is `route-guards.test.ts` from the phase plan, at the
layer that is testable without a running server.

- Every `NAVIGATION_ITEMS[].permission` is present in `PERMISSIONS`.
- `bishop` and `counselor` produce **identical** lists (CLAUDE.md §7). Compare the full arrays, not
  the lengths.
- `sacrament_manager` sees exactly one item, and its href is under `/sacrament`.
- `music_coordinator` sees no item whose href starts with `/visits`, `/tithing`, or `/admin`.
- `org_secretary` sees no `/admin` item.
- No role except `bishop`/`counselor` sees `/admin/audit-log`.

### Not tested here, deliberately

Route handlers are exercised by the harness scenarios rather than Vitest — there is no local server
in this setup and standing one up for two routes is not worth it. `auth-b` tests the invite logic
at the library layer for the same reason. Note this in the retro.

---

## Test Scenarios (Harness)

Scope folder: `testing/scenarios/auth/`. Run `npm run manifest` after creating them.

### Scenario 001: Role-appropriate shell

**Tags:** `auth`, `smoke`, `rbac`

**Purpose:** The sidebar is the most visible expression of the role matrix, and it is the one
thing a unit test cannot confirm — that the right words appear on a real screen at phone width.
Seeding matters because comparing roles means five accounts that differ only by role.

**Seed data summary:**
- Ward — Harness Test Ward (`ensureTestWard()`)
- Users — 5 via `createTestUser()`: `bishop` (bishop), `counselor1` (counselor, position 1),
  `secretary` (ward_secretary), `music` (music_coordinator), `eqpres` (org_president, elders quorum)

**Tester action:** Seed, `npm run dev`, then sign in as each of the five in turn, noting the
sidebar each time. Check one at 375px width and one in dark mode.

**Verification checklist:**
- [ ] Bishop's sidebar lists every module including Admin and Audit Log
- [ ] Counselor's sidebar is **identical** to the bishop's, item for item
- [ ] Ward secretary sees Calendar, Talks, Program, Music, Agendas — and no Visits, Tithing, or Admin
- [ ] Music coordinator sees Calendar, Talks, Music — and nothing else
- [ ] EQ president sees Visits, Goals, Youth Activities — and no Talks, Program, or Admin
- [ ] Every sidebar link opens or 404s; none returns a "not permitted" error
- [ ] At 375px the sidebar is a drawer, not a squeezed column, and the toggle is thumb-reachable
- [ ] Dark mode: no white flash on reload, and every panel has a visible border

**Failure behavior:**
- [ ] Typing `/admin/users` directly as the music coordinator gives a "not permitted" page, not a blank one
- [ ] Signing in with a wrong password says "Email or password is incorrect" — never that the account does not exist

### Scenario 002: Deactivated account

**Tags:** `auth`, `full`, `rbac`

**Purpose:** Deactivation is enforced per request rather than by revoking the token, so the
interesting case is a user who is *already signed in* when they are deactivated. That state is
tedious to reach by hand and is exactly what seeding is for.

**Seed data summary:**
- Ward — Harness Test Ward
- Users — `bishop` (bishop, active); `formerclerk` (ward_secretary) created with
  `createTestUser({ ..., isActive: false })`

**Tester action:** Try to sign in as `formerclerk`. Then sign in as `bishop`, and while that
session is live, deactivate the bishop's own row from the Supabase dashboard and navigate.

**Verification checklist:**
- [ ] `formerclerk` gets past the password prompt, then sees "This account has been deactivated. Contact a member of the bishopric."
- [ ] `formerclerk` is left signed out — reloading `/dashboard` lands on `/login`, not the shell
- [ ] The still-signed-in user, once deactivated, is redirected to `/login` on their next navigation
- [ ] `audit_log` has a `login` row for the successful sign-in and none for the refused one

**Failure behavior:**
- [ ] The deactivated message names no other reason (wrong password, missing account)
- [ ] No stack trace or Supabase error string reaches the screen

### Not covered by a scenario

Password reset needs a working outbound email configuration on the hosted project, which is not
set up. Verify it manually once SMTP is configured; note the gap in the retro.

---

## Validation Commands

Run in this order. The migration must be pushed before the tests, or
`tests/db/migrations.test.ts` fails by design.

```bash
npm run db:push
npm run db:types
npm run lint
npm run typecheck
npm test
npm run harness:typecheck
npm run manifest
```

**Never run `npm run db:reset`** — it wipes the hosted database (CLAUDE.md §9).

---

## Integration Notes

- **Unblocks:** `auth-b` (invites and admin users need `requireSessionUser()` and the ward-scoped
  `users` read) and `auth-c` (the youth shell branches off `app/(app)/layout.tsx`).
- **Breaking change:** migration 020 drops `users_select_self`. Any code assuming a user can only
  see their own row is now wrong. Nothing in the tree assumes that today.
- **Left for `auth-c`:** the youth-account branch in the app shell. A `sacrament_manager` signing
  in during this plan lands on `/dashboard` with one nav item. That is correct but temporary — 
  01-auth-rbac.md §Step 5 requires a separate minimal layout, not a hidden nav.
- **Deliberately deferred, record in the retro:**
  - JWT custom claims and the token-reading RLS helpers (see Decisions above)
  - Session revocation on role change — superseded by the per-request `is_active` check
  - Real role dashboards — Phase 11
- **Docs to update on completion:** add a `plans/retros/auth-a-session-shell.md` entry and a line
  in `plans/retros/INDEX.md`. If the shell diverges from SPEC.md §Component Structure, update
  SPEC.md in the same change (CLAUDE.md §1).
