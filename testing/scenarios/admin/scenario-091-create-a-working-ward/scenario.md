---
name: Create a working ward from Stakes & Wards
scope: ITER-041
part: 1
tags: [admin, units, full]
prerequisites: none
---

## Purpose

Adding a ward on Stakes & Wards used to make a `units` row and nothing behind it, so the new ward
could not be held a calling in or switched to. It now provisions the real ward: the `wards` row,
seven organizations and one notification setting per trigger, plus (if ticked) a calling for the
super admin who made it. Only a walk proves you can switch into it and use it.

## Seed Data

| Entity | Detail |
|---|---|
| Wards | 1: "Harness Test Ward", under "Harness Test Stake" |
| Units | "Harness Test Stake" and the harness ward's unit |
| Users | `admin`: counselor in the harness ward **plus** an app-wide `super_admin` unit assignment |

**Sign in as:** `admin@harness.wardleadershiptools.test`

## Steps

1. Sign in as `admin`. Open **Administration → Stakes & wards**.
2. Under **Add a unit**, choose **Ward**, under **Harness Test Stake**, name it "Harness Second
   Ward". Leave **Give me a calling here** ticked with **Bishop**. Press **Add it**.
3. Open the account menu and switch to Harness Second Ward.
4. Open **Sacrament**, then **Roster**.
5. Switch back to Harness Test Ward.
6. On Stakes & wards, edit Harness Second Ward and rename it "Harness Ward Two". Reload.

## Verification checklist (machine-checkable)

- [ ] The new ward appears under Harness Test Stake, and the sentence "Harness Second Ward was
      created. Switch to it from your account menu." shows
- [ ] The new ward's card does **not** say "No ward set up behind this unit."
- [ ] `wards` has a row with the new unit's `unit_id`, `settings.timezone = America/Denver`
- [ ] 7 `organizations` rows for it, Sunday School included
- [ ] One `notification_settings` row per trigger key for it (read back against the seed list)
- [ ] `ward_role_assignments` has an active **bishop** calling for `admin` in it
- [ ] The `unit_created` audit row carries the new `wardId` and `callingCreated: true`
- [ ] The account menu offers the switch; after switching, the chrome bar names the new ward
- [ ] Sacrament generates Sundays in the new ward; Roster is empty and offers the import
- [ ] After the rename and a reload, `wards.name` and the chrome bar read "Harness Ward Two"
- [ ] `npm run seed:clean` removes the walk-created ward, its unit and the calling

## Needs a human eye

- [ ] Does "Give me a calling here" read clearly next to the role choice, at 375px too?
- [ ] Does the "Switch to it from your account menu" sentence point you to the right place?

## Walkthrough record

**Not yet walked.**
