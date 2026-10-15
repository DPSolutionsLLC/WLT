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

### 2026-10-15 — agent-driven (Claude, Playwright), screenshots for human review

**Driven by the agent** as `admin`; every write read back with the service client. Judgement items
are on <https://claude.ai/artifact/KrpQ9RYZmXS5ibgmY4mSNT>. Screenshots in
`testing/walk-screenshots/scenario-091/` (git-excluded).

Observed:
- Add form (Ward): "Give me a calling here" ticked, Bishop selected; 375px scrollWidth 360 = clientWidth 360.
- After Add: stake line "2 wards: Harness Test Ward unit, Harness Second Ward"; the new card has no
  "No ward set up" note; status text "Harness Second Ward was created. Switch to it from your account menu."
- DB: unit under the harness stake; `wards` row with that `unit_id`, settings
  `{ timezone: "America/Denver", cross_org_visibility: false }`; 7 organizations (Bishopric, Elders
  Quorum, Primary, Relief Society, Sunday School, Young Men, Young Women); 36 `notification_settings`
  keys, equal to the seed SQL's 36; one active `bishop` calling for Dana; audit `unit_created` with
  `wardId` and `callingCreated: true`; no `ward_release_settings` row.
- Account menu "Acting in" offered both wards (after a page reload; see below). After switching:
  chrome bar "Harness Second Ward", "You are signed in as Bishop.", 17 tiles, no pill. Sacrament showed
  October with 4 Sundays (52 generated in the DB); Roster "No members yet" with "Import from LCR".
- Rename to "Harness Ward Two": `units.name` and `wards.name` both changed; chrome bar after reload and
  a switch read "Harness Ward Two".
- `npm run seed:clean` removed the walk-created unit, ward, Sundays and calling (all read back as gone).

**Defect found:** the success sentence renders at the top of the page, 6,564px above the Add form
at 375px (the leftover test data makes the page long, but it is above the whole list regardless).
The form simply resets, so nothing visible says it worked.

**Left unsettled:** the first time I opened the account menu (before any reload, waiting 3 s) the
switcher did not show; after a reload it showed after a few seconds. The dev server was slow to
compile the route, so I could not tell whether a reload is actually needed. Worth a quick look on the
deployed build.

No checklist corrections were needed.

### 2026-10-15 (later) — fix re-checked, agent-driven

Re-walked from scenario 090's seed as `admin` at 375px: adding "Harness Fix Check Ward" put
"Harness Fix Check Ward was created. Switch to it from your account menu." inside the Add form,
directly under "Add it" and on screen (top 707px in an 812px viewport). Errors from the Add form now
appear there too. `npm run seed:clean` removed the ward afterwards (0 rows). Screenshot
`03-fix-created-message-375-dark.png`. The user answered question 5 **yes**.
