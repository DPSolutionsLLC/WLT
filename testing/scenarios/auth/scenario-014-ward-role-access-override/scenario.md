---
name: A ward role-access override changes what a role may do
scope: ITER-005
part: 1
tags: [auth, permissions, full]
prerequisites: none
---

## Purpose

Nothing in the app writes `wards.settings.role_access` — the Phase 11 screen that will own the
matrix does not exist yet. So this state is unreachable by hand without editing `jsonb` in the
Supabase dashboard, which is exactly the kind of setup seeding is for.

Walking it once proves the add/remove delta shape is writable and readable end to end **before**
a screen depends on it, and proves the page guards and the route guards now agree. Today they can
disagree: 25 of the app's 62 permission checks read the hardcoded defaults, so a page could hide
a button while the route behind it happily allowed the write. That is the bug ITER-005 closes.

Every 403 this scenario could assert is already covered by
`tests/routes/role-access-overrides.test.ts`. This walkthrough is kept to what needs eyes — that
the page and the route agree, and that controls are **absent** rather than present-and-broken.

## Seed Data

| Entity | Detail |
|---|---|
| Ward | Harness Test Ward, with a `role_access` override |
| Override | `ward_secretary: { add: ["roster.manage"] }`, `bishop: { remove: ["calendar.manage"] }` |
| Users | bishop (Mark Andersen), counselor 1 (Paul Whitfield), ward secretary (Ruth Nguyen) |
| Households | 2 — Andersen, Nguyen |
| Members | 4 — 3 adults, 1 youth. Only Mark Andersen starts in an organization |
| Organizations | The standard harness set; Elders Quorum is the one used here |
| Sundays | 4 — June 2027, so the calendar has something to refuse an edit on |

Note what the override does **not** say. It never names the counselor, and it never names an
`admin.*` permission. Both omissions are load-bearing and both are on the checklist.

**Sign in with:** `bishop@harness.wardleadershiptools.test`,
`counselor1@harness.wardleadershiptools.test`, `secretary@harness.wardleadershiptools.test`
**Password:** the value of `HARNESS_TEST_PASSWORD` in your env file.

## Steps

1. `npm run seed -- auth/scenario-014-ward-role-access-override`
2. `npm run dev`, then open http://localhost:3000
3. Sign in as **Ruth Nguyen (ward secretary)**. Open the roster, open **David Nguyen**.
   The organization controls are visible — by default a ward secretary has `roster.view` and
   **not** `roster.manage`, so without the override these would be absent.
4. Add David to the **Elders Quorum** and save.
5. Sign out. Sign in as **Mark Andersen (bishop)**. Open the calendar, open a Sunday in
   June 2027. The edit controls are gone.
6. In the same session, open `/admin/users`. It still loads.
7. Sign out. Sign in as **Paul Whitfield (counselor 1)**. Open the same Sunday. The edit
   controls are gone here too — even though the override never named this role.

## Verification Checklist

- [ ] The ward secretary sees organization controls on David Nguyen's member page
- [ ] Saving the organization change succeeds and the page shows him in the Elders Quorum
- [ ] `member_organizations` holds the new row (check in Supabase; there is no audit viewer yet)
- [ ] An `audit_log` row was written for the change, with action `member_organizations_updated`
- [ ] The bishop cannot edit a Sunday — the controls are **absent**, not disabled
- [ ] The counselor cannot edit a Sunday either, though the override never named that role
- [ ] The bishop can still reach `/admin/users` — `admin.*` is locked and the override did not
      touch it
- [ ] No console errors on any of the five page loads

## Failure Behavior

- [ ] If the ward secretary's save returns **403**, the route is still reading the hardcoded
      defaults — the page and the route disagree, which is the exact bug this closes
- [ ] If the bishop still sees Sunday edit controls, `resolveRoleAccess` is not reaching the
      calendar page guard
- [ ] If the counselor **can** edit a Sunday while the bishop cannot, bishopric equivalence has
      broken (CLAUDE.md §7) — `mergeRoleAccess` should apply either role's delta to both
- [ ] If `/admin/users` returns 403 for the bishop, the `NON_OVERRIDABLE_PERMISSIONS` deny-list
      is not restoring the default — a ward could lock its own bishopric out of the admin screen
- [ ] A 500 on any page means `resolveRoleAccess` threw on the `wards` read. That is deliberate —
      it never falls back to the defaults, because falling back can be wrong in either direction

## Notes

- The override is a **delta**, not a replacement list. `ward_secretary` keeps every default it
  already had and gains `roster.manage`; it does not end up holding only that one permission.
- A ward secretary may already edit an individual Sunday by default (`calendar.manage`). The
  bishop losing `calendar.manage` therefore does **not** mean nobody can edit a Sunday — sign in
  as Ruth if you want to see the controls still present for someone.
- Role access is resolved per request from the `wards` row, not from the JWT, so a change takes
  effect without signing out. The re-login warning Phase 11 owes its users is about the session's
  *role*, which is a different thing.
