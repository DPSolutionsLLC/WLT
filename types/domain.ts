export const ROLES = [
  "bishop",
  "counselor",
  "ward_secretary",
  "executive_secretary",
  "org_president",
  "org_counselor",
  "org_secretary",
  "music_coordinator",
  "ward_council_member",
  "sacrament_manager",
] as const;
export type Role = (typeof ROLES)[number];

// Every role name a user will ever see. Kept beside ROLES so a role added there fails to
// compile until someone decides what to call it on screen.
export const ROLE_LABELS: Record<Role, string> = {
  bishop: "Bishop",
  counselor: "Counselor",
  ward_secretary: "Ward Secretary",
  executive_secretary: "Executive Secretary",
  org_president: "Organization President",
  org_counselor: "Organization Counselor",
  org_secretary: "Organization Secretary",
  music_coordinator: "Music Coordinator",
  ward_council_member: "Ward Council Member",
  sacrament_manager: "Sacrament Manager",
};

export const ORGANIZATION_TYPES = [
  "bishopric",
  "elders_quorum",
  "relief_society",
  "young_men",
  "young_women",
  "primary",
  "sunday_school",
  "other",
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const PIPELINE_STAGES = [
  "plan",
  "review",
  "approve",
  "request",
  "confirm",
  "notify",
  "speak",
  "appreciate",
  "complete",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const MEMBER_CATEGORIES = ["adult", "youth", "child"] as const;
export type MemberCategory = (typeof MEMBER_CATEGORIES)[number];

export const MEMBER_GENDERS = ["male", "female"] as const;
export type MemberGender = (typeof MEMBER_GENDERS)[number];

export const MEMBER_STATUSES = ["active", "moved_out", "do_not_contact"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const SUNDAY_TYPES = [
  "standard",
  "fast_sunday",
  "stake_conference",
  "general_conference",
  "holiday",
  "special",
] as const;
export type SundayType = (typeof SUNDAY_TYPES)[number];

export const TOPIC_CATEGORIES = [
  "doctrinal",
  "scriptural",
  "conference_talk",
  "seasonal",
  "custom",
] as const;
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];

export const TOPIC_SOURCES = ["ai_generated", "manual", "library"] as const;
export type TopicSource = (typeof TOPIC_SOURCES)[number];

export const TOPIC_STATUSES = ["active", "archived"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export const ASSIGNMENT_TYPES = [
  "sacrament_talk",
  "organizational",
  "returning_missionary",
  "new_member",
  "youth_speaker",
  "high_council",
  "other",
] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const REQUEST_OUTCOMES = ["accepted", "declined", "pending"] as const;
export type RequestOutcome = (typeof REQUEST_OUTCOMES)[number];

export const ASSIGNMENT_HISTORY_OUTCOMES = [
  "accepted",
  "declined",
  "cancelled",
  "completed",
] as const;
export type AssignmentHistoryOutcome =
  (typeof ASSIGNMENT_HISTORY_OUTCOMES)[number];

export const COMMENT_LEVELS = ["month", "assignment"] as const;
export type CommentLevel = (typeof COMMENT_LEVELS)[number];

export const PRAYER_TYPES = ["invocation", "benediction"] as const;
export type PrayerType = (typeof PRAYER_TYPES)[number];

export const PRAYER_STAGES = ["assign", "ask", "confirm", "done"] as const;
export type PrayerStage = (typeof PRAYER_STAGES)[number];

export const HYMN_TYPES = ["opening", "sacrament", "closing"] as const;
export type HymnType = (typeof HYMN_TYPES)[number];

export const PROGRAM_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "distributed",
] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const VISIT_TARGET_TYPES = [
  "all_households",
  "specific_households",
  "custom",
] as const;
export type VisitTargetType = (typeof VISIT_TARGET_TYPES)[number];

export const VISIT_CADENCES = ["annual", "biannual", "custom"] as const;
export type VisitCadence = (typeof VISIT_CADENCES)[number];

export const REPORT_TYPES = ["visit_log", "youth_activity"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const ACTIVITY_TYPES = [
  "sport",
  "performance",
  "academic",
  "community",
  "other",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_SOURCE_TYPES = [
  "ics_upload",
  "google_sync",
  "manual",
] as const;
export type ActivitySourceType = (typeof ACTIVITY_SOURCE_TYPES)[number];

export const EVENT_TYPES = ["home", "away", "tbd"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = [
  "upcoming",
  "covered",
  "uncovered",
  "completed",
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const GOAL_TARGET_TYPES = ["member", "household", "org", "group"] as const;
export type GoalTargetType = (typeof GOAL_TARGET_TYPES)[number];

export const GOAL_STATUSES = ["on_track", "due_soon", "overdue"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const MEETING_TYPES = ["bishopric", "ward_council"] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];

export const AGENDA_STATUSES = ["draft", "published"] as const;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

export const ACTION_ITEM_STATUSES = ["open", "complete"] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

export const KNOWLEDGE_TYPE_TAGS = [
  "standard_works",
  "general_conference",
  "other",
] as const;
export type KnowledgeTypeTag = (typeof KNOWLEDGE_TYPE_TAGS)[number];

export const KNOWLEDGE_STATUSES = ["active", "inactive"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export const THREAD_TYPES = ["org", "ward_council"] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];

export const SACRAMENT_ASSIGNMENT_TYPES = [
  "bread_blessing",
  "water_blessing",
  "setup_takedown",
  "bread_provider",
] as const;
export type SacramentAssignmentType =
  (typeof SACRAMENT_ASSIGNMENT_TYPES)[number];

export const PUBLIC_PAGE_TYPES = ["sacrament_assignments", "program"] as const;
export type PublicPageType = (typeof PUBLIC_PAGE_TYPES)[number];

export type Permission = `${string}.${string}`;

export type SessionUser = {
  id: string;
  wardId: string;
  role: Role;
  orgId: string | null;
  counselorPosition: 1 | 2 | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  themePreference: ThemePreference;
  isActive: boolean;
};
