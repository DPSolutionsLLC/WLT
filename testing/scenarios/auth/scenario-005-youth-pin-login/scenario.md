---
name: Youth PIN sign-in and shell isolation
scope: auth-c-youth-pin
part: 1
tags: [auth, smoke, sacrament]
prerequisites: none
---

## Purpose

PIN entry is a physical-device question — which keyboard the phone raises, whether iOS
capitalises the first letter of the username — and none of that can be answered by a test
runner. This scenario also proves the shell isolation in both directions, which is the part
most likely to be got wrong: a youth account must not reach the app shell, and a bishop must
not be trapped in the youth one. Seeding gives a youth account with a known PIN, which is
otherwise a multi-step admin flow before the interesting part can begin.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward |
| Users | `bishop` (bishop, Mark Andersen) |
| | `jsmith` — youth account, Jared Smith, **PIN `572913`**, no email |
| Members | 3 youth (Ethan Park, Noah Reyes, Liam Turner) |
| Sacrament | one bread-blessing rotation pool, 5 August Sundays with assignments |
| | `jsmith` set as the active sacrament assignment manager |
| Notifications | all 23 triggers |

**Sign in with:** `jsmith` / `572913` at `/pin`, then `bishop@harness.wardleadershiptools.test`
at `/login`
**Password:** the bishop's password is the value of `HARNESS_TEST_PASSWORD` in your env file.
The youth account has no password and no email — only the username and PIN above.

## Steps

1. `npm run seed -- auth/scenario-005-youth-pin-login`
2. `npm run dev`, then open http://localhost:3000 **on a real phone on the same network, or in
   a browser narrowed to 375px**. This scenario is about the phone; a desktop-width run tells
   you very little.
3. Open `/login` first and find the way through to the youth sign-in.
4. On `/pin`, tap into the username field and type `jsmith`. Watch what the keyboard does to
   the first letter before you correct it.
5. Tap into the PIN field. Note which keyboard the phone raises before you type anything.
6. Enter `572913` and submit. Watch the field as you type.
7. Look at the page you land on: what is in the header, and what is not.
8. Type `/dashboard` into the address bar. Then `/admin/users`. Then `/visits`.
9. Sign out.
10. Sign in again at `/pin` as `jsmith` with the PIN `111111`, then with the username `nobody`
    and any PIN. Read both messages carefully and compare them.
11. Sign in at `/login` as `bishop`, then type `/sacrament` into the address bar.
12. In the Supabase dashboard, read `audit_log` filtered to the Harness Test Ward.

## Verification Checklist

- [ ] `/login` has a "Youth sign-in" link that reaches `/pin`
- [ ] `/pin` shows a username field and a PIN field, and **no email field anywhere**
- [ ] `/pin` has a "Ward leader sign-in" link back to `/login`
- [ ] Tapping the PIN field raises the phone's **numeric** keyboard, not the full alphabetic one
- [ ] There is no second, app-drawn keypad competing with the phone's own
- [ ] Nothing is clipped or scrolls sideways at 375px
- [ ] Entered PIN digits appear as dots, never as numbers
- [ ] The PIN field will not accept a letter, and stops at 6 digits
- [ ] Correct username and PIN lands on the sacrament page
- [ ] The youth shell has **no** sidebar, **no** notification bell, **no** theme toggle, and a
      visible Sign out button
- [ ] Typing `/dashboard` redirects back to `/sacrament`
- [ ] Typing `/admin/users` does not show the admin page
- [ ] Typing `/visits` does not show the visits page
- [ ] Signing out from the youth shell returns to `/pin`, not `/login`
- [ ] Signing in as `bishop` and typing `/sacrament` does **not** trap the bishop in the youth
      shell — they land back on the app shell
- [ ] `audit_log` has a `login` row with `module = 'auth'` for the youth account

## Failure Behavior

- [ ] A wrong PIN says "That username or PIN is not correct."
- [ ] An unknown username gives the **identical** message, with no hint that the username does
      not exist
- [ ] After a failed attempt the PIN field is cleared, so the next try starts from empty
- [ ] The PIN appears nowhere in the terminal running `npm run dev`, on the success path or the
      failure path — search the output for `572913` and `111111`
- [ ] The PIN appears nowhere in the browser's network tab response bodies
- [ ] The username field does not auto-capitalise on iOS

## Notes

**There is deliberately no on-screen keypad.** The plan specified one; a real-device run showed
the phone already raises its own numeric keypad from `inputMode="numeric"`, so an app-drawn one
was a second keypad fighting the first for screen space, and on a desktop it was slower than
typing. If you see one, you are running stale code — restart `npm run dev`.

The sacrament page is a placeholder until Phase 10
([10-sacrament-admin.md](../../../../plans/10-sacrament-admin.md)). What is being checked here
is the shell around it and the route boundary, not the module's contents.

Step 8 is the whole point of the separate layout. A youth account is a member of the ward as
far as the database is concerned, so several ward-scoped policies would hand it roster and
calendar rows — `tests/rls/youth-isolation.test.ts` asserts exactly that. The permission matrix
and this shell are what actually close those pages, which is why typing the URLs by hand is a
required step rather than a paranoid one.

Only one sacrament assignment manager can be active per ward (partial unique index, migration
018). `setSacramentManager()` stands down any existing active row before inserting.
