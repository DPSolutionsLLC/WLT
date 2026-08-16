---
name: Admin user management and the lockout guard
scope: auth-b-invites-admin
part: 1
tags: [auth, full, admin]
prerequisites: none
---

## Purpose

The last-bishop guard is a refusal, and refusals are where this app's rules live. A unit test
proves the guard returns the right answer; only a walkthrough proves the answer reaches the
screen as a readable sentence on the row the admin was touching, instead of a 500 page or a raw
Postgres error. The same walkthrough is the only place the stacked-card layout at 375px gets
looked at. Setting up a ward with exactly one bishop plus a spare account to promote is fiddly
by hand and exact when seeded.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `counselor1` (counselor, position 1, Sarah Brooks) |
| | `secretary` (ward_secretary, David Nguyen) |
| | `eqpres` (org_president, elders quorum, Tomas Ruiz) |
| | `spare` (ward_council_member, Miguel Cortez, no organization) |
| Notifications | all 22 triggers, including `admin_setting_changed` |

**Sign in with:** `bishop@`, then `counselor1@`, then `eqpres@` —
all `@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- auth/scenario-004-admin-user-management`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop` and open Admin → Users.
4. Look at your own row before changing anything. Note which controls are available on it.
5. Change `spare` (Miguel Cortez) to **Bishop**.
6. Deactivate `spare`. The ward is now down to one active bishop — you.
7. Sign out and sign in as `counselor1`, who shares your admin authority. Open Admin → Users.
8. Try to deactivate `bishop` (Mark Andersen). Read the message, and watch what the button does
   after it appears.
9. Try to change that same bishop's role to Counselor.
10. Deactivate `secretary` (David Nguyen).
11. Narrow the browser to 375px wide and look at the list.
12. Sign out, sign in as `secretary`, and try to get in.
13. Sign out, sign in as `eqpres`, and navigate directly to `/admin/users`.
14. In the Supabase dashboard, read `audit_log` and `notifications` filtered to the Harness Test
    Ward. The notification bell in the app is a placeholder until Phase 11, so the table is the
    only place to see the notifications.

## Verification Checklist

- [ ] The list shows all five accounts with name, role, organization, and an active/inactive control
- [ ] The signed-in user's own row is marked "(you)" and its role select and active button are both disabled
- [ ] Promoting `spare` to Bishop succeeds and the row shows the new role after the page refreshes
- [ ] With two bishops, deactivating `spare` succeeds
- [ ] As `counselor1`, deactivating the last active bishop is refused with "This is the only active bishop. Assign another bishop before changing this account."
- [ ] Changing that same bishop's role is refused with the same message
- [ ] Deactivating `secretary` succeeds, and that account can no longer sign in
- [ ] `notifications` has `admin_setting_changed` rows naming the acting person and describing each change by name — e.g. "Mark Andersen updated Miguel Cortez: role changed from Ward Council Member to Bishop."
- [ ] `audit_log` has a `user_updated` row with `module = 'admin'` for every successful change, with the acting user as `user_id`
- [ ] `audit_log` has no `user_updated` row for the refused changes
- [ ] At 375px the list is stacked cards with full-width controls, not a sideways-scrolling table

## Failure Behavior

- [ ] The last-bishop refusal appears as a readable message on the row itself, not as a 500 page, an alert box, or a Postgres error string
- [ ] After a refused change, the control snaps back to the value it had before — the screen never shows a change that did not happen
- [ ] Signing in as `eqpres` and opening `/admin/users` shows "Not permitted" with a way back to the dashboard, not a blank page and not a 500
- [ ] The organization dropdown offers only this ward's organizations

## Notes

Steps 5 and 8 leave accounts deactivated. Re-run the seed before using this ward for another
scenario — `createTestUser` upserts, so re-seeding restores `is_active` and the original roles.

Deactivation takes effect on the account's *next request*, by design (auth-a). If `secretary`
still has a page open, it keeps showing what it already rendered until they navigate.

**Why the guard is tested from `counselor1`'s session, not the bishop's.** Nobody can change
their own role or active status here — the controls are disabled on your own row. That is
deliberate: the last-bishop guard does not fire while a second bishop still exists, so a
self-demotion would be a silent one-way trip out of the admin surface that no server-side check
would catch. It also means the bishop cannot reach the last-bishop refusal by acting on
themselves; another bishopric member has to be the one to try. Bishop and counselors share
identical admin authority (CLAUDE.md §7), so `counselor1` is the right seat for steps 8 and 9.

The notification checks read the database because `NotificationBell` is a placeholder until
Phase 11 ([11-notifications-admin.md](../../../../plans/11-notifications-admin.md)) — the rows
are written, but no UI reads them yet.
