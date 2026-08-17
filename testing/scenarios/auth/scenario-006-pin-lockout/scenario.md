---
name: PIN lockout and the bishopric notification
scope: auth-c-youth-pin
part: 1
tags: [auth, full, sacrament]
prerequisites: none
---

## Purpose

A PIN is short enough to guess, so the lockout is part of the feature rather than a
hardening pass. It is also a timed state, which makes the interesting moments awkward to reach
by hand: the fifth failure, the sixth attempt with the **correct** PIN, and the notification
that has to reach both bishopric members. The seed puts the account one failure short of the
threshold, which is the only sane way to reach that boundary more than once. What a unit test
cannot check is whether the refusal reaches the screen as a sentence a teenager can act on.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Sarah Brooks) |
| | `jsmith` — youth account, Jared Smith, **PIN `572913`** |
| Lockout | `youth_login_attempts` row for `jsmith`: `failed_count` 4, `locked_until` null |
| Notifications | all 23 triggers, including `youth_account_locked` |

**Sign in with:** `jsmith` / `572913` at `/pin`, then
`bishop@harness.wardleadershiptools.test` and `counselor1@harness.wardleadershiptools.test`
at `/login`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file (adults only — the youth
account has no password).

## Steps

1. `npm run seed -- auth/scenario-006-pin-lockout`
2. `npm run dev`, then open http://localhost:3000/pin
3. Sign in as `jsmith` with the **wrong** PIN `111111`. This is the fifth failure. Read the
   message.
4. Now sign in as `jsmith` with the **correct** PIN `572913`. Read the message.
5. Sign in at `/login` as `bishop` and open Admin → Users. Scroll to the Youth accounts
   section.
6. In the Supabase dashboard, read `notifications` filtered to the Harness Test Ward.
7. Back in the app, use Reset PIN on `jsmith` and set it to `481625`. Read what appears after it
   succeeds.
8. Sign out, go to `/pin`, and sign in as `jsmith` with `481625`.
9. Sign out. Now fail four times with `111111`, then sign in with `481625` on the fifth attempt.
10. Fail once more with `111111`, then check whether the account is locked.

## Verification Checklist

- [ ] The fifth failure is refused with a message that says how many **minutes** remain
- [ ] The **correct** PIN is refused while locked, with the same lockout message
- [ ] The lockout message is legible at 375px without zooming
- [ ] Admin → Users has a Youth accounts section listing `jsmith` with the username, separate
      from the adult account list
- [ ] `notifications` has a `youth_account_locked` row for **both** `bishop` and `counselor1`
      naming the account
- [ ] Resetting the PIN shows the new PIN **once**, with "Write this down — it cannot be
      retrieved"
- [ ] The new PIN signs in on the first try, with no waiting — the reset cleared the lock
- [ ] Four failures followed by a success leaves no lock, and the failure after that does not
      lock the account either — the counter reset on the success
- [ ] Reloading Admin → Users after the reset does **not** show the PIN again

## Failure Behavior

- [ ] The lockout message gives minutes remaining, not a raw timestamp, not a status code, and
      not "429"
- [ ] The notification names the account and contains **no PIN**
- [ ] Neither `572913`, `111111`, nor `481625` appears anywhere in the terminal running `npm run dev`
- [ ] `audit_log` has a `youth_pin_reset` row whose `detail` contains no PIN
- [ ] The lockout message is the **only** place the app distinguishes one failure from another
      — a wrong PIN and an unknown username still read identically

## Notes

The account is seeded at four failures, so **step 3 is the fifth**. If you re-run steps without
re-seeding, the counter is wherever your last attempt left it — re-run `npm run seed` to get
back to the boundary.

The lock is 15 minutes. Step 7's reset is the intended way out, and is also the answer to give
a real youth who is locked out; there is no self-service path and there is not meant to be.

Notification checks read the `notifications` table directly because `NotificationBell` is a
Phase 11 placeholder ([11-notifications-admin.md](../../../../plans/11-notifications-admin.md))
with no query behind it yet.

`youth_login_attempts` has RLS enabled and no policies at all, so it is invisible in the
Supabase dashboard's table editor unless you are viewing it as the service role. Use the SQL
editor if you want to look at the counter directly.
