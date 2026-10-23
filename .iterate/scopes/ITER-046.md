# ITER-046: Module access by title, set by the super admin

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-10-23

## Summary
The super admin decides, for every title (calling) and every module, whether that title has **no
access, view-only, or full access**. An app-wide baseline seeds each new ward, and the super admin
can customize any ward afterwards. A module a title cannot reach does not appear at all.

## Context
Raised by the user 2026-10-23 while scoping ITER-045 (the Sacrament Planner). The user wants to
open modules to people title by title, both while the app is being built (one module at a time)
and as the permanent way access is managed. Same distinctions in every ward, according to members'
callings, with the freedom to tailor a ward when needed.

## Current Behavior
Access today is three layers that must all agree:
1. **A built-in matrix per role, in code** (`lib/auth/permissions.ts`), partly organization-aware
   (only Young Women manage youth activities). No screen can change it.
2. **Per-ward add/remove changes** (`wards.settings.role_access`), made by a ward admin with
   `admin.manage_roles`, plus the **access request** flow where a ward asks the super admin for a
   module at a level (ITER-era migrations 073/075). `admin.*` and `sacrament.*` cannot be changed
   this way.
3. **Per-ward released modules** (ITER-041, migration 091): the super admin ticks which modules a
   whole ward can reach, for every title alike, enforced in `can()`, page layouts and RLS.

Nothing lets the super admin say "this title gets these modules" once for every ward, and access
is expressed as raw permissions rather than module + level.

## Desired Outcome
- **Levels:** for each title × module the access is **none / view only / full**. None means the
  tile and pages are absent, not dimmed.
- **Titles are individual callings** (assumed; see Open Questions): Elders Quorum president,
  Relief Society president, Primary president, etc. each get their own row, not one shared
  "organization president" row.
- **Baseline:** one app-wide default (title × module → level), edited by the super admin.
- **New wards** start from the baseline automatically when created on Stakes & Wards.
- **Per-ward customizing:** the super admin can change any title's level for any module in a
  given ward, at any time.
- **Changing the baseline:** every time, the super admin is offered the choice of which wards
  follow the change (none, all, or chosen wards).
- **Super admin only, for now.** The ward-level self-service controls and the access-request flow
  are switched off. Opening this to ward-level admins may come later.
- **Replaces ITER-041's per-ward release checkboxes** — "hidden from this ward" becomes every
  title at none for that module.
- **Day one moves nobody:** every existing ward keeps exactly the effective access it has today.
- **First use:** the bishop and both counselors in the real ward get full access to Sacrament
  (ITER-045) and Tithing.

## Scope Notes
- Bishop and counselors must keep identical access (CLAUDE.md §7, rule 10) unless the user
  deliberately decides otherwise; the screen should make that clear rather than silently allow it.
- Enforcement must stay at the database (RLS) as well as in `can()` and the page layouts, as
  ITER-041 does — view-only must actually refuse writes server-side, not just hide buttons.
- Module granularity matters: ITER-044 splits the "Sacrament meeting" module so its tiles can be
  set separately. Plan ITER-044 with this item in mind.
- Super admin, `sacrament_manager` (youth PIN account), stake officers and the always-on
  essentials (notifications, To Do / personal tools, account) need explicit decisions on whether
  they appear in the matrix at all.
- Existing pieces to retire or fold in: `role_access` deltas, `access_requests`, the app-wide
  grant flow (`lib/access/appWideGrant.ts`), `ward_release_settings`, the access-modules catalog
  (`lib/access/accessModules.ts`) and the released-modules catalog (`lib/access/releasedModules.ts`).
  Retire without losing history.

## Open Questions
- Confirm titles are individual callings (EQ president ≠ RS president) rather than the broader
  role values — assumed in the summary; the user did not answer explicitly.
- How a ward customized away from the baseline is shown when the baseline later changes (is the
  override kept, overwritten, or asked about per ward).
- Whether a person with two callings in one ward can happen (today: one active calling per ward),
  and what a person holding callings in two wards sees in each.
