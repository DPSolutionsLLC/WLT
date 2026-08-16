-- Foundation B, migration 012: meeting agendas and action items.

create table agendas (
  id           uuid primary key default gen_random_uuid(),
  ward_id      uuid not null references wards (id) on delete cascade,
  meeting_type text check (meeting_type in ('bishopric', 'ward_council')),
  meeting_date date not null,
  sections     jsonb,
  status       text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  published_by uuid,
  pdf_url      text,
  created_at   timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (published_by, ward_id) references users (id, ward_id)
);

create table action_items (
  id                     uuid primary key default gen_random_uuid(),
  ward_id                uuid not null references wards (id) on delete cascade,
  agenda_id              uuid,
  description            text not null,
  assigned_to            text,
  due_date               date,
  status                 text not null default 'open' check (status in ('open', 'complete')),
  carried_from_agenda_id uuid,
  completed_at           timestamptz,
  created_at             timestamptz not null default now(),
  foreign key (agenda_id, ward_id) references agendas (id, ward_id) on delete cascade,
  foreign key (carried_from_agenda_id, ward_id) references agendas (id, ward_id) on delete set null
);
