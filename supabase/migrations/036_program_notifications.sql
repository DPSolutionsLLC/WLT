-- Program A, migration 036: notification trigger keys for the sacrament program.
--
-- A NEW TRIGGER KEY IS A TWO-PART CHANGE (plans/retros/foundation-c-services.md):
--
--   1. supabase/seed/notification_triggers.sql  — for wards created AFTER this migration
--   2. this insert                              — for wards that already exist
--
-- One without the other is a notification that silently never fires: no error, no log, just
-- nothing arriving. emitNotification() looks the key up by string and logs a warning when a ward
-- has no row for it, which is easy to miss in a server log nobody is reading.
--
-- THREE KEYS, NOT FOUR. `program_distributed` belongs to program-d, which is the plan that emits
-- it. A key that nothing fires is indistinguishable from a key that is broken, so it is added by
-- the change that starts using it.
--
-- Recipients follow the pattern the seed file already sets: bishop and counselor always appear
-- together, because bishopric admin authority is shared (CLAUDE.md §7). The ward secretary is on
-- the two OUTCOME keys but not on the request for approval — they are the person who submitted
-- it, and telling somebody their own action happened is noise.

insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, trigger.key, trigger.default_roles, true
from wards ward
cross join (values
  ('program_pending_approval',  array['bishop', 'counselor']::text[]),
  ('program_approved',          array['bishop', 'counselor', 'ward_secretary']),
  ('program_changes_requested', array['bishop', 'counselor', 'ward_secretary'])
) as trigger(key, default_roles)
on conflict (ward_id, trigger_key) do nothing;
