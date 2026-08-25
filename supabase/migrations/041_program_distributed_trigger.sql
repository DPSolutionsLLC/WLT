-- ============================================================================
-- 041 — the `program_distributed` notification trigger key
-- ============================================================================
--
-- NUMBERED 041, NOT 040. plans/program-d-pdf-and-distribution.md says 040; this plan's own storage
-- migration took it, because program-c had already used 039. See the note at the top of
-- 040_program_storage.sql.
--
-- A NEW TRIGGER KEY IS A TWO-PART CHANGE (plans/retros/foundation-c-services.md):
--
--   1. supabase/seed/notification_triggers.sql  — for wards created AFTER this migration
--   2. this insert                              — for wards that already exist
--
-- One without the other is a notification that silently never fires: no error, no log, just
-- nothing arriving.
--
-- Migration 036 added the other three programme keys and deliberately LEFT THIS ONE OUT, because
-- program-d is the plan that emits it and "a key that nothing fires is indistinguishable from a key
-- that is broken". POST /api/programs/[id]/distribute now fires it, so it is added here.
--
-- Recipients: the bishopric and the ward secretary — the same three roles as program_approved.
-- Distribution is the irreversible step, and all three are people who need to know it has happened
-- whichever of them pressed the button. Bishop and counselor always appear together, because
-- bishopric admin authority is shared (CLAUDE.md §7).

insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, 'program_distributed', array['bishop', 'counselor', 'ward_secretary']::text[], true
from wards ward
on conflict (ward_id, trigger_key) do nothing;
