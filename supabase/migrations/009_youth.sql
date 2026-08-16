-- Foundation B, migration 009: youth activity support.

create table youth_activity_profiles (
  id              uuid primary key default gen_random_uuid(),
  ward_id         uuid not null references wards (id) on delete cascade,
  member_id       uuid,
  activity_name   text not null,
  school_org      text,
  activity_type   text check (activity_type in ('sport', 'performance', 'academic', 'community', 'other')),
  season_schedule text,
  notes           text,
  entered_by      uuid,
  created_at      timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (member_id, ward_id) references members (id, ward_id) on delete cascade,
  foreign key (entered_by, ward_id) references users (id, ward_id)
);

create table activity_calendars (
  id             uuid primary key default gen_random_uuid(),
  ward_id        uuid not null references wards (id) on delete cascade,
  profile_id     uuid,
  source_type    text check (source_type in ('ics_upload', 'google_sync', 'manual')),
  source_url     text,
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (profile_id, ward_id) references youth_activity_profiles (id, ward_id) on delete cascade
);

create table activity_events (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  calendar_id uuid,
  profile_id  uuid,
  title       text,
  event_type  text check (event_type in ('home', 'away', 'tbd')),
  event_date  timestamptz,
  location    text,
  status      text not null default 'upcoming' check (
                status in ('upcoming', 'covered', 'uncovered', 'completed')
              ),
  created_at  timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (calendar_id, ward_id) references activity_calendars (id, ward_id) on delete cascade,
  foreign key (profile_id, ward_id) references youth_activity_profiles (id, ward_id) on delete cascade
);

create table activity_attendees (
  id                   uuid primary key default gen_random_uuid(),
  ward_id              uuid not null references wards (id) on delete cascade,
  event_id             uuid not null,
  user_id              uuid not null,
  assigned_by          uuid,
  confirmed_attendance boolean,
  created_at           timestamptz not null default now(),
  foreign key (event_id, ward_id) references activity_events (id, ward_id) on delete cascade,
  foreign key (user_id, ward_id) references users (id, ward_id) on delete cascade,
  foreign key (assigned_by, ward_id) references users (id, ward_id)
);

create table activity_logs (
  id                       uuid primary key default gen_random_uuid(),
  ward_id                  uuid not null references wards (id) on delete cascade,
  event_id                 uuid,
  logged_by                uuid,
  shared_notes             text,
  flagged_for_ward_council boolean not null default false,
  flag_sent_at             timestamptz,
  created_at               timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (event_id, ward_id) references activity_events (id, ward_id) on delete cascade,
  foreign key (logged_by, ward_id) references users (id, ward_id)
);

-- Author-only, exactly like visit_private_notes. No bishopric branch anywhere.
create table activity_private_notes (
  id              uuid primary key default gen_random_uuid(),
  ward_id         uuid not null references wards (id) on delete cascade,
  activity_log_id uuid not null,
  user_id         uuid not null,
  notes           text not null,
  created_at      timestamptz not null default now(),
  foreign key (activity_log_id, ward_id) references activity_logs (id, ward_id) on delete cascade,
  foreign key (user_id, ward_id) references users (id, ward_id) on delete cascade
);
