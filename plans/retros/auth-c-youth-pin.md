---
id: auth-c-youth-pin
type: feature
iter: null
commits: ["80004f5"]
date: 2026-08-17
files:
  - supabase/migrations/021_youth_accounts.sql
  - supabase/seed/notification_triggers.sql
  - lib/validation/youthAccount.ts
  - lib/auth/syntheticYouthEmail.ts
  - lib/auth/youthAccounts.ts
  - lib/auth/pinLockout.ts
  - lib/auth/errors.ts
  - lib/auth/routeErrors.ts
  - app/api/auth/pin-login/route.ts
  - app/api/admin/users/youth/route.ts
  - app/api/admin/users/[id]/reset-pin/route.ts
  - app/(auth)/pin/page.tsx
  - app/(auth)/pin/PinSignInForm.tsx
  - app/(auth)/login/LoginForm.tsx
  - app/(youth)/layout.tsx
  - app/(youth)/YouthSignOut.tsx
  - app/(youth)/sacrament/page.tsx
  - app/(app)/layout.tsx
  - app/(app)/admin/users/page.tsx
  - app/(app)/admin/users/YouthAccountForm.tsx
  - testing/infrastructure/seedUtils.ts
  - testing/infrastructure/cleanUp.ts
  - types/database.ts
  - FEATURES.md
  - SPEC.md
related: [auth-a-session-shell, auth-b-invites-admin, foundation-b-schema, foundation-c-services]
---

## What was done

Milestone M3 of Phase 1, and the last of it: username + PIN accounts for the youth sacrament
assignment manager. The bishopric creates the account outright — no invite, no email — and the
youth signs in at `/pin` and lands in a separate minimal shell that reaches exactly one module.
Five consecutive failures lock the username for 15 minutes and notify the bishopric. Migration
021 drops `users.pin_hash` and adds `youth_login_attempts`. 248 tests pass, and both halves were
driven end to end. Phase 1 is complete except for JWT custom claims, deferred in `auth-a`.

## Key decisions

- **The PIN is a Supabase Auth password on a synthetic address, and `pin_hash` is dropped.**
  Migration 002 created that column with "Phase 1 chooses the hash function"; 01-auth-rbac.md
  §Step 4 says the PIN is never stored in a column. The phase plan won. One credential store,
  Supabase owns the hashing and session issuance, and a column that is always null is worse
  than no column.
- **`{username}@youth.{ward-uuid}.invalid`, not a ward slug.** `wards` has no slug column, and
  adding one to prevent a collision a UUID already prevents is the wrong trade. RFC 2606
  reserves `.invalid`, so no mail can ever be sent there.
- **Six-digit PINs, not the 4–6 the plan and FEATURES.md specified.** Forced by the Supabase
  Auth asymmetry below: a shorter PIN can be created and then never reset, and a reset is the
  bishopric's only way to unblock a locked-out youth. Also takes the guess space from 10,000 to
  1,000,000. FEATURES.md was updated in the same change rather than left to contradict the code.
- **The attempt that trips the lock says so; every other failure is indistinguishable.** An
  unknown username returns before `recordFailedAttempt` is ever reached, so by the time a
  lockout message can appear the account is already known to exist — which the 429 on the *next*
  attempt would reveal anyway. Returning the generic message on the fifth failure was tried
  first and is wrong in practice: the youth's next correct PIN fails with no explanation.
- **The login schema applies no PIN format rules.** A format rejection at sign-in is an oracle
  telling an attacker which shapes are worth trying, and an account whose PIN predates a rule
  change must still be able to sign in. Only creation and reset enforce the format.
- **No `memberId` on `createYouthAccountSchema`,** which the plan sketched. `public.users` has
  no member column; the youth↔member link lives in `sacrament_assignment_managers`, which Phase
  10 owns. Accepting a field the server then discards is the silent drop CLAUDE.md rule 9 exists
  to prevent.
- **No on-screen keypad — a reversal of the plan's Task 7.** Real-device testing showed
  `inputMode="numeric"` already raises the phone's own numeric keypad, so an app-drawn one was a
  second keypad competing with the first for screen space, and on a desktop it was slower than
  typing. The plan assumed the app had to supply the keypad; the platform already does.

## Pitfalls for next time

- **Supabase Auth enforces the project's minimum password length on
  `auth.admin.updateUserById` but NOT on `auth.admin.createUser`.** A four-character password
  creates an account that signs in perfectly and can never have its password changed. This cost
  the most time in the phase and the symptom was a long way from the cause: the harness seed
  threw on the *second* run only, the `users` row was never written, and the PIN login route
  then reported "That username or PIN is not correct" for a correct PIN — because there was no
  account to match. **Any future flow that sets a password twice needs to be exercised twice.**
- **`cleanUp.ts` matched harness auth users by `@TEST_EMAIL_DOMAIN` only.** Youth accounts carry
  the synthetic `.invalid` address, so they survived `npm run seed:clean` — leaving a working
  login on the shared hosted project, and making the next seed take the broken `updateUserById`
  path. Any future account type with a different address shape has to be added to
  `harnessDomains` at the same time it is added to the factories.
- **A youth account's real boundary is the permission matrix and the separate shell, not RLS.**
  The ward-scoped policies from migration 019 admit *any* authenticated ward member to
  `members`, `households`, `sundays`, and `agendas` — a `sacrament_manager` is a ward member, so
  the database hands it those rows. `tests/rls/youth-isolation.test.ts` asserts that explicitly
  rather than leaving it as a comment, so a later change that assumes RLS is doing the work
  fails loudly. This is the strongest argument for the separate shell.
- **`visit_logs` is org-scoped, not ward-scoped**, so a youth account (with `org_id` null) gets
  zero rows from it. The plan listed it among the tables that return rows; it does not. Worth
  checking the actual policy rather than the table's apparent tier.
- **The harness cannot import anything that uses the `@/` path alias.** It runs on Node's
  `--experimental-strip-types`, which resolves neither tsconfig paths nor the modules those
  aliased imports pull in. `syntheticYouthEmail()` therefore lives in its own import-free leaf
  module, re-exported from `lib/auth/youthAccounts.ts` so app code has one obvious place to
  import it from. Any future value the harness and the app must agree on needs the same shape.
- **`/api/admin/users/youth` sits beside `/api/admin/users/[id]`.** Next.js matches the static
  segment first, so "youth" is never read as an account id — but the collision is easy to
  re-introduce with a differently named static child.
- **The Supabase CLI login expires independently of the project link**, exactly as `auth-a`
  recorded. `db push` and `gen types` both fail with a 401 while `supabase/.temp/project-ref` is
  still correct, and the fix is interactive. Worth doing before a session that needs a migration.
- **`db push` warns "failed to cache migrations catalog: failed to run docker".** Harmless and
  expected — there is no local Docker by design (CLAUDE.md §9). The migration still applies.

## Known gaps handed to later phases

- **`/sacrament` now resolves inside the `(youth)` route group.** SPEC.md §Component Structure
  places the bishopric's `/sacrament/admin` page under the authenticated shell, and a URL belongs
  to exactly one route group, so the two cannot coexist. **Phase 10
  ([10-sacrament-admin.md](../10-sacrament-admin.md)) must resolve this** — most likely by
  addressing the bishopric view as `/admin/sacrament`, which is also how every other
  bishopric-only screen in this app is addressed.
- **A youth whose session expires is bounced to `/login`, which they cannot use.** Middleware
  has no cheap way to know the role, so the redirect is role-blind. The "Youth sign-in" link on
  the login form is the way back, but it is a detour rather than a fix.
- **The lockout is per ward and per username, and an unknown username records nothing.** With no
  matching account there is no ward to attribute the attempt to, so the counter is untouched.
  The *response* is identical either way, which is what an attacker can observe, but a
  distributed username-probing attack is not rate limited. A ward-less attempt table or an
  IP-based limit would close it; neither is worth it for a single-ward v1.
- **`users_update_self` still has no column restriction**, so a user can rewrite their own
  `role`. Handed from `auth-a` to `auth-b` to here. This plan opened a migration and still did
  not close it, because the fix is a column-level `GRANT UPDATE (theme_preference, …)` rather
  than a policy change and it touches every role, not just youth. **Whichever phase next opens a
  migration should close it** — it is now three phases old.
- **Phase 1 Definition of Done is met except "JWT carries `ward_id` and `role`"**, deferred
  deliberately in `auth-a` §Decisions. Stating it plainly rather than ticking it: the
  `SECURITY DEFINER` helpers are correct today and a broken `custom_access_token` hook would
  break every sign-in on a project holding real data.
- **Route handlers are still not unit-tested**, for the same reason as `auth-a` and `auth-b`:
  there is no local server. The pin-login route was exercised end to end against the dev server
  by hand, and the two harness scenarios cover it, but nothing catches a regression
  automatically. The library layer beneath it is tested.
- **A ward created outside `supabase/seed/ward.sql` still has no `notification_settings` rows.**
  `youth_account_locked` was added in two places for this reason — migration 021 for existing
  wards, the seed file for future ones — but the underlying gap is unchanged and now costs two
  edits per new trigger key.
