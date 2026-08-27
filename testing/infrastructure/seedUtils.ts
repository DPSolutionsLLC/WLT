import { createHash } from "node:crypto";
import { syntheticYouthEmail } from "../../lib/auth/syntheticYouthEmail.ts";
import { getAdminClient } from "./adminClient.ts";
import { loadEnvironment } from "./envLoader.ts";
import type {
  AppointmentStatus,
  ActivityType,
  AgendaStatus,
  AssignmentType,
  CommentLevel,
  HymnType,
  KnowledgeStatus,
  KnowledgeTypeTag,
  MeetingType,
  MemberCategory,
  MemberGender,
  MemberStatus,
  OrganizationType,
  PipelineStage,
  PrayerStage,
  PrayerType,
  ProgramStatus,
  PublicPageType,
  ReportType,
  RequestOutcome,
  Role,
  RotationCadence,
  SacramentAssignmentType,
  SpeakerRole,
  StandardWork,
  SundayType,
  TopicCandidateStatus,
  TopicCategory,
  TopicSource,
  TopicStatus,
  CadenceUnit,
  VisitTargetType,
  VisitArrangement,
  VisitOutcome,
  VisitType,
} from "./types.ts";

// ============================================================================
// The test ward IS the isolation boundary.
//
// Postgres primary keys here are UUIDs, so there is nothing to prefix with "__test__". Every
// table in this schema is ward-scoped instead, and every child row cascades from `wards` on
// delete — so one ward id is a complete, safe unit of cleanup. cleanUp.ts deletes this ward
// and nothing else, which is what keeps the harness usable against the shared hosted project
// (CLAUDE.md §9) without ever risking a real ward or the Development Ward.
// ============================================================================

export const TEST_WARD_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_EMAIL_DOMAIN = "harness.wardleadershiptools.test";

// Youth accounts do not sit on TEST_EMAIL_DOMAIN — they carry the synthetic address
// syntheticYouthEmail() builds, which is keyed by ward id. cleanUp.ts has to match both
// domains or a youth auth user survives `npm run seed:clean` and leaves a working login on a
// shared project. It also makes the next seed take updateUserById instead of createUser, which
// fails for any PIN under six characters — a confusing failure a long way from its cause.
export const TEST_YOUTH_EMAIL_DOMAIN = `youth.${TEST_WARD_ID}.invalid`;

// The Development Ward from supabase/seed/ward.sql. Named here only so the guard in
// cleanUp.ts can prove it is never the delete target.
export const DEVELOPMENT_WARD_ID = "00000000-0000-4000-8000-000000000001";

export const TEST_ORG_IDS = {
  bishopric: "11111111-1111-4111-8111-1111111111a1",
  eldersQuorum: "11111111-1111-4111-8111-1111111111a2",
  reliefSociety: "11111111-1111-4111-8111-1111111111a3",
  youngMen: "11111111-1111-4111-8111-1111111111a4",
  youngWomen: "11111111-1111-4111-8111-1111111111a5",
  primary: "11111111-1111-4111-8111-1111111111a6",
  sundaySchool: "11111111-1111-4111-8111-1111111111a7",
} as const;

export type TestOrgKey = keyof typeof TEST_ORG_IDS;

const ORG_DEFINITIONS: Array<{ key: TestOrgKey; name: string; type: OrganizationType }> = [
  { key: "bishopric", name: "Bishopric", type: "bishopric" },
  { key: "eldersQuorum", name: "Elders Quorum", type: "elders_quorum" },
  { key: "reliefSociety", name: "Relief Society", type: "relief_society" },
  { key: "youngMen", name: "Young Men", type: "young_men" },
  { key: "youngWomen", name: "Young Women", type: "young_women" },
  { key: "primary", name: "Primary", type: "primary" },
  { key: "sundaySchool", name: "Sunday School", type: "sunday_school" },
];

// Stable ids from a label, so a scenario can refer to the same row across re-seeds and a
// tester can recognise a row in the database. All of these live inside the test ward.
export function testUuid(label: string): string {
  const hex = createHash("sha256").update(`wlt-harness:${label}`).digest("hex");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function testEmail(handle: string): string {
  return `${handle.toLowerCase()}@${TEST_EMAIL_DOMAIN}`;
}

// These accounts can actually sign in to the app, on the same project as real data, so the
// password is an environment variable rather than a constant in the repo (CLAUDE.md rule 8).
export function testPassword(): string {
  loadEnvironment();

  const password = process.env.HARNESS_TEST_PASSWORD;
  if (!password) {
    throw new Error(
      "Missing HARNESS_TEST_PASSWORD. Harness accounts can sign in to the real app, so the " +
        "password is not hardcoded. Add a line like HARNESS_TEST_PASSWORD=choose-something-long " +
        "to .env.local (or testing/.env) and re-run.",
    );
  }

  if (password.length < 12) {
    throw new Error("HARNESS_TEST_PASSWORD must be at least 12 characters.");
  }

  return password;
}

async function insertRow(
  table: string,
  row: Record<string, unknown>,
  conflictTarget?: string,
): Promise<string> {
  const builder = getAdminClient().from(table);

  const { data, error } = conflictTarget
    ? await builder.upsert(row, { onConflict: conflictTarget }).select("id").single()
    : await builder.insert(row).select("id").single();

  if (error) {
    throw new Error(`Could not seed ${table}: ${error.message}`);
  }

  return String((data as { id: string }).id);
}

// ============================================================================
// Ward and organizations
// ============================================================================

// role_access is a per-role add/remove DELTA, not a replacement list (ITER-005):
//   { ward_secretary: { add: ["roster.manage"] }, bishop: { remove: ["calendar.manage"] } }
// admin.* and sacrament.* are locked in both directions and a delta naming them is ignored, and
// a delta naming bishop or counselor applies to both (CLAUDE.md §7).
export type RoleAccessSeed = Record<string, { add?: string[]; remove?: string[] }>;

export type WardOptions = {
  name?: string;
  crossOrgVisibility?: boolean;
  timezone?: string;
  roleAccess?: RoleAccessSeed;
  settings?: Record<string, unknown>;
};

export async function ensureTestWard(options: WardOptions = {}): Promise<string> {
  const supabase = getAdminClient();

  const { error: wardError } = await supabase.from("wards").upsert(
    {
      id: TEST_WARD_ID,
      name: options.name ?? "Harness Test Ward",
      settings: {
        cross_org_visibility: options.crossOrgVisibility ?? false,
        timezone: options.timezone ?? "America/Denver",
        ...(options.roleAccess ? { role_access: options.roleAccess } : {}),
        ...options.settings,
      },
    },
    { onConflict: "id" },
  );

  if (wardError) {
    throw new Error(`Could not create the test ward: ${wardError.message}`);
  }

  const { error: orgError } = await supabase.from("organizations").upsert(
    ORG_DEFINITIONS.map((organization) => ({
      id: TEST_ORG_IDS[organization.key],
      ward_id: TEST_WARD_ID,
      name: organization.name,
      type: organization.type,
    })),
    { onConflict: "id" },
  );

  if (orgError) {
    throw new Error(`Could not create the test organizations: ${orgError.message}`);
  }

  return TEST_WARD_ID;
}

// ============================================================================
// Users
// ============================================================================

export type TestUser = {
  id: string;
  handle: string;
  email: string;
  password: string;
  role: Role;
  orgId: string | null;
};

export type CreateUserOptions = {
  handle: string;
  role: Role;
  org?: TestOrgKey;
  counselorPosition?: 1 | 2;
  firstName?: string;
  lastName?: string;
  username?: string;
  isActive?: boolean;
};

export async function createTestUser(options: CreateUserOptions): Promise<TestUser> {
  const supabase = getAdminClient();
  const email = testEmail(options.handle);
  const password = testPassword();
  const orgId = options.org ? TEST_ORG_IDS[options.org] : null;

  const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const alreadyThere = existing?.users.find((user) => user.email === email);

  let userId: string;

  if (alreadyThere) {
    userId = alreadyThere.id;
    const { error } = await supabase.auth.admin.updateUserById(userId, { password });
    if (error) {
      throw new Error(`Could not reset the password for ${email}: ${error.message}`);
    }
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error || !data.user) {
      throw new Error(
        `Could not create the auth user ${email}: ${error?.message ?? "no user returned"}`,
      );
    }

    userId = data.user.id;
  }

  const { error: rowError } = await supabase.from("users").upsert(
    {
      id: userId,
      ward_id: TEST_WARD_ID,
      first_name: options.firstName ?? options.handle,
      last_name: options.lastName ?? "Harness",
      email,
      username: options.username ?? null,
      role: options.role,
      org_id: orgId,
      counselor_position: options.counselorPosition ?? null,
      is_active: options.isActive ?? true,
    },
    { onConflict: "id" },
  );

  if (rowError) {
    throw new Error(`Could not create the users row for ${email}: ${rowError.message}`);
  }

  return { id: userId, handle: options.handle, email, password, role: options.role, orgId };
}

export type TestYouthAccount = {
  id: string;
  username: string;
  pin: string;
};

export type CreateYouthAccountOptions = {
  username: string;
  pin: string;
  firstName?: string;
  lastName?: string;
  isActive?: boolean;
};

// createTestUser() always builds an email account. A youth account has no email at all: it
// signs in with a username and a PIN, where the PIN is the password on a synthetic Supabase
// Auth address (plans/auth-c-youth-pin.md).
//
// The address comes from the app's own syntheticYouthEmail() rather than being rebuilt here.
// Two copies of that format would drift, and the drift would show up as a seeded youth account
// that cannot sign in for no visible reason.
//
// The PIN is a parameter rather than an environment variable, unlike testPassword(): a
// scenario checklist has to name the exact digits the tester will type, and six digits behind
// a rate limiter is not a secret worth protecting the way a real password is.
export async function createYouthAccount(
  options: CreateYouthAccountOptions,
): Promise<TestYouthAccount> {
  const supabase = getAdminClient();
  const username = options.username.toLowerCase();
  const email = syntheticYouthEmail(username, TEST_WARD_ID);

  const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const alreadyThere = existing?.users.find((user) => user.email === email);

  let userId: string;

  if (alreadyThere) {
    userId = alreadyThere.id;
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      password: options.pin,
    });
    if (error) {
      throw new Error(`Could not reset the PIN for ${username}: ${error.message}`);
    }
  } else {
    // email_confirm: true — there is no inbox to confirm from, and an unconfirmed account
    // cannot sign in.
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: options.pin,
      email_confirm: true,
    });

    if (error || !data.user) {
      throw new Error(
        `Could not create the youth auth user ${username}: ${error?.message ?? "no user returned"}`,
      );
    }

    userId = data.user.id;
  }

  // email stays null, matching createYouthAccount() in lib/auth/youthAccounts.ts: the
  // synthetic address lives in auth.users only.
  const { error: rowError } = await supabase.from("users").upsert(
    {
      id: userId,
      ward_id: TEST_WARD_ID,
      first_name: options.firstName ?? username,
      last_name: options.lastName ?? "Harness",
      email: null,
      username,
      role: "sacrament_manager",
      org_id: null,
      counselor_position: null,
      is_active: options.isActive ?? true,
    },
    { onConflict: "id" },
  );

  if (rowError) {
    throw new Error(
      `Could not create the users row for ${username}: ${rowError.message}`,
    );
  }

  return { id: userId, username, pin: options.pin };
}

// Seeds the failed-attempt counter directly, which is the only sane way to reach the fifth
// failure repeatedly. `youth_login_attempts` has RLS enabled and no policies (migration 021),
// so the admin client is the only thing that can write it.
export async function setYouthLoginAttempts(options: {
  username: string;
  failedCount: number;
  lockedUntil?: string | null;
}): Promise<string> {
  return insertRow(
    "youth_login_attempts",
    {
      ward_id: TEST_WARD_ID,
      username: options.username.toLowerCase(),
      failed_count: options.failedCount,
      locked_until: options.lockedUntil ?? null,
      last_failed_at: new Date().toISOString(),
    },
    "ward_id,username",
  );
}

// ============================================================================
// Roster
// ============================================================================

// The ADDRESS is part of the derived id, not just the family name. Two households can share a
// family name — scenario 008 seeds "Smith, 3 North Road" and "Smith, 91 South Road" on purpose,
// because keeping them apart is exactly what the picker's household grouping has to do, and
// apply_roster_import (migration 022) matches on the pair for the same reason.
//
// Keyed on the family name alone, both Smiths derived the SAME uuid and the second insert failed
// on households_pkey, aborting the whole seed after three households and zero members. Scenario
// 008 had therefore never once seeded successfully.
export async function createHousehold(options: {
  id?: string;
  familyName: string;
  address?: string;
  // "May we call on this family at all." A do-not-contact household stays on the roster, stays
  // VISIBLE and marked on the visit dashboard, and is counted in no statistic (ITER-018
  // Decision 4). It is a separate axis from a member's `do_not_contact` STATUS, which removes
  // the member from the active list and can empty a household out of the dashboard entirely.
  doNotContact?: boolean;
}): Promise<string> {
  return insertRow("households", {
    id:
      options.id ??
      testUuid(`household:${options.familyName}:${options.address ?? ""}`),
    ward_id: TEST_WARD_ID,
    family_name: options.familyName,
    address: options.address ?? null,
    do_not_contact: options.doNotContact ?? false,
  });
}

// The one DELETE this module offers, and it exists for exactly one state: a goal whose
// polymorphic `target_id` outlives the row it pointed at. `goals.target_id` carries no foreign
// key (migration 010), so nothing in the database prevents that — and it cannot be seeded any
// other way than by writing the goal and then removing the household.
//
// Scoped to the test ward by the same id constant every other factory uses. It deletes ONE row by
// id and nothing else.
export async function deleteHousehold(id: string): Promise<void> {
  const { error } = await getAdminClient()
    .from("households")
    .delete()
    .eq("id", id)
    .eq("ward_id", TEST_WARD_ID);

  if (error) {
    throw new Error(`Could not delete the seeded household: ${error.message}`);
  }
}

export async function createMember(options: {
  id?: string;
  firstName: string;
  lastName: string;
  householdId?: string;
  category?: MemberCategory;
  gender?: MemberGender;
  status?: MemberStatus;
  phone?: string;
}): Promise<string> {
  return insertRow("members", {
    id: options.id ?? testUuid(`member:${options.firstName}:${options.lastName}`),
    ward_id: TEST_WARD_ID,
    household_id: options.householdId ?? null,
    first_name: options.firstName,
    last_name: options.lastName,
    category: options.category ?? "adult",
    gender: options.gender ?? null,
    status: options.status ?? "active",
    phone: options.phone ?? null,
  });
}

export async function addMemberToOrganization(options: {
  memberId: string;
  org: TestOrgKey;
}): Promise<string> {
  return insertRow("member_organizations", {
    ward_id: TEST_WARD_ID,
    member_id: options.memberId,
    org_id: TEST_ORG_IDS[options.org],
  });
}

export async function createMemberNote(options: {
  memberId: string;
  body: string;
  createdBy?: string;
}): Promise<string> {
  return insertRow("member_notes", {
    ward_id: TEST_WARD_ID,
    member_id: options.memberId,
    body: options.body,
    created_by: options.createdBy ?? null,
  });
}

// ============================================================================
// Calendar
// ============================================================================

export async function createSunday(options: {
  id?: string;
  date: string;
  type?: SundayType;
  conductingUserId?: string;
  speakingSlots?: number;
  notes?: string;
  fastSundayPinned?: boolean;
}): Promise<string> {
  return insertRow("sundays", {
    id: options.id ?? testUuid(`sunday:${options.date}`),
    ward_id: TEST_WARD_ID,
    date: options.date,
    type: options.type ?? "standard",
    conducting_user_id: options.conductingUserId ?? null,
    speaking_slots: options.speakingSlots ?? 3,
    notes: options.notes ?? null,
    fast_sunday_pinned: options.fastSundayPinned ?? false,
  });
}

// The three rows that make up ONE rotation, all sharing an effective_from AND a cadence. A
// rotation change inserts a whole new set rather than updating this one (migration 023), which
// is what makes "applies forward only" true by construction — so a scenario seeding two
// rotations calls this twice with different dates rather than editing rows in place. The same
// holds for a cadence change (migration 024, Part 1).
//
// `orgId` omitted is the BISHOPRIC's sacrament-meeting rotation, which is what a NULL org_id
// means in the database. Passing an organization id seeds that organization's own rotation.
export async function createConductingRotation(options: {
  effectiveFrom: string;
  userIds: [string | null, string | null, string | null];
  cadence?: RotationCadence;
  orgId?: string;
}): Promise<string[]> {
  const ids: string[] = [];

  for (const [index, userId] of options.userIds.entries()) {
    ids.push(
      await insertRow(
        "conducting_rotation",
        {
          ward_id: TEST_WARD_ID,
          org_id: options.orgId ?? null,
          position: index + 1,
          user_id: userId,
          effective_from: options.effectiveFrom,
          cadence: options.cadence ?? "weekly",
        },
        "ward_id,org_id,position,effective_from",
      ),
    );
  }

  return ids;
}

// Who conducts ONE organization's meeting on ONE Sunday. Seeding this row IS seeding an
// override — there is no is_override flag, exactly as there is none on
// sundays.conducting_user_id (migration 024, Part 4).
//
// `userId` omitted seeds "nobody assigned yet", which is a real state and what an unfilled
// rotation position resolves to.
export async function createSundayOrgConducting(options: {
  sundayId: string;
  orgId: string;
  userId?: string;
}): Promise<string> {
  return insertRow(
    "sunday_org_conducting",
    {
      ward_id: TEST_WARD_ID,
      sunday_id: options.sundayId,
      org_id: options.orgId,
      user_id: options.userId ?? null,
    },
    "ward_id,sunday_id,org_id",
  );
}

// ============================================================================
// Talk pipeline
// ============================================================================

// `lastAssignedAt` and `status` are what talks-c gave meaning to: the library sorts unused
// topics first and hides archived ones, so a scenario proving either needs to seed both. It is a
// DATE-time string the caller supplies rather than a relative offset, so a re-seed produces the
// same library rather than one that drifts a day each run.
export async function createTopic(options: {
  id?: string;
  title: string;
  category?: TopicCategory;
  description?: string;
  source?: TopicSource;
  status?: TopicStatus;
  lastAssignedAt?: string;
  suggestedScriptures?: string[];
  suggestedTalks?: string[];
}): Promise<string> {
  return insertRow("topics", {
    id: options.id ?? testUuid(`topic:${options.title}`),
    ward_id: TEST_WARD_ID,
    title: options.title,
    category: options.category ?? "doctrinal",
    description: options.description ?? null,
    suggested_scriptures: options.suggestedScriptures ?? null,
    suggested_talks: options.suggestedTalks ?? null,
    source: options.source ?? "manual",
    status: options.status ?? "active",
    last_assigned_at: options.lastAssignedAt ?? null,
  });
}

// The AI accept/reject queue (migration 028). Phase 5 is what will really write these; a
// scenario seeds them directly to stand in for it, which is the whole reason the queue could be
// proven before Phase 5 exists.
//
// The topic_candidates_review_pair CHECK refuses a reviewed row with no reviewer, so `reviewedBy`
// and `reviewedAt` move together — a seed that sets one fails loudly rather than producing a
// state the app can never reach.
export async function createTopicCandidate(options: {
  id?: string;
  title: string;
  category?: TopicCategory;
  description?: string;
  suggestedScriptures?: string[];
  suggestedTalks?: string[];
  status?: TopicCandidateStatus;
  reviewedBy?: string;
}): Promise<string> {
  const status = options.status ?? "pending";
  const isReviewed = status !== "pending";

  if (isReviewed && options.reviewedBy === undefined) {
    throw new Error(
      `createTopicCandidate("${options.title}") set status "${status}" with no reviewedBy. ` +
        "The topic_candidates_review_pair CHECK refuses a reviewed candidate with no reviewer.",
    );
  }

  return insertRow("topic_candidates", {
    id: options.id ?? testUuid(`topic_candidate:${options.title}`),
    ward_id: TEST_WARD_ID,
    title: options.title,
    category: options.category ?? "doctrinal",
    description: options.description ?? null,
    suggested_scriptures: options.suggestedScriptures ?? null,
    suggested_talks: options.suggestedTalks ?? null,
    status,
    reviewed_by: isReviewed ? (options.reviewedBy ?? null) : null,
    reviewed_at: isReviewed ? "2026-05-01T12:00:00.000Z" : null,
  });
}

// A speaker is a ward member OR somebody invited from outside, never both — the
// assignments_speaker_exactly_one CHECK (migration 025) refuses a row with two, and a seed that
// sets both fails loudly rather than producing a state the app can never reach (ITER-004).
export async function createAssignment(options: {
  id?: string;
  sundayId: string;
  memberId?: string;
  externalSpeakerName?: string;
  externalSpeakerTitle?: string;
  topicId?: string;
  assignmentType?: AssignmentType;
  pipelineStage?: PipelineStage;
  slotNumber?: number;
  slotLengthMinutes?: number;
  plannedBy?: string;
  requestOutcome?: RequestOutcome;
  requestNotes?: string;
  notifyMessage?: string;
  notifySentAt?: string;
  sundayConfirmedAt?: string;
  thankYouMessage?: string;
  thankYouSentAt?: string;
  // Both waiver columns move together or neither does — assignments_waiver_pair, migration 025.
  contactWaivedAt?: string;
  contactWaivedBy?: string;
}): Promise<string> {
  return insertRow("assignments", {
    id: options.id ?? testUuid(`assignment:${options.sundayId}:${options.slotNumber ?? 1}`),
    ward_id: TEST_WARD_ID,
    sunday_id: options.sundayId,
    member_id: options.memberId ?? null,
    external_speaker_name: options.externalSpeakerName ?? null,
    external_speaker_title: options.externalSpeakerTitle ?? null,
    topic_id: options.topicId ?? null,
    assignment_type: options.assignmentType ?? "sacrament_talk",
    pipeline_stage: options.pipelineStage ?? "plan",
    slot_number: options.slotNumber ?? 1,
    slot_length_minutes: options.slotLengthMinutes ?? 10,
    planned_by: options.plannedBy ?? null,
    request_outcome: options.requestOutcome ?? null,
    request_notes: options.requestNotes ?? null,
    notify_message: options.notifyMessage ?? null,
    notify_sent_at: options.notifySentAt ?? null,
    sunday_confirmed_at: options.sundayConfirmedAt ?? null,
    thank_you_message: options.thankYouMessage ?? null,
    thank_you_sent_at: options.thankYouSentAt ?? null,
    contact_waived_at: options.contactWaivedAt ?? null,
    contact_waived_by: options.contactWaivedBy ?? null,
  });
}

// One bishopric member's decision on one assignment. assignment_approvals_one_per_user (UNIQUE
// on assignment_id, user_id) is what stops one seeded counselor filling a three-person gate
// alone, so building a 2-of-3 state means three DIFFERENT user ids — which is exactly the state
// that is tedious and error-prone to build by hand, and therefore worth seeding.
export async function createAssignmentApproval(options: {
  assignmentId: string;
  userId: string;
  approved: boolean;
  comment?: string;
}): Promise<string> {
  return insertRow("assignment_approvals", {
    ward_id: TEST_WARD_ID,
    assignment_id: options.assignmentId,
    user_id: options.userId,
    approved: options.approved,
    comment: options.comment ?? null,
  });
}

export async function createAssignmentComment(options: {
  assignmentId?: string;
  sundayId?: string;
  userId: string;
  comment: string;
  level: CommentLevel;
}): Promise<string> {
  return insertRow("assignment_comments", {
    ward_id: TEST_WARD_ID,
    assignment_id: options.assignmentId ?? null,
    sunday_id: options.sundayId ?? null,
    user_id: options.userId,
    comment: options.comment,
    level: options.level,
  });
}

// The stage's TIMESTAMPS are filled in from the stage, so a seeded `done` prayer is a prayer
// that was genuinely asked and confirmed rather than a row with a stage column set. Without
// them, canTransitionPrayer refuses to move a seeded prayer at all and the scenario dead-ends on
// its first press.
//
// One invocation and one benediction per Sunday — migration 028's unique index refuses a second,
// so a seed that assigns the same slot twice fails loudly.
export async function createPrayerAssignment(options: {
  id?: string;
  sundayId: string;
  memberId?: string;
  prayerType: PrayerType;
  stage?: PrayerStage;
  askedBy?: string;
}): Promise<string> {
  const stage = options.stage ?? "assign";

  const hasBeenAsked = stage === "ask" || stage === "confirm" || stage === "done";
  const hasBeenConfirmed = stage === "confirm" || stage === "done";

  return insertRow("prayer_assignments", {
    id: options.id ?? testUuid(`prayer:${options.sundayId}:${options.prayerType}`),
    ward_id: TEST_WARD_ID,
    sunday_id: options.sundayId,
    member_id: options.memberId ?? null,
    prayer_type: options.prayerType,
    stage,
    asked_by: hasBeenAsked ? (options.askedBy ?? null) : null,
    asked_at: hasBeenAsked ? "2026-05-01T12:00:00.000Z" : null,
    confirmed_at: hasBeenConfirmed ? "2026-05-02T12:00:00.000Z" : null,
  });
}

// ============================================================================
// Music and programs
// ============================================================================

// `aiSuggested` DEFAULTS TO FALSE, matching POST /api/hymns/select: a selection that does not say
// otherwise is a person's own choice, and a seed that could not distinguish the two would make
// scenario 036's "the accepted hymn is marked as AI-suggested, the searched ones are not" check
// unwalkable.
export async function createHymnSelection(options: {
  sundayId: string;
  hymnType: HymnType;
  hymnNumber: number;
  hymnTitle: string;
  selectedBy?: string;
  aiSuggested?: boolean;
}): Promise<string> {
  return insertRow("hymn_selections", {
    ward_id: TEST_WARD_ID,
    sunday_id: options.sundayId,
    hymn_type: options.hymnType,
    hymn_number: options.hymnNumber,
    hymn_title: options.hymnTitle,
    selected_by: options.selectedBy ?? null,
    ai_suggested: options.aiSuggested ?? false,
  });
}

export async function createMusicalNumber(options: {
  sundayId: string;
  performer: string;
  pieceTitle: string;
  notes?: string;
}): Promise<string> {
  return insertRow("musical_numbers", {
    ward_id: TEST_WARD_ID,
    sunday_id: options.sundayId,
    performer: options.performer,
    piece_title: options.pieceTitle,
    notes: options.notes ?? null,
  });
}

// `publicData` is the ONLY thing /public/[slug] can read, and `public_program` also requires
// `status = 'distributed'` AND a non-null projection. A scenario that seeds one without the other
// renders a 404, which looks exactly like a broken seed — set all three together or none.
//
// It is written out by hand in the scenario, the same way draftData is, and NOT built by calling
// toPublicProgram(): that module imports through the `@/` alias, which the seed runner does not
// resolve (only supabase/scripts/register.mjs teaches Node that alias, and `npm run seed` does not
// load it). Keep the shape in step with lib/program/publicProjection.ts — a projection the app
// cannot parse makes the page 404 with the reason only in the server log.
export async function createProgram(options: {
  id?: string;
  sundayId: string;
  status?: ProgramStatus;
  pdfUrl?: string;
  draftData?: Record<string, unknown>;
  publicData?: Record<string, unknown>;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  distributedAt?: string;
}): Promise<string> {
  return insertRow("programs", {
    id: options.id ?? testUuid(`program:${options.sundayId}`),
    ward_id: TEST_WARD_ID,
    sunday_id: options.sundayId,
    status: options.status ?? "draft",
    pdf_url: options.pdfUrl ?? null,
    draft_data: options.draftData ?? null,
    public_data: options.publicData ?? null,
    created_by: options.createdBy ?? null,
    approved_by: options.approvedBy ?? null,
    approved_at: options.approvedAt ?? null,
    distributed_at: options.distributedAt ?? null,
  });
}

export async function createPublicPage(options: {
  pageType: PublicPageType;
  slug: string;
  isActive?: boolean;
}): Promise<string> {
  return insertRow("public_pages", {
    ward_id: TEST_WARD_ID,
    page_type: options.pageType,
    slug: options.slug,
    is_active: options.isActive ?? true,
  });
}

// ============================================================================
// Visits
// ============================================================================

// A goal has NO PERIOD. It has a rolling cadence measured from each household's own last
// completed visit, plus a warning window and an optional, presentation-only deadline (ITER-018).
//
// A FIXTURE MUST NOT BE ABLE TO EXPRESS A STATE THE APP CANNOT CREATE. lib/validation/visit.ts
// requires the notice window to be strictly SHORTER than the cadence — a window as long as the
// cadence marks every household "approaching" forever — so the defaults here are a pair that
// satisfies it, and a scenario overriding one should think about the other.
export async function createVisitGoal(options: {
  org: TestOrgKey;
  title: string;
  targetType?: VisitTargetType;
  cadenceAmount?: number;
  cadenceUnit?: CadenceUnit;
  noticeAmount?: number;
  noticeUnit?: CadenceUnit;
  // Presentation only. It drives no arithmetic, and one in the past is a legitimate record of a
  // deadline that passed.
  deadline?: string;
  createdBy?: string;
}): Promise<string> {
  return insertRow("visit_goals", {
    ward_id: TEST_WARD_ID,
    org_id: TEST_ORG_IDS[options.org],
    title: options.title,
    target_type: options.targetType ?? "all_households",
    cadence_amount: options.cadenceAmount ?? 1,
    cadence_unit: options.cadenceUnit ?? "year",
    notice_amount: options.noticeAmount ?? 2,
    notice_unit: options.noticeUnit ?? "month",
    deadline: options.deadline ?? null,
    created_by: options.createdBy ?? null,
  });
}

// This organization's cadence for this household, overriding its goal. ABSENT means "use the
// goal" — there is no sentinel row meaning "default" — so a scenario that wants the default
// simply does not call this.
//
// `unique (household_id, org_id)` means one per pair. Two calls with the same pair collide.
export async function createHouseholdVisitCadence(options: {
  householdId: string;
  org: TestOrgKey;
  cadenceAmount: number;
  cadenceUnit: CadenceUnit;
  createdBy?: string;
}): Promise<string> {
  return insertRow("household_visit_cadences", {
    ward_id: TEST_WARD_ID,
    household_id: options.householdId,
    org_id: TEST_ORG_IDS[options.org],
    cadence_amount: options.cadenceAmount,
    cadence_unit: options.cadenceUnit,
    created_by: options.createdBy ?? null,
  });
}

// `recordedBy` is WHO TYPED IT IN, and it is deliberately not "who went". visits-d split the two
// because they are frequently different people — a secretary records the visits their presidency
// made. Who WENT is seeded separately with createVisitParticipant(), and a visit with NO
// participants is a legitimate fixture that reads "Nobody recorded as visiting".
export async function createVisitLog(options: {
  id?: string;
  org: TestOrgKey;
  householdId?: string;
  recordedBy?: string;
  visitDate: string;
  visitType?: VisitType;
  // Defaults to `completed`, matching migration 046. An `attempted` visit is shown on the record
  // and counted towards no goal, so a scenario that needs the distinction must set it.
  outcome?: VisitOutcome;
  arrangement?: VisitArrangement;
  sharedNotes?: string;
  flaggedForWardCouncil?: boolean;
  // Seeding an ALREADY-SENT flag is the only way to reach the re-flag path in one sitting: the
  // route notifies on false -> true only while flag_sent_at is null, so a fixture that left it
  // null would make "flagging again sends nothing" untestable by hand (07-visits.md §Step 3).
  flagSentAt?: string;
}): Promise<string> {
  return insertRow("visit_logs", {
    id: options.id ?? testUuid(`visit:${options.org}:${options.visitDate}`),
    ward_id: TEST_WARD_ID,
    org_id: TEST_ORG_IDS[options.org],
    household_id: options.householdId ?? null,
    recorded_by: options.recordedBy ?? null,
    visit_date: options.visitDate,
    visit_type: options.visitType ?? "in_home",
    outcome: options.outcome ?? "completed",
    arrangement: options.arrangement ?? "drop_in",
    shared_notes: options.sharedNotes ?? null,
    flagged_for_ward_council: options.flaggedForWardCouncil ?? false,
    flag_sent_at: options.flagSentAt ?? null,
  });
}

// EXACTLY ONE of userId, memberId and label. Migration 046's `visit_participants_one_identity`
// CHECK refuses anything else, so a fixture that set two would fail at the insert rather than
// seed a state the app cannot produce.
//
// `org` must match the parent visit's organization: the column is denormalized from the visit so
// the RLS policy can be the same shape as visit_logs', and a fixture that disagreed would seed a
// participant an org leader could read on a visit they cannot.
export async function createVisitParticipant(options: {
  org: TestOrgKey;
  visitLogId: string;
  userId?: string;
  memberId?: string;
  label?: string;
}): Promise<string> {
  return insertRow("visit_participants", {
    ward_id: TEST_WARD_ID,
    org_id: TEST_ORG_IDS[options.org],
    visit_log_id: options.visitLogId,
    user_id: options.userId ?? null,
    member_id: options.memberId ?? null,
    label: options.label ?? null,
  });
}

// `scheduledFor` is an ISO INSTANT, not a date-only string — an appointment is the one thing in
// this app stored as a timestamptz, because "Tuesday at seven" is the point of arranging one.
//
// A PAST `scheduledFor` left at status `scheduled` is the MISSED fixture, and it is the only way
// to reach that state: "missed" is computed on read and cannot be produced by clicking.
export async function createVisitAppointment(options: {
  id?: string;
  org: TestOrgKey;
  householdId?: string;
  scheduledFor: string;
  status?: AppointmentStatus;
  visitLogId?: string;
  madeBy?: string;
  notes?: string;
}): Promise<string> {
  return insertRow("visit_appointments", {
    id: options.id ?? testUuid(`appointment:${options.org}:${options.scheduledFor}`),
    ward_id: TEST_WARD_ID,
    org_id: TEST_ORG_IDS[options.org],
    household_id: options.householdId ?? null,
    scheduled_for: options.scheduledFor,
    status: options.status ?? "scheduled",
    visit_log_id: options.visitLogId ?? null,
    made_by: options.madeBy ?? null,
    notes: options.notes ?? null,
  });
}

// Per-user read and bookmark state for the return-and-report feed.
//
// SEEDING IS THE ONLY WAY TO REACH THE STATE THIS SCENARIO NEEDS. Per-user read state is invisible
// until two people have looked at the SAME feed, and arranging that by hand means signing in
// twice, tapping a precise number of tiles, and signing back. `readAt` left undefined seeds a
// bookmark on a report the user has not opened — a row with read_at null and flagged true, which
// is exactly the case that proves isRead is a question about the timestamp rather than about the
// row existing.
//
// `flagged` is the PRIVATE per-user bookmark, NOT `visit_logs.flagged_for_ward_council`. Same word
// in the database, unrelated meanings (lib/reports/types.ts).
export async function createReportReadStatus(options: {
  userId: string;
  reportType: ReportType;
  reportId: string;
  readAt?: string;
  bookmarked?: boolean;
}): Promise<string> {
  return insertRow(
    "report_read_status",
    {
      ward_id: TEST_WARD_ID,
      user_id: options.userId,
      report_type: options.reportType,
      report_id: options.reportId,
      read_at: options.readAt ?? null,
      flagged: options.bookmarked ?? false,
    },
    "user_id,report_type,report_id",
  );
}

// The author is the only person who will ever be able to read this back through the app
// (CLAUDE.md rule 5), so userId is required rather than optional.
export async function createVisitPrivateNote(options: {
  visitLogId: string;
  userId: string;
  notes: string;
}): Promise<string> {
  return insertRow("visit_private_notes", {
    ward_id: TEST_WARD_ID,
    visit_log_id: options.visitLogId,
    user_id: options.userId,
    notes: options.notes,
  });
}

// ============================================================================
// Youth activities
// ============================================================================

export async function createYouthActivityProfile(options: {
  id?: string;
  memberId?: string;
  activityName: string;
  activityType?: ActivityType;
  schoolOrg?: string;
  enteredBy?: string;
}): Promise<string> {
  return insertRow("youth_activity_profiles", {
    id: options.id ?? testUuid(`profile:${options.activityName}`),
    ward_id: TEST_WARD_ID,
    member_id: options.memberId ?? null,
    activity_name: options.activityName,
    activity_type: options.activityType ?? "sport",
    school_org: options.schoolOrg ?? null,
    entered_by: options.enteredBy ?? null,
  });
}

export async function createActivityEvent(options: {
  id?: string;
  profileId?: string;
  title: string;
  eventDate: string;
  eventType?: "home" | "away" | "tbd";
  location?: string;
  status?: "upcoming" | "covered" | "uncovered" | "completed";
}): Promise<string> {
  return insertRow("activity_events", {
    id: options.id ?? testUuid(`event:${options.title}:${options.eventDate}`),
    ward_id: TEST_WARD_ID,
    profile_id: options.profileId ?? null,
    title: options.title,
    event_date: options.eventDate,
    event_type: options.eventType ?? "home",
    location: options.location ?? null,
    status: options.status ?? "upcoming",
  });
}

export async function createActivityLog(options: {
  id?: string;
  eventId?: string;
  loggedBy?: string;
  sharedNotes?: string;
  flaggedForWardCouncil?: boolean;
}): Promise<string> {
  return insertRow("activity_logs", {
    id: options.id ?? testUuid(`activity-log:${options.eventId ?? "standalone"}`),
    ward_id: TEST_WARD_ID,
    event_id: options.eventId ?? null,
    logged_by: options.loggedBy ?? null,
    shared_notes: options.sharedNotes ?? null,
    flagged_for_ward_council: options.flaggedForWardCouncil ?? false,
  });
}

export async function createActivityPrivateNote(options: {
  activityLogId: string;
  userId: string;
  notes: string;
}): Promise<string> {
  return insertRow("activity_private_notes", {
    ward_id: TEST_WARD_ID,
    activity_log_id: options.activityLogId,
    user_id: options.userId,
    notes: options.notes,
  });
}

// ============================================================================
// Goals, agendas, tithing
// ============================================================================

// `lastFulfilledAt` and `createdAt` are both settable, and both are load-bearing: goal status is
// computed from them (lib/goals/goalStatus.ts), so placing a goal either side of the 80% boundary
// or making one "never fulfilled and past its interval" is impossible without writing them
// directly. Added in talks-d.
//
// `status` writes the CACHED column, which is deliberately NOT what the app reads — the UI
// computes status on every read (04-talks-pipeline.md §Step 9). It defaults to a value that is
// often WRONG on purpose, so a scenario that finds the board agreeing with this column has found
// the compute-on-read rule being broken.
export async function createGoal(options: {
  id?: string;
  // The OWNING organization (migration 030). Omitted means a ward-level goal, which is
  // bishopric-only — not "visible to everyone". Distinct from targetType/targetId, which say what
  // the goal is ABOUT.
  orgId?: string;
  title: string;
  targetType?: "member" | "household" | "org" | "group";
  targetId?: string;
  desiredFrequencyMonths?: number;
  lastFulfilledAt?: string;
  createdAt?: string;
  notes?: string;
  status?: "on_track" | "due_soon" | "overdue";
}): Promise<string> {
  const hasTarget = options.targetType !== undefined && options.targetId !== undefined;

  return insertRow("goals", {
    id: options.id ?? testUuid(`goal:${options.title}`),
    ward_id: TEST_WARD_ID,
    org_id: options.orgId ?? null,
    title: options.title,
    target_type: hasTarget ? options.targetType : null,
    target_id: hasTarget ? options.targetId : null,
    desired_frequency_months: options.desiredFrequencyMonths ?? null,
    last_fulfilled_at: options.lastFulfilledAt ?? null,
    created_at: options.createdAt ?? undefined,
    notes: options.notes ?? null,
    status: options.status ?? "on_track",
  });
}

// One row of a member's speaking history. talks-d reads this table for the reliability profile,
// and the four pattern flags are computed from exactly these three fields plus the Sunday date
// the assignment carries (lib/assignments/reliabilityFlags.ts).
//
// `memberId` is REQUIRED because `assignment_history.member_id` is `not null` — an external
// speaker cannot have a history row, which is what keeps ITER-004's "speaker history is not
// distorted" true in the schema rather than in everybody's memory (talks-a Decision 3).
export async function createAssignmentHistory(options: {
  memberId: string;
  assignmentId?: string;
  outcome?: "accepted" | "declined" | "cancelled" | "completed";
  cancellationDaysNotice?: number;
  notes?: string;
}): Promise<string> {
  return insertRow("assignment_history", {
    ward_id: TEST_WARD_ID,
    member_id: options.memberId,
    assignment_id: options.assignmentId ?? null,
    outcome: options.outcome ?? "completed",
    cancellation_days_notice: options.cancellationDaysNotice ?? null,
    notes: options.notes ?? null,
  });
}

export async function createAgenda(options: {
  id?: string;
  meetingType: MeetingType;
  meetingDate: string;
  status?: AgendaStatus;
  sections?: Record<string, unknown>;
}): Promise<string> {
  return insertRow("agendas", {
    id: options.id ?? testUuid(`agenda:${options.meetingType}:${options.meetingDate}`),
    ward_id: TEST_WARD_ID,
    meeting_type: options.meetingType,
    meeting_date: options.meetingDate,
    status: options.status ?? "draft",
    sections: options.sections ?? null,
  });
}

export async function createActionItem(options: {
  agendaId?: string;
  description: string;
  assignedTo?: string;
  dueDate?: string;
  status?: "open" | "complete";
}): Promise<string> {
  return insertRow("action_items", {
    ward_id: TEST_WARD_ID,
    agenda_id: options.agendaId ?? null,
    description: options.description,
    assigned_to: options.assignedTo ?? null,
    due_date: options.dueDate ?? null,
    status: options.status ?? "open",
  });
}

// No member linkage of any kind is possible here, by design (CLAUDE.md rule 10). If a
// scenario seems to need one, the scenario is wrong.
export async function createTithingSession(options: {
  id?: string;
  sessionDate: string;
  createdBy?: string;
}): Promise<string> {
  return insertRow("tithing_sessions", {
    id: options.id ?? testUuid(`tithing:${options.sessionDate}`),
    ward_id: TEST_WARD_ID,
    session_date: options.sessionDate,
    created_by: options.createdBy ?? null,
  });
}

export async function createTithingEntry(options: {
  sessionId: string;
  entryNumber: number;
  checks?: Array<{ amount: number; note?: string }>;
  bills?: Partial<
    Record<"bills_100" | "bills_50" | "bills_20" | "bills_10" | "bills_5" | "bills_2" | "bills_1", number>
  >;
  coins?: Partial<
    Record<"coins_dollar" | "coins_half" | "coins_quarter" | "coins_dime" | "coins_nickel" | "coins_penny", number>
  >;
}): Promise<string> {
  return insertRow("tithing_entries", {
    ward_id: TEST_WARD_ID,
    session_id: options.sessionId,
    entry_number: options.entryNumber,
    checks: options.checks ?? null,
    ...(options.bills ?? {}),
    ...(options.coins ?? {}),
  });
}

// ============================================================================
// AI platform
// ============================================================================

// `ai_settings` is APPEND-ONLY (migration 014): the row with the latest created_at is the active
// configuration. A scenario that seeds two versions is seeding a HISTORY, so `createdAt` is
// required rather than defaulted — two rows written a millisecond apart would give the walk no
// stable answer to "which one is Active".
//
// There is deliberately no update helper here, for the same reason lib/ai/queries.ts has none.
export async function createAiSettings(options: {
  id?: string;
  createdAt: string;
  savedBy?: string;
  toneVoice?: string;
  doctrinalEmphasis?: string;
  canonPriority?: StandardWork[];
  maxScriptureReferences?: number;
  scriptureNotes?: string;
  maxYearsOld?: number | null;
  maxConferenceTalks?: number;
  preferKnowledgeBase?: boolean;
  scope?: {
    sinceYears: number | null;
    speakerRoles: SpeakerRole[];
    savedFilterIds: string[];
  } | null;
  topicPreferences?: string;
  wardContext?: string;
  thankYouPreferences?: string;
}): Promise<string> {
  return insertRow("ai_settings", {
    id: options.id ?? testUuid(`ai_settings:${options.createdAt}`),
    ward_id: TEST_WARD_ID,
    tone_voice: options.toneVoice ?? null,
    doctrinal_emphasis: options.doctrinalEmphasis ?? null,
    scripture_preferences: {
      canonPriority: options.canonPriority ?? [],
      maxReferences: options.maxScriptureReferences ?? 3,
      relevanceNotes: options.scriptureNotes ?? null,
    },
    // `maxYearsOld: null` means NO recency limit. It is not zero, and lib/ai/systemPrompt.ts
    // renders the two differently — a seed that confuses them changes what the walk is judging.
    conference_preferences: {
      maxYearsOld: options.maxYearsOld === undefined ? null : options.maxYearsOld,
      maxTalks: options.maxConferenceTalks ?? 3,
      preferKnowledgeBase: options.preferKnowledgeBase ?? true,
      // The CORPUS SCOPE, which is a different thing from maxYearsOld above and lives on a
      // different screen — this decides which talks are SEARCHED, that one asks the AI to prefer
      // recent ones among whatever it finds. null means the ward has never opened the scope
      // panel, which must retrieve exactly what a pre-ai-d ward retrieved.
      scope: options.scope ?? null,
    },
    topic_preferences: options.topicPreferences ?? null,
    ward_context: options.wardContext ?? null,
    thank_you_preferences: options.thankYouPreferences ?? null,
    saved_by: options.savedBy ?? null,
    created_at: options.createdAt,
  });
}

// ============================================================================
// Knowledge base
// ============================================================================

// EMBEDDINGS ARE HAND-WRITTEN UNIT VECTORS, NOT REAL ONES.
//
// A scenario that seeded real embeddings would have to call OpenAI on every `npm run seed`,
// which costs money, needs a network, and makes the walk's results different every time. A unit
// vector — 1 on one axis, 0 everywhere else — gives a similarity of exactly 1 against a query on
// the same axis and 0 against any other. That is enough to make "deactivating this document
// removes its passages from the next search" a visible, repeatable change.
//
// What it cannot do is make the RETRIEVAL TESTER return sensible results for a typed English
// query: a real query embedding will not align with any of these axes, so a hand-seeded corpus
// answers "nothing was close enough". Scenarios that need real retrieval must UPLOAD a document
// through the app, which embeds it for real. Scenario 022 does exactly that, which is why it
// seeds a corpus for the deactivate/delete half and uploads for the search half.
const EMBEDDING_DIMENSIONS = 1536;

export function unitEmbedding(axis: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) =>
    index === axis ? 1 : 0,
  );
}

// `speaker`, `speakerRole` and `conferenceDate` default to null, which is correct for the
// standard works and for anything that is not a conference talk.
//
// A `general_conference` document seeded WITHOUT them is the "Not filterable" case, and it is a
// real state worth seeding rather than a broken fixture: no filter can reach such a document, so
// per migration 033 it is silently ALWAYS INCLUDED. Scenario 026 seeds one deliberately.
export async function createKnowledgeDocument(options: {
  id?: string;
  title: string;
  typeTag?: KnowledgeTypeTag;
  status?: KnowledgeStatus;
  uploadedBy?: string;
  uploadedAt?: string;
  fileUrl?: string | null;
  speaker?: string | null;
  speakerRole?: SpeakerRole | null;
  conferenceDate?: string | null;
}): Promise<string> {
  return insertRow("knowledge_documents", {
    id: options.id ?? testUuid(`knowledge_document:${options.title}`),
    ward_id: TEST_WARD_ID,
    title: options.title,
    type_tag: options.typeTag ?? "other",
    speaker: options.speaker ?? null,
    speaker_role: options.speakerRole ?? null,
    conference_date: options.conferenceDate ?? null,
    // null unless a scenario says otherwise: a seeded document has no uploaded file behind it,
    // and pointing file_url at a storage object that was never written would make the delete
    // path log a spurious failure.
    file_url: options.fileUrl ?? null,
    status: options.status ?? "active",
    uploaded_by: options.uploadedBy ?? null,
    ...(options.uploadedAt ? { uploaded_at: options.uploadedAt } : {}),
  });
}

// `embeddingAxis: null` seeds a chunk whose embedding FAILED during ingest — the text is kept,
// and match_document_chunks (migration 031) must never return it. That is a real state worth
// seeding, not a broken fixture.
export async function createDocumentChunk(options: {
  documentId: string;
  content: string;
  chunkIndex: number;
  embeddingAxis?: number | null;
}): Promise<string> {
  const axis = options.embeddingAxis;

  return insertRow("document_chunks", {
    id: testUuid(`document_chunk:${options.documentId}:${options.chunkIndex}`),
    ward_id: TEST_WARD_ID,
    document_id: options.documentId,
    content: options.content,
    // pgvector's text input format is `[1,2,3]`, byte-identical to a JSON array.
    embedding:
      axis === null || axis === undefined ? null : JSON.stringify(unitEmbedding(axis)),
    chunk_index: options.chunkIndex,
  });
}

// A filter a ward taught the app once and reuses by ticking a box (migration 034).
//
// NULL MEANS "THIS AXIS IS NOT FILTERED", NEVER AN EMPTY ARRAY. `= any ('{}')` matches NOTHING,
// so an empty array would seed a filter that silently narrows the corpus to zero while reading
// as "no restriction" — migration 035's CHECK constraints refuse that shape, and a seed that
// tried it would fail at insert rather than produce a confusing scenario.
//
// `sourcePhrase` is what the user typed. Seeding one that DIFFERS from the label is the case
// worth seeding: the label alone does not tell you whether a filter is about a calling or a
// person, and the phrase is the only durable record of what was meant.
export async function createRetrievalFilter(options: {
  id?: string;
  label: string;
  sourcePhrase: string;
  speakerRoles?: SpeakerRole[];
  speakers?: string[];
  since?: string;
  createdBy?: string;
}): Promise<string> {
  return insertRow("retrieval_filters", {
    id: options.id ?? testUuid(`retrieval_filter:${options.label}`),
    ward_id: TEST_WARD_ID,
    label: options.label,
    source_phrase: options.sourcePhrase,
    speaker_roles: options.speakerRoles ?? null,
    speakers: options.speakers ?? null,
    since: options.since ?? null,
    created_by: options.createdBy ?? null,
  });
}


// ============================================================================
// Sacrament administration
// ============================================================================

export async function createSacramentRotationPool(options: {
  assignmentType: SacramentAssignmentType;
  memberIds: string[];
  createdBy?: string;
}): Promise<string> {
  return insertRow(
    "sacrament_rotation_pools",
    {
      ward_id: TEST_WARD_ID,
      assignment_type: options.assignmentType,
      member_ids: options.memberIds,
      created_by: options.createdBy ?? null,
    },
    "ward_id,assignment_type",
  );
}

export async function createSacramentAssignment(options: {
  sundayId: string;
  assignmentType: SacramentAssignmentType;
  memberIds: string[];
  isOverride?: boolean;
  overrideReason?: string;
}): Promise<string> {
  return insertRow(
    "sacrament_assignments",
    {
      ward_id: TEST_WARD_ID,
      sunday_id: options.sundayId,
      assignment_type: options.assignmentType,
      member_ids: options.memberIds,
      is_override: options.isOverride ?? false,
      override_reason: options.overrideReason ?? null,
    },
    "ward_id,sunday_id,assignment_type",
  );
}

// Exactly one active manager per ward (partial unique index, migration 018), so any existing
// active row is stood down first.
export async function setSacramentManager(options: {
  userId: string;
  memberId?: string;
  assignedBy?: string;
}): Promise<string> {
  const supabase = getAdminClient();

  const { error: standDownError } = await supabase
    .from("sacrament_assignment_managers")
    .update({ is_active: false })
    .eq("ward_id", TEST_WARD_ID)
    .eq("is_active", true);

  if (standDownError) {
    throw new Error(`Could not stand down the previous manager: ${standDownError.message}`);
  }

  return insertRow("sacrament_assignment_managers", {
    ward_id: TEST_WARD_ID,
    user_id: options.userId,
    member_id: options.memberId ?? null,
    assigned_by: options.assignedBy ?? null,
    is_active: true,
  });
}

// ============================================================================
// Notifications
// ============================================================================

// A ward created outside supabase/seed/ward.sql gets no notification_settings rows, and
// emitNotification() warns and sends nothing for an unknown key. Every scenario that expects
// a notification must call this first.
export const NOTIFICATION_TRIGGERS: Array<{ key: string; defaultRoles: Role[] }> = [
  { key: "plan_submitted", defaultRoles: ["bishop", "counselor"] },
  { key: "plan_approved", defaultRoles: ["bishop", "counselor", "executive_secretary"] },
  { key: "plan_change_requested", defaultRoles: ["bishop", "counselor"] },
  { key: "assignment_declined", defaultRoles: ["bishop", "counselor", "executive_secretary"] },
  { key: "message_approved_ready", defaultRoles: ["bishop", "counselor", "executive_secretary"] },
  { key: "sunday_confirmation_request", defaultRoles: ["bishop", "counselor", "executive_secretary"] },
  { key: "issue_flagged_post_sunday", defaultRoles: ["bishop", "counselor"] },
  { key: "appreciation_comments_ready", defaultRoles: ["bishop", "counselor"] },
  // A calendar change voided planning work. Migration 025 added this key and
  // supabase/seed/notification_triggers.sql has carried it since; this list had not, so every
  // harness ward silently dropped the notification and logged "Unknown notification trigger".
  // Surfaced by scenario 015, the first walkthrough to confirm a cancellation.
  { key: "assignment_reverted", defaultRoles: ["bishop", "counselor"] },
  { key: "admin_setting_changed", defaultRoles: ["bishop", "counselor"] },
  {
    key: "org_conducting_rotation_changed",
    defaultRoles: ["org_president", "org_counselor", "org_secretary"],
  },
  { key: "visit_overdue", defaultRoles: ["org_president", "org_counselor", "org_secretary"] },
  // Must match supabase/seed/notification_triggers.sql exactly. A harness ward seeded from a
  // stale copy of this list restores the old roles and quietly disagrees with production.
  { key: "visit_flagged_for_ward_council", defaultRoles: ["executive_secretary"] },
  { key: "new_household_added", defaultRoles: ["bishop", "counselor", "org_president", "ward_secretary"] },
  { key: "youth_activity_added", defaultRoles: ["org_president", "org_counselor", "org_secretary"] },
  { key: "youth_event_uncovered", defaultRoles: ["org_president", "org_counselor"] },
  { key: "youth_support_assigned", defaultRoles: ["org_president", "org_counselor", "org_secretary"] },
  { key: "youth_followup_prompt", defaultRoles: ["org_president", "org_counselor", "org_secretary"] },
  { key: "youth_followup_submitted", defaultRoles: ["org_president", "org_counselor"] },
  { key: "agenda_published", defaultRoles: ["bishop", "counselor", "ward_council_member", "executive_secretary"] },
  { key: "agenda_email_distributed", defaultRoles: ["bishop", "counselor", "executive_secretary"] },
  { key: "sacrament_assignments_sent", defaultRoles: ["bishop", "counselor"] },
  { key: "sacrament_assignments_overdue", defaultRoles: ["bishop", "counselor"] },
  { key: "sacrament_manager_changed", defaultRoles: ["bishop", "counselor"] },
  { key: "youth_account_locked", defaultRoles: ["bishop", "counselor"] },
];

export async function seedNotificationTriggers(): Promise<number> {
  const { error } = await getAdminClient().from("notification_settings").upsert(
    NOTIFICATION_TRIGGERS.map((trigger) => ({
      ward_id: TEST_WARD_ID,
      trigger_key: trigger.key,
      default_roles: trigger.defaultRoles,
      is_globally_enabled: true,
    })),
    { onConflict: "ward_id,trigger_key" },
  );

  if (error) {
    throw new Error(`Could not seed notification triggers: ${error.message}`);
  }

  return NOTIFICATION_TRIGGERS.length;
}

export async function createNotification(options: {
  recipientUserId: string;
  triggerKey: string;
  title: string;
  body: string;
  readAt?: string | null;
}): Promise<string> {
  return insertRow("notifications", {
    ward_id: TEST_WARD_ID,
    recipient_user_id: options.recipientUserId,
    trigger_key: options.triggerKey,
    title: options.title,
    body: options.body,
    read_at: options.readAt ?? null,
  });
}

export async function optOutOfNotification(options: {
  userId: string;
  triggerKey: string;
}): Promise<string> {
  return insertRow(
    "notification_user_prefs",
    {
      ward_id: TEST_WARD_ID,
      user_id: options.userId,
      trigger_key: options.triggerKey,
      is_enabled: false,
    },
    "user_id,trigger_key",
  );
}
