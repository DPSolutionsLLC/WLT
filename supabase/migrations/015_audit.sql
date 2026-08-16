-- Foundation B, migration 015: audit log.
--
-- Append-only by policy (migration 019): any authenticated ward member may insert their own
-- row, only the bishopric may read, and nobody may update or delete. Rule 6 requires every
-- mutation to write here, so the insert path cannot be bishopric-only — an org secretary
-- logging a visit still has to be able to record it.

create table audit_log (
  id         uuid primary key default gen_random_uuid(),
  ward_id    uuid not null references wards (id) on delete cascade,
  user_id    uuid,
  action     text not null,
  module     text,
  detail     jsonb,
  created_at timestamptz not null default now(),
  foreign key (user_id, ward_id) references users (id, ward_id) on delete set null
);

comment on table audit_log is
  'Append-only. Written by lib/audit/writeAuditLog() on every mutation; never updated or deleted.';
