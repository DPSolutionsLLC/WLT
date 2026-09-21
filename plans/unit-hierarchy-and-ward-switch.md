# Plan: Unit Hierarchy and the Ward Switch

**Created:** 2026-09-21
**Type:** feature
**Source:** [plans/P2-unit-hierarchy.md](P2-unit-hierarchy.md) — slices `proto-b` and `proto-c`
**Structure:** Two slices, two commits, in order. `proto-d` (super admin screens, the
request/approve flow, Stakes & Wards) is deliberately **not** in this plan — see §Out of scope.

---

## Overview

Put stakes above wards and a super admin above both, and let a stake officer act inside a ward
that is not their own — **without rewriting 131 RLS policies**.

The mechanism is not cross-ward policies. It is an **authorized ward switch**: after the switch,
every policy that already says `ward_id = current_ward_id()` is correct for the ward the officer
is now in. The risk therefore concentrates into four helper functions and one guarded column,
instead of spreading across every table in the schema.

### Key requirements

1. **Migration 065 applies with zero behaviour change.** Nothing reads the new columns. The app
   is walked after it and looks identical.
2. **Migration 066 changes helper functions and two `users` policies. It changes no other
   policy.** That is the proof the 131 did not move.
3. A user with no unit assignment **cannot set `active_ward_id` at all**.
4. A stake officer can switch **only** into a ward under their own stake.
5. Across a switch: `current_org_id()` is null, `is_bishopric()` is false, and
   `visit_private_notes` / `activity_private_notes` stay invisible (CLAUDE.md rule 5).
6. Revoking a stake assignment **takes effect immediately**, even if `active_ward_id` is still set.
7. The last active super admin can never be deactivated or have the role removed.

### Success criteria

- `tests/rls/unit-switching.test.ts` green, including the private-note case.
- Every existing RLS suite still green.
- `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` all clean.
- Signing in as an ordinary ward member shows **no ward control anywhere**.

---

## Three findings that change the phase file's premise

The executing agent must read these before writing SQL. Each contradicts something
`P2-unit-hierarchy.md` states or implies.

### 1. The one-line `current_ward_id()` change signs the switcher out

[020_users_ward_read.sql](../supabase/migrations/020_users_ward_read.sql#L18) is:

```sql
create policy users_ward_select on users
  for select to authenticated
  using (ward_id = current_ward_id());
```

Redefine `current_ward_id()` to return the active ward and a switched-in officer can no longer
read **their own** `users` row — their `users.ward_id` is still ward A.
[lib/auth/session.ts](../lib/auth/session.ts#L57) selects that row by `id`, gets nothing, treats
it as a half-created account and redirects to `/login`. **The switch would log you out.**

`users_ward_select` gains `or id = auth.uid()` in migration 066. Task 2.3.

### 2. A policy alone cannot open the switch — a column GRANT must open it first

[022_roster_import.sql](../supabase/migrations/022_roster_import.sql#L242) did
`revoke update on users from authenticated` and granted back exactly `theme_preference`. Column
privileges are checked **before** policies, so `active_ward_id` needs an explicit
`grant update (active_ward_id) on users to authenticated`.

The moment that grant exists, every authenticated session may *attempt* the write and the
`WITH CHECK` arm on `users_update_self` is the entire security boundary. That is still CLAUDE.md
rule 2 — but it means the predicate must be airtight, and (the `060-D2` lesson, CLAUDE.md §9) a
failed `WITH CHECK` **raises** where every other refusal in this codebase returns zero rows.
Plan for a raise: `lib/youth/policyRefusal.ts`-style 42501 handling on the route. Tasks 2.4 and 2.9.

### 3. `coalesce(active_ward_id, ward_id)` is not safe on its own

The phase file writes the new `current_ward_id()` as a plain `coalesce`. That authorizes the
switch **once, at write time, forever**. Release a stake president and their session keeps
reading ward B until somebody remembers to null the column.

`current_ward_id()` must **re-validate on every read**:

```sql
case when u.active_ward_id is not null and can_act_in_ward(u.id, u.active_ward_id)
     then u.active_ward_id else u.ward_id end
```

The function is `stable`, so Postgres evaluates it once per statement, not once per row. This is
requirement 6 and it is cheap. Task 2.2.

---

## Decisions taken before planning

| Question | Answer | Why |
|---|---|---|
| Plan scope | `proto-b` + `proto-c` | `proto-b`'s assignment-model decision is only answerable once `proto-c`'s authorization query is known. Splitting them means designing `proto-b` twice. |
| Where the ward lives on an assignment | **Additive `unit_assignments`** | `users` stays the person's HOME row — `ward_id`, `role`, `org_id` do not move, so `current_*()` and the session keep reading it and the 131 policies genuinely do not move. A second `users` row per person is impossible anyway: `users.id` **is** `auth.users.id`. |
| Stake officer powers after a switch | **Read-only** | Matches the phase file's "writes are still refused". Widening later is one list edit; narrowing later is a security incident. |

**Written down for the next reader, per the phase file's instruction:** roles stay reusable
templates. `unit_assignments` says "this person holds this stake role over this unit". Moving
*every* calling into that table is the eventual shape but is explicitly **not** this phase — it
would rewrite `current_ward_id`, `current_org_id`, `current_user_role`, `is_bishopric`,
`resolveSessionUser`, the invite flow and the admin user list inside a slice whose whole
requirement is zero behaviour change. Revisit only when a real ward needs one person holding
callings in two wards at once.

---

## Relevant Files

### Create

- `supabase/migrations/065_unit_hierarchy.sql` — `units`, `unit_assignments`, `wards.unit_id`,
  `users.active_ward_id`, `members.mrn`, the 1:1 ward backfill, RLS + SELECT policies, two
  definer helpers.
- `supabase/migrations/066_ward_switch.sql` — rewrites `current_ward_id`, `current_org_id`,
  `is_bishopric`; adds `acting_in_home_ward`, `can_act_in_ward`, `unit_ancestor_ids`,
  `session_context`; replaces `users_ward_select` and `users_update_self`; grants
  `update (active_ward_id)`.
- `lib/units/queries.ts` — read units, read a user's assignments, list the wards a user may switch
  into.
- `lib/units/wardSwitch.ts` — `switchActiveWard()` / `clearActiveWard()`, both mapping a 42501
  policy refusal onto a typed refusal rather than a 500.
- `lib/validation/wardSwitch.ts` — Zod schema for the switch body.
- `app/api/session/active-ward/route.ts` — `PATCH` performs the switch, `GET` lists switchable wards.
- `tests/rls/unit-switching.test.ts` — the phase's highest-value suite.
- `tests/rls/unit-assignments.test.ts` — who may read/write the new tables.
- `tests/lib/unitAncestors.test.ts` — ancestor-walk tests, including the cycle guard.
- `tests/routes/session-active-ward.test.ts` — route happy path + refusal path.
- `testing/scenarios/auth/scenario-064-switching-into-another-ward/{scenario.md,seed.ts}`
- `testing/scenarios/auth/scenario-065-the-ward-that-never-sees-the-switch/{scenario.md,seed.ts}`

### Modify

- `types/domain.ts` — 5 new role values in `ROLES`, labels, `INVITABLE_ROLES` narrowed,
  `STAKE_ROLES` / `UNIT_TYPES` / `UNIT_ASSIGNMENT_ROLES` added, `SessionUser` gains
  `homeWardId` / `activeWardId` / `isVisitingWard`.
- `types/database.ts` — regenerated (`npm run db:types`). **Do not hand-edit.**
- `lib/auth/permissions.ts` — permission lists for the 5 new roles; `super_admin` locked out of
  ward overrides in `mergeRoleAccess`.
- `lib/auth/session.ts` — resolve the effective ward from the database, not by recomputing it.
- `lib/auth/adminUsers.ts` — last-super-admin guard beside the existing last-bishop guard;
  super-admin assignment friction.
- `lib/validation/adminUser.ts` — keep `super_admin` out of the ordinary role-change path.
- `tests/helpers/seed.ts` — seed `units`, a stake over wards A and B, and three new handles.
- `tests/rls/ward-isolation.test.ts` — the ward-less-table assertion (see Pitfall 1).
- `tests/rls/users-column-grant.test.ts` — add cases for the newly granted column.
- `tests/lib/permissions.test.ts`, `tests/lib/navigation.test.ts` — whatever the new roles break.

---

## Dependencies

- **No new libraries.** Everything uses what is already here.
- Existing utilities to use, not to reinvent: `writeAuditLog()`, `assertCan()` /
  `resolveRoleAccess()`, `respondToRouteError()` / `readJsonBody()`,
  `seedFixtures()` / `asRole()`, the `isPolicyRefusal()` idiom in
  [lib/youth/policyRefusal.ts](../lib/youth/policyRefusal.ts).
- Two hosted-database steps, run by a human: `npm run db:push` then `npm run db:types`.
  **`npm run db:reset` wipes the hosted project — never run it** (CLAUDE.md §9).

---

## Known Pitfalls (from retro context)

- **`ward-isolation.test.ts` asserts exactly two ward-less tables.**
  `it("has exactly two deliberately ward-less tables")` expects `["hymns", "wards"]`. `units` and
  `unit_assignments` make it four and the test goes **red** — that is the mechanism working, not a
  nuisance. Update the assertion **and** write the justification into the migration header: a unit
  is not inside a ward, and a stake assignment has no ward, so a `ward_id` column there would be a
  lie no policy could use. This is the third and fourth documented exception to CLAUDE.md rule 1.

- **`role-access-overrides` (ITER-005) — the compiler is the enumerator.** `RoleAccess` is
  `Record<Role, …>` and `ROLE_LABELS` is `Record<Role, string>`. Adding to `ROLES` produces a
  compile error per new role in both. **Do not silence either with a default or an index
  signature** — being forced to name every new role is the whole point.

- **`youth-h` / defect `060-D2` — a mirror must copy BOTH halves of a policy.** `users_update_self`
  will carry a `WITH CHECK` arm that its `USING` arm does not. Any TypeScript gate on the switch
  control must mirror `USING ∧ WITH CHECK`, and the route must map SQLSTATE **42501** onto a
  typed refusal. Narrow the mapping to 42501 only — "the policy said no" and "the database is
  broken" must never become one message (CLAUDE.md rule 7).

- **`youth-b` / `youth-c` — `npm run build` catches what lint, typecheck and the suite miss.** A
  constant imported by a `"use client"` component out of a server-only module pulls
  `next/headers` into the browser bundle. The switcher control is a client component; its labels
  belong in `types/domain.ts`, never in the route file. (This is also why
  `cross-org-visibility/route.ts` keeps its wording in `types/domain.ts`.)

- **`notification-trigger-drift` (ITER-023) — one list, three copies, all disagreeing.** The
  `users.role` CHECK and `ROLES` are exactly this shape. Migration 002's own comment warns about
  it. Change both in the same commit; `tests/lib/permissions.test.ts` should assert they match by
  reading the migration from disk, the way `notification-triggers-seed.test.ts` does.

- **`seed-household-id-collision` — fixture ids must be unique per run.** New `units` fixtures
  take the per-run id like everything else in `seedFixtures`.

- **`talks-d` hole, four sightings — never scope a policy on a nullable author column.**
  `unit_assignments.created_by` is nullable and must not appear in any policy predicate.

---

## Tasks

### Slice `proto-b` — the schema (migration 065). One commit.

**Requirement: this slice is deployable with zero visible effect.** Nothing in `app/` or
`components/` reads a new column. The app is walked after it and looks identical.

#### Task 1.1 — Migration 065, part a: `units`

**File:** `supabase/migrations/065_unit_hierarchy.sql` (create)

```sql
create table units (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('area', 'stake', 'ward')),
  parent_id   uuid references units (id) on delete restrict,
  unit_number text,
  name        text not null,
  created_at  timestamptz not null default now()
);

create unique index units_unit_number_key
  on units (unit_number)
  where unit_number is not null;

create index units_parent_id_idx on units (parent_id);
```

**Details:**
- `type` covers `area | stake | ward` because real church structure also has missions and
  districts as stake-equivalents, and how far up this goes is genuinely uncertain — which is
  itself the reason not to hardcode two levels. **Build no area or district screens.**
- `unit_number` is the **real church-assigned number**, never an app-invented id. Nullable until
  a human knows it; unique **only where present**, hence the partial index.
- `parent_id` is `on delete restrict`, not `cascade`. Deleting a stake with wards under it must
  fail loudly rather than silently orphaning or destroying them.
- **No `ward_id`.** Write the rule-1 exception into the header comment (see Pitfall 1).

#### Task 1.2 — Migration 065, part b: `unit_assignments`

**File:** same migration

```sql
create table unit_assignments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users (id) on delete cascade,
  unit_id            uuid references units (id) on delete cascade,
  role               text not null check (
                       role in ('stake_president', 'stake_counselor',
                                'stake_secretary', 'super_admin')
                     ),
  counselor_position integer check (counselor_position in (1, 2)),
  created_by         uuid references users (id) on delete set null,
  created_at         timestamptz not null default now(),

  constraint unit_assignments_scope check (
    (role =  'super_admin' and unit_id is null) or
    (role <> 'super_admin' and unit_id is not null)
  )
);

create unique index unit_assignments_unique
  on unit_assignments (user_id, unit_id, role) nulls not distinct;

create index unit_assignments_user_id_idx on unit_assignments (user_id);
create index unit_assignments_unit_id_idx on unit_assignments (unit_id);
```

**Details:**
- **`unit_id` nullable means every unit**, and that is the same absent-means-default idiom as
  `household_stewardships` (052), `household_visit_cadences` (050), `054a`'s `org_id`, `059b`'s
  `occasion_id` and `060a`'s `closed_at`. **There is no sentinel "root" unit and none should be
  invented.**
- `nulls not distinct` on the unique index is **load-bearing**, and this is migration 055's lesson
  verbatim: without it, two `super_admin` rows for the same person would not conflict, because
  `null <> null`. Prove it by attempting the duplicate insert, do not assume it.
- The `unit_assignments_scope` CHECK makes "a super admin scoped to one stake" and "a stake
  president over nothing" both unrepresentable. This is a constraint and not a comment for the
  same reason `061`'s was: nobody can act on a state the schema should have refused.
- `created_by` is **nullable and must never appear in a policy predicate** — that is the
  `talks-d` hole, and it has been found four times in this repo already.

#### Task 1.3 — Migration 065, part c: the three added columns

**File:** same migration

```sql
alter table wards   add column unit_id        uuid references units (id) on delete restrict;
alter table users   add column active_ward_id uuid references wards (id) on delete set null;
alter table members add column mrn            text;

create index wards_unit_id_idx on wards (unit_id);
```

**Details:**
- `wards.unit_id` stays **NULLABLE**, deliberately, and the reason is worth writing in the header:
  `tests/helpers/seed.ts` inserts `wards` rows directly, so `not null` would break every RLS suite
  on the day it applied. It is also **fail-closed** — `can_act_in_ward()` walks
  `wards.unit_id → units.parent_id`, so a ward with no unit simply cannot be switched into.
  It becomes `not null` in `proto-d`, once ward creation goes through the Stakes & Wards screen.
- `users.active_ward_id` is `on delete set null`: deleting a ward must not delete the visiting
  officer's account.
- `members.mrn` (membership record number) is nullable and unused this phase. It is here because
  it belongs to the same identity shape and adding a column later is a second migration for no
  reason. **Nothing reads it.** Do not add it to the roster UI.

#### Task 1.4 — Migration 065, part d: the backfill

**File:** same migration

```sql
do $$
declare
  ward_row record;
  new_unit_id uuid;
begin
  for ward_row in select id, name from wards where unit_id is null loop
    insert into units (type, name) values ('ward', ward_row.name)
      returning id into new_unit_id;
    update wards set unit_id = new_unit_id where id = ward_row.id;
  end loop;
end $$;
```

**Details:** lossless and 1:1 — one `units` row of type `ward` per existing ward, **no parent**.
Stakes are created by a human afterwards, in `proto-d`. A row-by-row loop rather than a
`with … returning` join because ward names are not unique and a name join would mis-pair them.

#### Task 1.5 — Migration 065, part e: two definer helpers

**File:** same migration

```sql
create function is_super_admin()
  returns boolean language sql stable security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1 from unit_assignments ua
    join users u on u.id = ua.user_id
    where ua.user_id = auth.uid() and ua.role = 'super_admin' and u.is_active
  );
$$;

create function assigned_unit_ids()
  returns setof uuid language sql stable security definer
  set search_path = public, pg_temp
as $$
  select unit_id from unit_assignments
  where user_id = auth.uid() and unit_id is not null;
$$;
```

**Details:** `security definer` + a pinned `search_path` is **required, not stylistic** —
migration 019 Part 1 explains both reasons and this migration must restate them. Without definer,
a policy on `unit_assignments` that calls these re-enters itself: infinite recursion. Without the
pinned `search_path` a caller can prepend a schema and substitute their own table. `stable` lets
Postgres evaluate once per statement rather than once per row.

**`is_super_admin()` checks `users.is_active`.** A deactivated super admin is not a super admin.

#### Task 1.6 — Migration 065, part f: RLS and SELECT-only policies

**File:** same migration

```sql
alter table units            enable row level security;
alter table unit_assignments enable row level security;

create policy units_select on units
  for select to authenticated
  using (
    is_super_admin()
    or id in (select unit_id from wards where id = current_ward_id())
    or id in (select assigned_unit_ids())
  );

create policy unit_assignments_select on unit_assignments
  for select to authenticated
  using (is_super_admin() or user_id = auth.uid());
```

**Details:**
- **SELECT only. There are deliberately no INSERT / UPDATE / DELETE policies**, so RLS denies
  every write by default. Assignments and units are written through the **service-role client** in
  `proto-d`, the same shape [lib/auth/adminUsers.ts](../lib/auth/adminUsers.ts) already uses for
  role changes. Do not add write policies in this slice — there is no screen to exercise them, and
  an untested write policy is the most dangerous thing in this phase.
- A person may read **their own** assignments. That is what lets the switcher know whether to
  render at all, and it discloses nothing about anybody else.

#### Task 1.7 — The five new role values

**Files:** `supabase/migrations/065_unit_hierarchy.sql` (modify the CHECKs) **and**
`types/domain.ts` — in the same commit.

```sql
alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (
  role in ('bishop', 'counselor', 'ward_secretary', 'executive_secretary',
           'org_president', 'org_counselor', 'org_secretary',
           'music_coordinator', 'ward_council_member', 'sacrament_manager',
           'stake_president', 'stake_counselor', 'stake_secretary',
           'super_admin', 'resource_center_specialist')
);
```

Apply the identical change to the `invites.role` CHECK in the same migration — migration 002
defines the same list twice and they must not drift.

**Five, not the phase file's seven, and the arithmetic is worth recording.** The prototype's "4
stake roles" are `stake-president`, `stake-1st-counselor`, `stake-2nd-counselor`,
`stake-secretary` — but `users.counselor_position` already collapses the two counselors, exactly
as it does for the bishopric. So: 3 stake values + `super_admin` + `resource_center_specialist`.
`sacrament-ordinance-coordinator` is marked **verify** in
[module-map.md](prototype/module-map.md) §4 against the existing `sacrament_manager` and is
**deferred to P11**, which owns that module. Adding a role value nobody can assign is cheap;
adding the wrong one is a migration to undo.

In `types/domain.ts`:
- add all five to `ROLES` and to `ROLE_LABELS` ("Stake President", "Stake Counselor",
  "Stake Secretary", "Super Admin", "Resource Center Specialist");
- add `export const STAKE_ROLES = ["stake_president", "stake_counselor", "stake_secretary"] as const;`
- add `UNIT_TYPES` and `UNIT_ASSIGNMENT_ROLES` beside them.

⚠️ **`INVITABLE_ROLES` must be narrowed in the same edit or this slice is not invisible.** It is
currently `ROLES.filter(r => r !== "sacrament_manager")`, so all five new roles would appear in
the admin invite dropdown the moment they are added — a visible behaviour change in a slice whose
requirement is zero visible change. Narrow it to exclude `sacrament_manager`, `super_admin` and
the three stake roles; stake roles are assigned through `unit_assignments` in `proto-d`, not by a
ward's invite form.

#### Task 1.8 — Permission lists for the five new roles

**File:** `lib/auth/permissions.ts` (modify)

`RoleAccess` is `Record<Role, …>`, so Task 1.7 makes this file fail to compile until every new
role is named. That is the ITER-005 mechanism and it is the point.

```ts
// Read-only across the stake. A stake officer switched into a ward is there to SEE how the ward
// is doing, and every write in this app is somebody's stewardship. Widening this later is one
// list edit; narrowing it later is a security incident.
//
// Deliberately absent: tithing.* (CLAUDE.md rule 11 — a counting worksheet belongs to the ward
// that is counting, and nobody else has a reason to open it), knowledge.* and ai_settings.*
// (a ward's own corpus and its own drafting voice), admin.*, audit.view and sacrament.*.
const STAKE_OFFICER_PERMISSIONS: readonly KnownPermission[] = [
  "roster.view", "calendar.view", "talks.view", "topics.view",
  "program.view", "music.view", "visits.view", "goals.view",
  "youth_activities.view", "agendas.view", "notifications.view",
];

// Everything, exactly as BISHOPRIC_PERMISSIONS is everything. CLAUDE.md §7 says super admin
// "bypasses the access matrix"; granting the whole list IS that, through the one mechanism the
// app already has, rather than a second code path beside can(). One mechanism, not two.
const SUPER_ADMIN_PERMISSIONS: readonly KnownPermission[] = PERMISSIONS;

// Empty ON PURPOSE. WLT has no resource-centre module for this role to reach, and guessing a
// grant is how a role comes to hold a permission nobody chose. proto-d decides what it gets when
// somebody can say what it does.
const RESOURCE_CENTER_SPECIALIST_PERMISSIONS: readonly KnownPermission[] = [];
```

Wire all five into `ROLE_PERMISSIONS` (the three stake roles share
`STAKE_OFFICER_PERMISSIONS`, one constant rather than three identical literals — the
`BISHOPRIC_PERMISSIONS` precedent).

**Also — lock `super_admin` out of ward overrides.** In `mergeRoleAccess`, skip the
`super_admin` key with a `console.warn`, for the reason `NON_OVERRIDABLE_PERMISSIONS` exists: a
ward must not be able to disable the app-wide administrator who is there to help it. Add a test
asserting a `super_admin` delta is ignored.

#### Task 1.9 — Regenerate types, and fix the ward-less assertion

- Run `npm run db:push`, then `npm run db:types`. **`types/database.ts` is generated — never
  hand-edit it** (CLAUDE.md §5).
- `tests/rls/ward-isolation.test.ts`: update `it("has exactly two deliberately ward-less tables")`
  to expect `["hymns", "unit_assignments", "units", "wards"]` (sorted), rename it to say *four*,
  and extend the comment above it with one sentence per new table saying why it has no `ward_id`.
  **Do not weaken the assertion into a `toContain`** — an exact list is what makes the next
  ward-less table a deliberate act.

#### Task 1.10 — Seed fixtures learn about units

**File:** `tests/helpers/seed.ts` (modify)

- Create a `units` row per ward as the app will (`type: 'ward'`), plus **one `stake` unit that is
  the parent of both ward A's and ward B's units**. Set `wards.unit_id` on both.
- Expose `stakeUnitId`, `wardAUnitId`, `wardBUnitId` on `Fixtures`.
- Add three handles to `HANDLE_SPECS`: `stakePresident` (role `stake_president`, ward `A`),
  `superAdmin` (role `super_admin`, ward `A`), and `outsideStakePresident` (role
  `stake_president`, ward `A`, but assigned over a **second** stake that is parent to nothing).
  A `HandleSpec` gains an optional `unitAssignment` field; `seedFixtures` inserts the
  `unit_assignments` row after the user exists.
- Cleanup: `units` rows do **not** cascade from `wards` (the FK points the other way), so the
  existing `cleanup()` must delete the fixture's units explicitly, **after** the wards.

> A handle's `ward` is still their HOME ward — that is the whole point of the additive model. The
> stake president belongs to ward A and reaches ward B by switching.

---

### Slice `proto-c` — the switch and the RLS that guards it (migration 066). One commit.

**The dangerous one. Everything here can silently widen access.**

#### Task 2.1 — Migration 066, part a: the ancestor walk and the authorization test

**File:** `supabase/migrations/066_ward_switch.sql` (create)

```sql
create function unit_ancestor_ids(target_unit uuid)
  returns setof uuid language sql stable
as $$
  with recursive chain (id, parent_id, depth) as (
    select id, parent_id, 0 from units where id = target_unit
    union all
    select u.id, u.parent_id, c.depth + 1
      from units u join chain c on u.id = c.parent_id
     where c.depth < 10
  )
  select id from chain;
$$;

create function can_act_in_ward(target_user uuid, target_ward uuid)
  returns boolean language sql stable security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1 from users u
     where u.id = target_user and u.is_active and u.ward_id = target_ward
  ) or exists (
    select 1
      from unit_assignments ua
      join users u on u.id = ua.user_id
     where ua.user_id = target_user
       and u.is_active
       and (
         ua.role = 'super_admin'
         or ua.unit_id in (
           select unit_ancestor_ids((select unit_id from wards where id = target_ward))
         )
       )
  );
$$;
```

**Details:**
- **The `depth < 10` guard is not decoration.** `units.parent_id` is a self-reference with no
  constraint preventing a cycle, and an unguarded recursive CTE inside a policy helper is an
  infinite loop inside every query on the system. Ten is far above any real church structure.
- `unit_ancestor_ids` returns the unit **and** its ancestors, so a stake officer assigned over
  the stake matches a ward whose unit's parent is that stake, and an area officer would match
  through the stake — the generic shape working without an area screen existing.
- **Every arm requires `users.is_active`.** A deactivated officer loses the switch on their next
  request, which is the same place [session.ts](../lib/auth/session.ts) already enforces
  deactivation.
- The first arm — "this is already your own ward" — is what makes setting `active_ward_id` to
  your own ward a harmless no-op rather than a refusal.
- A ward with `unit_id is null` matches nothing. **Fail-closed, by construction.**

#### Task 2.2 — Migration 066, part b: rewrite the three functions, add one

**File:** same migration

```sql
create or replace function current_ward_id()
  returns uuid language sql stable security definer
  set search_path = public, pg_temp
as $$
  select case
           when u.active_ward_id is not null
                and can_act_in_ward(u.id, u.active_ward_id)
             then u.active_ward_id
           else u.ward_id
         end
    from users u where u.id = auth.uid();
$$;

create function acting_in_home_ward()
  returns boolean language sql stable security definer
  set search_path = public, pg_temp
as $$
  select coalesce(
    (select ward_id from users where id = auth.uid()) = current_ward_id(),
    false
  );
$$;

create or replace function current_org_id()
  returns uuid language sql stable security definer
  set search_path = public, pg_temp
as $$
  select case when acting_in_home_ward() then org_id else null end
    from users where id = auth.uid();
$$;

create or replace function is_bishopric()
  returns boolean language sql stable security definer
  set search_path = public, pg_temp
as $$
  select coalesce(current_user_role() in ('bishop', 'counselor'), false)
         and acting_in_home_ward();
$$;
```

**Details — read all of these:**

- **`current_ward_id()` re-validates on every read.** See Finding 3. Do not simplify it to a
  `coalesce`; that is the difference between "released on Sunday" and "still reading ward B in
  March".
- **`current_org_id()` is the subtle one** and the phase file is right about it. A stake president
  switched into a ward has no organization *in that ward*, and their own `org_id` points at a row
  in a different ward entirely. Returning it would make `household_stewardships`, `visit_goals`,
  `activity_logs` and `youth_activity_profiles` match rows they have no business seeing. **Null is
  the correct answer and the suite must assert it.**
- **Both `current_org_id()` and `is_bishopric()` key off `acting_in_home_ward()`, not off
  `active_ward_id is not null`.** That is one mechanism rather than two: if `current_ward_id()`
  falls back because authorization was revoked, the org and the bishopric flag fall back with it,
  automatically and in step. Writing `active_ward_id is not null` in three places is three chances
  for one to drift.
- `is_bishopric()` keeps its shape and its migration-019 comment: bishopric authority is shared
  and there is deliberately no function granting the bishop something a counselor lacks. The
  change is only that a bishop **acting away from home** is not a bishopric member there.
- **`current_user_role()` is deliberately NOT changed.** A stake president's role is
  `stake_president` in every ward; the role travels with the person, only the ward changes.

#### Task 2.3 — Migration 066, part c: let the switcher read their own row

**File:** same migration

```sql
drop policy users_ward_select on users;

-- `or id = auth.uid()` is LOAD-BEARING, not defensive. After a switch a visiting officer's own
-- users.ward_id is their HOME ward, so `ward_id = current_ward_id()` no longer matches their own
-- row — and lib/auth/session.ts reads exactly that row by id to resolve the session. Without this
-- arm the switch signs the switcher out.
create policy users_ward_select on users
  for select to authenticated
  using (ward_id = current_ward_id() or id = auth.uid());
```

#### Task 2.4 — Migration 066, part d: open the column, then guard it

**File:** same migration

```sql
grant update (active_ward_id) on users to authenticated;

drop policy users_update_self on users;

create policy users_update_self on users
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and (active_ward_id is null or can_act_in_ward(auth.uid(), active_ward_id))
  );
```

**Details:**
- Migration 022 Part 3's header names `theme_preference` as "the complete set of what an
  authenticated session updates today" and says a future page must widen the grant deliberately.
  **This is that deliberate widening** — say so in the header, and say that `first_name` /
  `last_name` are still NOT granted.
- `active_ward_id is null` is always allowed: **clearing the switch can never need authorization.**
  An officer who has been released must still be able to get back to their own ward.
- A refused switch **raises** (SQLSTATE 42501, "new row violates row-level security policy"),
  unlike almost every other refusal in this codebase. Task 2.9 handles it; the test must assert
  the raise *and* re-read the row.

#### Task 2.5 — Migration 066, part e: `session_context()`

**File:** same migration

```sql
create function session_context()
  returns table (
    ward_id uuid, home_ward_id uuid, active_ward_id uuid,
    org_id uuid, is_bishopric boolean, acting_in_home_ward boolean
  )
  language sql stable security definer
  set search_path = public, pg_temp
as $$
  select current_ward_id(), u.ward_id, u.active_ward_id,
         current_org_id(), is_bishopric(), acting_in_home_ward()
    from users u where u.id = auth.uid();
$$;
```

**Why this exists:** the application must not recompute the effective ward. If TypeScript does
`activeWardId ?? wardId` while the database re-validates and falls back, the app and RLS disagree
about which ward the user is in — the app renders ward B's page frame around ward A's rows, and
every audit row is filed under the wrong ward. **One round trip, one answer, both sides agree.**
`getSessionUser` is already wrapped in `cache()`, so this costs one query per request.

Verify `execute` reaches `authenticated` (function privileges default to `PUBLIC`, but confirm
the PostgREST `rpc` call actually works rather than assuming).

#### Task 2.6 — The session carries home, active and effective

**File:** `lib/auth/session.ts` (modify), `types/domain.ts` (modify)

`SessionUser` gains:

```ts
homeWardId: string;          // users.ward_id — the ward they belong to
activeWardId: string | null; // the raw column; null means "not switched"
isVisitingWard: boolean;     // wardId !== homeWardId
```

**`wardId` KEEPS ITS NAME AND BECOMES THE EFFECTIVE WARD.** This is the single most important
decision in the slice and it is what makes the phase cheap: every one of the ~200 existing
`user.wardId` reads — `resolveRoleAccess(supabase, user.wardId)`, `writeAuditLog({ wardId })`,
every query filter — keeps compiling and starts meaning the switched ward, which is exactly what
`current_ward_id()` now returns. Renaming it would touch every route in the app to achieve the
same thing.

In `resolveSessionUser`, after the existing `users` read succeeds, call
`supabase.rpc("session_context")` and take `ward_id` from it. Treat an RPC error the way the
existing `users` read error is treated: **throw with context, never fall back to `data.ward_id`**
— a silent fall back is the app and RLS disagreeing, which is the one failure this design exists
to prevent (CLAUDE.md rule 7).

#### Task 2.7 — `lib/units/queries.ts`

**File:** `lib/units/queries.ts` (create)

Follow the shape of [lib/ward/crossOrgVisibility.ts](../lib/ward/crossOrgVisibility.ts) — small,
named exports, snake_case→camelCase mapped once here.

- `readUnit(unitId, client)` / `readWardUnit(wardId, client)`
- `listUnitAssignments(userId, client)` — a person's own assignments.
- `listSwitchableWards(client)` — the wards this session may act in. Resolve it by reading the
  caller's assignments, walking `units` down to `type = 'ward'`, and joining `wards`. Return
  `[]` for somebody with no assignment.

> **`listSwitchableWards()` must return `[]`, never the user's own ward alone, for a person with
> no assignment.** The control renders only when the list is non-empty, and *"anyone who belongs
> to exactly one ward never sees the control at all"* is a stated requirement of the phase.

#### Task 2.8 — `lib/validation/wardSwitch.ts`

**File:** `lib/validation/wardSwitch.ts` (create)

```ts
import { z } from "zod";

// No userId — the target is the session, never something the body may assert
// (conventions.md §Validation). `null` clears the switch and returns the caller to their
// own ward, which is always permitted.
export const wardSwitchSchema = z.object({
  activeWardId: z.uuid("Choose a ward from the list.").nullable(),
});
export type WardSwitchInput = z.infer<typeof wardSwitchSchema>;
```

#### Task 2.9 — `lib/units/wardSwitch.ts`

**File:** `lib/units/wardSwitch.ts` (create)

`switchActiveWard(activeWardId, client)` writes `users.active_ward_id` for `auth.uid()`.

**It must map SQLSTATE 42501 onto a typed refusal**, modelled on
[lib/youth/policyRefusal.ts](../lib/youth/policyRefusal.ts):

```ts
// A failed WITH CHECK RAISES where a failed USING returns zero rows, and every other write path
// in this codebase was built for the quiet one (defect 060-D2). Without this mapping an
// unauthorized switch surfaces as a 500 reading "Please try again", which is untrue — the answer
// is "not yours", and it will never become true by trying again.
//
// NARROW ON PURPOSE: 42501 only. "The policy said no" and "the database is broken" must never
// become one message (CLAUDE.md rule 7).
```

Return `null` on refusal; the route turns that into a 403 with a sentence.

#### Task 2.10 — `app/api/session/active-ward/route.ts`

**File:** `app/api/session/active-ward/route.ts` (create)

Copy the structure of
[app/api/ward-settings/cross-org-visibility/route.ts](../app/api/ward-settings/cross-org-visibility/route.ts)
exactly — same guard order, same `respondToRouteError` shape, session resolved **outside** the
`try` block (`requireSessionUser()` redirects by throwing, and catching that turns a redirect
into a 500).

- `GET` → `{ wards: […], activeWardId, homeWardId }` from `listSwitchableWards()`.
- `PATCH` → validate with `wardSwitchSchema`, call `switchActiveWard()`, 403 on a `null` return.

**No `assertCan()` here, and that is deliberate — write the reason in the file.** There is no
`units.*` permission and there must not be one: the authority to switch is a *unit assignment*,
not a ward-configurable permission. Putting it in `PERMISSIONS` would let
`wards.settings.role_access` widen it, which means a ward could grant itself the right to read
another ward. **RLS is the only boundary here** (rule 2), and the route's job is to turn its
refusal into a sentence.

**Audit both directions** (CLAUDE.md rule 6). File the row under the ward the session is now
acting in, with `detail` naming both ends:

```ts
await writeAuditLog({
  wardId: resultingWardId,
  userId: user.id,
  action: activeWardId ? "active_ward_switched" : "active_ward_cleared",
  module: "units",
  detail: { fromWardId: user.wardId, toWardId: resultingWardId },
}, supabase);
```

#### Task 2.11 — The last-super-admin guard

**File:** `lib/auth/adminUsers.ts` (modify)

Mirror the existing last-bishop guard (same file, ~line 263) in shape and message:

```
"This is the only active super admin. Assign another before changing this account."
```

**It must count across the whole app, not within a ward** — `super_admin` is the one role that is
not ward-scoped, so the count is `unit_assignments where role = 'super_admin'` joined to active
users, with **no ward filter**. Copying the bishop guard's `.eq("ward_id", …)` would make the
guard trivially bypassable by deactivating from another ward.

Trigger it when the change would deactivate the account, or would remove the assignment.

**Friction on assignment.** `super_admin` bypasses the access matrix entirely, so it must not be
a value in the ordinary role dropdown: keep it out of `INVITABLE_ROLES` (Task 1.7) and out of
`updateUserSchema`'s `role` enum in `lib/validation/adminUser.ts` by filtering it from `ROLES`
there. Assignment gets its own explicit path in `proto-d`. Note in the file that the *friction
UI* is `proto-d`'s; what this slice guarantees is that the ordinary path cannot reach it.

---

## Testing Strategy

Priority follows CLAUDE.md §8: RLS first, then permission helpers, then routes.

### `tests/rls/unit-switching.test.ts` (create) — the phase's highest-value suite

Seed `["bishop", "eqPresident", "wardBBishop", "wardBEqPresident", "stakePresident",
"outsideStakePresident", "superAdmin"]`. **Every case re-reads with the service client** — an
RLS-denied UPDATE is a zero-row success, and here a WITH CHECK failure is a raise, so asserting
"an error came back" can pass for the wrong reason.

- an ordinary ward member (`eqPresident`) **cannot** set `active_ward_id` at all → error, and the
  column is still null on re-read
- `stakePresident` **can** switch to ward B (both wards sit under the seeded stake)
- `outsideStakePresident` **cannot** switch to ward B → refused, column unchanged
- `superAdmin` **can** switch to ward B
- setting `active_ward_id` to one's **own** ward succeeds (no-op)
- **clearing to null always succeeds**, including after the assignment is deleted
- after an authorized switch, `stakePresident` **reads** ward B's households, visit logs and
  youth events
- after the switch, `stakePresident` **still reads their own `users` row** — the Finding-1
  regression, asserted directly, because its real symptom is a redirect to `/login` that no
  query-level test would otherwise notice
- after the switch, **writes are refused** wherever the policy needs an org or the bishopric:
  attempt a `visit_goals` insert, a `household_stewardships` insert and a `wards` update; re-read
  each
- `select current_org_id()` returns **null** across the switch
- `select is_bishopric()` returns **false** for the visiting officer
- **revocation is immediate**: with `active_ward_id` still pointing at ward B, delete the
  `unit_assignments` row with the service client, then assert `current_ward_id()` returns ward A
  and ward B's rows are gone
- **PRIVATE NOTES NEVER WIDEN.** Seed a `visit_private_notes` row and an `activity_private_notes`
  row authored by a ward B user; assert the switched-in `stakePresident` reads **zero** of each.
  *This is the assertion that proves the phase did not break the promise the whole app rests on*
  (CLAUDE.md rule 5).

### `tests/rls/unit-assignments.test.ts` (create)

- a user reads their **own** assignments and **not** another user's
- `superAdmin` reads every assignment
- an authenticated user **cannot insert, update or delete** any `unit_assignments` row — there are
  no write policies, so all three are refused; re-read to confirm
- `units`: a ward member reads their own ward's unit and **not** an unrelated stake's
- the `nulls not distinct` unique index: a second `super_admin` row for the same user is
  **refused**. Prove it by attempting the insert.
- the `unit_assignments_scope` CHECK: a `super_admin` row **with** a `unit_id`, and a
  `stake_president` row **without** one, are both refused.

### `tests/lib/unitAncestors.test.ts` (create)

Exercise `unit_ancestor_ids` through the service client: a three-level chain returns all three; a
ward with a null `unit_id` resolves to nothing; **a deliberately cyclic pair terminates** rather
than hanging (the depth guard). Clean up the cyclic rows in `afterAll` — `parent_id` is
`on delete restrict`, so break the cycle with an `update … set parent_id = null` first.

### `tests/routes/session-active-ward.test.ts` (create)

Use [tests/helpers/routeClient.ts](../tests/helpers/routeClient.ts) — read its header comment
first for the `vi.mock` hoisting trap. A route test needs no server.

- `GET` as `eqPresident` → `wards: []`
- `GET` as `stakePresident` → ward B present
- `PATCH` as `stakePresident` to ward B → 200, and the column really changed on a service re-read
- `PATCH` as `eqPresident` → **403 with a sentence**, not a 500 — the Task 2.9 mapping
- `PATCH` with `{ activeWardId: null }` → 200 always
- an audit row is written for both directions

### Modify

- `tests/rls/users-column-grant.test.ts` — add: an ordinary member's `active_ward_id` write is
  refused, and `first_name` is **still** refused (proving the grant was widened by exactly one
  column).
- `tests/lib/permissions.test.ts` — the five new roles resolve; `super_admin` holds everything;
  the stake roles hold no `*.manage`, no `tithing.*` and no `admin.*`; a `super_admin` entry in
  `role_access` is ignored. Add an assertion that `ROLES` and the `users.role` CHECK match, by
  reading the migration from disk the way `notification-triggers-seed.test.ts` does.
- `tests/rls/ward-isolation.test.ts` — Task 1.9.
- `tests/lib/navigation.test.ts` — whatever the new roles change.

---

## Test Scenarios (Harness)

### Scenario 064: Switching into another ward

**Folder:** `testing/scenarios/auth/scenario-064-switching-into-another-ward/`
**Tags:** `auth`, `admin`, `full`
**Purpose:** A stake with two real wards, a stake president over both, and live data in the ward
they do not belong to. Seeding is the whole value — there is no UI anywhere for creating a stake
or an assignment until `proto-d`, so this state cannot be reached by hand at all.

**Seed data summary:**
- `units` — 3 — one `stake`, two `ward` children; ward units linked from `wards.unit_id`
- `wards` — 2 — "Harness Test Ward" and "Harness Second Ward"
- `users` — 4 — a stake president (home: ward 1), a bishop in each ward, an EQ president in ward 1
- `unit_assignments` — 1 — the stake president over the stake
- ward 2 data: 4 households, 8 members, 2 visit logs (one carrying a **private note** authored by
  ward 2's bishop), 1 youth activity profile with 2 events

**Tester action:** sign in as the stake president, switch to ward 2, read the visits and youth
pages, attempt a write, open the visit carrying the private note, then switch back.

**Verification checklist:**
- [ ] Before switching, the page frame names ward 1 and ward 1's data is on screen
- [ ] The ward control offers ward 2 and **only** ward 2 and ward 1
- [ ] After switching, the frame names ward 2 and ward 2's households are listed
- [ ] The private note written by ward 2's bishop is **not visible** in any form
- [ ] No control that writes an org-scoped record is offered; if one is reachable by URL it
      refuses with a sentence rather than a 500
- [ ] Switching back restores ward 1 exactly, with nothing from ward 2 left on screen
- [ ] The audit log (via the service client) holds one row per switch, filed under the ward
      being entered
- [ ] Signing in as ward 1's EQ president shows **no ward control anywhere on any page**

### Scenario 065: The ward that never sees the switch

**Folder:** `testing/scenarios/auth/scenario-065-the-ward-that-never-sees-the-switch/`
**Tags:** `auth`, `smoke`
**Purpose:** The zero-behaviour-change guarantee, walkable. A single ward with no stake above it —
exactly the state every existing ward is in after migration 065 backfills. Proves the phase is
invisible to everybody who belongs to one ward.

**Seed data summary:**
- `units` — 1 — one `ward` unit, **no parent** (what the backfill produces)
- `wards` — 1 · `users` — 4 — bishop, EQ president, ward council member, music coordinator
- ordinary roster, calendar and visit data

**Tester action:** sign in as each of the four and walk the dashboard, roster, calendar, visits
and youth pages.

**Verification checklist:**
- [ ] No ward control, ward name badge or "you are visiting" affordance appears for any of them
- [ ] Every page renders exactly as it did before migration 065
- [ ] `GET /api/session/active-ward` returns an empty ward list for all four
- [ ] Nothing in the UI mentions a stake, a unit or a unit number

---

## Validation Commands

Run in this order. **Slice `proto-b` must go green on its own before `proto-c` starts.**

```bash
# 1. Apply the migration to the LINKED HOSTED project, then regenerate types.
#    There is no local database (CLAUDE.md §9). NEVER run `npm run db:reset` — it wipes
#    the shared hosted project.
npm run db:push
npm run db:types

# 2. Linting
npm run lint

# 3. Type checking
npm run typecheck

# 4. Tests — the full suite, because the proof that the 131 policies did not move is that
#    every pre-existing RLS suite is still green.
npm run test

# 5. Production build. Lint, typecheck and tests can all pass while this fails: a constant
#    imported by a "use client" component out of a server-only module pulls next/headers into
#    the browser bundle, which only the build catches (youth-b, youth-c).
npm run build
```

Targeted reruns while iterating:

```bash
npx vitest run tests/rls/unit-switching.test.ts
npx vitest run tests/rls/ward-isolation.test.ts tests/rls/users-column-grant.test.ts
npx vitest run tests/db/migrations.test.ts tests/db/rls-enabled.test.ts
npx vitest run tests/lib/explicitTimeZone.test.ts
```

---

## Integration Notes

### Deploy order — and why there is no `HELD_BACK_UNTIL_DEPLOYED` entry

**Both migrations are additive and apply immediately.** 065 only creates tables, adds nullable
columns and widens two CHECK constraints — widening a CHECK cannot fail on an existing row. 066
replaces function bodies and two policies; the replaced `current_ward_id()` returns the old answer
for every user, because no user has an `active_ward_id` yet.

So **neither migration gets an entry in `HELD_BACK_UNTIL_DEPLOYED`** in
[tests/db/migrations.test.ts](../tests/db/migrations.test.ts). That list is for the *contract* half
of an expand-and-contract pair, and an unnecessary entry **hides a real migration** from the
assertion that everything on disk has been applied — which is exactly the failure mode its own
header warns about. Do not add one.

### Breaking changes

- **`SessionUser.wardId` changes meaning** from "the ward I belong to" to "the ward I am acting
  in". Identical for every existing user (nobody has an `active_ward_id`), and it is what makes
  the ~200 downstream call sites correct without edits. Anything that genuinely wants the home
  ward must now say `homeWardId` — at the time of writing, nothing does. Grep for `wardId` in
  `lib/auth/` and `app/api/admin/` before assuming that holds.
- **`INVITABLE_ROLES` shrinks relative to `ROLES`** for the first time by more than one entry.
  Any code assuming `INVITABLE_ROLES.length === ROLES.length - 1` breaks; grep before assuming
  there is none.
- **The `users` UPDATE grant widens by one column.** `first_name` / `last_name` are still not
  granted; a future profile page still has to widen it deliberately.

### Documentation to update in the same commits

- `CLAUDE.md` §4 rule 1 — record `units` and `unit_assignments` as the third and fourth
  documented ward-less tables, with the one-line reason. Rule 1 currently names `hymns` as "the
  sole exception" and that sentence becomes false the moment 065 applies.
- `CLAUDE.md` §7 — the five role values that actually landed, and the note that the prototype's
  "7 new" is 5 here because `counselor_position` collapses the two stake counselors and the
  sacrament coordinator is deferred to P11.
- `plans/P2-unit-hierarchy.md` — mark `proto-b` and `proto-c` done, and **correct the three
  findings in the file itself**, so the next reader is not misled by the plain `coalesce`.
- `plans/retros/INDEX.md` — `/execute` writes the retro entries.

### Deliberately out of scope

- **Slice `proto-d` entirely** — super admin screens, the Stakes & Wards screen, the
  request → approve flow, the app-wide grant mechanism and the access-matrix port. Its own plan.
- **The switcher CONTROL.** The mechanism lands here so it can be tested before it is visible; the
  control is a **P3 chrome** component. `GET /api/session/active-ward` is what P3 will call.
- **Area and district screens.** The data shape only.
- **The Young Men omission** in the prototype's role list ([module-map.md](prototype/module-map.md)
  §4) — it does not affect this plan, because org presidencies are already reachable as
  `org_president` + `org_id` and `organizations.type` already has `young_men`. It must be
  confirmed with the user before `proto-d` treats the access matrix as authoritative.
- **The two corrupted access-matrix entries** (`stake-president.access.zoom`,
  `music-coordinator.access.music`, both holding a pasted build note where a level belongs) —
  `proto-d`'s input, not this plan's.
- **Moving every calling into `unit_assignments`** — see §Decisions.
- **`members.mrn` having a reader.** The column ships unused, on purpose.
- **Real LCR integration**, and the roster-boundary refactor decisions.md §5 asks for. It is
  genuinely cheap to draw during `proto-d`'s admin work and expensive to draw here, where no
  roster code is being touched.
