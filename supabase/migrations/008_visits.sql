-- Foundation B, migration 008: visit tracker and return-and-report.

create table visit_goals (
  id                uuid primary key default gen_random_uuid(),
  ward_id           uuid not null references wards (id) on delete cascade,
  org_id            uuid,
  title             text,
  target_type       text check (target_type in ('all_households', 'specific_households', 'custom')),
  cadence           text check (cadence in ('annual', 'biannual', 'custom')),
  cadence_months    integer,
  goal_period_start date,
  goal_period_end   date,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  foreign key (org_id, ward_id) references organizations (id, ward_id),
  foreign key (created_by, ward_id) references users (id, ward_id)
);

create table visit_logs (
  id                       uuid primary key default gen_random_uuid(),
  ward_id                  uuid not null references wards (id) on delete cascade,
  org_id                   uuid,
  household_id             uuid,
  visited_by               uuid,
  visit_date               date not null,
  shared_notes             text,
  flagged_for_ward_council boolean not null default false,
  flag_sent_at             timestamptz,
  created_at               timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (org_id, ward_id) references organizations (id, ward_id),
  foreign key (household_id, ward_id) references households (id, ward_id),
  foreign key (visited_by, ward_id) references users (id, ward_id)
);

-- Readable and writable ONLY by their author (CLAUDE.md rule 5). Not by the bishop, not by
-- an admin, not by a support query. Migration 019 gives this table no bishopric branch on
-- any operation, and plan C asserts that explicitly.
create table visit_private_notes (
  id           uuid primary key default gen_random_uuid(),
  ward_id      uuid not null references wards (id) on delete cascade,
  visit_log_id uuid not null,
  user_id      uuid not null,
  notes        text not null,
  created_at   timestamptz not null default now(),
  foreign key (visit_log_id, ward_id) references visit_logs (id, ward_id) on delete cascade,
  foreign key (user_id, ward_id) references users (id, ward_id) on delete cascade
);

-- report_id is polymorphic (visit_logs.id or activity_logs.id), so it carries no foreign
-- key. report_type says which table it points at; integrity is the application's job.
create table report_read_status (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  user_id     uuid not null,
  report_type text not null check (report_type in ('visit_log', 'youth_activity')),
  report_id   uuid not null,
  read_at     timestamptz,
  flagged     boolean not null default false,
  unique (user_id, report_type, report_id),
  foreign key (user_id, ward_id) references users (id, ward_id) on delete cascade
);
