# Plan: Auth C — Youth Accounts, PIN Login & Lockout

**Created:** 2026-08-16
**Type:** feature
**Phase:** 3 of 3 for [01-auth-rbac.md](01-auth-rbac.md) — requires `auth-a` and `auth-b`

## Overview

Username + PIN accounts for the youth sacrament assignment manager (FEATURES.md §Module 17). These
accounts have no email, no self-service anything, and reach exactly one module. A four-digit PIN is
10,000 possibilities, so rate limiting is part of the feature, not a hardening pass afterwards.

**Key requirements**

1. Bishopric creates the account outright: username, PIN, member link. No invite, no email.
2. **The PIN is never stored in a column**, hashed or otherwise — it is the password on a synthetic
   Supabase Auth account.
3. 4–6 digits, numeric only, trivial PINs refused, enforced at the API boundary.
4. Five consecutive failures locks the username for 15 minutes and notifies the bishopric.
5. A youth session gets a **separate minimal shell** — not the standard nav with items hidden.
6. The PIN never reaches a log line, an error message, or an audit detail object.

**Success criteria**

- A youth account signs in with username + PIN and lands on the sacrament module.
- That session cannot reach the roster, the calendar, or any admin page.
- `0000`, `1234`, `1111`, `123`, `1234567`, and `12a4` are all refused with useful messages.
- The sixth attempt after five failures is refused even with the correct PIN, and the bishopric has
  a notification.
- `users.pin_hash` no longer exists.
- `npm run lint`, `npm run typecheck`, and `npm test` all pass.

---

## Decisions Already Made

| Decision | Choice | Why |
|---|---|---|
| PIN storage | **Supabase Auth password. Drop `users.pin_hash`.** | Migration 002 created `pin_hash` with "Phase 1 chooses the hash function"; 01-auth-rbac.md §Step 4 says never store it in a column. The phase plan wins. One credential system, Supabase handles hashing and session issuance, and a hand-rolled hash is a security surface with no upside. |
| Synthetic email domain | **`{username}@youth.{ward-uuid}.invalid`** | 01-auth-rbac.md says "ward slug", but `wards` has no `slug` column and adding one to dodge a collision the UUID already prevents is the wrong trade. `.invalid` is reserved by RFC 2606 and can never resolve, so no mail can ever be sent there. |
| Lockout threshold | **5 failures → locked; the 6th attempt is refused** | Reconciles §Step 4 ("after 5 consecutive failures") with the test table ("6 failures lock the account"). |
| Ward resolution at PIN login | **Look up the username across wards; refuse if ambiguous** | The login form has no ward field and v1 is single-ward. Multi-ward UI is explicitly out of scope (plans/INDEX.md §Scope Guardrails). |

---

## Relevant Files

| File | Action | What changes |
|---|---|---|
| `supabase/migrations/021_youth_accounts.sql` | create | Drop `users.pin_hash`; create `youth_login_attempts` + RLS; add the lockout trigger row |
| `supabase/seed/notification_triggers.sql` | modify | Add `youth_account_locked` so fresh wards get it too |
| `types/database.ts` | regenerate | `npm run db:types` after pushing |
| `lib/validation/youthAccount.ts` | create | PIN and username schemas |
| `lib/auth/youthAccounts.ts` | create | `syntheticYouthEmail`, `createYouthAccount`, `resetYouthPin` |
| `lib/auth/pinLockout.ts` | create | `assertNotLocked`, `recordFailedAttempt`, `clearAttempts` |
| `lib/auth/errors.ts` | modify | Add `PinLockedError` beside `ForbiddenError` |
| `app/api/admin/users/youth/route.ts` | create | POST — bishopric only |
| `app/api/admin/users/[id]/reset-pin/route.ts` | create | PATCH — bishopric only |
| `app/api/auth/pin-login/route.ts` | create | POST — public, rate limited |
| `app/(auth)/pin/page.tsx` | create | Server page |
| `app/(auth)/pin/PinKeypad.tsx` | create | `"use client"` — thumb-sized numeric keypad |
| `app/(youth)/layout.tsx` | create | Minimal shell — no sidebar |
| `app/(youth)/sacrament/page.tsx` | create | Placeholder until Phase 10 |
| `app/(app)/layout.tsx` | modify | Redirect a youth account to the youth shell |
| `app/(app)/admin/users/page.tsx` | modify | Add the youth section |
| `app/(app)/admin/users/YouthAccountForm.tsx` | create | `"use client"` — create + reset PIN |
| `app/(auth)/login/LoginForm.tsx` | modify | Add a "Youth sign-in" link to `/pin` |
| `middleware.ts` | verify | `/pin` is already in `PUBLIC_PATHS` from `auth-a` — confirm, do not duplicate |
| `testing/infrastructure/seedUtils.ts` | modify | Add a `createYouthAccount()` factory |
| `tests/lib/pinValidation.test.ts` | create | Pure-function tests, no network |
| `tests/lib/pinLockout.test.ts` | create | Threshold, expiry, reset-on-success |
| `tests/rls/youth-isolation.test.ts` | create | One module and nothing else |
| `testing/scenarios/auth/scenario-005-youth-pin-login/` | create | Harness scenario |
| `testing/scenarios/auth/scenario-006-pin-lockout/` | create | Harness scenario |
| `testing/scenarios/manifest.json` | regenerate | `npm run manifest` |

## Dependencies

No new libraries.

Uses, do not reimplement: `lib/auth/session.ts`, `lib/auth/permissions.ts`,
`lib/audit/writeAuditLog.ts`, `lib/notifications/emitNotification.ts`,
`lib/notifications/notifyOtherBishopric.ts`, and the service-role factory.

---

## Known Pitfalls (from retro context)

- **[foundation-b-schema]** — **Migration 019 enabled RLS by looping the catalog at migration
  time.** It does not cover tables created afterwards. `youth_login_attempts` **must** carry its own
  `alter table ... enable row level security` in migration 021. Without it the table is readable by
  every authenticated user in every ward, with no error to hint at it. `tests/db/rls-enabled.test.ts`
  will fail — let it be the backstop, not the discovery mechanism.
- **[foundation-b-schema]** — Migration 019 set default privileges for future tables, so the new
  table does not need its own `GRANT`. Verify with the rls test rather than adding a redundant grant.
- **[foundation-c-services]** — A ward with no `notification_settings` row for a key gets nothing
  from `emitNotification()` except a console warning. `youth_account_locked` is a **new** key: it
  needs both a seed-file line (fresh wards) and an insert in migration 021 (wards that already
  exist), or the lockout notification silently never fires.
- **[foundation-c-services]** — An RLS-denied UPDATE or DELETE returns no error and zero rows.
  Re-read with the service client. Only INSERT raises.
- **[foundation-c-services]** — Delete wards before auth users in teardown.
- **[foundation-a-scaffold]** — `cookies()` is async; `@supabase/ssr` allows only `getAll`/`setAll`.
- **[CLAUDE.md rule 8 / conventions.md §Error Handling]** — Never log a PIN. Zod's default error for
  a failing string can echo the input; write explicit messages on every PIN rule so nothing
  interpolates the value.
- **[CLAUDE.md §9]** — `npm run db:reset` wipes the hosted database. Use `db:push`.

---

## Tasks

### Task 1: Migration — drop `pin_hash`, add lockout tracking

**File:** `supabase/migrations/021_youth_accounts.sql` (create)

**Details:**

```sql
-- Phase 1C, migration 021: youth account support.
--
-- pin_hash is dropped, not populated. Migration 002 created it with "Phase 1 chooses the hash
-- function"; plans/01-auth-rbac.md §Step 4 rules that the PIN is never stored in a column,
-- hashed or otherwise — it is the password on a synthetic Supabase Auth account, so Supabase
-- owns the hashing. Two credential stores for one credential is a drift waiting to happen, and
-- a column named pin_hash that is always null is worse than no column at all.
alter table users drop column pin_hash;

-- Rate limiting for username + PIN sign-in. A 4-digit PIN is 10,000 possibilities, so this is
-- part of the feature, not hardening (plans/01-auth-rbac.md §Step 4).
--
-- Keyed by username rather than user id: the attempt has to be recorded even when the username
-- does not resolve to anyone, or probing for valid usernames becomes free.
create table youth_login_attempts (
  id             uuid primary key default gen_random_uuid(),
  ward_id        uuid not null references wards (id) on delete cascade,
  username       text not null,
  failed_count   integer not null default 0,
  locked_until   timestamptz,
  last_failed_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (ward_id, username)
);

-- Migration 019 enabled RLS by looping the catalog AT MIGRATION TIME; it does not reach tables
-- created later. Postgres defaults RLS off, so this line is what stands between this table and
-- every authenticated user in every ward.
alter table youth_login_attempts enable row level security;

-- No policies, deliberately. Only the PIN login route touches this table and it runs with the
-- service-role client (the caller is unauthenticated by definition). RLS enabled with zero
-- policies denies every authenticated read and write, which is exactly right — failed-attempt
-- counts are not something a ward member needs to see.

comment on table youth_login_attempts is
  'Failed username+PIN attempts. Service-role only. Never stores the PIN itself.';

-- New notification trigger for wards that already exist. supabase/seed/notification_triggers.sql
-- gets the same key for wards created later; both are needed or the lockout notification fires
-- into nothing (plans/retros/foundation-c-services.md).
insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, 'youth_account_locked', array['bishop', 'counselor']::text[], true
from wards ward
on conflict (ward_id, trigger_key) do nothing;
```

Store `username` lower-cased at every write so the unique index behaves. The `users` table already
has a case-insensitive unique index (`users_username_key` on `(ward_id, lower(username))`).

**Then:** update `supabase/seed/notification_triggers.sql` with the same key under a
`-- Youth accounts` heading, and bump the count in its header comment (it currently says
"Twenty-two keys"). Then `npm run db:push` and `npm run db:types`.

---

### Task 2: PIN and username validation

**File:** `lib/validation/youthAccount.ts` (create)

**Details:**

```ts
const TRIVIAL_PINS = new Set(["1234", "4321", "0000", "123456", "654321"]);

export const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, "Use 4 to 6 digits, numbers only.")
  .refine((pin) => !TRIVIAL_PINS.has(pin), "Choose a less predictable PIN.")
  .refine((pin) => new Set(pin).size > 1, "Choose a less predictable PIN.");

export const usernameSchema = z
  .string()
  .min(3).max(30)
  .regex(/^[a-z0-9._-]+$/, "Use lowercase letters, numbers, dots, dashes, or underscores.")
  .transform((value) => value.toLowerCase());

export const createYouthAccountSchema = z.object({
  username: usernameSchema,
  pin: pinSchema,
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  memberId: z.string().uuid().optional(),
});

export const resetPinSchema = z.object({ pin: pinSchema });
```

Every message is a fixed string. **Never interpolate the PIN into an error** — Zod's default
messages can echo the input, and a validation error is the easiest way to get a PIN into a log
(CLAUDE.md rule 8). The all-same-digit rule is `new Set(pin).size > 1`, which covers `0000` through
`999999` without listing them.

The `role` for these accounts is always `sacrament_manager` and is set by the server, never
accepted from the body — the same rule as the invite flow in `auth-b`.

---

### Task 3: Youth account creation and PIN reset

**File:** `lib/auth/youthAccounts.ts` (create)

**Details:**

```ts
// RFC 2606 reserves .invalid, so this address can never resolve and no mail can ever be sent to
// it. The ward id rather than a slug: `wards` has no slug column, and adding one to prevent a
// collision a UUID already prevents is the wrong trade. Deviates from 01-auth-rbac.md §Step 4
// deliberately.
export function syntheticYouthEmail(username: string, wardId: string): string {
  return `${username.toLowerCase()}@youth.${wardId}.invalid`;
}
```

`createYouthAccount({ wardId, actingUserId, input })`:

1. Check the username is free in this ward before touching Auth — a clean "That username is
   already taken in this ward." beats a unique-violation.
2. `service.auth.admin.createUser({ email: syntheticYouthEmail(...), password: input.pin, email_confirm: true })`.
   `email_confirm: true` matters: there is no inbox to confirm from, and an unconfirmed account
   cannot sign in.
3. Insert the `users` row: `role: "sacrament_manager"`, `username`, `email: null`, `ward_id`, names
   from the input. **`email` stays null** — the synthetic address lives in `auth.users` only, and a
   `.invalid` address in `public.users` would surface in the admin list as if it were real.
4. On a failed `users` insert, `deleteUser` the auth user before returning — the same compensating
   pattern as `redeemInvite` in `auth-b`.
5. Return the created id. **Never return, log, or audit the PIN.**

`resetYouthPin({ wardId, targetUserId, pin })`:
- Confirm the target is in the caller's ward and actually has a username, then
  `service.auth.admin.updateUserById(targetUserId, { password: pin })`.
- Clear any lockout rows for that username — a reset is the admin's way of unblocking someone.
- Audit as `{ action: "youth_pin_reset", module: "admin", detail: { targetUserId } }`. The detail
  object must not contain the PIN. `writeAuditLog` redacts keys matching `/pin/i` as a backstop —
  do not rely on it.

---

### Task 4: Lockout tracking

**File:** `lib/auth/pinLockout.ts` (create)

**Details:**

```ts
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

export async function assertNotLocked(wardId, username, client): Promise<void>
export async function recordFailedAttempt(wardId, username, client): Promise<{ isNowLocked: boolean }>
export async function clearAttempts(wardId, username, client): Promise<void>
```

- `assertNotLocked` — read the row; if `locked_until` is in the future, throw a `PinLockedError`
  carrying the remaining minutes. Define that error class beside `ForbiddenError` in
  `lib/auth/errors.ts` (modify that file) so route handlers have one place to look.
- `recordFailedAttempt` — upsert on `(ward_id, username)`, incrementing `failed_count` and setting
  `last_failed_at`. When the new count reaches `MAX_FAILED_ATTEMPTS`, set
  `locked_until = now + LOCKOUT_MINUTES` and return `{ isNowLocked: true }`. Use `date-fns`
  `addMinutes` (conventions.md §Dates); do not hand-roll millisecond arithmetic.
- `clearAttempts` — delete the row on a successful sign-in. "Five *consecutive* failures" means the
  counter resets on success, not that it accumulates forever.
- A stale lock (`locked_until` in the past) should reset `failed_count` to 0 on the next attempt so
  the window is genuinely rolling.
- Take an optional `client?` like every other lib helper, so the tests can pass a service client.

---

### Task 5: PIN login route

**File:** `app/api/auth/pin-login/route.ts` (create)

**Action:** The only unauthenticated write path in Phase 1. Read this fully before writing it.

**Details:**

```ts
export async function POST(request: Request) {
  const { username, pin } = pinLoginSchema.parse(await request.json());
  const service = createServiceSupabaseClient();

  // 1. Resolve the username to a user row across wards (service role — the caller has no session).
  //    Select id, ward_id, username, is_active. Filter `username is not null`.
  // 2. Zero matches → generic 401. More than one match → generic 401 plus a console.warn:
  //    v1 is single-ward, and an ambiguous username means the multi-ward assumption broke.
  // 3. assertNotLocked(wardId, username, service)
  // 4. Sign in through a SERVER client so @supabase/ssr writes the session cookies onto the
  //    response: createServerSupabaseClient().auth.signInWithPassword({
  //      email: syntheticYouthEmail(username, wardId), password: pin })
  // 5. Failure → recordFailedAttempt. If isNowLocked, emitNotification({ triggerKey:
  //    "youth_account_locked", ... }). Return the generic 401.
  // 6. Success → clearAttempts, writeAuditLog({ action: "login", module: "auth" }),
  //    return { redirectTo: "/sacrament" }.
}
```

Non-negotiable details:

- **One error message for every failure**: "That username or PIN is not correct." Unknown username,
  wrong PIN, and inactive account must be indistinguishable. A distinct "no such username" turns a
  10,000-guess problem into a two-step one.
- **Locked is the one exception** and it is deliberate: "Too many attempts. Try again in N minutes."
  The account is already known to exist by the time anyone sees this, and a user staring at a
  correct PIN that keeps failing needs to know why.
- **Never log the PIN.** Not in a success path, not in a catch block, not in the Zod error. Log
  `{ username, wardId }` only. Add a comment saying so — a PIN in a Vercel log is a real leak
  (01-auth-rbac.md §Pitfalls).
- Steps 3 and 5 use the **service** client (`youth_login_attempts` has no policies); step 4 uses the
  **server** client so cookies land on the response. Two clients in one handler is unusual — comment
  on why.
- Step 6's `writeAuditLog` can use the now-authenticated server client, so the
  `user_id = auth.uid()` insert policy is satisfied.

Add `pinLoginSchema` to `lib/validation/youthAccount.ts`: `{ username: usernameSchema, pin: z.string() }`.
Note deliberately: the **login** schema does not apply the PIN format rules. A user whose PIN
predates a rule change must still be able to sign in, and a format rejection at login is an oracle
telling an attacker which shapes are worth trying.

---

### Task 6: Admin routes for youth accounts

**Files:** `app/api/admin/users/youth/route.ts`, `app/api/admin/users/[id]/reset-pin/route.ts`
(create)

**Details:**

Both follow conventions.md §Route Handler Shape and both require
`assertCan(user, "admin.manage_users")`.

- `POST /api/admin/users/youth` → `createYouthAccount` → audit
  `{ action: "youth_account_created", module: "admin", detail: { targetUserId, username } }` →
  `notifyOtherBishopric` describing the creation by name. **No PIN in either.**
- `PATCH /api/admin/users/[id]/reset-pin` → `resetYouthPin` → audit → `notifyOtherBishopric`.
  Params are async: `const { id } = await params`.
- Reuse the `ForbiddenError` → 403 helper from `auth-b`. Add a `PinLockedError` → 429 branch to it
  while you are there.

---

### Task 7: PIN entry page

**Files:** `app/(auth)/pin/page.tsx`, `app/(auth)/pin/PinKeypad.tsx` (create)

**Action:** Used by a teenager on a phone. Design for that.

**Details:**

- Username text input with `inputMode="text"` and `autoCapitalize="off"` — an auto-capitalised
  first letter against a lower-cased username is a login failure with no visible cause.
- PIN entry as an on-screen keypad: digits 0–9, a delete key, and a submit key. Minimum 56px tap
  targets, three columns, comfortably inside a 375px viewport. Set `inputMode="numeric"` on any
  underlying input so a hardware keyboard also works.
- Mask the entered digits as filled dots. Never render the digits themselves.
- No email field anywhere on this page.
- Errors in large, plain text. "Too many attempts. Try again in 12 minutes." — not a status code.
- On success, `router.replace(redirectTo)` then `router.refresh()`.
- Add a "Ward leader sign-in" link back to `/login`, and the matching "Youth sign-in" link on
  `LoginForm.tsx`. Two entry points with no route between them is a support call.

---

### Task 8: Youth shell

**Files:** `app/(youth)/layout.tsx`, `app/(youth)/sacrament/page.tsx` (create),
`app/(app)/layout.tsx` (modify)

**Action:** 01-auth-rbac.md §Step 5: *"Do not render the standard nav and hide items; render a
separate minimal layout."*

**Details:**

- `app/(youth)/layout.tsx` calls `requireSessionUser()`, then redirects to `/dashboard` if the role
  is **not** `sacrament_manager`. Header with the ward name and a sign-out button. No sidebar, no
  notification bell, no theme toggle beyond what the root script provides.
- `app/(app)/layout.tsx` gains the mirror check: if `user.role === "sacrament_manager"`, redirect to
  `/sacrament`. Together these two make the shells mutually exclusive by construction rather than by
  a nav filter.
- `app/(youth)/sacrament/page.tsx` — a placeholder calling
  `assertCan(user, "sacrament.view_assignments")`, naming the module, and pointing at
  [10-sacrament-admin.md](10-sacrament-admin.md). Keep it thin; Phase 10 builds the real thing.
- Route-group note: `(app)` and `(youth)` are both groups, so `/sacrament` resolves from
  `app/(youth)/sacrament/`. SPEC.md §Component Structure puts the bishopric's
  `/sacrament/admin` page under the authenticated shell — that is Phase 10's problem, but flag the
  collision in the retro so Phase 10 does not discover it the hard way.

---

### Task 9: Admin UI for youth accounts

**Files:** `app/(app)/admin/users/YouthAccountForm.tsx` (create),
`app/(app)/admin/users/page.tsx` (modify)

**Details:**

- A separate "Youth accounts" section under the adult user list. Youth accounts have no email and
  no invite, so mixing them into one table makes both harder to read.
- Create form: username, first name, last name, PIN, confirm PIN. Validate with
  `createYouthAccountSchema` client-side so the rules are stated before submission, not after.
- After creation, show the username and PIN **once**, with "Write this down — it cannot be
  retrieved." Then a reset-PIN control per row. The PIN is only ever in memory on this page; never
  persist it, never put it in a URL.
- A reset shows the new PIN the same way, once.

---

### Task 10: Harness factory for youth accounts

**File:** `testing/infrastructure/seedUtils.ts` (modify)

**Action:** `createTestUser()` always builds an email account via `testEmail(handle)`. Youth
accounts need the synthetic address and the PIN as the password.

**Details:**

Add `createYouthAccount({ username, pin, firstName?, lastName?, isActive? })` alongside it,
following the existing shape: reuse the auth user if it already exists (`listUsers` then
`updateUserById` for the password), upsert the `users` row with `role: "sacrament_manager"`,
`username`, and `email: null`. Return `{ id, username, pin }`.

Import `syntheticYouthEmail` from `lib/auth/youthAccounts.ts` rather than rebuilding the address —
two copies of that format will drift, and the drift shows up as a login that fails for no visible
reason.

Update `testing/README.md` §What the factories cover in the same change.

---

## Testing Strategy

### `tests/lib/pinValidation.test.ts` (create)

Pure functions, no network — the cheapest and highest-value tests here (CLAUDE.md §8 item 4).
Table-driven:

| Input | Expected |
|---|---|
| `"1234"`, `"0000"`, `"1111"`, `"999999"`, `"4321"` | rejected |
| `"123"` (3 digits), `"1234567"` (7 digits), `""` | rejected |
| `"12a4"`, `"12 4"`, `"12.4"`, `"१२३४"` | rejected |
| `"1357"`, `"9042"`, `"573914"` | accepted |

Also: `usernameSchema` lower-cases its input; `syntheticYouthEmail("JSmith", wardId)` ends in
`.invalid` and contains no uppercase.

**And one negative test that matters more than it looks:** assert that a rejected PIN's error
message does **not** contain the PIN. Iterate the rejected cases and check
`expect(message).not.toContain(pin)`. That is the regression guard for CLAUDE.md rule 8.

### `tests/lib/pinLockout.test.ts` (create)

Against the hosted project with a service client and a per-run ward, cleaned up in `afterAll`.

- Four failures → not locked; the fifth → locked.
- While locked, `assertNotLocked` throws `PinLockedError` with a positive remaining-minutes value.
- A success between failures resets the count: fail 3, `clearAttempts`, fail 3 again → still not
  locked.
- A row whose `locked_until` is in the past (set directly with the service client) does not throw,
  and the next failure starts from 1 rather than 6.
- A failed attempt on a username that matches no user still records a row — the anti-enumeration
  property.

### `tests/rls/youth-isolation.test.ts` (create)

The `sacramentManager` and `sacramentManagerInactive` handles already exist in
`tests/helpers/seed.ts`. Note that the existing `tests/rls/sacrament-access.test.ts` covers the
sacrament tables — this file covers everything a youth account must **not** reach.

Signed in as `sacramentManager`:
- Reading `members`, `households`, `sundays`, `visit_logs`, and `agendas` returns rows (ward-scoped
  policies permit any ward member) — **so document that the youth account's real boundary is
  `SACRAMENT_MANAGER_PERMISSIONS` plus the separate shell, not RLS.** Assert
  `can(youthUser, "roster.view") === false` for each, table-driven.
- `audit_log`, `invites`, `tithing_entries`, and `topics` return **zero** rows — those are
  bishopric-only, so RLS genuinely blocks them.
- INSERT into `sacrament_assignments` is refused (error returned); UPDATE of an existing one
  succeeds. This is the manager's exact capability.
- `sacrament_rotation_pools` returns zero rows.

This asymmetry is the important finding of the file. Write it into the retro: for a youth account,
RLS is not the whole boundary, and that is the strongest argument for the separate shell.

---

## Test Scenarios (Harness)

Scope folder: `testing/scenarios/auth/`.

### Scenario 005: Youth PIN sign-in and shell isolation

**Tags:** `auth`, `smoke`, `sacrament`

**Purpose:** The PIN keypad is a physical-device question — tap targets, numeric keyboard,
auto-capitalisation — that no test can answer. Seeding gives a youth account with a known PIN,
which is otherwise a multi-step admin flow before you can even start.

**Seed data summary:**
- Ward — Harness Test Ward, with `seedNotificationTriggers()`
- Users — `bishop` (bishop); `jsmith` youth account via the new `createYouthAccount()` factory,
  PIN `5729`
- Sacrament — one rotation pool and a month of assignments via `createSacramentRotationPool()` and
  `createSacramentAssignment()`, plus `setSacramentManager()` pointing at the youth account

**Tester action:** Open `/pin` **on a real phone or at 375px**, sign in as `jsmith` / `5729`, then
try to reach `/dashboard`, `/admin/users`, and `/visits` by typing the URLs.

**Verification checklist:**
- [ ] `/pin` shows a username field and a numeric keypad, and no email field anywhere
- [ ] Keypad digits are comfortably tappable with a thumb; nothing is clipped at 375px
- [ ] Entered PIN digits appear as dots, never as numbers
- [ ] Correct username + PIN lands on the sacrament page
- [ ] The youth shell has **no** sidebar, no notification bell, and a visible sign-out button
- [ ] Typing `/dashboard` redirects back to `/sacrament`
- [ ] Typing `/admin/users` does not show the admin page
- [ ] Signing in as `bishop` and typing `/sacrament` does **not** trap the bishop in the youth shell
- [ ] `audit_log` has a `login` row for the youth account

**Failure behavior:**
- [ ] A wrong PIN says "That username or PIN is not correct."
- [ ] An unknown username gives the **identical** message — no hint that the username is unknown
- [ ] The PIN appears nowhere in the terminal output, not even on the failure path
- [ ] The username field does not auto-capitalise on iOS

### Scenario 006: PIN lockout

**Tags:** `auth`, `full`, `sacrament`

**Purpose:** Lockout is a timed state, so the interesting moments are the fifth failure, the sixth
attempt with the *correct* PIN, and the bishopric notification. Seeding an account at four failures
is the only sane way to reach the boundary repeatedly.

**Seed data summary:**
- Ward — Harness Test Ward, with `seedNotificationTriggers()` (must include `youth_account_locked`)
- Users — `bishop` (bishop), `counselor1` (counselor); `jsmith` youth account, PIN `5729`
- `youth_login_attempts` — one row for `jsmith` with `failed_count: 4` and `locked_until: null`,
  seeded directly with the admin client

**Tester action:** Fail once (the fifth attempt), then try the **correct** PIN. Then sign in as
`bishop` to check the notification, reset the PIN, and sign in as `jsmith` again.

**Verification checklist:**
- [ ] The fifth failure locks the account and says how many minutes remain
- [ ] The **correct** PIN is refused while locked, with the same lockout message
- [ ] `bishop` and `counselor1` both have a notification saying the youth account was locked
- [ ] Resetting the PIN from `/admin/users` clears the lock immediately
- [ ] The new PIN signs in on the first try
- [ ] Four failures followed by a success leaves no lock — the counter resets

**Failure behavior:**
- [ ] The lockout message gives minutes remaining, not a raw timestamp or a status code
- [ ] The notification names the account but contains no PIN
- [ ] Neither the old nor the new PIN appears in the terminal output

---

## Validation Commands

```bash
npm run db:push
npm run db:types
npm run lint
npm run typecheck
npm test
npm run harness:typecheck
npm run manifest
```

`tests/db/migrations.test.ts` fails if migration 021 is on disk but unpushed, and
`tests/db/rls-enabled.test.ts` fails if `youth_login_attempts` shipped without RLS enabled. Both are
intentional tripwires — do not work around them.

**Never run `npm run db:reset`.**

---

## Integration Notes

- **Requires:** `auth-a` (session, shell, middleware public paths, UI primitives) and `auth-b` (the
  admin users page and the `ForbiddenError` → 403 helper this plan extends).
- **Breaking change:** `users.pin_hash` is dropped. Nothing reads it today — confirm with a grep for
  `pin_hash` before pushing, and regenerate `types/database.ts` in the same change (CLAUDE.md
  rule 9).
- **New notification trigger:** `youth_account_locked`. It exists in two places — migration 021 for
  existing wards, `supabase/seed/notification_triggers.sql` for future ones. Both are required.
- **Phase 1 Definition of Done, at the end of this plan:** all boxes in 01-auth-rbac.md are met
  except *"JWT carries `ward_id` and `role`"*, deferred deliberately (see `auth-a` §Decisions).
  State that plainly in the retro rather than ticking it.
- **Hand to Phase 10** ([10-sacrament-admin.md](10-sacrament-admin.md)):
  - The `/sacrament` route now resolves inside the `(youth)` group. SPEC.md places the bishopric's
    `/sacrament/admin` page in the authenticated shell. Phase 10 must resolve that collision —
    likely by moving the bishopric view to `/admin/sacrament`, which also matches how every other
    bishopric-only screen is addressed.
  - `setSacramentManager()` already exists in the harness; the link between a youth `users` row and
    `sacrament_assignment_managers` is what makes `is_active_sacrament_manager()` return true.
- **Still open across Phase 1:** JWT custom claims and token-reading RLS helpers; ward creation
  seeding `notification_settings`; password-reset email (needs SMTP on the hosted project).
- **Docs to update on completion:** `plans/retros/auth-c-youth-pin.md`, a line in
  `plans/retros/INDEX.md`, and `testing/README.md` for the new factory.
