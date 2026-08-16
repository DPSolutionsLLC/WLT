# Plan: Auth B — Invite Flow & Admin User Management

**Created:** 2026-08-16
**Type:** feature
**Phase:** 2 of 3 for [01-auth-rbac.md](01-auth-rbac.md) — requires `auth-a` to be complete

## Overview

How an adult account comes to exist, and how the bishopric manages accounts afterwards. A
bishopric member generates an invite link tied to a role and organization; the recipient opens it,
sets a name and password, and gets exactly the role the invite carried — never the one they asked
for.

**Key requirements**

1. `POST /api/auth/invite` — bishopric-only, returns a URL.
2. `POST /api/auth/register` — unauthenticated, redeems a token, creates the auth user and the
   `users` row.
3. **Role and organization come from the invite row, never the request body.** 01-auth-rbac.md
   calls this "the single most likely security bug in this phase".
4. Single-use and expiry are enforced atomically, not by read-then-write.
5. `GET /api/admin/users` and `PATCH /api/admin/users/[id]` for the minimum viable admin surface.
6. The ward cannot lock itself out: the last active bishop cannot be deactivated or demoted.
7. Every admin change writes an audit row **and** notifies the other two bishopric members.

**Success criteria**

- A registration request carrying `role: "bishop"` in its JSON body produces a user with the
  invite's role. Proven by a test, not by review.
- An expired token, a used token, and a token from another ward are all refused.
- A failed `users` insert leaves no orphaned `auth.users` row and no consumed invite.
- Deactivating the only active bishop is refused with a clear message.
- `npm run lint`, `npm run typecheck`, and `npm test` all pass.

---

## Decisions Already Made

| Decision | Choice | Why |
|---|---|---|
| Which client redeems an invite | **Service role** | `invites` is bishopric-only under RLS (migration 019) and the registrant is unauthenticated, so no session-scoped client can read the token. There is also no INSERT policy on `users`, by design. |
| Claim ordering | **Claim the invite first, then create the auth user** | 01-auth-rbac.md suggests creating the auth user first and compensating. That closes the orphan case but leaves the single-use race open. Claiming first with a conditional UPDATE closes both — see Task 3. |
| Deactivation enforcement | **`getSessionUser()` returns null for an inactive user** (built in `auth-a`) | `auth.admin.signOut()` needs the user's JWT, which the server does not hold. Effective on the user's next request. |

---

## Relevant Files

| File | Action | What changes |
|---|---|---|
| `lib/validation/invite.ts` | create | `createInviteSchema`, `registerSchema` |
| `lib/validation/adminUser.ts` | create | `updateUserSchema` |
| `lib/auth/invites.ts` | create | `createInvite`, `claimInvite`, `releaseInvite`, `redeemInvite` |
| `lib/auth/adminUsers.ts` | create | `listWardUsers`, `updateWardUser`, `countActiveBishops` |
| `app/api/auth/invite/route.ts` | create | POST — bishopric only |
| `app/api/auth/register/route.ts` | create | POST — public, token-gated |
| `app/api/admin/users/route.ts` | create | GET — list |
| `app/api/admin/users/[id]/route.ts` | create | PATCH — role, org, active status |
| `app/(auth)/invite/[token]/page.tsx` | create | Registration page |
| `app/(auth)/invite/[token]/RegisterForm.tsx` | create | `"use client"` |
| `app/(app)/admin/layout.tsx` | create | `assertCan(user, "admin.view")` for the whole section |
| `app/(app)/admin/users/page.tsx` | create | User list + invite generator |
| `app/(app)/admin/users/UserRow.tsx` | create | `"use client"` — role/org/active editing |
| `app/(app)/admin/users/InviteForm.tsx` | create | `"use client"` — generates and displays the link |
| `lib/auth/navigation.ts` | modify | Confirm the Admin item's href resolves to a real page now |
| `tests/lib/inviteEscalation.test.ts` | create | **Highest-priority test in Phase 1** |
| `tests/lib/inviteLifecycle.test.ts` | create | Expired, used, cross-ward |
| `tests/lib/lastBishop.test.ts` | create | Lockout guard |
| `testing/scenarios/auth/scenario-003-invite-registration/` | create | Harness scenario |
| `testing/scenarios/auth/scenario-004-admin-user-management/` | create | Harness scenario |
| `testing/scenarios/manifest.json` | regenerate | `npm run manifest` |

**No migration in this plan.** The `invites` table already exists (migration 002) with the right
columns, and the atomic claim is a single conditional UPDATE that needs no schema support.

## Dependencies

No new libraries. `node:crypto` (built in) generates the token.

Uses, do not reimplement:
- `lib/auth/session.ts` — `requireSessionUser()` from `auth-a`
- `lib/auth/permissions.ts` — `assertCan()`, `BISHOPRIC_ROLES`
- `lib/audit/writeAuditLog.ts` — never throws
- `lib/notifications/notifyOtherBishopric.ts` — already emits `admin_setting_changed` to the other
  two; call it, do not hand-roll the recipient query
- `lib/supabase/service.ts` — the service-role factory, with its browser guard

---

## Known Pitfalls (from retro context)

- **[foundation-c-services]** — A ward created outside `supabase/seed/ward.sql` has **no**
  `notification_settings` rows, and `emitNotification()` warns and sends nothing for an unknown
  key. Every test and harness scenario that expects an `admin_setting_changed` notification must
  seed the trigger first: `seedFixtures(handles, { notificationTriggers: [...] })` in Vitest,
  `seedNotificationTriggers()` in the harness. This is the single most likely cause of a
  "notification didn't fire" report in this plan.
- **[foundation-c-services]** — An RLS-denied UPDATE or DELETE returns no error and zero rows.
  Re-read with the service client to prove a denial. Only INSERT raises.
- **[foundation-c-services]** — Delete wards before auth users in teardown.
- **[foundation-b-schema]** — `users.org_id` carries a **composite** foreign key
  `(org_id, ward_id) → organizations (id, ward_id)`. Assigning an organization from another ward
  fails at the database level, which is the intended backstop — but it surfaces as a foreign-key
  error, so translate it into a readable message rather than passing it through.
- **[foundation-b-schema]** — No auth users are seeded by `supabase/seed/ward.sql`. The
  Development Ward has data but nobody who can sign in. Use the harness to create accounts.
- **[CLAUDE.md §9]** — Tests run over the network against the shared hosted project. Clean up
  every fixture, and never assume an empty table.
- **[conventions.md §Validation]** — "Never trust a client-supplied `wardId`, `role`, `orgId`, or
  `userId`. All four come from the session." In this plan two of them come from the *invite row*
  instead, which is the same principle: not from the body.

---

## Tasks

### Task 1: Validation schemas

**Files:** `lib/validation/invite.ts`, `lib/validation/adminUser.ts` (create)

**Details:**

```ts
// lib/validation/invite.ts
export const createInviteSchema = z.object({
  email: z.string().email().optional(),
  role: z.enum(ROLES),
  orgId: z.string().uuid().nullable().optional(),
  counselorPosition: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
});

// The registration body carries NO role and NO orgId. This omission is the security control,
// not an oversight — Zod strips unknown keys, so a body containing `role: "bishop"` arrives at
// redeemInvite() without it. Do not add them "for completeness".
export const registerSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  password: z.string().min(12, "Use at least 12 characters."),
});
```

Write that comment into the file verbatim. It is the one place a future contributor is most likely
to "helpfully" add a field.

`updateUserSchema` in `adminUser.ts`: `role`, `orgId`, `counselorPosition`, `isActive` — all
optional, at least one required (`.refine()`). No `wardId`, ever; it comes from the session.

---

### Task 2: Invite creation

**File:** `lib/auth/invites.ts` (create) — `createInvite`

**Details:**

- Token: `randomBytes(32).toString("base64url")` from `node:crypto`. 32 bytes as the plan requires;
  `base64url` is URL-safe with no escaping.
- `expires_at`: `now + 7 days`, computed with `date-fns` `addDays` (conventions.md §Dates).
- `ward_id` from the session, `invited_by` from the session. Never from the body.
- Validate `orgId` belongs to the caller's ward before inserting, so the user sees "That
  organization is not in your ward" rather than a raw foreign-key error.
- Return `{ invite, url }` where `url` is `${origin}/invite/${token}`. Take the origin from the
  request headers, not an environment variable — this app runs on localhost and on Vercel.
- **Never log the token.** It is a bearer credential. `writeAuditLog`'s redaction pattern already
  catches a key named `token`, but do not rely on the backstop: pass the invite `id`, the role, and
  the org, and leave the token out of the detail object entirely.

---

### Task 3: Atomic claim, release, and redemption

**File:** `lib/auth/invites.ts` (create) — `claimInvite`, `releaseInvite`, `redeemInvite`

**Action:** The security core of this plan. Read this task fully before writing any of it.

**Details:**

`claimInvite(token)` — one conditional UPDATE, which Postgres executes atomically:

```ts
const nowIso = new Date().toISOString();

const { data, error } = await service
  .from("invites")
  .update({ used_at: nowIso })
  .eq("token", token)
  .is("used_at", null)
  .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
  .select()
  .maybeSingle();
```

Zero rows back means the token is unknown, already used, or expired. Return **one** generic
failure for all three — distinguishing them tells an attacker which tokens exist.

01-auth-rbac.md describes creating the auth user first and compensating on failure. That closes
the orphan case but not the race: two people opening the same link simultaneously both pass a
read-then-check and both create an account. Claiming first closes both, because the second UPDATE
matches zero rows. Write that reasoning into a comment — it is a deliberate deviation from the
phase plan.

`releaseInvite(inviteId)` — sets `used_at` back to `null`. Only ever called from `redeemInvite`'s
failure path.

`redeemInvite(token, input)`:

1. `claimInvite(token)` → the invite row, or a generic 400.
2. `service.auth.admin.createUser({ email, password, email_confirm: true })`.
   Use the invite's `email` when it has one. If it does not, the account has no way to sign in
   afterwards — reject invites without an email at creation time in Task 2 rather than discovering
   it here.
   On failure → `releaseInvite`, return the error.
3. Insert the `users` row with **`role`, `org_id`, `counselor_position`, and `ward_id` read from
   the invite row**, and `first_name`/`last_name`/`email` from the validated input. The input type
   makes it impossible to do otherwise — `RegisterInput` has no role field.
   On failure → `service.auth.admin.deleteUser(createdUserId)`, then `releaseInvite`, then return
   the error. Both compensations, in that order.
4. Return the created user id.

Every failure path logs with context (invite id, not token) and returns an actionable message. No
`catch {}` anywhere (CLAUDE.md rule 7).

---

### Task 4: Invite and registration routes

**Files:** `app/api/auth/invite/route.ts`, `app/api/auth/register/route.ts` (create)

**Details:**

`POST /api/auth/invite` — the six-step shape from conventions.md §Route Handler Shape:
`requireSessionUser()` → `assertCan(user, "admin.manage_users")` → `createInviteSchema.parse()` →
`createInvite(...)` → `writeAuditLog({ action: "invite_created", module: "admin", detail: { inviteId, role, orgId } })`
→ `notifyOtherBishopric({ wardId, actingUserId: user.id, description: "..." })`.

Catch `ForbiddenError` (via `isForbiddenError`) and return 403 — otherwise it escapes as a 500 and
tells the user nothing. Consider a small shared helper for this; every route in `auth-b` and
`auth-c` needs it.

`POST /api/auth/register` — public. No `requireSessionUser`, no `assertCan`.
`registerSchema.parse()` → `redeemInvite(token, input)` → `writeAuditLog({ action: "user_registered", module: "auth" })`
using the **new** user's id → 200.

The token comes from the JSON body here (the page has it from the URL). It is a credential, so:
never log it, and never echo it back in an error message.

Do not sign the new user in automatically. Redirect them to `/login` and let them authenticate —
one code path for establishing a session instead of two.

---

### Task 5: Registration page

**Files:** `app/(auth)/invite/[token]/page.tsx`, `RegisterForm.tsx` (create)

**Details:**

- The page is a server component in the `(auth)` group, so it inherits the unauthenticated layout
  from `auth-a` and stays out of the middleware redirect (`/invite` is already in `PUBLIC_PATHS`).
- Optionally validate the token server-side on load — with the service client, read-only, **without
  claiming it** — so an expired link says so before the user types a password. Use a separate
  read-only helper; do not call `claimInvite` here.
- The form collects first name, last name, password, and confirmation. **It must not display or
  collect a role.** Showing "You are being invited as: Ward Secretary" is fine and helpful; a role
  input is not. Note the distinction in a comment.
- Params are async in this Next.js version: `const { token } = await params`.
- On success, redirect to `/login` with a confirmation message.

---

### Task 6: Admin user queries

**File:** `lib/auth/adminUsers.ts` (create)

**Details:**

`listWardUsers(wardId, client)` — select id, first/last name, email, role, org_id,
counselor_position, is_active, created_at, joined to the organization name. Uses the **caller's
session client**, not service role: the ward-scoped SELECT policy from migration 020 already scopes
it correctly, and going through RLS is the point (rule 2). Map to camelCase here.

`countActiveBishops(wardId, client)` — `head: true, count: "exact"` over
`role = "bishop" AND is_active = true`.

`updateWardUser({ wardId, targetUserId, changes }, client)`:

1. Read the target row first. Refuse if it is in another ward — RLS would refuse anyway, but a
   clear message beats an empty result.
2. **Last-bishop guard.** If the target is currently an active bishop, and the change either sets
   `isActive: false` or moves `role` off `bishop`, then `countActiveBishops` must be > 1 or the
   change is refused with: "This is the only active bishop. Assign another bishop before changing
   this account."
3. Apply the update. Note in a comment that the guard is check-then-act and two simultaneous
   demotions could in principle slip past it — accepted, because the recovery is a service-role
   fix and the alternative is a database constraint that would block legitimate bishopric
   transitions.
4. `users` has no UPDATE policy for other people's rows — only `users_update_self`. So this write
   **must** use the service-role client while the caller's permission is enforced by `assertCan`
   in the route. Write that down: it is the one place in this plan where the API route, not RLS,
   is the effective boundary, and it is the reason `assertCan` cannot be skipped here.

---

### Task 7: Admin routes

**Files:** `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts` (create)

**Details:**

`GET /api/admin/users` — `requireSessionUser()` → `assertCan(user, "admin.manage_users")` →
`listWardUsers(user.wardId)`. No audit row; a read is not a mutation.

`PATCH /api/admin/users/[id]` — full six-step shape. Params are async:
`const { id } = await params`.

- `writeAuditLog({ action: "user_updated", module: "admin", detail: { targetUserId, changes } })`
- `notifyOtherBishopric` with a description naming what changed and who changed it — FEATURES.md
  §Module 15 requires the description, not just a ping. Example: *"Sarah Brooks changed Miguel
  Cortez's role from Ward Council Member to Executive Secretary."*
- If the user was deactivated, include that in the description. Add a comment: the deactivated user
  keeps a valid cookie until their next request, at which point `getSessionUser()` returns null
  (built in `auth-a`).
- Return 400 with the guard's message when the last-bishop check refuses, not 500.

---

### Task 8: Admin UI

**Files:** `app/(app)/admin/layout.tsx`, `admin/users/page.tsx`, `UserRow.tsx`, `InviteForm.tsx`
(create)

**Details:**

- `admin/layout.tsx` calls `requireSessionUser()` then `assertCan(user, "admin.view")`, so every
  page under `/admin` — now and in Phase 11 — is guarded once. A `ForbiddenError` here should
  render a "not permitted" page, not a 500: add an `error.tsx` in the segment, or catch and render.
- `users/page.tsx` is a server component: fetch with `listWardUsers`, render the table, and mount
  the two client children.
- `UserRow` (`"use client"`) — role select, organization select, active toggle; PATCHes on change
  and refreshes. Disable the controls on the caller's own row for role and active status: a
  bishopric member demoting themselves by accident is a self-lockout the last-bishop guard does not
  catch (they might not be the last one).
- `InviteForm` (`"use client"`) — email, role, organization, counselor position. On success, show
  the URL with a copy button. Show it **once**, plainly, with a note that it expires in 7 days and
  works a single time. Do not persist it in component state longer than the page life.
- Mobile-first: the user table becomes a stacked card list below `md:`. A horizontally scrolling
  table at 375px is not usable.

---

## Testing Strategy

Tested at the **library layer**, not over HTTP — there is no local server in this setup, and the
security-critical logic all lives in `lib/auth/invites.ts` and `lib/auth/adminUsers.ts`. The route
handlers are thin by design; the harness scenarios cover them.

### `tests/lib/inviteEscalation.test.ts` (create)

01-auth-rbac.md calls this the highest-priority test in the phase. Two layers:

1. **Schema layer** — `registerSchema.parse({ firstName, lastName, password, role: "bishop", orgId: "..." })`
   succeeds and the result has **no** `role` and **no** `orgId` key. Assert with
   `expect(result).not.toHaveProperty("role")`, not by comparing a shape.
2. **Function layer** — seed a ward with an invite for `music_coordinator`, call
   `redeemInvite(token, parsedInput)`, then read the created `users` row with the service client and
   assert `role === "music_coordinator"`. Then repeat passing a raw object that *does* carry
   `role: "bishop"` past the schema, straight into `redeemInvite`, and assert the created row is
   **still** `music_coordinator` — proving the function reads the invite, not its input.

Clean up: delete created auth users and the ward in `afterAll`, wards first.

### `tests/lib/inviteLifecycle.test.ts` (create)

- A token that does not exist → refused.
- An invite with `expires_at` in the past → refused, and `used_at` stays null.
- A used invite → refused on the second attempt. Call `claimInvite` twice in a row and assert the
  second returns nothing — this is the single-use race, tested directly.
- Two concurrent `claimInvite` calls on the same token via `Promise.all` → exactly one succeeds.
- A token belonging to ward B cannot create a user in ward A: `redeemInvite` puts the user in the
  invite's ward, so assert the created row's `ward_id` equals the invite's.
- After a forced failure at the `users` insert step, assert the auth user was deleted **and** the
  invite's `used_at` is back to null. Force it by pointing the invite at an `org_id` from another
  ward, which the composite foreign key rejects.

### `tests/lib/lastBishop.test.ts` (create)

- One active bishop in the ward → deactivating them is refused; re-read and confirm `is_active` is
  still true.
- Same setup → changing their role to `counselor` is refused.
- Two active bishops → deactivating one succeeds; the second is then protected.
- An inactive bishop does not count toward the total.

### Regression check

`tests/lib/permissions.test.ts` and `tests/rls/*` must still pass untouched. This plan changes no
policies.

---

## Test Scenarios (Harness)

Scope folder: `testing/scenarios/auth/` (continues the numbering from `auth-a`).

### Scenario 003: Invite to registration, end to end

**Tags:** `auth`, `smoke`, `admin`

**Purpose:** The invite link crosses three contexts — an authenticated admin page, a copied URL,
and an unauthenticated browser. That handoff is what breaks, and no unit test spans it. Seeding
gives a bishopric account to generate from.

**Seed data summary:**
- Ward — Harness Test Ward, with `seedNotificationTriggers()` so `admin_setting_changed` fires
- Users — `bishop` (bishop), `counselor1` (counselor, position 1)
- Organizations — the standard harness set

**Tester action:** Sign in as `bishop`, generate an invite for `music_coordinator`, copy the URL,
open it in a private window, register, then sign in as the new account.

**Verification checklist:**
- [ ] The generated link is shown once with a copy button and a stated 7-day expiry
- [ ] The registration page names the invited role ("Music Coordinator") and offers **no** way to change it
- [ ] Registration succeeds and lands on `/login`, not straight into the app
- [ ] The new account signs in and sees the music coordinator sidebar — Calendar, Talks, Music
- [ ] Opening the same invite URL a second time is refused
- [ ] Signing in as `counselor1` shows an "Admin setting changed" notification naming the bishop and the invite
- [ ] `audit_log` has an `invite_created` row and a `user_registered` row

**Failure behavior:**
- [ ] A tampered token in the URL gives the same refusal as an expired one — no hint that the token is merely unknown
- [ ] Registering with a 6-character password shows "Use at least 12 characters." before submitting
- [ ] No invite token appears anywhere in the terminal output

### Scenario 004: Admin user management and the lockout guard

**Tags:** `auth`, `full`, `admin`

**Purpose:** The last-bishop guard is a refusal, and refusals are where this app's rules live.
Setting up a ward with exactly one bishop plus a second bishop to toggle is fiddly by hand and
exact when seeded.

**Seed data summary:**
- Ward — Harness Test Ward, with `seedNotificationTriggers()`
- Users — `bishop` (bishop), `counselor1` (counselor), `secretary` (ward_secretary),
  `eqpres` (org_president, elders quorum), `spare` (ward_council_member)

**Tester action:** Sign in as `bishop`, open `/admin/users`, promote `spare` to bishop, demote them
back, then try to deactivate yourself as the only remaining bishop.

**Verification checklist:**
- [ ] The list shows all five users with role, organization, and active status
- [ ] Promoting `spare` to bishop succeeds, and `counselor1` receives a notification describing the change by name
- [ ] With two bishops, deactivating `spare` succeeds
- [ ] With one bishop left, deactivating that bishop is refused with "This is the only active bishop..."
- [ ] With one bishop left, changing that bishop's role is refused with the same message
- [ ] Deactivating `secretary` succeeds; that account can no longer sign in
- [ ] Every change appears in `audit_log` with the acting user
- [ ] At 375px the list is stacked cards, not a sideways-scrolling table

**Failure behavior:**
- [ ] The refusal is a readable message on the row, not a 500 page or a raw Postgres error
- [ ] Assigning an organization from outside the ward is impossible (or refused readably if reachable)
- [ ] Signing in as `eqpres` and opening `/admin/users` directly gives "not permitted", not a blank page

---

## Validation Commands

```bash
npm run lint
npm run typecheck
npm test
npm run harness:typecheck
npm run manifest
```

No `db:push` in this plan — it adds no migration. **Never run `npm run db:reset`.**

---

## Integration Notes

- **Requires:** `auth-a` complete. `requireSessionUser()`, the `(auth)` layout, the `(app)` shell,
  the UI primitives, and migration 020's ward-scoped `users` read are all prerequisites.
- **Unblocks:** `auth-c` — the youth-account routes live under `/api/admin/users/`, extending the
  admin surface this plan creates. `auth-c` also reuses the `ForbiddenError` → 403 helper.
- **Service-role usage in this plan, and why each is legitimate:**
  - `redeemInvite` — the registrant is unauthenticated and `invites` is bishopric-only.
  - `updateWardUser`'s write — there is no UPDATE policy for other users' rows, by design.
  Both are server-only modules. Neither returns service-role-read data to an unauthorized caller,
  and both sit behind `assertCan` where a session exists. Do not widen this pattern without the
  same justification.
- **Still open after this plan:**
  - A ward created outside `supabase/seed/ward.sql` still has no `notification_settings` rows.
    Nothing in v1 creates a ward through the app, so this stays open — hand it to whichever phase
    adds ward creation, and keep the note in the retro.
  - Full admin surface (role access matrix, ward settings, notification management, audit viewer)
    is Phase 11 ([11-notifications-admin.md](11-notifications-admin.md)).
- **Docs to update on completion:** `plans/retros/auth-b-invites-admin.md` plus a line in
  `plans/retros/INDEX.md`.
