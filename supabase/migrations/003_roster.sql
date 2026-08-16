-- Foundation B, migration 003: roster.

create table households (
  id          uuid primary key default gen_random_uuid(),
  ward_id     uuid not null references wards (id) on delete cascade,
  family_name text not null,
  address     text,
  latitude    numeric,
  longitude   numeric,
  created_at  timestamptz not null default now(),
  unique (id, ward_id)
);

-- `notes` is deliberately absent. FEATURES.md §Module 1 makes member notes bishopric-only,
-- and an RLS policy grants or denies a row, never a column — so a notes column here could
-- not be protected by the security boundary CLAUDE.md rule 2 requires. Notes live in
-- member_notes below, behind their own policy.
create table members (
  id           uuid primary key default gen_random_uuid(),
  ward_id      uuid not null references wards (id) on delete cascade,
  household_id uuid,
  first_name   text not null,
  last_name    text not null,
  category     text check (category in ('adult', 'youth', 'child')),
  gender       text check (gender in ('male', 'female')),
  status       text not null default 'active' check (status in ('active', 'moved_out', 'do_not_contact')),
  phone        text,
  created_at   timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (household_id, ward_id) references households (id, ward_id)
);

create table member_organizations (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  member_id  uuid not null,
  org_id     uuid not null,
  created_at timestamptz not null default now(),
  unique (member_id, org_id),
  foreign key (member_id, ward_id) references members (id, ward_id) on delete cascade,
  foreign key (org_id, ward_id) references organizations (id, ward_id) on delete cascade
);

create table member_notes (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  member_id  uuid not null,
  body       text not null,
  created_by uuid references users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (member_id, ward_id) references members (id, ward_id) on delete cascade
);
