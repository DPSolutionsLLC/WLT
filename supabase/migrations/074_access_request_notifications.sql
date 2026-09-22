-- Phase 2, migration 074: notification trigger keys for access requests.
--
-- A NEW TRIGGER KEY IS A TWO-PART CHANGE (plans/retros/foundation-c-services.md, and migration
-- 036 which is this file's direct precedent):
--
--   1. supabase/seed/notification_triggers.sql  — for wards created AFTER this migration
--   2. this insert                              — for wards that already exist
--
-- One without the other is a notification that silently never fires: no error, no log, just
-- nothing arriving. emitNotification() looks the key up by string and warns when a ward has no
-- row for it, which is easy to miss in a server log nobody is reading — and
-- `notification-trigger-drift` (ITER-023) is what happens when that goes unnoticed for weeks.
--
-- The THIRD copy of this list is NOTIFICATION_TRIGGERS in testing/infrastructure/seedUtils.ts,
-- and all three changed in the same commit as this file. tests/db/notification-triggers-seed.test.ts
-- diffs them in both directions and fails naming the key and the file.
--
-- ---------------------------------------------------------------------------
-- WHY `access_request_submitted` CARRIES AN EMPTY ROLE LIST
-- ---------------------------------------------------------------------------
-- Its recipients are the app's SUPER ADMINS, and a super admin is not a ward role — the
-- assignment lives in `unit_assignments`, which has no ward_id at all (migration 065b). So there
-- is no role list in the ASKING ward that could name them, and the route resolves them explicitly
-- and passes them as `recipientUserIds`.
--
-- The row still has to exist: emitNotification() reads `notification_settings` first and returns
-- with a warning when there is none, whatever recipients the caller supplied. An empty
-- `default_roles` is the honest value — nobody is addressed BY ROLE for this key — and naming the
-- bishopric instead would notify the very people who just pressed the button.
--
-- The per-user opt-out still applies to explicitly addressed recipients (emitNotification's own
-- comment says so), so a super admin can still switch these off.

insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, trigger.key, trigger.default_roles, true
from wards ward
cross join (values
  ('access_request_submitted', array[]::text[]),
  ('access_request_decided',   array['bishop', 'counselor']),
  ('access_app_wide_grant',    array['bishop', 'counselor'])
) as trigger(key, default_roles)
on conflict (ward_id, trigger_key) do nothing;
