-- Visits D, migration 046: what happened on a visit, and who actually went.
--
-- THE ADDITIVE HALF. Migration 047 drops `visit_logs.visited_by`, and it is applied only after
-- the code that stops reading it has deployed. Expand and contract: this migration adds
-- `recorded_by` and backfills it, the application switches over, and only then does the old
-- column go. Both applied at once would leave the running app selecting a column that no longer
-- exists, and every visit query would 500 until the deploy landed.
--
-- IT DROPS NO POLICY AND ADDS NONE TO `visit_logs`. PostgreSQL ORs permissive policies together,
-- so dropping one to "replace" it is how a widened read survives a review
-- (plans/retros/talks-d-reliability-goals.md). Migration 019's four visit_logs policies already
-- cover the new columns — RLS grants rows, not columns.

-- ---------------------------------------------------------------------------
-- Part 1: what happened, and how it was arranged
-- ---------------------------------------------------------------------------
--
-- `outcome` defaults to 'completed' so every existing row keeps the meaning it was written with.
-- `arrangement` defaults to 'drop_in' because no existing row recorded an arrangement, and
-- claiming they were all appointments would be an invention rather than a default.
alter table visit_logs
  add column outcome text not null default 'completed'
    check (outcome in ('completed', 'attempted')),
  add column arrangement text not null default 'drop_in'
    check (arrangement in ('appointment', 'drop_in')),
  add column recorded_by uuid,
  add constraint visit_logs_recorded_by_fkey
    foreign key (recorded_by, ward_id) references users (id, ward_id);

-- Every existing row was recorded by the person it credits as the visitor, because visits-a had
-- only one column for both. The backfill preserves that reading before the column is retired.
update visit_logs set recorded_by = visited_by where recorded_by is null;

-- ---------------------------------------------------------------------------
-- Part 2: appointments
-- ---------------------------------------------------------------------------
--
-- A separate table because these have NOT happened yet, and `visit_logs` means "a thing that
-- happened" — createVisitLogSchema refuses a future date for that reason, and visits-b counts
-- those rows as progress.
--
-- `status` holds only what a HUMAN did. "Missed" is a scheduled appointment whose time has
-- passed, computed on read in lib/visits/appointments.ts. A stored status that time invalidates
-- goes stale the moment nobody writes to it, and this project has no pg_cron and no triggers to
-- keep it fresh — the same reasoning that keeps goals.status out of every read path.
create table visit_appointments (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,
  org_id        uuid,
  household_id  uuid,
  -- timestamptz, not date: an appointment is an EVENT with a time (CLAUDE.md section 6).
  -- "Tuesday at seven" is the whole point of arranging one. The ward's timezone already lives
  -- in wards.settings.timezone.
  scheduled_for timestamptz not null,
  status        text not null default 'scheduled'
                  check (status in ('scheduled', 'kept', 'cancelled')),
  visit_log_id  uuid,
  made_by       uuid,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (org_id, ward_id) references organizations (id, ward_id),
  foreign key (household_id, ward_id) references households (id, ward_id),
  -- `on delete set null`, never cascade: deleting a visit must not delete the record that an
  -- appointment was made.
  foreign key (visit_log_id, ward_id) references visit_logs (id, ward_id) on delete set null,
  foreign key (made_by, ward_id) references users (id, ward_id)
);

-- ---------------------------------------------------------------------------
-- Part 3: who actually went
-- ---------------------------------------------------------------------------
--
-- `users` and `members` are NOT linked in this schema. There is no users.member_id; a leader and
-- their own member record are two unrelated rows. So a table keyed only to `users` could not
-- record a spouse, and one keyed only to `members` could not record the recording leader. The row
-- carries all three columns and a CHECK enforcing that EXACTLY ONE is set.
create table visit_participants (
  id           uuid primary key default gen_random_uuid(),
  ward_id      uuid not null references wards (id) on delete cascade,
  -- Denormalized from the parent so the policy below can be the SAME SHAPE as visit_logs' rather
  -- than an EXISTS subquery evaluated per row. Safe because a visit log's org_id is not
  -- patchable — app/api/visits/[id]/route.ts accepts no org change, by design.
  org_id       uuid,
  visit_log_id uuid not null,
  user_id      uuid,
  member_id    uuid,
  label        text,
  created_at   timestamptz not null default now(),
  constraint visit_participants_one_identity check (
    (user_id is not null)::int + (member_id is not null)::int
      + (nullif(btrim(coalesce(label, '')), '') is not null)::int = 1
  ),
  foreign key (org_id, ward_id) references organizations (id, ward_id),
  foreign key (visit_log_id, ward_id) references visit_logs (id, ward_id) on delete cascade,
  foreign key (user_id, ward_id) references users (id, ward_id),
  foreign key (member_id, ward_id) references members (id, ward_id)
);

-- The same person is not on the same visit twice. Two PARTIAL unique indexes rather than one
-- constraint, because a NULL never equals a NULL and a plain unique over three nullable columns
-- would let duplicates through.
--
-- There is deliberately NO unique index on `label`: two people can genuinely be "a neighbour".
create unique index visit_participants_one_user_per_visit
  on visit_participants (visit_log_id, user_id) where user_id is not null;
create unique index visit_participants_one_member_per_visit
  on visit_participants (visit_log_id, member_id) where member_id is not null;

create index visit_participants_visit_log_idx on visit_participants (visit_log_id);
create index visit_appointments_household_idx
  on visit_appointments (ward_id, household_id, scheduled_for desc);

-- ---------------------------------------------------------------------------
-- RLS for the two NEW tables — visit_logs' shape, exactly
-- ---------------------------------------------------------------------------
--
-- SELECT carries the cross-org branch; INSERT, UPDATE and DELETE do not. Cross-org visibility
-- widens READS only, in this slice exactly as in visits-a: a leader of one organization never
-- gains the right to write another organization's record, whatever the ward setting says.
--
-- Written out per table rather than in a loop. The loops in 019 exist because a dozen tables
-- shared one shape; two tables sharing a shape read more clearly written out, and a reviewer can
-- SEE the missing cross-org branch on each write policy.
--
-- `visit_participants` is deliberately NOT in 019's ward-wide loop — `member_organizations` is,
-- and copying that here would let an Elders Quorum leader read who visited a Relief Society
-- household with visibility off.
alter table visit_appointments enable row level security;
alter table visit_participants enable row level security;

create policy visit_appointments_select on visit_appointments
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (
      is_bishopric()
      or org_id = current_org_id()
      or ward_allows_cross_org_visibility()
    )
  );

create policy visit_appointments_insert on visit_appointments
  for insert to authenticated
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy visit_appointments_update on visit_appointments
  for update to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()))
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy visit_appointments_delete on visit_appointments
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy visit_participants_select on visit_participants
  for select to authenticated
  using (
    ward_id = current_ward_id()
    and (
      is_bishopric()
      or org_id = current_org_id()
      or ward_allows_cross_org_visibility()
    )
  );

create policy visit_participants_insert on visit_participants
  for insert to authenticated
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy visit_participants_update on visit_participants
  for update to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()))
  with check (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));

create policy visit_participants_delete on visit_participants
  for delete to authenticated
  using (ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id()));
