-- Foundation B, migration 004: Sunday calendar and conducting rotation.

-- SPEC.md had `date NOT NULL UNIQUE`, which would stop a second ward ever holding a
-- meeting on the same date. Scoped to (ward_id, date) instead — an approved deviation.
create table sundays (
  id                 uuid primary key default gen_random_uuid(),
  ward_id            uuid not null references wards (id) on delete cascade,
  date               date not null,
  type               text not null default 'standard' check (
                       type in ('standard', 'fast_sunday', 'stake_conference',
                                'general_conference', 'holiday', 'special')
                     ),
  notes              text,
  conducting_user_id uuid,
  speaking_slots     integer not null default 3 check (speaking_slots >= 0),
  slot_config        jsonb,
  presiding_override text,
  created_at         timestamptz not null default now(),
  unique (ward_id, date),
  unique (id, ward_id),
  foreign key (conducting_user_id, ward_id) references users (id, ward_id)
);

create table conducting_rotation (
  id             uuid primary key default gen_random_uuid(),
  ward_id        uuid not null references wards (id) on delete cascade,
  position       integer not null check (position in (1, 2, 3)),
  user_id        uuid,
  effective_from date,
  created_at     timestamptz not null default now(),
  foreign key (user_id, ward_id) references users (id, ward_id)
);
