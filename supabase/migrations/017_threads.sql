-- Foundation B, migration 017: discussion threads.
--
-- Framework only. plans/INDEX.md §Scope Guardrails puts org discussion threads explicitly
-- out of scope for v1: build the two tables, ship no UI. They exist now so a later phase
-- does not have to migrate a live database to add them.

create table conversation_threads (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  org_id      uuid,
  thread_type text check (thread_type in ('org', 'ward_council')),
  created_at  timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade
);

create table conversation_messages (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  thread_id  uuid not null,
  user_id    uuid,
  body       text,
  created_at timestamptz not null default now(),
  foreign key (thread_id, ward_id) references conversation_threads (id, ward_id) on delete cascade,
  foreign key (user_id, ward_id) references users (id, ward_id) on delete set null
);
