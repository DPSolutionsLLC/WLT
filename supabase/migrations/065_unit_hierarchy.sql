-- Phase 2 slice proto-b, migration 065: STAKES ABOVE WARDS, AND A SUPER ADMIN ABOVE BOTH.
--
-- APPLIES IMMEDIATELY, AND ITS WHOLE REQUIREMENT IS THAT NOTHING CHANGES. Every statement here
-- is additive: two new tables, three nullable columns, a lossless 1:1 backfill, two new helper
-- functions, and two CHECK constraints WIDENED. A widened CHECK cannot fail on an existing row,
-- and nothing in app/ or components/ reads a new column. The app is walked after this and looks
-- identical.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts for 065, and
-- none should be added. That allowlist is for the CONTRACT half of an expand-and-contract pair,
-- and an unnecessary entry HIDES a real migration from the assertion that everything on disk has
-- been applied — which is the failure mode its own header warns about.
--
-- The mechanism this slice exists to make possible is NOT cross-ward policies. It is an
-- authorized WARD SWITCH (migration 066): after the switch, every policy that already says
-- `ward_id = current_ward_id()` is correct for the ward the officer is now in. That is why the
-- risk of this phase concentrates into four helper functions and one guarded column instead of
-- spreading across all 131 policies.
--
-- Structure:
--   065a  units
--   065b  unit_assignments
--   065c  wards.unit_id, users.active_ward_id, members.mrn
--   065d  the 1:1 ward backfill
--   065e  two definer helpers
--   065f  RLS and SELECT-only policies
--   065g  the five new role values, on BOTH role CHECKs


-- ============================================================================
-- 065a — units
-- ============================================================================
--
-- THE THIRD DOCUMENTED EXCEPTION TO CLAUDE.md RULE 1 ("every table has ward_id").
-- A UNIT IS NOT INSIDE A WARD. A ward IS a unit, and a stake sits ABOVE wards — so a `ward_id`
-- column here would be a lie no policy could use, and the only honest value for a stake row
-- would be null, which rule 1 exists to forbid. tests/rls/ward-isolation.test.ts asserts the
-- EXACT list of ward-less tables, so this exception is a deliberate act recorded in two places
-- rather than a table that quietly joined a skip list and went untested for ever.
--
-- `type` covers area | stake | ward because real church structure also has missions and
-- districts as stake-equivalents, and how far up this goes is genuinely uncertain — which is
-- itself the reason not to hardcode two levels. BUILD NO AREA OR DISTRICT SCREENS. The shape
-- anticipates them; nothing else does.

create table units (
  id          uuid primary key default gen_random_uuid(),
  type        text not null check (type in ('area', 'stake', 'ward')),
  -- `on delete restrict`, not cascade. Deleting a stake with wards under it must fail LOUDLY
  -- rather than silently orphaning or destroying them.
  parent_id   uuid references units (id) on delete restrict,
  -- The REAL church-assigned unit number, never an app-invented id. Nullable until a human
  -- knows it.
  unit_number text,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Unique ONLY WHERE PRESENT — hence a partial index rather than a plain unique constraint, which
-- would still permit exactly one null and therefore say something nobody meant.
create unique index units_unit_number_key
  on units (unit_number)
  where unit_number is not null;

create index units_parent_id_idx on units (parent_id);

comment on table units is
  'Area / stake / ward. Deliberately ward-less: a unit is not inside a ward (CLAUDE.md rule 1, third documented exception).';


-- ============================================================================
-- 065b — unit_assignments
-- ============================================================================
--
-- THE FOURTH DOCUMENTED EXCEPTION TO CLAUDE.md RULE 1. A STAKE ASSIGNMENT HAS NO WARD — that is
-- the entire point of it. A `ward_id` here would have to name one of the wards under the stake,
-- arbitrarily, and every policy reading it would be wrong for all the others.
--
-- ROLES STAY REUSABLE TEMPLATES (CLAUDE.md §7). This row says "this person holds this stake role
-- over this unit"; it does not duplicate a role per unit. `users` stays the person's HOME row —
-- ward_id, role and org_id do not move — which is what lets current_*() and the session keep
-- reading it, and is why the 131 policies genuinely do not move.
--
-- Moving EVERY calling into this table is the eventual shape and is explicitly NOT this phase.
-- Revisit only when a real ward needs one person holding callings in two wards at once.

create table unit_assignments (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references users (id) on delete cascade,
  -- NULL MEANS EVERY UNIT. The same absent-means-default idiom as household_stewardships (052),
  -- household_visit_cadences (050), 054a's org_id, 059b's occasion_id and 060a's closed_at.
  -- THERE IS NO SENTINEL "ROOT" UNIT AND NONE SHOULD BE INVENTED.
  unit_id            uuid references units (id) on delete cascade,
  role               text not null check (
                       role in ('stake_president', 'stake_counselor',
                                'stake_secretary', 'super_admin')
                     ),
  -- Collapses stake 1st and 2nd counselor exactly as it already does for the bishopric, which is
  -- why the prototype's "4 stake roles" are 3 role values here.
  counselor_position integer check (counselor_position in (1, 2)),
  -- NULLABLE, AND IT MUST NEVER APPEAR IN A POLICY PREDICATE. That is the `talks-d` hole, found
  -- four times in this repo already: a null author column makes a predicate NULL rather than
  -- false, and the row becomes invisible to the very person who created it.
  created_by         uuid references users (id) on delete set null,
  created_at         timestamptz not null default now(),

  -- Makes "a super admin scoped to one stake" and "a stake president over nothing" both
  -- UNREPRESENTABLE. A constraint and not a comment, for the same reason 061's was: nobody can
  -- act on a state the schema should have refused in the first place.
  constraint unit_assignments_scope check (
    (role =  'super_admin' and unit_id is null) or
    (role <> 'super_admin' and unit_id is not null)
  )
);

-- `nulls not distinct` IS LOAD-BEARING, and this is migration 055's lesson verbatim: without it
-- two super_admin rows for the same person would NOT conflict, because null <> null. Proved by
-- attempting the duplicate insert in tests/rls/unit-assignments.test.ts rather than assumed.
create unique index unit_assignments_unique
  on unit_assignments (user_id, unit_id, role) nulls not distinct;

create index unit_assignments_user_id_idx on unit_assignments (user_id);
create index unit_assignments_unit_id_idx on unit_assignments (unit_id);

comment on table unit_assignments is
  'A stake role held over a unit, or super_admin over everything (unit_id null). Deliberately ward-less: a stake assignment has no ward (CLAUDE.md rule 1, fourth documented exception).';


-- ============================================================================
-- 065c — the three added columns
-- ============================================================================

-- STAYS NULLABLE, DELIBERATELY. tests/helpers/seed.ts inserts `wards` rows directly, so `not
-- null` would break every RLS suite on the day it applied. It is also FAIL-CLOSED:
-- can_act_in_ward() (066) walks wards.unit_id → units.parent_id, so a ward with no unit simply
-- cannot be switched into. It becomes `not null` in proto-d, once ward creation goes through the
-- Stakes & Wards screen.
alter table wards   add column unit_id        uuid references units (id) on delete restrict;

-- `on delete set null`: deleting a ward must not delete the visiting officer's ACCOUNT.
alter table users   add column active_ward_id uuid references wards (id) on delete set null;

-- Membership record number. NULLABLE AND UNUSED THIS PHASE — NOTHING READS IT, and it must not
-- be added to the roster UI. It is here because it belongs to the same identity shape this
-- migration is drawing, and adding a column later is a second migration for no reason.
alter table members add column mrn            text;

create index wards_unit_id_idx on wards (unit_id);


-- ============================================================================
-- 065d — the backfill
-- ============================================================================
--
-- LOSSLESS AND 1:1 — one `units` row of type 'ward' per existing ward, WITH NO PARENT. Stakes are
-- created by a human afterwards, in proto-d. This is exactly the state every existing ward is in
-- the moment this migration applies, and scenario 065 walks it.
--
-- A row-by-row loop rather than a `with … returning` join because WARD NAMES ARE NOT UNIQUE and a
-- name join would mis-pair them.

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


-- ============================================================================
-- 065e — two definer helpers
-- ============================================================================
--
-- SECURITY DEFINER is required, not stylistic, and migration 019 Part 1 gives both reasons this
-- file must restate. Without definer, a policy on `unit_assignments` that calls these re-enters
-- itself: infinite recursion. Without the pinned search_path a caller can prepend a schema and
-- substitute their own table — a privilege-escalation vector. STABLE lets Postgres evaluate once
-- per statement rather than once per row, which matters because a policy below calls both.

-- CHECKS users.is_active. A DEACTIVATED SUPER ADMIN IS NOT A SUPER ADMIN — the same rule
-- lib/auth/session.ts already enforces on the next request, enforced again where RLS can see it.
create function is_super_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from unit_assignments ua
    join users u on u.id = ua.user_id
    where ua.user_id = auth.uid()
      and ua.role = 'super_admin'
      and u.is_active
  );
$$;

create function assigned_unit_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select unit_id
  from unit_assignments
  where user_id = auth.uid()
    and unit_id is not null;
$$;


-- ============================================================================
-- 065f — RLS and SELECT-only policies
-- ============================================================================
--
-- SELECT ONLY. THERE ARE DELIBERATELY NO INSERT / UPDATE / DELETE POLICIES, so RLS denies every
-- write by default. Assignments and units are written through the SERVICE-ROLE client in proto-d,
-- the same shape lib/auth/adminUsers.ts already uses for role changes. Do not add write policies
-- in this slice: there is no screen to exercise them, and an untested write policy is the most
-- dangerous thing in this phase.
--
-- Migration 019 Part 4's `alter default privileges` already grants select/insert/update/delete on
-- future tables to `authenticated`, so these two tables are reachable through PostgREST; RLS,
-- not the grant, is what refuses the writes.

alter table units            enable row level security;
alter table unit_assignments enable row level security;

create policy units_select on units
  for select to authenticated
  using (
    is_super_admin()
    or id in (select unit_id from wards where id = current_ward_id())
    or id in (select assigned_unit_ids())
  );

-- A person may read THEIR OWN assignments. That is what lets the switcher know whether to render
-- at all, and it discloses nothing whatever about anybody else.
create policy unit_assignments_select on unit_assignments
  for select to authenticated
  using (is_super_admin() or user_id = auth.uid());


-- ============================================================================
-- 065g — the five new role values, on BOTH role CHECKs
-- ============================================================================
--
-- Migration 002 defines the same list TWICE — users.role and invites.role — and its own comment
-- warns that the CHECK must stay in step with ROLES in types/domain.ts. That is the
-- `notification-trigger-drift` shape exactly: one list, three copies, all free to disagree. Both
-- CHECKs are widened here, and in the SAME COMMIT as the types/domain.ts edit;
-- tests/lib/permissions.test.ts reads this file from disk and asserts the two lists match, the
-- way tests/db/notification-triggers-seed.test.ts does for the trigger keys.
--
-- FIVE, NOT THE PHASE FILE'S SEVEN, and the arithmetic is worth recording. The prototype names 4
-- stake roles — stake-president, stake-1st-counselor, stake-2nd-counselor, stake-secretary — but
-- users.counselor_position already collapses the two counselors, exactly as it does for the
-- bishopric. So: 3 stake values + super_admin + resource_center_specialist.
-- `sacrament-ordinance-coordinator` is marked VERIFY in plans/prototype/module-map.md §4 against
-- the existing sacrament_manager and is DEFERRED TO P11, which owns that module. Adding a role
-- value nobody can assign is cheap; adding the wrong one is a migration to undo.
--
-- WIDENING a CHECK cannot fail on an existing row, which is why this is safe to apply before any
-- code deploys.

alter table users drop constraint users_role_check;
alter table users add constraint users_role_check check (
  role in ('bishop', 'counselor', 'ward_secretary', 'executive_secretary',
           'org_president', 'org_counselor', 'org_secretary',
           'music_coordinator', 'ward_council_member', 'sacrament_manager',
           'stake_president', 'stake_counselor', 'stake_secretary',
           'super_admin', 'resource_center_specialist')
);

alter table invites drop constraint invites_role_check;
alter table invites add constraint invites_role_check check (
  role in ('bishop', 'counselor', 'ward_secretary', 'executive_secretary',
           'org_president', 'org_counselor', 'org_secretary',
           'music_coordinator', 'ward_council_member', 'sacrament_manager',
           'stake_president', 'stake_counselor', 'stake_secretary',
           'super_admin', 'resource_center_specialist')
);
