---
id: released-modules-per-ward
type: feature
iter: ITER-041
commits: []
date: 2026-10-15
files:
  - supabase/migrations/091_released_modules.sql
  - lib/access/releasedModules.ts
  - lib/access/requireReleasedRoute.ts
  - lib/access/writeReleasedModules.ts
  - lib/auth/permissions.ts
  - lib/auth/session.ts
  - types/domain.ts
  - middleware.ts
  - app/(app)/layout.tsx
  - app/(tithing)/layout.tsx
  - app/api/wards/[id]/released-modules/route.ts
  - app/(app)/admin/stakes/StakesAndWards.tsx
  - app/(app)/admin/stakes/page.tsx
  - app/(app)/dashboard/page.tsx
  - components/layout/ChromeBar.tsx
  - components/layout/AccountMenu.tsx
  - components/ui/Tile.tsx
  - lib/units/provisionWard.ts
  - lib/notifications/triggerDefaults.ts
  - app/api/units/route.ts
  - lib/units/writeUnit.ts
related: [role-access-overrides, p2-admin-and-access, notification-trigger-drift, p3-shell-and-tile-dashboard, sacrament-music-people, roster-paste-import]
---

## What was done
Two slices. **Slice a (`a234706`)** made "Add a unit → Ward" on Stakes & Wards set up a real ward:
the `wards` row, seven organizations, notification settings from a new TypeScript copy of the
trigger list, and optionally a calling for the super admin. Renaming a ward unit now renames the
ward too. **Slice b** gives each ward a released-modules list (`ward_release_settings`, migration
091) that narrows what anybody but the super admin can reach. Three layers read one catalog
(`lib/access/releasedModules.ts`): `can()` refuses an unreleased module's permissions, the (app)
and (tithing) layouts bounce its pages to `/dashboard`, and a restrictive policy on each module's own
tables calls `ward_module_released()`. Ordinary users see the tiles absent plus "More tools are on
the way for {ward}."; the super admin sees every tile badged "Hidden from this ward" and an Admin
view notice.

## Key decisions
- **One answer for the app and RLS.** The list and `is_super_admin` reach the app through
  `session_context()` in the same round trip as the role, and RLS reads the same table through
  `ward_module_released()`. No second query exists that could disagree (070e's rule).
- **The list reaches `admin.*` and `sacrament.*`, which `role_access` cannot.** A ward configuring
  itself and the super admin narrowing it from above are different acts. The table has a SELECT
  policy and no write policy; the only writer is the super-admin route.
- **Nothing escapes the catalog by accident.** A permission no module claims fails at load (checked
  from `permissions.ts`, avoiding an import cycle); a top-level page folder no module claims fails
  `releasedRoutesCovered.test.ts`; the policies must equal the catalog's `tables` both ways
  (`module-release-policies.test.ts`). Each test was broken on purpose and shown to fail.
- **The module key list lives in `types/domain.ts`**, beside `ROLES`. The harness compiles
  `domain.ts` without the `@/` alias, so importing the key type from `lib/` broke
  `harness:typecheck`.
- **The policy wraps the check as `(select ward_module_released(...))`**, so Postgres evaluates it
  once per statement rather than once per row.

## What the walk found (scenarios 090 and 091, agent-driven, 2026-10-15)
- **The "Admin view" pill did not fit a 375px chrome bar.** It squeezed the ward name to "Har…" and
  pushed the account button off-screen (419px against 360px). Fixed: the pill shows from `sm` up,
  and the account menu carries the notice at every width.
- **The "ward was created" sentence rendered 6,564px above the Add form.** Fixed: messages from the
  Add form, errors included, render inside it.
- **The released list followed tick order.** Fixed: saved and shown in catalog order.
- **The badge wording changed** from "Not released here" to "Hidden from this ward" at the user's
  request: "not released" on a tile the super admin can still open read as a contradiction.

## Pattern
- **A test suite reading the working copy is sensitive to line endings.** Python on Windows rewrote
  nine LF files as CRLF; git normalized it on commit, so the diff looked clean, but the trigger drift
  test parses `SPEC.md` from disk and failed. Edit with the Edit tool or `sed`, or open files with
  `newline=""`.
- **A control added to a fixed-width bar needs a phone-width check against a control user.** The
  pill passed every component test; only measuring the same page as a bishop showed the overflow
  was the pill's.

## Known gaps
- **Cross-module reads.** A released module reading an unreleased module's own table reads empty.
  The mapping avoids every known case; nothing but the catalog review enforces it.
- **The bounce covers typed URLs and full loads only.** A layout does not re-render on client-side
  navigation, so a link followed inside the app relies on the page's narrowed `can()` and RLS.
- **The (youth) layout does not bounce** (it would loop with the (app) layout's `/ordinances`
  redirect). The ordinance tables are still refused when unreleased.
- **A ward unit with no ward behind it** can be seen ("No ward set up behind this unit.") but not
  repaired.
- **A new ward's timezone is America/Denver** with no editor (P12).
- **An access request approved for an unreleased module** has no visible effect until released.
- **Leftover test fixtures:** 28 `wlt-test` units and 12 wards from runs between 2026-09-22 and
  10-04 remain in the hosted database and appear on Stakes & Wards. Not caused by this work.
- **Unsettled from the walk:** whether the ward switcher needs a reload before a just-created ward
  appears. It appeared after a reload; the slow dev server hid whether it would have without one.

## Runbook — slice c (onboarding, no code)
Only after slice b is **deployed**:
1. Stakes & Wards → Add a unit → Ward "Test Ward" under Sheridan Wyoming Stake, with "Give me a
   calling here: Bishop" ticked.
2. Reload, open the account menu, switch to Test Ward, check everything works, switch back.
3. On Buffalo Ward's card → **Edit released modules** → untick Everything → tick Speakers & Prayers
   and Tithing → Save. The card reads "Released: Speakers & Prayers, Tithing".
4. While acting in Buffalo, invite the bishop and first counselor from Admin → Users. Invites land
   in the acting ward, so Buffalo becomes their home ward.
5. Until ITER-042 ships, they see only Tithing and the "coming soon" line.
