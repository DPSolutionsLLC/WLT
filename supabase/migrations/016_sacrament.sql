-- Foundation B, migration 016: sacrament ordinance administration.

-- member_ids is an ordered array defining the rotation; position in the array is the
-- rotation order, so it is not normalised into a child table.
create table sacrament_rotation_pools (
  id              uuid primary key default gen_random_uuid(),
  ward_id         uuid not null references wards (id) on delete cascade,
  assignment_type text not null check (
                    assignment_type in ('bread_blessing', 'water_blessing', 'setup_takedown', 'bread_provider')
                  ),
  member_ids      uuid[] not null default '{}',
  created_by      uuid,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (ward_id, assignment_type),
  foreign key (created_by, ward_id) references users (id, ward_id)
);

-- Only one active manager per ward at a time — enforced by a partial unique index in
-- migration 018, not by a plain UNIQUE, because inactive historical rows must be allowed to
-- accumulate.
create table sacrament_assignment_managers (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  member_id   uuid,
  user_id     uuid,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  is_active   boolean not null default true,
  foreign key (member_id, ward_id) references members (id, ward_id) on delete set null,
  foreign key (user_id, ward_id) references users (id, ward_id) on delete set null,
  foreign key (assigned_by, ward_id) references users (id, ward_id)
);

create table sacrament_assignments (
  id              uuid primary key default gen_random_uuid(),
  ward_id         uuid not null references wards (id) on delete cascade,
  sunday_id       uuid,
  assignment_type text not null check (
                    assignment_type in ('bread_blessing', 'water_blessing', 'setup_takedown', 'bread_provider')
                  ),
  member_ids      uuid[] not null default '{}',
  is_override     boolean not null default false,
  override_reason text,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (ward_id, sunday_id, assignment_type),
  foreign key (sunday_id, ward_id) references sundays (id, ward_id) on delete cascade,
  foreign key (created_by, ward_id) references users (id, ward_id),
  foreign key (updated_by, ward_id) references users (id, ward_id)
);

create table sacrament_send_log (
  id              uuid primary key default gen_random_uuid(),
  ward_id         uuid not null references wards (id) on delete cascade,
  month           date,
  sent_by_user_id uuid,
  sent_at         timestamptz not null default now(),
  foreign key (sent_by_user_id, ward_id) references users (id, ward_id)
);

comment on column sacrament_send_log.month is
  'First day of the month the assignments cover. Written when the manager taps "Message sent".';
