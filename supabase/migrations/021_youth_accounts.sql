-- Phase 1C, migration 021: youth account support.
--
-- pin_hash is dropped, not populated. Migration 002 created it with "Phase 1 chooses the hash
-- function"; plans/01-auth-rbac.md §Step 4 rules that the PIN is never stored in a column,
-- hashed or otherwise — it is the password on a synthetic Supabase Auth account, so Supabase
-- owns the hashing. Two credential stores for one credential is a drift waiting to happen, and
-- a column named pin_hash that is always null is worse than no column at all.
alter table users drop column pin_hash;

-- Rate limiting for username + PIN sign-in. A 4-digit PIN is 10,000 possibilities, so this is
-- part of the feature, not hardening (plans/01-auth-rbac.md §Step 4).
--
-- Keyed by username rather than user id: the attempt has to be recorded even when the username
-- does not resolve to anyone, or probing for valid usernames becomes free.
create table youth_login_attempts (
  id             uuid primary key default gen_random_uuid(),
  ward_id        uuid not null references wards (id) on delete cascade,
  username       text not null,
  failed_count   integer not null default 0,
  locked_until   timestamptz,
  last_failed_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (ward_id, username)
);

-- Migration 019 enabled RLS by looping the catalog AT MIGRATION TIME; it does not reach tables
-- created later. Postgres defaults RLS off, so this line is what stands between this table and
-- every authenticated user in every ward.
alter table youth_login_attempts enable row level security;

-- No policies, deliberately. Only the PIN login route touches this table and it runs with the
-- service-role client (the caller is unauthenticated by definition). RLS enabled with zero
-- policies denies every authenticated read and write, which is exactly right — failed-attempt
-- counts are not something a ward member needs to see.

comment on table youth_login_attempts is
  'Failed username+PIN attempts. Service-role only. Never stores the PIN itself.';

-- New notification trigger for wards that already exist. supabase/seed/notification_triggers.sql
-- gets the same key for wards created later; both are needed or the lockout notification fires
-- into nothing (plans/retros/foundation-c-services.md).
insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, 'youth_account_locked', array['bishop', 'counselor']::text[], true
from wards ward
on conflict (ward_id, trigger_key) do nothing;
