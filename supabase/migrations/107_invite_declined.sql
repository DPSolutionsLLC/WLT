-- 107: "No, this isn't me" on a person invite (ITER-058 cr4, decided walking scenario 105).
--
-- 107a. invites.declined_at — when the person who opened the link said it was not them.
--
-- A declined invite is DEAD: the claim in lib/auth/invites.ts refuses it, the registration page
-- shows it as not valid, and Admin → Users shows the person as "Said this invite wasn't them" until
-- a new invite is made. Nothing is deleted, so the audit trail and the sender's notification still
-- point at a real row.
--
-- Written only by POST /api/auth/invite/not-me with the service role. The person declining has no
-- session, and `invites` keeps migration 019's bishopric-only policies: no policy moves.
alter table invites add column declined_at timestamptz;

-- 107b. The sender's notification, for every existing ward.
--
-- supabase/seed/notification_triggers.sql carries the same key for new wards, and so do SPEC.md,
-- lib/notifications/triggerDefaults.ts and testing/infrastructure/seedUtils.ts — a key missing from
-- one of them never fires for that set of wards (notification-trigger-drift). The recipient is
-- addressed explicitly (whoever sent the invite), so the role list is the opt-out surface only.
insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, 'invite_declined', array['bishop', 'counselor']::text[], true
from wards ward
on conflict (ward_id, trigger_key) do nothing;
