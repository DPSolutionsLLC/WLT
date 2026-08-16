-- Foundation B, migration 005: talk pipeline.

create table topics (
  id                   uuid primary key default gen_random_uuid(),
  ward_id              uuid not null references wards (id) on delete cascade,
  title                text not null,
  category             text check (category in ('doctrinal', 'scriptural', 'conference_talk', 'seasonal', 'custom')),
  description          text,
  suggested_scriptures jsonb,
  suggested_talks      jsonb,
  source               text check (source in ('ai_generated', 'manual', 'library')),
  status               text not null default 'active' check (status in ('active', 'archived')),
  last_assigned_at     timestamptz,
  created_at           timestamptz not null default now(),
  unique (id, ward_id)
);

create table assignments (
  id                     uuid primary key default gen_random_uuid(),
  ward_id                uuid not null references wards (id) on delete cascade,
  sunday_id              uuid,
  member_id              uuid,
  assignment_type        text check (
                           assignment_type in ('sacrament_talk', 'organizational', 'returning_missionary',
                                               'new_member', 'youth_speaker', 'high_council', 'other')
                         ),
  counts_toward_rotation boolean not null default true,
  topic_id               uuid,
  slot_number            integer,
  slot_length_minutes    integer,
  pipeline_stage         text not null default 'plan' check (
                           pipeline_stage in ('plan', 'review', 'approve', 'request', 'confirm',
                                              'notify', 'speak', 'appreciate', 'complete')
                         ),
  planned_by             uuid,
  plan_submitted_at      timestamptz,
  approved_at            timestamptz,
  requested_at           timestamptz,
  requested_by           uuid,
  request_outcome        text check (request_outcome in ('accepted', 'declined', 'pending')),
  request_notes          text,
  confirmed_at           timestamptz,
  notify_message         text,
  notify_sent_at         timestamptz,
  notify_sent_by         uuid,
  sunday_confirmed_at    timestamptz,
  thank_you_message      text,
  thank_you_sent_at      timestamptz,
  thank_you_sent_by      uuid,
  completed_at           timestamptz,
  created_at             timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (sunday_id, ward_id) references sundays (id, ward_id),
  foreign key (member_id, ward_id) references members (id, ward_id),
  foreign key (topic_id, ward_id) references topics (id, ward_id),
  foreign key (planned_by, ward_id) references users (id, ward_id),
  foreign key (requested_by, ward_id) references users (id, ward_id),
  foreign key (notify_sent_by, ward_id) references users (id, ward_id),
  foreign key (thank_you_sent_by, ward_id) references users (id, ward_id)
);

create table assignment_approvals (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,
  assignment_id uuid not null,
  user_id       uuid not null,
  approved      boolean,
  comment       text,
  created_at    timestamptz not null default now(),
  foreign key (assignment_id, ward_id) references assignments (id, ward_id) on delete cascade,
  foreign key (user_id, ward_id) references users (id, ward_id)
);

-- Either assignment_id (an assignment-level comment) or sunday_id (a month-level one) is
-- set. MATCH SIMPLE means a composite FK with a null column is not checked, which is what
-- allows both shapes in one table.
create table assignment_comments (
  id            uuid primary key default gen_random_uuid(),
  ward_id       uuid not null references wards (id) on delete cascade,
  assignment_id uuid,
  sunday_id     uuid,
  user_id       uuid not null,
  comment       text not null,
  level         text check (level in ('month', 'assignment')),
  created_at    timestamptz not null default now(),
  foreign key (assignment_id, ward_id) references assignments (id, ward_id) on delete cascade,
  foreign key (sunday_id, ward_id) references sundays (id, ward_id) on delete cascade,
  foreign key (user_id, ward_id) references users (id, ward_id)
);

create table assignment_history (
  id                       uuid primary key default gen_random_uuid(),
  ward_id                  uuid not null references wards (id) on delete cascade,
  member_id                uuid not null,
  assignment_id            uuid,
  outcome                  text check (outcome in ('accepted', 'declined', 'cancelled', 'completed')),
  cancellation_days_notice integer,
  notes                    text,
  created_at               timestamptz not null default now(),
  foreign key (member_id, ward_id) references members (id, ward_id) on delete cascade,
  foreign key (assignment_id, ward_id) references assignments (id, ward_id) on delete set null
);

create table prayer_assignments (
  id           uuid primary key default gen_random_uuid(),
  ward_id      uuid not null references wards (id) on delete cascade,
  sunday_id    uuid,
  member_id    uuid,
  prayer_type  text check (prayer_type in ('invocation', 'benediction')),
  stage        text not null default 'assign' check (stage in ('assign', 'ask', 'confirm', 'done')),
  asked_by     uuid,
  asked_at     timestamptz,
  confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (sunday_id, ward_id) references sundays (id, ward_id) on delete cascade,
  foreign key (member_id, ward_id) references members (id, ward_id),
  foreign key (asked_by, ward_id) references users (id, ward_id)
);
