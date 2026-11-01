-- ITER-055 slice bv1, migration 099: EACH ORGANIZATION'S VISITS ARE ITS OWN, AND THE BISHOPRIC
-- DECIDES WHO ELSE MAY SEE THEM (plans/bishopric-visits.md, D1–D3, P1–P4).
--
-- ---------------------------------------------------------------------------
-- WHAT THIS REPLACES
-- ---------------------------------------------------------------------------
-- Until now one ward-wide switch, `ward_allows_cross_org_visibility()` (019), opened every
-- organization's visits to every other organization at once — the Bishopric's included. The user
-- decided (2026-10-31) that sharing is per organization and set by the bishopric: "let the Elders
-- Quorum see the Bishopric's visits" is a row in `visit_org_sharing`, and nothing else is shared.
--
-- THE SWITCH STAYS FOR YOUTH. `activity_logs_select` (057c) still reads it and this migration does
-- not touch that policy. Visits simply stop asking it.
--
-- ---------------------------------------------------------------------------
-- THE SIX POLICIES THAT MOVE — ALL OF THEM, BY NAME
-- ---------------------------------------------------------------------------
-- 053's header listed four widened tables when there were six. These are the six:
--
--     visit_logs_select                (019)
--     visit_goals_select               (053)
--     household_visit_cadences_select  (053)
--     household_stewardships_select    (052)
--     visit_appointments_select        (046)
--     visit_participants_select        (046)
--
-- Each keeps its `is_bishopric()` arm and its ward filter. Only the READ widens, and only through a
-- grant. NO WRITE POLICY MOVES: a leader who can see another organization's visits cannot write one.
-- `visit_private_notes` does not move either — author only, forever (CLAUDE.md rule 5).
--
-- ---------------------------------------------------------------------------
-- A NULL `org_id` IS THE BISHOPRIC (P1, revised with the user)
-- ---------------------------------------------------------------------------
-- A visit the bishopric records is stored with `org_id = null` (app/api/visits/route.ts), and that
-- stays. A null row can only ever be written by the bishopric — every write policy's org arm is
-- `org_id = current_org_id()`, which is never true for null — so null is unambiguous.
-- visit_org_visible_to_caller() therefore reads a null owner as the ward's `bishopric`-typed
-- organization when it looks for a grant, and grants for the Bishopric are stored against that
-- organization's id. A ward with no Bishopric organization simply cannot share the bishopric's
-- visits.
--
-- The null owner gets NO "your own organization" arm: before this migration a non-bishopric person
-- never read a null row through `org_id = current_org_id()`, and they still do not.
--
-- ---------------------------------------------------------------------------
-- A SELECT POLICY AND NO WRITE POLICY ON `visit_org_sharing` (P2)
-- ---------------------------------------------------------------------------
-- The only writer is PUT /api/visit-sharing through the service role, behind
-- `visits.manage_sharing` AND a bishopric calling (lib/visits/sharing.ts). The 073 / 089 / 094
-- shape. Do not add a write policy "for convenience".
--
-- The grants are readable ward-wide: which organizations may see which is not sensitive, and an
-- org leader's page needs it to offer the organizations shared with them.

-- ---------------------------------------------------------------------------
-- 099a. The grants
-- ---------------------------------------------------------------------------
create table visit_org_sharing (
  id            uuid        primary key default gen_random_uuid(),
  ward_id       uuid        not null references wards (id) on delete cascade,
  owner_org_id  uuid        not null,
  viewer_org_id uuid        not null,
  created_by    uuid        references users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint visit_org_sharing_owner_fkey
    foreign key (owner_org_id, ward_id) references organizations (id, ward_id) on delete cascade,
  constraint visit_org_sharing_viewer_fkey
    foreign key (viewer_org_id, ward_id) references organizations (id, ward_id) on delete cascade,
  constraint visit_org_sharing_one_per_pair unique (owner_org_id, viewer_org_id),
  constraint visit_org_sharing_not_self check (owner_org_id <> viewer_org_id)
);

create index visit_org_sharing_ward_idx on visit_org_sharing (ward_id, viewer_org_id);

comment on table visit_org_sharing is
  'Which organization may read which organization''s visits. Set by the bishopric (ITER-055).';

alter table visit_org_sharing enable row level security;

create policy visit_org_sharing_select on visit_org_sharing
  for select to authenticated
  using (ward_id = current_ward_id());

create policy visit_org_sharing_module_released on visit_org_sharing
  as restrictive for all to authenticated
  using ((select ward_module_released('visits')))
  with check ((select ward_module_released('visits')));

-- ---------------------------------------------------------------------------
-- 099b. The one question all six policies ask
-- ---------------------------------------------------------------------------
create function visit_org_visible_to_caller(p_owner_org uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  select case
    when p_owner_org is null then
      exists (
        select 1
          from visit_org_sharing s
          join organizations o
            on o.id = s.owner_org_id
           and o.ward_id = s.ward_id
         where s.ward_id = current_ward_id()
           and o.type = 'bishopric'
           and s.viewer_org_id = current_org_id()
      )
    else
      coalesce(p_owner_org = current_org_id(), false)
      or exists (
        select 1
          from visit_org_sharing s
         where s.ward_id = current_ward_id()
           and s.owner_org_id = p_owner_org
           and s.viewer_org_id = current_org_id()
      )
  end;
$$;

revoke all on function visit_org_visible_to_caller(uuid) from public;
grant execute on function visit_org_visible_to_caller(uuid) to authenticated;
grant execute on function visit_org_visible_to_caller(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 099c. The six SELECT policies
-- ---------------------------------------------------------------------------
drop policy if exists visit_logs_select on visit_logs;
create policy visit_logs_select on visit_logs
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or visit_org_visible_to_caller(org_id)));

drop policy if exists visit_goals_select on visit_goals;
create policy visit_goals_select on visit_goals
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or visit_org_visible_to_caller(org_id)));

drop policy if exists household_visit_cadences_select on household_visit_cadences;
create policy household_visit_cadences_select on household_visit_cadences
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or visit_org_visible_to_caller(org_id)));

drop policy if exists household_stewardships_select on household_stewardships;
create policy household_stewardships_select on household_stewardships
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or visit_org_visible_to_caller(org_id)));

drop policy if exists visit_appointments_select on visit_appointments;
create policy visit_appointments_select on visit_appointments
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or visit_org_visible_to_caller(org_id)));

drop policy if exists visit_participants_select on visit_participants;
create policy visit_participants_select on visit_participants
  for select to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or visit_org_visible_to_caller(org_id)));

-- ---------------------------------------------------------------------------
-- 099d. Day one moves nobody but the Bishopric's readers (D3)
-- ---------------------------------------------------------------------------
-- A ward whose switch was on gets every ordered pair of its organizations, so every organization
-- keeps seeing every other. The Bishopric is left out on BOTH sides: it starts shared with nobody
-- (the decision), and as a viewer a grant would be meaningless because the bishopric reads
-- everything through is_bishopric(). A ward whose switch was off gets no rows.
insert into visit_org_sharing (ward_id, owner_org_id, viewer_org_id)
select owner.ward_id, owner.id, viewer.id
  from wards ward
  join organizations owner  on owner.ward_id  = ward.id and owner.type  <> 'bishopric'
  join organizations viewer on viewer.ward_id = ward.id and viewer.type <> 'bishopric'
 where (ward.settings ->> 'cross_org_visibility') = 'true'
   and owner.id <> viewer.id
on conflict do nothing;
