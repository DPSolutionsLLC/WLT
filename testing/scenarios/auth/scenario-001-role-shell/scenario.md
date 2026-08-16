---
name: Role-appropriate shell
scope: auth-a-session-shell
part: 1
tags: [auth, smoke, rbac]
prerequisites: none
---

## Purpose

The sidebar is the most visible expression of the role matrix, and it is the one thing a unit
test cannot confirm — that the right words appear on a real screen, at phone width, in the
right theme. `tests/lib/navigation.test.ts` proves the filtering function is correct; this
proves the shell actually renders what that function returned. Seeding matters because
comparing roles means five accounts that differ only by role, which is tedious and
error-prone to build by hand.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop) |
| | `counselor1` (counselor, position 1) |
| | `secretary` (ward_secretary) |
| | `music` (music_coordinator) |
| | `eqpres` (org_president, Elders Quorum) |

**Sign in with:** `bishop@harness.wardleadershiptools.test` (then each of the others in turn)
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- auth/scenario-001-role-shell`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as `bishop@harness.wardleadershiptools.test`. Note every item in the sidebar.
4. Sign out, then repeat for `counselor1`, `secretary`, `music`, and `eqpres`.
5. Check one account at 375px width (device toolbar) and one in dark mode.

## Verification Checklist

- [ ] Bishop's sidebar lists every module, including Admin and Audit Log
- [ ] Counselor's sidebar is identical to the bishop's, item for item and in the same order
- [ ] Ward secretary sees Calendar, Talks, Program, Music, Agendas — and no Visits, Tithing, or Admin
- [ ] Music coordinator sees Calendar, Talks, Music — and nothing else
- [ ] EQ president sees Visits, Goals, Youth Activities — and no Talks, Program, or Admin
- [ ] Every role also sees Dashboard, which is not permission-filtered
- [ ] Every sidebar link opens or 404s; none returns a "not permitted" error
- [ ] The top bar shows "Harness Test Ward", the signed-in name, and the role in plain words
- [ ] At 375px the sidebar is an off-canvas drawer, not a squeezed column, and the ☰ toggle is thumb-reachable at the bottom left
- [ ] Tapping a link in the drawer navigates and closes the drawer
- [ ] The theme button cycles Light → Dark → System, and the change is instant
- [ ] Dark mode survives a reload with no white flash, and every panel has a visible border
- [ ] Signing out returns to `/login`, and pressing Back does not restore the shell

## Failure Behavior

- [ ] Typing `/admin` directly as the music coordinator gives a "not permitted" page, not a blank one
- [ ] Signing in with a wrong password says "Email or password is incorrect" — never that the account does not exist
- [ ] Signing in with a malformed email is refused by the form before any request is sent
- [ ] Visiting `/dashboard` while signed out redirects to `/login?redirectTo=/dashboard`

## Notes

Most module routes have no page yet — they arrive with their phase. A 404 from `/visits` is
the expected result in this phase and is not a failure. What matters is that the link is
present for the roles that should have it and absent for the rest.

`/admin` has no page yet either, so the "not permitted" check under Failure Behavior cannot
pass until auth-b builds it. Until then, expect a 404 and record it as such.
