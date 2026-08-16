---
name: Deactivated account
scope: auth-a-session-shell
part: 1
tags: [auth, full, rbac]
prerequisites: none
---

## Purpose

Deactivation is enforced on every request rather than by revoking the token, because the
server never holds the user's JWT. That makes the interesting case a user who is *already
signed in* when they are deactivated — their cookie is still perfectly valid, and the app has
to refuse them anyway. That state is tedious to reach by hand and is exactly what seeding is
for. The second half, a deactivated user getting past the password prompt and then being
turned away with a message they can act on, is the part a unit test cannot show.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, active) |
| | `formerclerk` (ward_secretary, `is_active = false`) |

**Sign in with:** `formerclerk@harness.wardleadershiptools.test`, then
`bishop@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- auth/scenario-002-deactivated-account`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `formerclerk` with the correct password. Note what happens after the password
   is accepted.
4. Reload `/dashboard` and note where you land.
5. Sign in as `bishop`. Confirm the shell loads.
6. Leaving that session open, use the Supabase dashboard to set `users.is_active = false` on
   the bishop's row.
7. Back in the app, navigate to any page.
8. In the Supabase dashboard, read the `audit_log` table for this ward.

## Verification Checklist

- [ ] `formerclerk` gets past the password prompt, then sees "This account has been deactivated. Contact a member of the bishopric."
- [ ] `formerclerk` is left signed out — reloading `/dashboard` lands on `/login`, not the shell
- [ ] The bishop's session loads the shell normally before step 6
- [ ] After step 6, the bishop's next navigation redirects to `/login` without needing a reload of the whole browser
- [ ] `audit_log` has a `login` row with `module = 'auth'` for the bishop's successful sign-in
- [ ] `audit_log` has NO `login` row for `formerclerk`
- [ ] Signing out normally writes a `logout` row with `module = 'auth'`

## Failure Behavior

- [ ] The deactivated message names no other reason — not a wrong password, not a missing account
- [ ] No stack trace, Supabase error string, or user id reaches the screen
- [ ] Re-submitting the sign-in form as `formerclerk` gives the same message every time, never a different one

## Notes

Step 6 needs the Supabase dashboard because admin user management does not exist yet — it is
`auth-b`. Set `is_active` to false on the row in the `users` table of the linked project,
filtered to the Harness Test Ward.

Deactivation takes effect on the user's *next request*, by design. An open page that makes no
further requests will keep showing what it already rendered; that is expected, not a failure.

Remember to set the bishop's `is_active` back to true, or re-run the seed, before using this
ward for another scenario.
