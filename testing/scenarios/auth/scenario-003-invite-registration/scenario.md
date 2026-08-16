---
name: Invite to registration, end to end
scope: auth-b-invites-admin
part: 1
tags: [auth, smoke, admin]
prerequisites: none
---

## Purpose

The invite link crosses three contexts — an authenticated admin page, a URL copied out of the
browser, and a second browser with no session at all. That handoff is what breaks, and no unit
test spans it: the library tests prove the invite cannot be escalated or replayed, but they
never touch a clipboard or a fresh browser profile. Seeding gives a bishopric account to
generate from, and the notification triggers that make the "admin setting changed" half of the
journey observable.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Sarah Brooks) |
| Organizations | the standard harness set |
| Notifications | all 22 triggers, including `admin_setting_changed` |

**Sign in with:** `bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- auth/scenario-003-invite-registration`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop` and go to Admin → Users.
4. In "Invite someone", enter a fresh email you control the spelling of — use
   `newmusic@harness.wardleadershiptools.test` — choose **Music Coordinator**, and submit.
5. Copy the generated link. Read what the page says about it before you navigate away.
6. Open a private/incognito window and paste the link.
7. Try submitting with a 6-character password, then register properly with a password of at
   least 12 characters. Note where you land.
8. Sign in as the new account in that private window.
9. Back in the private window, paste the same invite link a second time.
10. Change one character in the middle of the token and open that URL.
11. In the Supabase dashboard, read `audit_log` filtered to the Harness Test Ward.
12. In the same dashboard, read `notifications` filtered to that ward. The notification bell in
    the app is a placeholder until Phase 11, so the table is the only place to see this.

## Verification Checklist

- [ ] The generated link is shown once with a copy button and a stated 7-day, single-use expiry
- [ ] The registration page names the invited role ("Music Coordinator") and offers no way to change it
- [ ] Registration succeeds and lands on `/login` with a confirmation message, not straight into the app
- [ ] The new account signs in and sees the music coordinator sidebar — Calendar, Talks, Music
- [ ] The new account's sidebar has no Admin, Visits, or Tithing entry
- [ ] Opening the same invite URL a second time is refused
- [ ] `notifications` has an `admin_setting_changed` row addressed to `counselor1`, whose body names the bishop and the invited role
- [ ] `audit_log` has an `invite_created` row with `module = 'admin'`
- [ ] `audit_log` has a `user_registered` row with `module = 'auth'`, whose `user_id` is the new account
- [ ] Neither audit row's `detail` contains the token

## Failure Behavior

- [ ] A tampered token gives exactly the same refusal wording as an already-used one — no hint that one is merely unknown
- [ ] Registering with a 6-character password shows "Use at least 12 characters." before the form submits
- [ ] Mismatched password and confirmation are refused before the form submits
- [ ] No invite token appears in any log line the app itself writes

## Notes

The notification is checked in the database rather than on screen because `NotificationBell` is
a deliberate placeholder until Phase 11 ([11-notifications-admin.md](../../../../plans/11-notifications-admin.md))
— it renders a static bell with no query behind it. The row is written; there is simply no UI
that reads it yet.

The dev server's own request log necessarily contains the invite URL, because the token is in
the path — that is inherent to link-based invites and is not what the last failure check is
about. What that check means is that no `console.log` or `console.error` line the app writes
ever contains the token, and that no `audit_log.detail` carries it.

Step 4 asks for a fresh email because an email that already has an account is refused by design
— that path is covered by `tests/lib/inviteLifecycle.test.ts`, not here. If you re-run this
scenario, either use a different address or delete the previous auth user first;
`npm run seed:clean` removes the ward and its `users` rows but not the auth user behind them.
