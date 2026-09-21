-- Phase 2, migration 071: THE CONTRACT HALF. ⚠️ HELD BACK UNTIL THE SLICE-3 DEPLOY IS LIVE.
--
-- ---------------------------------------------------------------------------
-- DO NOT APPLY THIS WITH `npm run db:push` BEFORE THE DEPLOY
-- ---------------------------------------------------------------------------
-- `"071"` is listed in HELD_BACK_UNTIL_DEPLOYED in tests/db/migrations.test.ts, which is the only
-- thing that distinguishes "held back on purpose" from "written and forgotten". The deploy order
-- is not a nicety:
--
--   1. Apply 068, 069 and 070. All three are no-ops for the running build.
--   2. DEPLOY the application.
--   3. Apply this file, and DELETE its entry from HELD_BACK_UNTIL_DEPLOYED in the same change.
--
-- Applying it early answers EVERY AUTHENTICATED PAGE with a 400 at once. The currently-deployed
-- build selects `role`, `org_id` and `counselor_position` through lib/auth/session.ts and
-- lib/auth/adminUsers.ts, and PostgREST answers a select naming a missing column with a 400.
-- That is migrations 062/063's lesson verbatim, where the same mistake would have taken down
-- every youth screen simultaneously.
--
-- ---------------------------------------------------------------------------
-- WHY THE COLUMNS GO AT ALL
-- ---------------------------------------------------------------------------
-- Two places answering "what calling does this person hold" is `notification-trigger-drift`
-- waiting to happen — that retro is one list in three copies, all disagreeing, and the damage was
-- silent. From migration 070 on, `ward_role_assignments` is the source of truth and these three
-- columns are a second copy that nothing reads and nothing keeps in step. A stale copy of an
-- access decision is worse than no copy.
--
-- `users.ward_id` STAYS. It is the HOME ward — the ward the account was created in, the one a
-- person lands in when no switch is active, and the fallback current_ward_id() uses. Dropping it
-- would touch resolveSessionWardId(), the invite flow, youth account creation and registration
-- for no gain.
--
-- `unique (id, ward_id)` on `users` also stays. Nothing references it after migration 069 and it
-- costs one index; removing it is a separate decision with its own blast radius, and this file is
-- not the place to take it.
--
-- Dropping `org_id` drops `users`' own `(org_id, ward_id) -> organizations (id, ward_id)` foreign
-- key with it. That constraint's job moved to `ward_role_assignments` in migration 068, where it
-- is stated on the row that actually carries the organization.

alter table users drop column role;
alter table users drop column org_id;
alter table users drop column counselor_position;

comment on column users.ward_id is
  'The HOME ward: where this account was created and where a session lands with no active '
  'switch. It is NOT necessarily the ward the person is acting in — that is current_ward_id(), '
  'resolved from ward_role_assignments (migration 070).';
