# Phase 1 — Auth & RBAC

Sign-in for adults, username + PIN sign-in for youth, invite-based onboarding, and the
route guards that enforce the role matrix.

**Depends on:** Phase 0. **Unlocks:** every authenticated feature.
**Reference:** [FEATURES.md](../FEATURES.md) §User Roles, §Module 17 (youth accounts);
[SPEC.md](../SPEC.md) §API Routes → Auth, §Admin.

---

## Goals

1. Email/password sign-in via Supabase Auth, with `ward_id` and `role` on the session
2. Invite-link flow: bishopric generates a link tied to a role and org; recipient registers
3. Youth accounts: username + 4–6 digit PIN, no email, created entirely by an admin
4. Route guards and an app shell that shows only what the role can reach
5. Login/logout written to the audit log

---

## Step 1 — Session & Role Resolution

`lib/auth/session.ts`:

```ts
export type SessionUser = {
  id: string; wardId: string; role: Role;
  orgId: string | null; counselorPosition: 1 | 2 | null;
  firstName: string; lastName: string;
  themePreference: 'light' | 'dark' | 'system';
};

export async function getSessionUser(): Promise<SessionUser | null>
export async function requireSessionUser(): Promise<SessionUser>  // redirects to /login
```

`getSessionUser()` reads the Supabase session, then joins the `users` row. Cache it
per-request with React `cache()` so a page rendering ten components does one query.

**Put `ward_id` and `role` into the JWT** via a Supabase Auth Hook (custom access token
claims). This lets RLS policies read them from the token instead of subquerying `users`
on every row check — a meaningful performance difference on the roster and visit tables.
Keep the `users`-table fallback in the SQL helpers so the system still works if a token
is stale.

> When a bishopric admin changes someone's role, their JWT still carries the old claim
> until it refreshes. Force a refresh by revoking the session on role change, and note
> in the admin UI that the user must sign in again.

---

## Step 2 — Adult Sign-In

| Route | Purpose |
|---|---|
| `app/(auth)/login/page.tsx` | Email + password form |
| `app/(auth)/forgot-password/page.tsx` | Supabase reset-email flow |
| `app/(auth)/reset-password/page.tsx` | Landing page for the reset link |
| `app/api/auth/logout/route.ts` | Clears session, writes audit row |

Sign-in itself goes through the Supabase client directly — do not proxy it through a
custom route. What the custom code adds is:

- After sign-in, verify the `users` row exists and `is_active = true`. A deactivated
  account signs out immediately with a clear message.
- Write an audit row: `action: 'login'`, `module: 'auth'`.
- Redirect to `/dashboard`, which routes by role (Phase 11 builds the real dashboards;
  for now a placeholder per role is fine).

**Error messages must be actionable but not enumerate accounts.** "Email or password is
incorrect" — never "no account with that email."

---

## Step 3 — Invite Flow

Bishopric-only. Three routes, per SPEC.md:

| Route | Method | Does |
|---|---|---|
| `/api/auth/invite` | POST | Generate an invite: role, org, counselor position, email. Returns a URL |
| `/api/auth/register` | POST | Redeem a token: create the auth user and the `users` row |
| `/app/(auth)/invite/[token]` | page | Registration form — name, password. Role and org come from the token, not the form |

Invite token rules:

- Cryptographically random, 32+ bytes, stored in `invites.token`
- `expires_at` defaults to 7 days
- Single use — set `used_at` inside the same transaction that creates the user
- **Role and org are read from the invite row, never from the request body.** This is the
  privilege-escalation hole; close it deliberately.

Redemption is a transaction: create auth user → insert `users` row with the invite's role
and org → mark invite used. If any step fails, none apply. Supabase Auth user creation
happens outside Postgres, so compensate: create the auth user first, and on a failed
`users` insert, delete the auth user before returning the error.

Emit `admin_setting_changed` to the other two bishopric members when an invite is issued.

---

## Step 4 — Youth Accounts (Username + PIN)

Per FEATURES.md §Module 17. These accounts have no email and no self-service anything.

**Storage.** Supabase Auth requires an email. Use a synthetic one:
`{username}@youth.{ward-slug}.invalid` — the `.invalid` TLD is reserved by RFC 2606 and
can never resolve, so no mail can ever be sent there. Store the real `username` on the
`users` row and mark the account `is_youth_account = true` (add this column in Phase 0's
`core` migration).

**PIN handling.** The PIN is a password. Treat it as one:

- Hash it with the same mechanism as any password — pass it to Supabase Auth as the
  password. **Never store the PIN in a column**, hashed or otherwise.
- Enforce 4–6 digits, numeric only, at the API boundary.
- Reject trivial PINs (`0000`, `1234`, all-same-digit).

**A 4-digit PIN is 10,000 possibilities.** Rate limiting is not optional:

- Track failed attempts per username in a `youth_login_attempts` table (add in this phase)
- Lock for 15 minutes after 5 consecutive failures
- Emit a notification to bishopric on lockout

| Route | Method | Auth | Does |
|---|---|---|---|
| `/api/admin/users/youth` | POST | Bishopric | Create youth account: username, PIN, member link |
| `/api/admin/users/[id]/reset-pin` | PATCH | Bishopric | Set a new PIN. No email flow |
| `/api/auth/pin-login` | POST | Public | Username + PIN → session. Rate limited |
| `/app/(auth)/pin/page.tsx` | page | Public | Big, thumb-friendly numeric keypad |

The PIN entry page is used by a teenager on a phone. Large tap targets, numeric keyboard,
no email field, clear error text.

---

## Step 5 — Route Guards & App Shell

**Middleware** (`middleware.ts`) refreshes the Supabase session cookie on every request
and redirects unauthenticated traffic to `/login`. It must **not** enforce roles —
middleware runs on the edge without database access and would need a second round trip.

**Layout guard** (`app/(app)/layout.tsx`) calls `requireSessionUser()`, resolves
permissions, and renders the shell. Each route group additionally calls `assertCan()`
for its own permission at the top of the page component.

**Public routes bypass both:** `/public/[slug]`, `/login`, `/pin`, `/invite/[token]`.

App shell contents:

- `Sidebar` — nav items filtered by `can()`. A user never sees a link they cannot open
- `TopNav` — ward name, user menu, `ThemeToggle`
- `NotificationBell` — placeholder in this phase; wired up in Phase 11
- Mobile: sidebar collapses to a bottom tab bar or a drawer

**Youth accounts get a different shell entirely** — no sidebar, one page, a sign-out
button. Do not render the standard nav and hide items; render a separate minimal layout.

---

## Step 6 — Admin: Users

Minimum viable user management now; the full admin surface is Phase 11.

| Route | Method | Does |
|---|---|---|
| `/api/admin/users` | GET | List users with role, org, active status |
| `/api/admin/users/[id]` | PATCH | Change role, org, or `is_active` |

Every change here writes an audit row **and** notifies the other two bishopric members
with a description of what changed and who changed it. Deactivating a user revokes their
sessions.

Guard against the ward locking itself out: refuse to deactivate or demote the last
active `bishop`.

---

## Tests

| Test | Asserts |
|---|---|
| `invite-escalation.test.ts` | A registration request that includes `role: 'bishop'` in the body still gets the invite's role. **Highest priority test in this phase** |
| `invite-lifecycle.test.ts` | Expired token rejected; used token rejected; token from another ward rejected |
| `pin-login.test.ts` | Correct PIN succeeds; wrong PIN fails; 6 failures lock the account; lockout expires |
| `pin-validation.test.ts` | Non-numeric, 3-digit, 7-digit, and trivial PINs are rejected |
| `route-guards.test.ts` | Each role hitting each protected route gets 200 or 403 per the matrix |
| `youth-isolation.test.ts` | A youth session can reach the sacrament module and nothing else |
| `last-bishop.test.ts` | Deactivating the final active bishop is refused |

---

## Definition of Done

- [ ] Adult sign-in, sign-out, and password reset work end to end
- [ ] Invite generation → registration → correct role assignment, in one transaction
- [ ] Youth account creation, PIN login, PIN reset, and lockout all work
- [ ] PIN is never stored in a column and never logged
- [ ] Sidebar shows only permitted modules; direct URL access to a forbidden route 403s
- [ ] Login and logout appear in the audit log
- [ ] JWT carries `ward_id` and `role`; RLS helpers read from it with a `users` fallback
- [ ] All seven tests pass

---

## Pitfalls

- **Role from the request body.** The single most likely security bug in this phase.
  Role and org come from the invite row or the admin's authenticated action — never from
  user-supplied JSON. Assert this in a test, not just in review.
- **Middleware doing role checks.** It cannot query the database cheaply. Session refresh
  and auth redirect only; role enforcement belongs in the layout and page.
- **Stale JWT claims after a role change.** Revoke the session so the next request forces
  a fresh token, and tell the user they need to sign in again.
- **Synthetic youth emails colliding across wards.** Include the ward slug in the local
  part or the subdomain so `jsmith` in two wards does not collide.
- **PIN in a log line.** Scrub request bodies before logging on any auth route. A PIN in
  a Vercel log is a real leak.
- **Hiding UI is not access control.** Every guarded page calls `assertCan()` server-side.
  A hidden sidebar link is cosmetic.
