-- Phase 3, migration 077: A PERSON'S OWN PREFERENCES, WHICH FOLLOW THEM RATHER THAN THEIR DEVICE.
--
-- APPLIES IMMEDIATELY, BEFORE THE CODE DEPLOYS. PURELY ADDITIVE: one nullable-by-default column
-- with a default, one CHECK on that new column only, and one column grant. It sets nothing NOT
-- NULL on existing data (the default fills every row), narrows no existing CHECK and tightens no
-- policy.
--
-- So there is NO entry in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts and none should
-- be added — see 073's header.
--
-- ---------------------------------------------------------------------------
-- ⚠️ users.settings IS USER-OWNED PREFERENCE DATA AND NOTHING MAY EVER READ AUTHORIZATION OUT OF IT
-- ---------------------------------------------------------------------------
-- THE USER CAN WRITE THIS COLUMN DIRECTLY. The grant below is what makes the quick-links control
-- work, and it means anything security-relevant stored here would be SELF-GRANTED — a role, a
-- permission, a ward id, a flag any policy consults. There is no way to make that safe short of
-- taking the grant away.
--
-- The ward's `role_access` lives in `wards.settings` behind a bishopric-only `wards_update` for
-- exactly this reason, and the two columns must not be thought of as the same kind of thing
-- because they share a name and a type.
--
-- What belongs here: pinned quick links, and later, whatever else is purely about how one person
-- likes their own screen to look. `theme_preference` is the precedent, one column up.
--
-- ---------------------------------------------------------------------------
-- THE GRANT IS LOAD-BEARING AND IS THE EASIEST LINE HERE TO FORGET
-- ---------------------------------------------------------------------------
-- Migration 022 revoked blanket UPDATE on `users` and granted back exactly `theme_preference`.
-- COLUMN PRIVILEGES ARE CHECKED BEFORE POLICIES, so without this grant the write fails with
-- "permission denied for table users" rather than the zero-row success an RLS denial produces —
-- a different error, from a different layer, that looks like a broken policy and is not.
-- `unit-hierarchy-and-ward-switch` lost real time to this on `active_ward_id`.
-- tests/rls/users-column-grant.test.ts pins both halves and is extended in this commit.
--
-- ---------------------------------------------------------------------------
-- THE SIZE CHECK IS WHAT MAKES AN OPEN GRANT SAFE
-- ---------------------------------------------------------------------------
-- `theme_preference` is one enum value and is self-limiting. An ungated jsonb column a user may
-- write directly is a storage hole — one account could put megabytes in it. 4 KB is far more than
-- a list of pinned hrefs needs and far less than anybody could abuse.
alter table users
  add column settings jsonb not null default '{}'::jsonb;

alter table users
  add constraint users_settings_size check (pg_column_size(settings) < 4096);

comment on column users.settings is
  'User-owned display preferences (quick links today). The user can write it directly, so NOTHING may ever read authorization out of it — the ward''s role_access lives in wards.settings behind a bishopric-only policy for that reason.';

-- The existing users_update_self policy already restricts the ROW to the person themselves; this
-- grant is what makes the COLUMN reachable at all. Both are required and they fail differently.
grant update (settings) on users to authenticated;
