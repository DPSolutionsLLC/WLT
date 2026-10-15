# Plan: Released modules per ward, and a ward you can actually create

**Created:** 2026-10-15
**Type:** feature
**Scope refs:** ITER-041

## Overview

Give each ward a **released-modules list** that narrows what anyone in that ward can reach, so the
real **Buffalo Ward** shows the bishopric only **Speakers & Prayers** (ITER-042, not built yet) and
**Tithing**, while a **test ward** keeps everything. Only the super admin changes the list, and the
super admin sees everything in every ward.

The ITER-040 setup changed the starting point (recorded in the scope's last section): the old
"Development Ward" **is** the real Buffalo Ward (Sheridan, WY Stake), the user is the app's first
super admin, and a **new test ward is needed**. Research then found that **no code creates a ward**:
Stakes & Wards' "Add a unit → Ward" makes only a `units` row, with no `wards` row behind it, so a
new test ward cannot be made, held a calling in, or switched to. That gap is part of this plan.

### Slices (each its own commit, in this order)

- **a — Create a ward that works.** Adding a ward on Stakes & Wards provisions the real ward
  (`wards` row, organizations, notification settings), attaches the unit, and can give the creating
  super admin a calling there. Renaming a ward unit renames the ward the app displays.
- **b — Released modules.** Storage, the module catalog, narrowing in `can()`, the bounce, the
  database refusal, the super admin's editor, and the dashboard's "coming soon" line and
  "Not released here" marks.
- **c — Onboarding (no code).** The user creates the test ward, sets Buffalo's list, and invites the
  bishop and first counselor. A short runbook in the retro.

### Decisions settled with the user (2026-10-15) — do not re-litigate

- **Per ward, not per user.** Roles are unchanged; the list only narrows. Bishop and counselors stay
  identical (CLAUDE.md §7).
- **To Do / My Appointments are ONE module on the list** (`personal_tools`), unreleased in Buffalo.
- **Admin is a module on the list**, unreleased in Buffalo. The super admin does invites and
  settings there.
- **The database refuses a module's OWN tables when it is unreleased.** Shared tables (people,
  households, organizations, the ward, Sundays, users, notifications, audit log, AI and knowledge
  tables) stay readable, because other modules read them. For Roster that means its pages and
  actions are hidden and refused while `members`/`households` stay readable (Speakers & Prayers
  needs them).
- **Unreleased modules are hidden, plus a "coming soon" line** for people who are not the super
  admin, in a ward that has a list with something built left unreleased. The super admin instead
  sees every tile, unreleased ones marked "Not released here".
- **Absent means everything.** A ward with no list has every module released. Every existing ward,
  every test fixture and the new test ward keep working with no data change.
- **Notifications are always on** (account level), never on the list. So are the dashboard,
  account, sign-in and session.
- **`speakers` exists in the catalog now** (label "Speakers & Prayers", not built, no permissions,
  no tables), so Buffalo's list can name it today. ITER-042 fills it in.

### Success criteria

- On Stakes & Wards the super admin adds "Test Ward" (ticking "Give me a calling here: Bishop"),
  switches into it, and every module works there.
- With Buffalo's list set to Speakers & Prayers + Tithing, a bishop (not super admin) in Buffalo
  sees only the Tithing tile and the "coming soon" line. A typed `/roster` bounces to `/dashboard`.
  `GET /api/agendas` answers 403. A direct database read of `agendas` returns nothing.
- The super admin in Buffalo sees every tile (unreleased ones marked), opens anything, and sees an
  "Admin view" pill in the chrome bar.
- The test ward and every fixture ward behave exactly as before (the full suite stays green).

## Relevant Files

**Slice a**
- `lib/notifications/triggerDefaults.ts`: create. The trigger keys and default roles as a
  TypeScript constant, so app code can seed a new ward. It becomes the 4th source.
- `tests/db/notification-triggers-seed.test.ts`: modify. Diff the 4th source too, with its own
  anchor key.
- `lib/units/provisionWard.ts`: create. Inserts the ward, its 7 organizations and its notification
  settings with the service role, attaches the unit, and deletes the ward on a partial failure.
- `lib/units/writeUnit.ts`: modify. `updateUnit` also renames `wards.name` for the ward attached to
  a ward-type unit.
- `lib/validation/unit.ts`: modify. `createUnitSchema` gains optional `callingRole` (ward units
  only).
- `app/api/units/route.ts`: modify. POST of a `ward` unit provisions the ward, optionally creates the
  creator's calling, and writes audit.
- `app/(app)/admin/stakes/StakesAndWards.tsx`: modify. The Add form for a Ward gains "Give me a
  calling here" (checkbox plus role select, default Bishop). Ward cards show whether a ward exists
  behind the unit.
- `app/(app)/admin/stakes/page.tsx`: modify only if the card needs data it doesn't get yet.
- `tests/routes/units-provision.test.ts`: create.
- `tests/components/admin/StakesAndWards.test.tsx`: modify. The calling checkbox payload.

**Slice b**
- `supabase/migrations/091_released_modules.sql`: create. The table, `ward_module_released()`,
  `session_context()` gaining two columns, the restrictive policies, and the
  `module_release_policies()` RPC for tests.
- `lib/access/releasedModules.ts`: create. The catalog: module keys, labels, permission prefixes,
  route prefixes, owned tables, `built`. Plus `moduleOfPermission()`, `moduleForPath()`, and the
  label for "coming soon".
- `lib/auth/permissions.ts`: modify. `can()` narrows by the session's released modules unless the
  session is super admin.
- `types/domain.ts`: modify. `SessionUser` gains `releasedModules: readonly ReleasedModuleKey[] |
  null` and `isSuperAdmin: boolean` (required, so the 10 literal construction sites fail to compile
  until updated).
- `lib/auth/session.ts`: modify. Map the two new `session_context()` columns.
- `types/database.ts`: regenerate (`npm run db:types`).
- `middleware.ts`: modify. Set an `x-wlt-pathname` request header on app page requests.
- `lib/access/requireReleasedRoute.ts`: create. Reads the header, maps to a module, and redirects
  to `/dashboard` if the session lacks it.
- `app/(app)/layout.tsx`, `app/(tithing)/layout.tsx`: modify. Call `requireReleasedRoute(user)`.
- `app/api/wards/[id]/released-modules/route.ts`: create. `PUT { modules: string[] | null }`,
  super admin only, service-role write, audit.
- `lib/access/writeReleasedModules.ts`: create. Read/write helpers used by the route and the page.
- `lib/validation/releasedModules.ts`: create. The Zod schema.
- `app/(app)/admin/stakes/StakesAndWards.tsx` + `page.tsx`: modify. A "Released modules" editor on
  each provisioned ward card.
- `app/(app)/dashboard/page.tsx` and its header/tile components: modify. "Not released here" marks
  for the super admin, and the "coming soon" line for everyone else.
- `components/layout/ChromeBar.tsx`: modify. An "Admin view" pill when `user.isSuperAdmin &&
  user.releasedModules !== null`.
- `testing/infrastructure/seedUtils.ts`: modify. `setReleasedModules(wardId, modules | null)`, and a
  way to make a harness user super admin (check whether `createTestUser` supports
  `unitAssignment`; add it if not, and make clean-up remove the row).
- Tests (see Testing Strategy).
- Docs: `CLAUDE.md` §9 (a decision entry), `SPEC.md` (the table, function, route, session fields),
  `FEATURES.md` (released modules, ward creation).

**Slice c**: no code files. A runbook in the retro, plus the scenario walk.

## Dependencies

- No new libraries.
- Existing pieces to use:
  - `isSuperAdmin()` (`lib/units/queries.ts`), and the SQL `is_super_admin()` (migration 065).
  - `current_ward_id()`.
  - `createCalling()` (`lib/callings/writeCalling.ts`).
  - `createUnit`/`updateUnit`/`setWardUnit` (`lib/units/writeUnit.ts`).
  - `createServiceSupabaseClient`, `writeAuditLog`, `respondToRouteError`, `readJsonBody`.
  - `NAVIGATION_ITEMS`/`visibleNavigationItems` (`lib/auth/navigation.tsx`), `Pill`, `Tile`.
- Migration 091 must be applied to the hosted DB: `npx supabase db push --linked --dry-run`, then
  push, then `npm run db:types`. It redefines `session_context()` with two extra columns. The
  running build ignores extra columns, so it is safe before the deploy and needs no
  `HELD_BACK_UNTIL_DEPLOYED` entry.

## Known Pitfalls (from retro context)

- **role-access-overrides (ITER-005):** never give an access decision a defaulted parameter. The new
  `SessionUser` fields are **required** and `can()` keeps its required third argument. Do not add a
  "releasedModules = null" default anywhere. A default is how checks silently opt out.
- **p2-admin-and-access (070e's rule):** the app and RLS must read one answer. The release list
  reaches the app through `session_context()` (the same round trip as role and ward), and RLS reads
  the same table through `ward_module_released()`. Do not add a separate app-side query that could
  disagree.
- **p2-admin-and-access (seams):** "A screen gated on a structural role must not sit behind a
  layout gated on a ward permission." The super admin bypass in `can()` means the super admin
  passes every layout and page check in a ward whose Admin is unreleased. `/admin/stakes` must stay
  reachable for the super admin in Buffalo. Test it.
- **notification-trigger-drift:** the trigger list now has a 4th copy (`triggerDefaults.ts`).
  Extend the drift test to diff it **in both directions**, with an anchor key, and **prove it can
  fail** (break the parser, watch it go red, revert). A file-diff test passes on empty input.
- **p3-shell-and-tile-dashboard:** "a person sees only what they can open". No locked tiles for
  ordinary users. The super admin's "Not released here" mark is a **badge on a working tile** (it
  still opens), never a disabled or dimmed tile. The tile root stays an `<a>` with no `opacity-`
  class (the existing Tile test asserts this shape; keep it green).
- **p3 (no second module list):** `moduleForPath()` must derive from the catalog's route prefixes,
  and a test must read `app/(app)` and `app/(tithing)` from disk to prove every top-level route
  folder maps to a module or to core. Without that, a new page silently escapes the bounce.
- **CLAUDE.md rule 1:** the new table has `ward_id`. `tests/rls/ward-isolation.test.ts` asserts the
  exact exception list and must not need a change.
- **access_requests / sunday_music shape (073, 089):** a table that only the super admin writes gets
  a SELECT policy and **no write policy**. Every write goes through the service role behind the
  route's `isSuperAdmin` check. The `wards` row is **not** a safe home: `wards_update` lets the
  bishopric write their own ward's row (019).
- **`admin.*` and `sacrament.*` are non-overridable** by `role_access`. Release narrowing is a
  separate, super-admin-only mechanism, and it **does** hide them (decided). Comment this in
  `can()` so nobody "fixes" it.
- **Composite-FK delete trap (sacrament-music-people):** the release table's `ward_id` cascades on
  ward delete; `updated_by` is a plain `references users (id) on delete set null`, never composite.

## Tasks

### Slice a — Create a ward that works

#### Task a1: Trigger defaults as a TypeScript source
**File:** `lib/notifications/triggerDefaults.ts` (create)
**Details:**
- `export const NOTIFICATION_TRIGGER_DEFAULTS: readonly { triggerKey: string; defaultRoles:
  readonly Role[] }[]`, copied exactly from `supabase/seed/notification_triggers.sql` (keys and
  role arrays).
- Header comment: the 4th copy; the SQL seed cannot import TS, so the copies are kept equal by
  `tests/db/notification-triggers-seed.test.ts`, not by care.
- Extend that test: parse this file (import it directly, since it is TS) and diff it against the
  seed SQL **in both directions** and against `default_roles`. Add an anchor-key assertion. Mutate
  once to prove it fails, then revert.

#### Task a2: Provision a ward
**File:** `lib/units/provisionWard.ts` (create)
**Action:** `provisionWard({ unitId, name, timezone = "America/Denver" }, service) → { wardId }`.
**Details:**
- Insert `wards { name, unit_id: unitId, settings: { cross_org_visibility: false, timezone } }`.
  Mirror `supabase/seed/ward.sql`.
- Insert 7 `organizations`, one per `ORGANIZATION_TYPES` except `other`, named "Bishopric", "Elders
  Quorum", "Relief Society", "Young Men", "Young Women", "Primary", "Sunday School".
- Insert one `notification_settings` row per `NOTIFICATION_TRIGGER_DEFAULTS` entry
  (`is_globally_enabled: true`).
- **No transaction exists in supabase-js:** on any failure after the ward insert, delete the ward
  row (children cascade), log, and rethrow. Never leave a half-made ward.
- Never touches members, households or any module table. The roster comes from a paste.

#### Task a3: Ward-unit creation provisions; ward-unit rename renames the ward
**Files:** `app/api/units/route.ts`, `lib/units/writeUnit.ts`, `lib/validation/unit.ts` (modify)
**Details:**
- `createUnitSchema` gains `callingRole: z.enum(BISHOPRIC_ROLES).optional()` (the bishopric roles
  only; extend later if needed). It is refused with a sentence on a non-ward unit.
- POST: after `createUnit` for `type === "ward"`, call `provisionWard`. On provisioning failure,
  delete the just-created unit and return a 500 with a sentence (no orphan unit).
- If `callingRole` is set, `createCalling({ userId: user.id, wardId, role, createdBy: user.id })`
  through the service role. A unique violation (already serving) gets the route's existing
  sentence.
- Audit: one `unit_created` row as today, with `wardId` (the new ward) and `callingCreated: bool`
  in the detail.
- `updateUnit`: when `changes.name` is set, also `update wards set name = $name where unit_id =
  unitId` (service role). Ignore zero rows (a stake has no ward). Comment why: the chrome bar reads
  `wards.name`.
- Ward units created before this change with no `wards` row behind them are left alone. Do not
  backfill. (Buffalo's unit already has its ward; any other such unit came from testing the old
  screen.)

#### Task a4: The Stakes & Wards form
**File:** `app/(app)/admin/stakes/StakesAndWards.tsx` (modify)
**Details:**
- When Type is Ward: a checkbox "Give me a calling here" (default ticked) and a role select
  (Bishop / Counselor, default Bishop). Send `callingRole` only when ticked.
- After creating, show one sentence: "Test Ward was created. Switch to it from your account menu."
  (the existing switcher appears once the user holds callings in two wards).
- A ward card whose unit has no ward behind it (`wards` prop has no row with that `unitId`) says
  "No ward set up behind this unit." Do not add a repair button. Record it as a gap if it is ever
  seen.

### Slice b — Released modules

#### Task b1: Migration 091
**File:** `supabase/migrations/091_released_modules.sql` (create)
**Details:**
- `create table ward_release_settings (ward_id uuid primary key references wards (id) on delete
  cascade, released_modules text[] not null, updated_by uuid references users (id) on delete set
  null, updated_at timestamptz not null default now())`. **No row means everything is released.**
  An empty array means nothing is.
- RLS on. `create policy ward_release_settings_select ... for select to authenticated using
  (ward_id = current_ward_id() or is_super_admin())`. **No insert/update/delete policy.**
- `create function ward_module_released(p_module text) returns boolean language sql stable
  security definer set search_path = public, pg_temp as $$ select is_super_admin() or not exists
  (select 1 from ward_release_settings where ward_id = current_ward_id()) or exists (select 1 from
  ward_release_settings where ward_id = current_ward_id() and p_module = any (released_modules))
  $$;` Grant execute to authenticated and service_role; revoke from public.
- **Restrictive policies**, one per module-owned table, generated in a `do` block from a literal
  mapping:
  `execute format('create policy %I on %I as restrictive for all to authenticated using
  (ward_module_released(%L)) with check (ward_module_released(%L))', t || '_module_released', t,
  m, m)`.
  The mapping (`table → module`):
  - **sacrament:**
    - Talks and prayers: `assignments`, `assignment_approvals`, `assignment_comments`,
      `assignment_history`, `talk_references`, `prayer_assignments`
    - Topics: `topics`, `topic_candidates`
    - Programmes and music: `programs`, `hymn_selections`, `musical_numbers`, `sunday_music`
    - Conducting: `conducting_rotation`, `sunday_org_conducting`
  - **agendas:** `agendas`, `action_items`
  - **visits:** `visit_logs`, `visit_private_notes`, `visit_participants`, `visit_appointments`,
    `visit_goals`, `household_visit_cadences`, `household_stewardships`, `goals`
  - **youth:** `youth_activity_profiles`, `activity_events`, `activity_attendees`, `activity_logs`,
    `activity_private_notes`, `activity_calendars`, `activity_occasions`, `activity_roster`,
    `activity_event_participation`
  - **tithing:** `tithing_entries`, `tithing_sessions`
  - **sacrament_ordinances:** `sacrament_assignments`, `sacrament_rotation_pools`,
    `sacrament_send_log`, `sacrament_assignment_managers`
  - **roster:** `member_notes`

  **Deliberately not restricted** (comment each reason in the migration):
  - `sundays`: shared by Sacrament, Agendas and the future tracker.
  - `members`, `households`, `member_organizations`, `organizations`: Speakers & Prayers reads them.
  - `todos`, `todo_steps`, `todo_log_entries`: Sacrament and Agendas write and read linked to-dos.
  - `knowledge_documents`, `document_chunks`, `retrieval_*`, `ai_settings`: AI drafting across
    modules reads them.
  - `report_read_status`: shared by the visits and youth feeds.
  - `invites`, `access_requests`, `audit_log`, `issue_reports`, `notifications*`, `users`,
    `wards`, `units`, `unit_assignments`, `ward_role_assignments`, `public_pages`, `hymns`,
    `conversation_*`, `youth_login_attempts`.

  `to authenticated` only, so anonymous public pages and the service role are unaffected.
- **`session_context()`**: `drop function` + `create function` with the same columns as migration
  072's version, plus `released_modules text[]` (null when no row) and `is_super_admin boolean`.
  Copy 072's body exactly and add the two columns (read 072 first; keep `security definer`, the
  grants and the comment).
- `create function module_release_policies() returns table (table_name text, policy_qual text)
  security definer`. It reads `pg_policies where policyname like '%\_module\_released'`, granted
  to service_role only, and exists for the drift test (same shape as `composite_user_author_fks`).

#### Task b2: The catalog
**File:** `lib/access/releasedModules.ts` (create)
**Details:**
- `export const RELEASED_MODULES = [...] as const` with `{ key, label, description, built,
  permissionPrefixes, routePrefixes, tables }`:

  | key | label | permission prefixes | route prefixes | built |
  |---|---|---|---|---|
  | `sacrament` | Sacrament meeting | `talks.` `topics.` `program.` `music.` `calendar.` | `/sacrament` `/assignments` `/prayers` `/talks` `/program` `/music` `/calendar` | true |
  | `speakers` | Speakers & Prayers | none yet (ITER-042) | none yet | false |
  | `agendas` | Agendas | `agendas.` | `/agendas` | true |
  | `roster` | Roster | `roster.` | `/roster` | true |
  | `visits` | Visits | `visits.` `goals.` | `/visits` `/goals` | true |
  | `youth` | Youth activities | `youth_activities.` | `/youth` | true |
  | `tithing` | Tithing | `tithing.` | `/tithing` | true |
  | `personal_tools` | To Do & Appointments | `personal_tools.` | `/todos` `/appointments` | true |
  | `knowledge` | Knowledge Base | `knowledge.` | `/knowledge` | true |
  | `ai_settings` | AI Settings | `ai_settings.` | `/ai-settings` | true |
  | `admin` | Admin | `admin.` `audit.` | `/admin` | true |
  | `sacrament_ordinances` | Sacrament ordinances | `sacrament.` | `/ordinances` | true |

- `ALWAYS_ON_PERMISSION_PREFIXES = ["notifications."]` and `CORE_ROUTE_PREFIXES = ["/dashboard"]`.
- `tables` lists exactly the migration's mapping, so the drift test can compare.
- `moduleOfPermission(permission): ReleasedModuleKey | null` (null means always on). It **throws** on
  a permission that matches no prefix, so a new permission cannot be added without placing it.
- `moduleForPath(pathname): ReleasedModuleKey | null` (null means core). Longest-prefix match on
  whole segments (`/talks` must not match `/talkative`).
- `isModuleReleased(user, key)`: `user.isSuperAdmin || user.releasedModules === null ||
  user.releasedModules.includes(key)`.
- Validate on import (like `accessModules.ts` asserts its invariant): every `PERMISSIONS` entry
  maps to exactly one module or to always-on, and no prefix belongs to two modules.

#### Task b3: Session and `can()`
**Files:** `types/domain.ts`, `lib/auth/session.ts`, `lib/auth/permissions.ts` (modify), and
`types/database.ts` (regenerate)
**Details:**
- Add the two required `SessionUser` fields. Fix every construction site the compiler names
  (about 10).
- `session.ts` maps `released_modules` (validate each entry against the catalog keys and drop
  unknown keys with a `console.warn`) and `is_super_admin`.
- `can()`: after the role check succeeds, `const module = moduleOfPermission(permission); if
  (module !== null && !isModuleReleased(user, module)) return false;`. `assertCan` inherits it.
  Comment: this is the super-admin-only release narrowing; it deliberately reaches `admin.*` and
  `sacrament.*`, which `role_access` cannot.
- `resolveRoleAccess` is **unchanged** (no extra query).

#### Task b4: The bounce
**Files:** `middleware.ts`, `lib/access/requireReleasedRoute.ts` (create), `app/(app)/layout.tsx`,
`app/(tithing)/layout.tsx` (modify)
**Details:**
- `middleware.ts`: for non-API page requests, forward `x-wlt-pathname: pathname` on the **request**
  headers. Use `NextResponse.next({ request: { headers } })`, merged with what `updateSession`
  returns. Read `lib/supabase/middleware.ts` first, keep its cookie handling intact, and copy the
  cookies onto the new response if a new one is built.
- `requireReleasedRoute(user)`: reads `headers().get("x-wlt-pathname")`. If absent, do nothing (and
  never throw). If `moduleForPath` returns a module the session lacks, `redirect("/dashboard")`.
- Call it in both layouts right after `requireSessionUser()`.
- API routes need nothing: they already `assertCan` through the narrowed `can()` and answer 403.

#### Task b5: The super admin's editor
**Files:** `app/api/wards/[id]/released-modules/route.ts`, `lib/access/writeReleasedModules.ts`,
`lib/validation/releasedModules.ts` (create); `StakesAndWards.tsx`, `admin/stakes/page.tsx`
(modify)
**Details:**
- Schema: `{ modules: z.array(z.enum(RELEASED_MODULE_KEYS)).max(50).nullable() }.strict()`, with
  named messages.
- `PUT`: `requireSessionUser` outside the try; `isSuperAdmin(supabase)` or `ForbiddenError`; parse;
  service-role upsert (`modules === null` deletes the row, meaning everything); audit
  `released_modules_updated` with `{ targetWardId, modules }` (keys only) under the acting
  session's ward. `params` is a Promise.
- `GET` is not needed: the page reads the rows with the service role, because it is already
  super-admin gated.
- On each ward card with a ward behind it: "Released: Everything" or the list of labels, plus
  **Edit**. That opens a checkbox list of every catalog module (unbuilt ones say "Not built yet"
  but stay tickable), an "Everything (no list)" option, and Save / Cancel.

#### Task b6: Dashboard and chrome bar
**Files:** `app/(app)/dashboard/page.tsx` (+ the header/tile components it renders),
`components/layout/ChromeBar.tsx` (modify)
**Details:**
- Ordinary users: tiles already filter through `visibleNavigationItems` → `can()`, so unreleased
  tiles vanish with no change. Add one muted line under the grid **only when**
  `!user.isSuperAdmin && user.releasedModules !== null` and some `built` catalog module is
  unreleased: *"More tools are on the way for {ward name}."*
- Super admin in a ward with a list: each tile whose module is unreleased gets a small "Not released
  here" `Pill` inside the working tile. No dimming; it still opens.
- ChromeBar: an "Admin view" pill when `user.isSuperAdmin && user.releasedModules !== null`, with a
  `title`/visually-hidden text: "You see modules this ward has not released."

### Slice c — Onboarding (no code; a runbook in the retro)
1. On Stakes & Wards, add Ward "Test Ward" under Sheridan, WY Stake, ticking "Give me a calling
   here: Bishop".
2. Switch to Test Ward from the account menu, confirm everything works, and switch back.
3. Edit Buffalo Ward's released modules: Speakers & Prayers + Tithing.
4. While acting in Buffalo, invite the bishop and first counselor through the normal invite flow
   (Admin → Users). Invites land in the inviter's acting ward (`lib/auth/invites.ts`), so Buffalo
   becomes their home ward.
5. Until ITER-042 ships, they will see only Tithing and the "coming soon" line.

## Testing Strategy

- **`tests/lib/releasedModules.test.ts`** (pure):
  - Every permission maps to exactly one module or always-on.
  - `moduleOfPermission` throws on an unknown permission.
  - `moduleForPath`: whole-segment and longest-prefix matching, core paths.
  - `isModuleReleased`: null list, super admin, listed, unlisted.
- **`tests/lib/releasedRoutesCovered.test.ts`** (reads the disk, like `navigationRoutesExist`):
  - Every top-level folder in `app/(app)` and `app/(tithing)` maps to a module or core.
  - Every `built` `NAVIGATION_ITEMS` href maps to a module. Assert a named anchor (`/roster` →
    `roster`) so it cannot pass trivially.
- **`tests/lib/permissions.test.ts`** (extend):
  - `can()` refuses a role-granted permission whose module is unreleased.
  - It allows it for `isSuperAdmin`.
  - It allows always-on `notifications.*`.
  - A null list changes nothing (table-driven over the existing matrix).
- **`tests/db/module-release-policies.test.ts`**:
  - Calls `module_release_policies()` and asserts the set of `(table, module)` equals the
    catalog's `tables` mapping exactly, in both directions, with an anchor (`agendas` →
    `agendas`).
  - Prove it can fail once.
- **`tests/rls/released-modules.test.ts`** (`seedFixtures(["bishop", "superAdmin", "wardBBishop"])`,
  the release row seeded with the service client):
  - Ward A with `[tithing]`: the bishop cannot select or insert `agendas` (insert raises, select
    returns 0).
  - The bishop can select `tithing_sessions`.
  - Ward B (no row) is unaffected.
  - The super admin acting in ward A **can** select `agendas`.
  - The bishop cannot insert, update or delete `ward_release_settings` (re-read with the service
    client).
  - `session_context()` returns the list and `is_super_admin` correctly for each.
  - Clean up the release row in `afterAll`.
- **`tests/routes/released-modules.test.ts`**:
  - PUT as bishop → 403 and no row.
  - As super admin → 200, the row is written, and an audit row exists.
  - `null` deletes the row.
  - An unknown key → 400.
  - `GET /api/agendas` as a bishop in a ward with `[tithing]` → 403.
- **`tests/routes/units-provision.test.ts`**:
  - Super admin POSTs a ward unit with `callingRole: "bishop"`. Assert:
    - `wards` row with `unit_id`.
    - 7 organizations.
    - `notification_settings` keys equal `NOTIFICATION_TRIGGER_DEFAULTS`.
    - The calling exists.
  - A stake with `callingRole` → 400.
  - Non-super-admin → 403 and nothing created.
  - Renaming the ward unit renames `wards.name`.
  - Clean up the created ward, unit and calling.
- **`tests/components/admin/StakesAndWards.test.tsx`** (extend):
  - The ward Add form sends `callingRole` when ticked, and omits it when unticked.
  - The release editor PUT body.
- **Dashboard component test** (if the header is a component):
  - The "coming soon" line shows only when not super admin, a list exists and a built module is
    unreleased.
  - The super admin sees marks.
- **Guards that must stay green:** `explicitTimeZone`, `navigationRoutesExist`, `ward-isolation`,
  `user-author-fks`, `migrations`, `notification-triggers-seed`, `permissions`, and the Tile shape
  test.

## Test Scenarios (Harness)

### Scenario 090: A ward that has released only some modules
**Tags:** admin, access, full
**Purpose:** The release list changes what three different people see from the same data, and
proving the bounce and the super admin's view needs a seeded list and a super admin. Building that
by hand is slow.
**Seed data summary:**
- Harness Test Ward with `ward_release_settings.released_modules = ['speakers', 'tithing']`.
- Users:
  - `bishop` (bishop, not super admin).
  - `admin` (counselor **plus** a super_admin `unit_assignments` row; clean-up removes it).
  - `secretary` (ward_secretary).
- A few members and one agenda row (so a refused read is visible as absence rather than an empty
  table).
- Notification triggers.
**Tester action:**
1. As `bishop`: open the dashboard, then type `/roster`, `/agendas`, `/todos` and `/admin`, then
   open `/tithing`.
2. As `admin`: open the dashboard, check the pill and marks, open `/agendas`, then on Stakes &
   Wards edit the ward's released modules to add Agendas.
3. As `bishop` again: Agendas now appears.
**Verification checklist:**
- [ ] The bishop sees only the Tithing tile and "More tools are on the way for Harness Test Ward."
- [ ] Each typed URL lands on `/dashboard`. `/tithing` opens.
- [ ] `admin` sees every tile, unreleased ones with "Not released here", and an "Admin view" pill.
- [ ] `admin` can open `/agendas` and `/admin/stakes` in this ward.
- [ ] After `admin` adds Agendas, the bishop sees the Agendas tile and its row. The
      `ward_release_settings` row and an audit row confirm the save.
- [ ] Usable at 375px and in dark mode.

### Scenario 091: Create a working ward from Stakes & Wards
**Tags:** admin, units, full
**Purpose:** Ward creation now provisions a real ward. Only a walk proves you can switch into it
and use it.
**Seed data summary:** Harness Test Ward, `admin` (super admin) holding one calling there, and a
stake unit "Harness Stake".
**Tester action:** As `admin`, on Stakes & Wards add Ward "Harness Second Ward" under Harness Stake
with "Give me a calling here: Bishop" ticked. Switch to it, open Sacrament and Roster, then switch
back. Rename it to "Harness Ward Two".
**Verification checklist:**
- [ ] The ward appears under the stake. The account menu offers the switch.
- [ ] After switching, the chrome bar names the new ward. Sacrament generates Sundays. Roster is
      empty and offers the import.
- [ ] `notification_settings` has a row per trigger for the new ward (read back).
- [ ] The rename shows in the chrome bar after reload.
- [ ] Clean-up removes the created ward, unit and calling (the seed's clean-up must know to delete
      a ward created during the walk; note it in the scenario if it cannot).

## Validation Commands

```bash
# Migration (hosted DB — dry run first)
npx supabase db push --linked --dry-run
npx supabase db push --linked
npm run db:types

# Linting
npm run lint

# Type checking
npm run typecheck
npm run harness:typecheck

# Tests: new and affected first, then the full suite (stop the dev server first; ~70 min)
npx vitest run tests/lib/releasedModules.test.ts tests/lib/releasedRoutesCovered.test.ts tests/lib/permissions.test.ts tests/db/notification-triggers-seed.test.ts tests/lib/navigationRoutesExist.test.ts tests/lib/explicitTimeZone.test.ts tests/components/admin/StakesAndWards.test.tsx
npx vitest run tests/db/module-release-policies.test.ts tests/rls/released-modules.test.ts tests/routes/released-modules.test.ts tests/routes/units-provision.test.ts tests/rls/ward-isolation.test.ts tests/db/migrations.test.ts
npm test

# Harness manifest
npm run manifest

# Production build (never while `npm run dev` is running)
npm run build
```

## Integration Notes

- **Order:** slice a, then b, then c. Slice a ships and deploys on its own. Slice b's migration can
  be pushed before its deploy (additive columns), but the restrictive policies take effect the
  moment it applies. With no release rows, that is a no-op for every ward. Do not create Buffalo's
  row until slice b is deployed.
- **ITER-042 hand-off:** add its permissions with a `speakers.` prefix (so `moduleOfPermission`
  places them), its route prefix to the catalog, its tables to the catalog **and** a migration
  adding the restrictive policy (the drift test will fail until both are present), and flip
  `built`. Its routes must not depend on `roster.view` (Roster is unreleased in Buffalo). It reads
  `members`/`households` directly.
- **Access requests** are unchanged. Approving a request for a module the ward has not released has
  no visible effect until it is released. Note this in the CLAUDE.md entry rather than building
  anything.
- **Future, not now (recorded):** the bishopric taking over roster imports in Buffalo means
  releasing `roster` for them later. One tick box.
- **Breaking:** `SessionUser` gains two required fields (compile-enforced). `session_context()`
  returns two more columns. Nothing else calls it.
- **Retro known gaps to record:**
  - Cross-module reads of a restricted table (a released module reading an unreleased module's own
    table) read as empty. The mapping avoids every known case, but nothing enforces it beyond the
    catalog review.
  - A ward unit with no ward behind it can only be seen, not repaired.
  - Ward timezone defaults to America/Denver with no editor.
