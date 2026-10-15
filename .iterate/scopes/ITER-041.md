# ITER-041: Released modules per ward, and the real ward

**Type:** Modification
**Status:** Backlogged
**Created:** 2026-10-14

## Summary
Give each ward a list of **released modules** that narrows what anyone in that ward can reach, so
the new **real ward** shows the bishopric only the Speaker Tracker and the tithing calculator while
the **test ward** keeps everything. Only the super admin flips the switches. Also covers creating
the real ward and onboarding the bishopric into it.

## Context
Second of three items in GROUP-03 (after ITER-040's paste import, before ITER-042's Speaker
Tracker). The user wants the bishopric on real data now, without them seeing — or being confused
by — the modules still under construction.

The user's original plan asked for a **per-user** module allow-list. Discovery replaced it with a
**per-ward** list, because real and test data now live in separate wards (decided in ITER-040):
"the real ward shows only what's released, and you test everything in the test ward" is enough.
That keeps CLAUDE.md §7's rule that bishop and counselors always resolve to identical access, and
avoids a second permission system layered over the role one.

## Current Behavior
- Access follows a person's **calling** (role in a ward), not the person. Each role carries a
  permission list; a ward can add or remove individual permissions per role
  (`wards.settings.role_access`); bishop and both counselors always resolve identically, and
  `admin.*` / `sacrament.*` are not overridable.
- There is **no per-ward notion of a module being released**; nothing narrows a ward's whole
  surface.
- Navigation and dashboard tiles show what the reader's permissions allow; unbuilt modules are
  hidden by a `built` flag that applies to every ward alike.
- Everyone lands on `/dashboard` (the tile grid) after signing in.
- The "Calculator" in the user's plan is the **tithing calculator**, already bishopric-only.
- A super admin is a structural role (`unit_assignments`), already the gate for Stakes & Wards.
- Ward switching, multiple callings per person (one per ward) and the invite flow all exist (P2).

## Desired Outcome
- **Each ward has a released-modules list.** The real ward starts with **Speaker Tracker** and the
  **tithing calculator**; the test ward has everything.
- An unreleased module is **hidden** from the dashboard and navigation, a typed URL to it
  **bounces to the dashboard**, and **the database refuses its data** — hiding a link is not
  security (CLAUDE.md rule 2).
- **Roles are unchanged.** The ward's list only narrows what a role would otherwise grant; bishop
  and counselors stay identical.
- **Only the super admin** (the user) can change a ward's released modules. Releasing a feature is
  a tick box, not a deploy.
- **The super admin sees everything in every ward, released or not** — that is how the user does
  roster imports and administration in the real ward. Everyone else sees only what is released.
- **After sign-in, the normal dashboard**, showing only the tiles that person can reach.
- **Real ward setup:** created through the existing Stakes & Wards screen; the user holds a
  bishopric calling there alongside the test-ward one and switches between them; the bishop and
  first counselor are invited into the real ward only, through the normal invite flow.
- **Done when:** the bishop and first counselor sign in to the real ward and see only Speaker
  Tracker and Calculator; a typed URL to anything else bounces them; the user sees everything in
  both wards.

## Scope Notes
- **Accidental testing in the real ward** is the main risk of the super-admin bypass. The ward
  switcher already names the ward; planning should check the real/test difference is obvious at a
  glance (e.g. a clearly different label).
- **Future, not now:** at launch the bishop and/or counselors take over roster imports in the real
  ward. Record it; do not build it.
- The Speaker Tracker does not exist yet (ITER-042), so its module key must exist for the list to
  name it — sequencing between this item and ITER-042 is a planning question.
- Released-modules must be **uniformly evaluable** at the database (CLAUDE.md's 056c rule): the same
  data must read the same way for everyone it applies to.
- The existing access-request flow (a ward asks the super admin for a module) is permission-level;
  decide in planning how — or whether — it relates to released modules.
- Admin screens, personal tools (To Do, My Appointments) and the account/settings pages: decide
  whether they count as "modules" on the list or are always present.
- New accounts land in their home ward; the bishop and first counselor's home ward should be the
  real ward.

## Open Questions
- Which existing modules map to list entries one-for-one, and which are "always on"
  (account, notifications, personal tools)?
- What does the bishopric see for To Do / My Appointments in the real ward if those aren't released
  — and does the Speaker Tracker need them?
- Should the dashboard say anything about modules "coming soon", or simply show nothing?
