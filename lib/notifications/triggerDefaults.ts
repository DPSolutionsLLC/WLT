import type { Role } from "@/types/domain";

// THE NOTIFICATION TRIGGER LIST, AS A TYPESCRIPT SOURCE — the FOURTH copy, and it exists because a
// ward created from the Stakes & Wards screen (lib/units/provisionWard.ts) needs its
// notification_settings rows and app code cannot read a seed file.
//
// supabase/seed/notification_triggers.sql stays the canonical list. The SQL cannot import this
// file, so the copies are kept equal by tests/db/notification-triggers-seed.test.ts, which diffs
// this one against the seed in both directions and on default_roles — not by care. A key added to
// the seed and not here is a notification that silently never fires in every ward created after.

export type NotificationTriggerDefault = {
  triggerKey: string;
  defaultRoles: readonly Role[];
};

export const NOTIFICATION_TRIGGER_DEFAULTS: readonly NotificationTriggerDefault[] = [
  { triggerKey: "plan_submitted", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "plan_approved", defaultRoles: ["bishop", "counselor", "executive_secretary"] },
  { triggerKey: "plan_change_requested", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "assignment_declined", defaultRoles: ["bishop", "counselor", "executive_secretary"] },
  { triggerKey: "message_approved_ready", defaultRoles: ["bishop", "counselor", "executive_secretary"] },
  { triggerKey: "sunday_confirmation_request", defaultRoles: ["bishop", "counselor", "executive_secretary"] },
  { triggerKey: "issue_flagged_post_sunday", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "appreciation_comments_ready", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "assignment_reverted", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "admin_setting_changed", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "org_conducting_rotation_changed", defaultRoles: ["org_president", "org_counselor", "org_secretary"] },
  { triggerKey: "visit_overdue", defaultRoles: ["org_president", "org_counselor", "org_secretary"] },
  { triggerKey: "visit_flagged_for_ward_council", defaultRoles: ["executive_secretary"] },
  { triggerKey: "new_household_added", defaultRoles: ["bishop", "counselor", "org_president", "ward_secretary"] },
  { triggerKey: "youth_activity_added", defaultRoles: ["org_president", "org_counselor", "org_secretary"] },
  { triggerKey: "youth_event_uncovered", defaultRoles: ["org_president", "org_counselor"] },
  { triggerKey: "youth_support_assigned", defaultRoles: ["org_president", "org_counselor", "org_secretary"] },
  { triggerKey: "youth_followup_prompt", defaultRoles: ["org_president", "org_counselor", "org_secretary"] },
  { triggerKey: "youth_followup_submitted", defaultRoles: ["org_president", "org_counselor"] },
  { triggerKey: "youth_activity_flagged_for_ward_council", defaultRoles: ["executive_secretary"] },
  { triggerKey: "program_pending_approval", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "program_approved", defaultRoles: ["bishop", "counselor", "ward_secretary"] },
  { triggerKey: "program_changes_requested", defaultRoles: ["bishop", "counselor", "ward_secretary"] },
  { triggerKey: "program_distributed", defaultRoles: ["bishop", "counselor", "ward_secretary"] },
  { triggerKey: "agenda_published", defaultRoles: ["bishop", "counselor", "ward_council_member", "executive_secretary"] },
  { triggerKey: "agenda_email_distributed", defaultRoles: ["bishop", "counselor", "executive_secretary"] },
  { triggerKey: "sacrament_assignments_sent", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "sacrament_assignments_overdue", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "sacrament_manager_changed", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "music_topics_ready", defaultRoles: ["music_coordinator"] },
  { triggerKey: "music_submitted", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "music_sent_back", defaultRoles: ["music_coordinator"] },
  { triggerKey: "access_request_submitted", defaultRoles: [] },
  { triggerKey: "access_request_decided", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "access_app_wide_grant", defaultRoles: ["bishop", "counselor"] },
  { triggerKey: "youth_account_locked", defaultRoles: ["bishop", "counselor"] },
];
