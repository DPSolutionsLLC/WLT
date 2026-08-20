-- Phase 3C, migration 024: rotation cadence, organization rotations, and the per-Sunday
-- organization conductor.
--
--   Part 1  conducting_rotation.cadence
--   Part 2  conducting_rotation.org_id
--   Part 3  the unique constraint, widened to include org_id
--   Part 4  sunday_org_conducting
--   Part 5  RLS on sunday_org_conducting
--   Part 6  real RLS on conducting_rotation, replacing migration 019's ward-wide grant
--
-- 03-calendar.md Step 3 describes a rotation that advances one step per SUNDAY. That is one of
-- two cadences a ward may run, not the only one: this ward hands the bishopric over month by
-- month, one member taking every Sunday in a month. The spec was written from the weekly case
-- and no test could have caught it, because the code matched the spec exactly.


-- ============================================================================
-- Part 1 — cadence
-- ============================================================================
--
-- 'weekly' is the default so every existing row keeps behaving exactly as it does today. A
-- rotation is a SET of three rows sharing an effective_from, written in one insert, and the
-- three rows of one set must agree on cadence. The schema cannot express that constraint — a
-- CHECK cannot see sibling rows — so lib/calendar/queries.ts is what guarantees it:
-- replaceConductingRotation() writes all three together and nothing exposes a per-row cadence
-- write.
--
-- Cadence lives on the row rather than in a header table precisely so that CHANGING the cadence
-- is INSERTING a new set. "A cadence change applies forward only" is then true by construction,
-- exactly as reordering already is, with no second mechanism to keep in step.

alter table conducting_rotation
  add column cadence text not null default 'weekly'
    check (cadence in ('weekly', 'monthly'));

comment on column conducting_rotation.cadence is
  'weekly = a different person each Sunday; monthly = one person for the whole month. The three rows of one rotation set must agree - lib/calendar/queries.ts writes all three together, because no CHECK constraint can see sibling rows.';


-- ============================================================================
-- Part 2 — organization
-- ============================================================================
--
-- NULL means the bishopric's sacrament-meeting rotation. One table, one resolver, one set of
-- rules — an organization presidency conducting its own Sunday meeting is the same machinery,
-- not a parallel one.
--
-- The composite foreign key, rather than a plain reference to organizations (id), is how the
-- ward scope is enforced structurally: a rotation cannot point at an organization in another
-- ward however the row was written.

alter table conducting_rotation
  add column org_id uuid,
  add constraint conducting_rotation_org_fkey
    foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade;

comment on column conducting_rotation.org_id is
  'NULL is the bishopric rotation for sacrament meeting. A uuid is that organization''s own rotation for its own Sunday meeting.';


-- ============================================================================
-- Part 3 — the unique constraint
-- ============================================================================
--
-- Migration 023's constraint is (ward_id, position, effective_from), which would let an Elders
-- Quorum rotation and the bishopric rotation collide on a date they have no business sharing.
--
-- NULLS NOT DISTINCT is required, not stylistic. A plain UNIQUE treats every NULL as distinct,
-- so (ward, NULL, 1, 2026-06-01) would happily land twice and the ward would hold two bishopric
-- rotations on the same date with nothing to say which one wins. Postgres 15+; this project
-- runs 17.6.

alter table conducting_rotation
  drop constraint conducting_rotation_ward_position_effective_key,
  add constraint conducting_rotation_ward_org_position_effective_key
    unique nulls not distinct (ward_id, org_id, position, effective_from);


-- ============================================================================
-- Part 4 — sunday_org_conducting
-- ============================================================================
--
-- Who conducts an organization's meeting on one Sunday, STORED rather than computed at read
-- time. The same rule 03-calendar.md Step 3 imposes on sacrament conducting, for the same
-- reason: a computed value silently rewrites history the moment the rotation changes.
--
-- There is deliberately NO is_override flag. Storage IS the override — editing the row is the
-- override, precisely as editing sundays.conducting_user_id is for the sacrament meeting. A
-- flag would be a second source of truth about the same fact.
--
-- user_id is nullable because "nobody assigned yet" is a real state, and it is what an unfilled
-- rotation position resolves to.
--
-- The composite foreign keys are how the ward scope is enforced structurally: a row cannot
-- point at a Sunday in one ward and an organization in another.

create table sunday_org_conducting (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  sunday_id  uuid not null,
  org_id     uuid not null,
  user_id    uuid,
  created_at timestamptz not null default now(),
  unique (ward_id, sunday_id, org_id),
  foreign key (sunday_id, ward_id) references sundays (id, ward_id) on delete cascade,
  foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade,
  foreign key (user_id, ward_id) references users (id, ward_id)
);

comment on table sunday_org_conducting is
  'Who conducts one organization''s meeting on one Sunday. Stored, never computed - and the row itself is the override, which is why there is no is_override flag.';

create index sunday_org_conducting_ward_sunday_idx
  on sunday_org_conducting (ward_id, sunday_id);


-- ============================================================================
-- Part 5 — RLS on sunday_org_conducting
-- ============================================================================
--
-- Real policies from birth: write the policy first, then the route (CLAUDE.md rule 2).
--
-- Read is ward-wide — who conducts is not sensitive, and the Sunday detail page lists every
-- organization's conductor to everyone who may see the calendar. Write is the bishopric OR the
-- caller's own organization, and nobody else's.
--
-- Written out longhand rather than in a loop. The loop in migration 019 exists because
-- twenty-four IDENTICAL blocks drift; four different ones do not, and a reader of a security
-- boundary should be able to see the predicate without mentally expanding a format() call.

alter table sunday_org_conducting enable row level security;

create policy sunday_org_conducting_ward_select on sunday_org_conducting
  for select to authenticated
  using (ward_id = current_ward_id());

create policy sunday_org_conducting_scoped_insert on sunday_org_conducting
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id = current_org_id())
  );

create policy sunday_org_conducting_scoped_update on sunday_org_conducting
  for update to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id = current_org_id())
  )
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id = current_org_id())
  );

create policy sunday_org_conducting_scoped_delete on sunday_org_conducting
  for delete to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or org_id = current_org_id())
  );


-- ============================================================================
-- Part 6 — tighten conducting_rotation
-- ============================================================================
--
-- Migration 019 put conducting_rotation in the ward-scoped policy loop, which grants INSERT,
-- UPDATE and DELETE to every authenticated member of the ward.
-- tests/rls/calendar-access.test.ts documents that asymmetry rather than asserting a denial
-- that does not exist. This part closes it: the rotation is now the first genuinely org-scoped
-- write boundary in the app, and a route that forgot its scope check must still be stopped by
-- the policy.
--
-- Nobody loses access they could actually use. The route already required admin.manage_ward,
-- so the write this narrows was never reachable through the app.
--
-- `org_id is not null` in the org branch is LOAD-BEARING. Without it, a user whose own org_id
-- happens to be NULL — every secretary, the music coordinator, a ward council member — would
-- match the bishopric rotation's NULL org_id and gain write access to the one rotation this
-- migration exists to protect. tests/rls/org-conducting.test.ts asserts exactly that case, and
-- it fails loudly if this clause is dropped.

drop policy conducting_rotation_ward_select on conducting_rotation;
drop policy conducting_rotation_ward_insert on conducting_rotation;
drop policy conducting_rotation_ward_update on conducting_rotation;
drop policy conducting_rotation_ward_delete on conducting_rotation;

create policy conducting_rotation_ward_select on conducting_rotation
  for select to authenticated
  using (ward_id = current_ward_id());

create policy conducting_rotation_scoped_insert on conducting_rotation
  for insert to authenticated
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or (org_id is not null and org_id = current_org_id()))
  );

create policy conducting_rotation_scoped_update on conducting_rotation
  for update to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or (org_id is not null and org_id = current_org_id()))
  )
  with check (
    ward_id = current_ward_id()
    and (is_bishopric() or (org_id is not null and org_id = current_org_id()))
  );

create policy conducting_rotation_scoped_delete on conducting_rotation
  for delete to authenticated
  using (
    ward_id = current_ward_id()
    and (is_bishopric() or (org_id is not null and org_id = current_org_id()))
  );
