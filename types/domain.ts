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

// Roles an emailed invite may carry, and the roles the admin user list may assign. A
// sacrament_manager is a youth account authenticated by username and PIN with no email at all,
// so it is created by its own flow in auth-c rather than by an invite link.
export const INVITABLE_ROLES: readonly Role[] = ROLES.filter(
  (role) => role !== "sacrament_manager",
);

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

// Beside PIPELINE_STAGES for the same reason ROLE_LABELS sits beside ROLES: a stage added there
// fails to compile until somebody decides what it is called on screen. The matching colour tokens
// are --stage-<name> in app/globals.css and use these same nine keys.
export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  plan: "Planning",
  review: "In Review",
  approve: "Approved",
  request: "Requested",
  confirm: "Confirmed",
  notify: "Notified",
  speak: "Speaking",
  appreciate: "Appreciation",
  complete: "Complete",
};

export const THEME_PREFERENCES = ["light", "dark", "system"] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const MEMBER_CATEGORIES = ["adult", "youth", "child"] as const;
export type MemberCategory = (typeof MEMBER_CATEGORIES)[number];

export const MEMBER_GENDERS = ["male", "female"] as const;
export type MemberGender = (typeof MEMBER_GENDERS)[number];

export const MEMBER_STATUSES = ["active", "moved_out", "do_not_contact"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const ROSTER_VIEW_MODES = ["household", "list"] as const;
export type RosterViewMode = (typeof ROSTER_VIEW_MODES)[number];

export const SUNDAY_TYPES = [
  "standard",
  "fast_sunday",
  "stake_conference",
  "general_conference",
  "holiday",
  "ward_conference",
  "special",
] as const;
export type SundayType = (typeof SUNDAY_TYPES)[number];

// A Record, not a lookup with a fallback, for the same reason ROLE_LABELS is one: a type added
// to SUNDAY_TYPES fails to compile until somebody decides what it is called on screen.
export const SUNDAY_TYPE_LABELS: Record<SundayType, string> = {
  standard: "Standard",
  fast_sunday: "Fast Sunday",
  stake_conference: "Stake Conference",
  general_conference: "General Conference",
  holiday: "Holiday",
  ward_conference: "Ward Conference",
  special: "Special",
};

// A Sunday of one of these types cannot BE Fast Sunday, so Fast Sunday moves past it. That is
// the ONLY question this list answers. It used to answer a second one — "does this Sunday hold a
// sacrament meeting" — because the two sets happened to coincide; NO_MEETING_SUNDAY_TYPES below
// now owns that question, and neither list may be read for the other's meaning.
//
// `ward_conference` is the type that proved the split was needed: it is the first type that
// cannot be Fast Sunday while still holding an ordinary sacrament meeting, with a conductor,
// speakers and organization meetings. Adding it to a list that meant both things would have
// cancelled its meeting.
//
// `special` is deliberately absent: a special meeting still holds a fast and testimony meeting
// unless somebody says otherwise. 03-calendar.md §Step 2 defines the set.
export const FAST_SUNDAY_DISPLACING_TYPES: readonly SundayType[] = [
  "stake_conference",
  "general_conference",
  "holiday",
  "ward_conference",
];

// A Sunday of one of these types holds NO sacrament meeting at all: no conductor, no speakers,
// no organization meetings, and it costs nobody a turn in the rotation.
//
// `holiday` is absent on purpose. A ward that marks Christmas Sunday as a holiday still meets,
// often with a shortened or music-focused service — it simply cannot be Fast Sunday. Treating
// `holiday` as a cancelled meeting warned bishoprics that their speakers were being orphaned
// when nothing of the sort was happening.
//
// `ward_conference` is absent for the same kind of reason: it holds a completely normal meeting
// and is only barred from being Fast Sunday.
export const NO_MEETING_SUNDAY_TYPES: readonly SundayType[] = [
  "stake_conference",
  "general_conference",
];

// The predicate call sites read. Prefer it over the array everywhere except a filter that
// genuinely needs the list itself — a named question is harder to point at the wrong list than
// an `includes` call is.
export function holdsSacramentMeeting(type: SundayType): boolean {
  return !NO_MEETING_SUNDAY_TYPES.includes(type);
}

export const ROTATION_POSITIONS = [1, 2, 3] as const;
export type RotationPosition = (typeof ROTATION_POSITIONS)[number];

// How fast a rotation advances. 03-calendar.md Step 3 describes the weekly cycle, which is the
// default and what every existing ward runs; monthly hands over at the month boundary, one
// person taking every Sunday in a month.
export const ROTATION_CADENCES = ["weekly", "monthly"] as const;
export type RotationCadence = (typeof ROTATION_CADENCES)[number];

// Sentences, not the words "Weekly" and "Monthly". This is the control most likely to be set
// wrong by somebody who has not read a plan, and "Monthly" alone does not distinguish "one
// person per month" from "the rotation restarts monthly".
export const ROTATION_CADENCE_LABELS: Record<RotationCadence, string> = {
  weekly: "A different person each Sunday",
  monthly: "One person for the whole month",
};

// The organization types that hold a presidency and may therefore run their own conducting
// rotation. `bishopric` is absent because its rotation IS the sacrament-meeting one, keyed by a
// NULL org_id (migration 024, Part 2); `other` is absent because it has no presidency to rotate.
export const ROTATION_ELIGIBLE_ORG_TYPES: readonly OrganizationType[] =
  ORGANIZATION_TYPES.filter((type) => type !== "bishopric" && type !== "other");

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

// A Record rather than a lookup with a fallback, for the same reason ROLE_LABELS is one: a
// category added to TOPIC_CATEGORIES must not silently render as its snake_case column value.
export const TOPIC_CATEGORY_LABELS: Record<TopicCategory, string> = {
  doctrinal: "Doctrinal",
  scriptural: "Scriptural",
  conference_talk: "Conference talk",
  seasonal: "Seasonal",
  custom: "Custom",
};

// The AI accept/reject queue (migration 028). A candidate is a PROPOSAL: it is not a topic, it
// is not in the topic library, and nothing moves it there but an explicit accept by a person
// (CLAUDE.md rule 3). Phase 5 writes `pending` rows here and never touches `topics` at all.
export const TOPIC_CANDIDATE_STATUSES = ["pending", "accepted", "rejected"] as const;
export type TopicCandidateStatus = (typeof TOPIC_CANDIDATE_STATUSES)[number];

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

// A Record rather than a lookup with a fallback, for the same reason PIPELINE_STAGE_LABELS is
// one: a type added to ASSIGNMENT_TYPES must not render as its own snake_case key.
//
// Moved here from AssignmentModal when talks-d's speaker history became a second reader
// (conventions.md §Components: a thing used by two modules moves, it is not copied).
export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  sacrament_talk: "Sacrament talk",
  organizational: "Organizational",
  returning_missionary: "Returning missionary",
  new_member: "New member",
  youth_speaker: "Youth speaker",
  high_council: "High council",
  other: "Other",
};

// Whether an assignment TYPE counts toward the ward's member speaking rotation
// (04-talks-pipeline.md §Step 2). A Record rather than a lookup with a fallback, for the same
// reason ROLE_LABELS is one: a type added to ASSIGNMENT_TYPES must not silently default to
// counting.
//
// This is NOT a "cancelled" flag. A cancelled or reverted assignment is excluded by its STAGE,
// never by this record. Reusing it to mean "cancelled" would be a bug nobody could see.
export const COUNTS_TOWARD_ROTATION: Record<AssignmentType, boolean> = {
  sacrament_talk: true,
  organizational: false,
  returning_missionary: false,
  new_member: false,
  youth_speaker: false,
  high_council: false,
  other: false,
};

// The one stage that means the talk actually happened. Every speaker-history and "who has
// spoken recently" query filters on it (04-talks-pipeline.md §Step 2, rule 1). Filtering on a
// row's mere existence instead counts a talk that was never given, quietly suppresses that
// member from the rotation for months, and produces no symptom until somebody asks why a
// family has not been asked to speak in a year.
export const COMPLETED_STAGE: PipelineStage = "complete";

// Who is speaking in a slot. `external` is ITER-004 — a visiting stake leader or a missionary
// reporting home, who is not on the ward roster. `empty` is a real state, not a missing one: an
// assignment at stage `plan` has no speaker yet, and a decline or a calendar revert returns a
// filled one to exactly that.
export const SPEAKER_KINDS = ["member", "external", "empty"] as const;
export type SpeakerKind = (typeof SPEAKER_KINDS)[number];

export const MAX_EXTERNAL_SPEAKER_NAME = 120;
export const MAX_EXTERNAL_SPEAKER_TITLE = 60;

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

export const PRAYER_TYPE_LABELS: Record<PrayerType, string> = {
  invocation: "Invocation",
  benediction: "Benediction",
};

export const PRAYER_STAGES = ["assign", "ask", "confirm", "done"] as const;
export type PrayerStage = (typeof PRAYER_STAGES)[number];

export const PRAYER_STAGE_LABELS: Record<PrayerStage, string> = {
  assign: "Assigned",
  ask: "Asked",
  confirm: "Confirmed",
  done: "Done",
};

// The one prayer stage that means the prayer was actually given. Every "last prayed" lookup
// filters on it, for the same reason COMPLETED_STAGE exists for talks: counting a prayer that
// was only ever ASKED suppresses that member from the rotation with no symptom at all
// (04-talks-pipeline.md §Step 2, rule 1).
export const PRAYER_COMPLETED_STAGE: PrayerStage = "done";

export const HYMN_TYPES = ["opening", "sacrament", "closing"] as const;
export type HymnType = (typeof HYMN_TYPES)[number];

export const PROGRAM_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "distributed",
] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

// Beside PROGRAM_STATUSES for the same reason ROLE_LABELS sits beside ROLES: a status added
// there fails to compile until somebody decides what it is called on screen.
//
// "Waiting for approval", not "Pending" — the secretary who submitted it is waiting on a person,
// and the label should say so rather than describe a column value.
export const PROGRAM_STATUS_LABELS: Record<ProgramStatus, string> = {
  draft: "Draft",
  pending_approval: "Waiting for approval",
  approved: "Approved",
  distributed: "Distributed",
};

// The CLOSED set of things a program draft can report as absent.
//
// A closed set rather than free text, because program-b renders one written sentence per key
// instead of interpolating a raw field name into "X is missing" — "sacrament_hymn is missing" is
// a column name leaking onto a bishop's screen, which is calendar-b's raw-uuid rule again.
//
// This is NOT an error list. A program built on Thursday with six entries here is the normal
// case (06-program-music.md §Step 2). Absent is null in the draft, and this names it; no field
// is ever the string "TBD" or "Not yet assigned", because program-d would print that as though
// somebody had typed it.
//
// `organist` and `chorister` have no upstream table in this schema — 06-program-music.md sources
// them from "music coordinator entry or manual", and neither exists until program-e. They
// therefore assemble as null and appear here every time, until somebody types them in program-b.
export const MISSING_FIELD_KEYS = [
  "presiding_unconfirmed_ward_conference",
  "opening_hymn",
  "sacrament_hymn",
  "closing_hymn",
  "invocation",
  "benediction",
  "speaker_slot",
  "organist",
  "chorister",
  "announcements",
] as const;
export type MissingFieldKey = (typeof MISSING_FIELD_KEYS)[number];

// The sentence a person reads. A Record rather than a lookup with a fallback, for the same
// reason PROGRAM_STATUS_LABELS is one.
//
// Each says what to DO, not what is null. "Nobody is assigned to a speaking slot yet" is a fact
// about the meeting; "speaker_slot is missing" is a fact about a database column.
export const MISSING_FIELD_LABELS: Record<MissingFieldKey, string> = {
  presiding_unconfirmed_ward_conference:
    "A ward conference usually has a visiting presiding officer. Confirm who is presiding.",
  opening_hymn: "No opening hymn has been chosen.",
  sacrament_hymn: "No sacrament hymn has been chosen.",
  closing_hymn: "No closing hymn has been chosen.",
  invocation: "Nobody has been asked to give the invocation.",
  benediction: "Nobody has been asked to give the benediction.",
  speaker_slot: "A speaking slot has no confirmed speaker.",
  organist: "No organist has been named.",
  chorister: "No chorister has been named.",
  announcements: "No announcements have been written.",
};

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

// A Record rather than a lookup with a fallback, for the same reason ROLE_LABELS is one: a tag
// added to KNOWLEDGE_TYPE_TAGS must not silently render as its raw snake_case column value.
export const KNOWLEDGE_TYPE_TAG_LABELS: Record<KnowledgeTypeTag, string> = {
  standard_works: "Standard works",
  general_conference: "General conference",
  other: "Other",
};

// "Inactive", not "Archived" or "Disabled". A document is excluded from retrieval and nothing
// else — it is still listed, still downloadable, and reactivating it costs one tap.
export const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

// The upload ceiling, in BYTES. Lives here rather than in lib/knowledge/parseDocument.ts so
// UploadForm — a client component — can check a file before sending it without importing a
// module that pulls in unpdf. parseDocument.ts re-exports it so the server checks the same
// number; two copies of this constant is how a client-side check starts disagreeing with the
// route that actually enforces it.
//
// 10 MB is roughly where a single upload stops finishing inside the route's 60-second budget.
// Anything larger belongs in supabase/scripts/ingestStandardWorks.ts.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// What the file picker offers and what the route accepts. Extension → the suffix used to build
// the storage key.
export const SUPPORTED_UPLOAD_EXTENSIONS = ["txt", "md", "pdf"] as const;
export type SupportedUploadExtension = (typeof SUPPORTED_UPLOAD_EXTENSIONS)[number];

// One document in the knowledge base.
//
// `chunkCount` and `embeddedCount` are TWO NUMBERS on purpose. A partial embedding failure is
// recorded rather than swallowed (lib/knowledge/ingest.ts), and "412 passages, 410 embedded" is
// how that reaches a human instead of becoming quietly worse retrieval months later.
//
// `speaker`, `speakerRole` and `conferenceDate` are ALL NULL for everything ingested before
// ai-d, the standard works included, and they stay null for anything that is not a conference
// talk. A `general_conference` document with three nulls is invisible to every filter — which,
// per migration 033's predicate, means it is silently ALWAYS INCLUDED. DocumentList badges that
// document "Not filterable" rather than leaving the silence to be discovered months later.
export type KnowledgeDocument = {
  id: string;
  title: string;
  typeTag: KnowledgeTypeTag | null;
  fileUrl: string | null;
  status: KnowledgeStatus;
  speaker: string | null;
  speakerRole: SpeakerRole | null;
  conferenceDate: string | null;
  uploadedBy: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
  chunkCount: number;
  embeddedCount: number;
};

// ---------------------------------------------------------------------------------------------
// Phase 5 — the AI platform
// ---------------------------------------------------------------------------------------------

// SIX entries. Each one has a route that calls it — a module-instruction block nothing calls
// reads as finished work. `hymn_suggestions` arrived with program-e and is called by
// GET /api/hymns/suggest.
export const AI_MODULES = [
  "settings_preview",
  "topic_suggestions",
  "confirmation_message",
  "thank_you_message",
  "program_edit",
  "hymn_suggestions",
] as const;
export type AiModule = (typeof AI_MODULES)[number];

export const STANDARD_WORKS = [
  "old_testament",
  "new_testament",
  "book_of_mormon",
  "doctrine_and_covenants",
  "pearl_of_great_price",
] as const;
export type StandardWork = (typeof STANDARD_WORKS)[number];

// A Record rather than a lookup with a fallback, for the same reason ROLE_LABELS is one: a work
// added to STANDARD_WORKS must not silently default to its raw snake_case name on screen.
export const STANDARD_WORK_LABELS: Record<StandardWork, string> = {
  old_testament: "Old Testament",
  new_testament: "New Testament",
  book_of_mormon: "Book of Mormon",
  doctrine_and_covenants: "Doctrine and Covenants",
  pearl_of_great_price: "Pearl of Great Price",
};

// ---------------------------------------------------------------------------------------------
// Conference corpus scoping (ai-d)
// ---------------------------------------------------------------------------------------------

// Matches the CHECK constraint on knowledge_documents.speaker_role (migration 033) EXACTLY. A
// value here the constraint rejects is a 400 nobody can diagnose from the UI, so the two lists
// are kept identical on purpose and tests/lib/conferenceMetadata.test.ts asserts the count.
export const SPEAKER_ROLES = [
  "prophet",
  "apostle",
  "seventy",
  "presiding_bishopric",
  "auxiliary",
  "other",
] as const;
export type SpeakerRole = (typeof SPEAKER_ROLES)[number];

// A Record rather than a lookup with a fallback, for the same reason ROLE_LABELS is one: a role
// added to SPEAKER_ROLES must not silently render as its raw snake_case column value.
export const SPEAKER_ROLE_LABELS: Record<SpeakerRole, string> = {
  prophet: "President of the Church",
  apostle: "Apostle",
  seventy: "Seventy",
  presiding_bishopric: "Presiding Bishopric",
  auxiliary: "Auxiliary leader",
  other: "Other",
};

// The three axes a conference talk can actually be filtered on, resolved down to what
// match_document_chunks takes. This is the shape retrieval passes to the database, not the shape
// a ward configures — see ConferenceScopeSettings for that.
//
// NULL MEANS "THIS AXIS IS NOT FILTERED", never an empty array. `= any ('{}')` matches NOTHING,
// so an empty array would silently narrow the corpus to zero while reading exactly like "no
// restriction". Migration 034 refuses to store one; mergeConferenceScope refuses to build one.
export type ConferenceScope = {
  since: string | null;
  speakerRoles: readonly SpeakerRole[] | null;
  speakers: readonly string[] | null;
};

// What a ward configures in the scope panel, stored inside ai_settings.conference_preferences.
//
// `sinceYears` is RELATIVE and stored as a number of years, resolved to a date at retrieval time.
// Storing the absolute date would mean "the last two years" quietly came to mean "since August
// 2026" and drifted further from the truth every month.
//
// `speakerRoles: []` means NO RESTRICTION, not "no roles". That distinction is on screen in
// ScopePanel because an empty checkbox group silently meaning "everything" is the same trap as
// an empty `WHERE ... IN ()`.
export type ConferenceScopeSettings = {
  sinceYears: number | null;
  speakerRoles: readonly SpeakerRole[];
  savedFilterIds: readonly string[];
};

// A filter a ward taught the app once, in its own words, and reuses by ticking a box.
//
// `since` here is ABSOLUTE, unlike ConferenceScopeSettings.sinceYears, and the difference is
// deliberate. A saved filter is a PINNED STATEMENT — "talks since April 2021" means the same
// thing next year as it does today. The panel's recency select is the live, relative control.
// `sourcePhrase` is what the user typed, which is the only durable explanation of why the three
// columns hold what they hold.
export type SavedFilter = {
  id: string;
  label: string;
  sourcePhrase: string;
  speakerRoles: readonly SpeakerRole[] | null;
  speakers: readonly string[] | null;
  since: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
};

// What the resolver proposes back from a typed phrase. A DISCRIMINATED UNION with three arms,
// and the middle one is the point of the feature.
//
// The corpus can be filtered by WHO SPOKE AND WHEN. It cannot be filtered by what a talk is
// ABOUT — that is what the vector search already does on every single call. Someone typing
// "talks about the temple" is asking for something they are already getting, and building them a
// metadata filter from it would produce a filter matching nothing while looking like it worked.
export type ResolvedFilter =
  | {
      kind: "filter";
      label: string;
      speakerRoles: readonly SpeakerRole[] | null;
      speakers: readonly string[] | null;
      since: string | null;
    }
  | { kind: "semantic"; explanation: string }
  | { kind: "unresolvable"; explanation: string };

// `maxYearsOld: null` means "no recency limit" and is spelled that way in the prose renderer.
// It is NOT zero, and a renderer that treats it as zero silently forbids every conference talk.
//
// `maxYearsOld` AND `scope` ARE TWO DIFFERENT THINGS AND THE PANEL SAYS SO IN WORDS.
// `maxYearsOld` is prose sent to the model — "prefer recent talks when you cite one" — and it
// shapes OUTPUT. `scope` is a SQL filter and it decides which talks are searchable at all, which
// shapes INPUT. Both are legitimate, they live on different screens, and shipping them without
// naming the difference is how a bishopric ends up with two recency controls it cannot tell
// apart. ScopePanel carries that sentence.
//
// `scope` is NULLABLE AND DEFAULTS TO NULL, which is load-bearing rather than lazy: every
// ai_settings row written before ai-d has no `scope` key at all, and lib/ai/queries.ts parses
// stored rows through conferencePreferencesSchema. A required field there would fail the parse
// and silently discard every ward's existing conference preferences.
export type ConferencePreferences = {
  maxYearsOld: number | null;
  maxTalks: number;
  preferKnowledgeBase: boolean;
  scope: ConferenceScopeSettings | null;
};

// `maxReferences: 0` means "do not suggest scriptures" — a real choice, not an unset field.
export type ScripturePreferences = {
  canonPriority: readonly StandardWork[];
  maxReferences: number;
  relevanceNotes: string | null;
};

// One saved version of a ward's AI configuration. `ai_settings` is APPEND-ONLY (migration 014):
// the row with the latest created_at is the active one, and no row is ever updated or deleted.
export type AiSettings = {
  id: string;
  toneVoice: string | null;
  doctrinalEmphasis: string | null;
  scripturePreferences: ScripturePreferences | null;
  conferencePreferences: ConferencePreferences | null;
  topicPreferences: string | null;
  wardContext: string | null;
  thankYouPreferences: string | null;
  savedBy: string | null;
  createdAt: string;
};

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
