-- Visits A, migration 045: the flag notification goes to the executive secretary.
--
-- A DATA correction, not a schema one, which is why it is not part of 044. Editing
-- supabase/seed/notification_triggers.sql changes what a FRESH ward gets; every ward that
-- already exists still holds the row seeded from migration 013 with
-- array['bishop', 'counselor', 'ward_council_member']. A correct seed file plus a stale row is a
-- bug that only ever shows up in production behaviour, so the fix ships as a migration rather
-- than as a hand-run update against the linked project — the same shape migration 025 used to
-- backfill `assignment_reverted` into wards that predated it.
--
-- FEATURES.md §Module 9 and 07-visits.md §Step 3 both give the ward council agenda to the
-- executive secretary. That role holds NO `visits.view` permission (lib/auth/permissions.ts),
-- which is what makes "the notification carries the one-liner and nothing else" structurally
-- true rather than a rule somebody has to remember.

update notification_settings
set default_roles = array['executive_secretary']::text[]
where trigger_key = 'visit_flagged_for_ward_council';

-- A ward created before migration 013's seed ran, or one whose row was deleted, gets it now.
insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select id, 'visit_flagged_for_ward_council', array['executive_secretary']::text[], true
from wards
on conflict (ward_id, trigger_key) do nothing;
