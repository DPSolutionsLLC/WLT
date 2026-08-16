-- Foundation B, migration 002: core identity tables.
--
-- ward_id is NOT NULL on every table in this schema (CLAUDE.md rule 1: "Every table has
-- ward_id. Every query filters on it. Every insert sets it."). SPEC.md writes it nullable;
-- a nullable ward_id would let a row exist that belongs to no ward and matches no RLS
-- predicate, so it is tightened here.
--
-- Each parent carries UNIQUE (id, ward_id) so children can use a composite foreign key.
-- That makes Postgres enforce "child ward_id equals parent ward_id" instead of trusting
-- application code to keep the denormalised column honest.

create table wards (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table organizations (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  name       text not null,
  type       text not null check (
               type in ('bishopric', 'elders_quorum', 'relief_society', 'young_men',
                        'young_women', 'primary', 'sunday_school', 'other')
             ),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, ward_id)
);

-- `role` includes sacrament_manager, which SPEC.md's comment omitted. The CHECK must stay
-- in step with ROLES in types/domain.ts; if they drift, the database accepts a value the
-- TypeScript union rejects.
create table users (
  id                 uuid primary key references auth.users (id) on delete cascade,
  ward_id            uuid not null references wards (id) on delete cascade,
  first_name         text,
  last_name          text,
  email              text,
  username           text,
  pin_hash           text,
  role               text not null check (
                       role in ('bishop', 'counselor', 'ward_secretary', 'executive_secretary',
                                'org_president', 'org_counselor', 'org_secretary',
                                'music_coordinator', 'ward_council_member', 'sacrament_manager')
                     ),
  org_id             uuid,
  counselor_position integer check (counselor_position in (1, 2)),
  is_active          boolean not null default true,
  theme_preference   text not null default 'system' check (theme_preference in ('light', 'dark', 'system')),
  created_at         timestamptz not null default now(),
  unique (id, ward_id),
  foreign key (org_id, ward_id) references organizations (id, ward_id)
);

-- Youth accounts authenticate with username + PIN and have no email. Usernames are unique
-- per ward, case-insensitively. Only the hash is ever stored — never the PIN itself, and
-- never in a log (CLAUDE.md rule 8). Phase 1 chooses the hash function.
create unique index users_username_key
  on users (ward_id, lower(username))
  where username is not null;

create table invites (
  id                 uuid primary key default gen_random_uuid(),
  ward_id            uuid not null references wards (id) on delete cascade,
  email              text,
  role               text check (
                       role in ('bishop', 'counselor', 'ward_secretary', 'executive_secretary',
                                'org_president', 'org_counselor', 'org_secretary',
                                'music_coordinator', 'ward_council_member', 'sacrament_manager')
                     ),
  org_id             uuid,
  counselor_position integer check (counselor_position in (1, 2)),
  invited_by         uuid references users (id),
  token              text not null unique,
  expires_at         timestamptz,
  used_at            timestamptz,
  created_at         timestamptz not null default now(),
  foreign key (org_id, ward_id) references organizations (id, ward_id)
);
