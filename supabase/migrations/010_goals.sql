-- Foundation B, migration 010: ministering and visit goals.

-- target_id is polymorphic — it points at a member, household, organization, or an ad-hoc
-- group depending on target_type, so it carries no foreign key. The CHECK only guarantees
-- the pair is coherent: either both are set or neither is. That a target_id actually
-- resolves to a live row is enforced in application code, not here.
create table goals (
  id                       uuid primary key default gen_random_uuid(),
  ward_id                  uuid not null references wards (id) on delete cascade,
  title                    text not null,
  target_type              text check (target_type in ('member', 'household', 'org', 'group')),
  target_id                uuid,
  desired_frequency_months integer,
  last_fulfilled_at        timestamptz,
  status                   text check (status in ('on_track', 'due_soon', 'overdue')),
  notes                    text,
  created_at               timestamptz not null default now(),
  constraint goals_target_pair check (
    (target_type is null and target_id is null)
    or (target_type is not null and target_id is not null)
  )
);
