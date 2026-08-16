-- Foundation B, migration 007: sacrament programs and public page registry.

create table programs (
  id             uuid primary key default gen_random_uuid(),
  ward_id        uuid not null references wards (id) on delete cascade,
  sunday_id      uuid,
  draft_data     jsonb,
  pdf_url        text,
  status         text not null default 'draft' check (
                   status in ('draft', 'pending_approval', 'approved', 'distributed')
                 ),
  created_by     uuid,
  approved_by    uuid,
  approved_at    timestamptz,
  distributed_at timestamptz,
  distributed_by uuid,
  created_at     timestamptz not null default now(),
  foreign key (sunday_id, ward_id) references sundays (id, ward_id) on delete cascade,
  foreign key (created_by, ward_id) references users (id, ward_id),
  foreign key (approved_by, ward_id) references users (id, ward_id),
  foreign key (distributed_by, ward_id) references users (id, ward_id)
);

-- Rows here name an unauthenticated URL. The pages themselves read through the restricted
-- views in migration 019 — anon never touches this table or the ones it points at.
create table public_pages (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  page_type  text not null check (page_type in ('sacrament_assignments', 'program')),
  slug       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);
