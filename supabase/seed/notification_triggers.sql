-- One notification_settings row per trigger key, per ward.
--
-- The keys below must match SPEC.md §Trigger Keys EXACTLY. emitNotification() (plan C) looks
-- them up by string, so a typo here is a notification that silently never fires — no error,
-- no log, just nothing arriving. Twenty-four keys; count them against the spec if you edit.
--
-- default_roles is the role list that receives the trigger unless a user opts out in
-- notification_user_prefs. Bishop and counselor always appear together: bishopric admin
-- authority is shared, and any admin change notifies the other two (CLAUDE.md §7).

insert into notification_settings (ward_id, trigger_key, default_roles, is_globally_enabled)
select ward.id, trigger.key, trigger.default_roles, true
from wards ward
cross join (values
  -- Talk pipeline
  ('plan_submitted',                array['bishop', 'counselor']::text[]),
  ('plan_approved',                 array['bishop', 'counselor', 'executive_secretary']),
  ('plan_change_requested',         array['bishop', 'counselor']),
  ('assignment_declined',           array['bishop', 'counselor', 'executive_secretary']),
  ('message_approved_ready',        array['bishop', 'counselor', 'executive_secretary']),
  ('sunday_confirmation_request',   array['bishop', 'counselor', 'executive_secretary']),
  ('issue_flagged_post_sunday',     array['bishop', 'counselor']),
  ('appreciation_comments_ready',   array['bishop', 'counselor']),

  -- Admin
  ('admin_setting_changed',         array['bishop', 'counselor']),

  -- Calendar
  -- Recipients are resolved EXPLICITLY by lib/notifications/notifyOrgLeadership.ts, so this
  -- default_roles list is the opt-out surface rather than the address list: a change to the
  -- Elders Quorum rotation reaches the Elders Quorum presidency only, never every president
  -- in the ward.
  ('org_conducting_rotation_changed', array['org_president', 'org_counselor', 'org_secretary']),

  -- Visits
  ('visit_overdue',                 array['org_president', 'org_counselor', 'org_secretary']),
  ('visit_flagged_for_ward_council', array['bishop', 'counselor', 'ward_council_member']),
  ('new_household_added',           array['bishop', 'counselor', 'org_president', 'ward_secretary']),

  -- Youth activities
  ('youth_activity_added',          array['org_president', 'org_counselor', 'org_secretary']),
  ('youth_event_uncovered',         array['org_president', 'org_counselor']),
  ('youth_support_assigned',        array['org_president', 'org_counselor', 'org_secretary']),
  ('youth_followup_prompt',         array['org_president', 'org_counselor', 'org_secretary']),
  ('youth_followup_submitted',      array['org_president', 'org_counselor']),

  -- Agendas
  ('agenda_published',              array['bishop', 'counselor', 'ward_council_member', 'executive_secretary']),
  ('agenda_email_distributed',      array['bishop', 'counselor', 'executive_secretary']),

  -- Sacrament administration
  ('sacrament_assignments_sent',    array['bishop', 'counselor']),
  ('sacrament_assignments_overdue', array['bishop', 'counselor']),
  ('sacrament_manager_changed',     array['bishop', 'counselor']),

  -- Youth accounts
  ('youth_account_locked',          array['bishop', 'counselor'])
) as trigger(key, default_roles)
on conflict (ward_id, trigger_key) do nothing;
