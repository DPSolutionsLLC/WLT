import type { SupabaseClient } from "@supabase/supabase-js";
import { countsTowardRotation } from "@/lib/assignments/rotation";
import { listSundays } from "@/lib/calendar/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  AssignmentFieldsInput,
  CreateAssignmentInput,
  CreateCommentInput,
} from "@/lib/validation/assignment";
import type { Database } from "@/types/database";
import {
  ASSIGNMENT_HISTORY_OUTCOMES,
  ASSIGNMENT_TYPES,
  COMMENT_LEVELS,
  PIPELINE_STAGES,
  REQUEST_OUTCOMES,
  type AssignmentHistoryOutcome,
  type AssignmentType,
  type CommentLevel,
  type PipelineStage,
  type RequestOutcome,
} from "@/types/domain";

// Every assignment read and write goes through this module. Route handlers and pages never touch
// Supabase directly (conventions.md §Data Access), which is what keeps the ward scope and the
// snake↔camel mapping in one place instead of re-derived at every call site.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. A client
// component that imports this file fails `npm run build` — and passes both `npm run lint` and
// `npm run typecheck` (plans/retros/roster-b-picker-and-orgs.md). The pure rules live in
// pipeline.ts, speaker.ts and rotation.ts precisely so talks-b can render them without touching
// this file.
//
// Nothing here moves a pipeline stage as a side effect of anything else. updateAssignmentFields()
// cannot write pipeline_stage at all, and transitionAssignment() is the only function that can —
// that separation is the phase's first pitfall made structural.

export type Assignment = {
  id: string;
  sundayId: string | null;
  memberId: string | null;
  externalSpeakerName: string | null;
  externalSpeakerTitle: string | null;
  assignmentType: AssignmentType | null;
  countsTowardRotation: boolean;
  topicId: string | null;
  slotNumber: number | null;
  slotLengthMinutes: number | null;
  stage: PipelineStage;
  plannedBy: string | null;
  planSubmittedAt: string | null;
  approvedAt: string | null;
  requestedAt: string | null;
  requestedBy: string | null;
  requestOutcome: RequestOutcome | null;
  requestNotes: string | null;
  confirmedAt: string | null;
  notifyMessage: string | null;
  notifySentAt: string | null;
  notifySentBy: string | null;
  sundayConfirmedAt: string | null;
  thankYouMessage: string | null;
  thankYouSentAt: string | null;
  thankYouSentBy: string | null;
  completedAt: string | null;
  contactWaivedAt: string | null;
  contactWaivedBy: string | null;
  createdAt: string;
};

export type AssignmentApproval = {
  id: string;
  assignmentId: string;
  userId: string;
  approved: boolean | null;
  comment: string | null;
  createdAt: string;
};

export type AssignmentComment = {
  id: string;
  assignmentId: string | null;
  sundayId: string | null;
  userId: string;
  authorName: string | null;
  comment: string;
  level: CommentLevel | null;
  createdAt: string;
};

export type AssignmentFilter =
  | { sundayId: string }
  | { from: string; to: string };

export type CommentFilter = { assignmentId: string } | { sundayId: string };

// Which timestamp a stage stamps as it is ENTERED. `requested_by` is stamped alongside
// `requested_at` by transitionAssignment, which is why the actor is a parameter there.
export type TransitionStamps = {
  actorUserId: string;
};

type AssignmentRow = {
  id: string;
  sunday_id: string | null;
  member_id: string | null;
  external_speaker_name: string | null;
  external_speaker_title: string | null;
  assignment_type: string | null;
  counts_toward_rotation: boolean;
  topic_id: string | null;
  slot_number: number | null;
  slot_length_minutes: number | null;
  pipeline_stage: string;
  planned_by: string | null;
  plan_submitted_at: string | null;
  approved_at: string | null;
  requested_at: string | null;
  requested_by: string | null;
  request_outcome: string | null;
  request_notes: string | null;
  confirmed_at: string | null;
  notify_message: string | null;
  notify_sent_at: string | null;
  notify_sent_by: string | null;
  sunday_confirmed_at: string | null;
  thank_you_message: string | null;
  thank_you_sent_at: string | null;
  thank_you_sent_by: string | null;
  completed_at: string | null;
  contact_waived_at: string | null;
  contact_waived_by: string | null;
  created_at: string;
};

// The generated Update shape, used for every patch this module builds. Typing a patch as
// Record<string, unknown> would compile against any column name at all, which is exactly how a
// typo becomes a write that silently does nothing.
type AssignmentUpdate = Database["public"]["Tables"]["assignments"]["Update"];

type AssignmentCommentRow = {
  id: string;
  assignment_id: string | null;
  sunday_id: string | null;
  user_id: string;
  comment: string;
  level: string | null;
  created_at: string;
};

// One string literal on ONE line, however long it gets, and never a `+` concatenation.
// Concatenation widens the type to `string`, which defeats supabase-js's literal-type parsing of
// the select list and silently turns every mapped row into GenericStringError. It is also how a
// column goes quietly missing from a built-up list (plans/retros/calendar-a-rules-and-api.md).
const ASSIGNMENT_COLUMNS =
  "id, sunday_id, member_id, external_speaker_name, external_speaker_title, assignment_type, counts_toward_rotation, topic_id, slot_number, slot_length_minutes, pipeline_stage, planned_by, plan_submitted_at, approved_at, requested_at, requested_by, request_outcome, request_notes, confirmed_at, notify_message, notify_sent_at, notify_sent_by, sunday_confirmed_at, thank_you_message, thank_you_sent_at, thank_you_sent_by, completed_at, contact_waived_at, contact_waived_by, created_at";

const APPROVAL_COLUMNS = "id, assignment_id, user_id, approved, comment, created_at";

const COMMENT_COLUMNS = "id, assignment_id, sunday_id, user_id, comment, level, created_at";

// A CHECK constraint already restricts every column this is used on, so an unrecognised value
// means the constraint and types/domain.ts have drifted. Throwing is the only safe answer — the
// same reasoning as toEnumValue() in lib/calendar/queries.ts and lib/roster/queries.ts.
function toEnumValue<Value extends string>(
  value: string,
  allowed: readonly Value[],
  column: string,
  migration = "005",
): Value {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `${column} holds "${value}", which is not a known value. The CHECK constraint ` +
        `in migration ${migration} and types/domain.ts have drifted.`,
    );
  }
  return value as Value;
}

function toOptionalEnum<Value extends string>(
  value: string | null,
  allowed: readonly Value[],
  column: string,
): Value | null {
  return value === null ? null : toEnumValue(value, allowed, column);
}

// Builds an explicit object rather than spreading the row, for the same reason mapSundayRow does:
// a column added to `assignments` later cannot ride along into a response nobody reviewed.
export function mapAssignmentRow(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    sundayId: row.sunday_id,
    memberId: row.member_id,
    externalSpeakerName: row.external_speaker_name,
    externalSpeakerTitle: row.external_speaker_title,
    assignmentType: toOptionalEnum(
      row.assignment_type,
      ASSIGNMENT_TYPES,
      "assignments.assignment_type",
    ),
    countsTowardRotation: row.counts_toward_rotation,
    topicId: row.topic_id,
    slotNumber: row.slot_number,
    slotLengthMinutes: row.slot_length_minutes,
    stage: toEnumValue(row.pipeline_stage, PIPELINE_STAGES, "assignments.pipeline_stage"),
    plannedBy: row.planned_by,
    planSubmittedAt: row.plan_submitted_at,
    approvedAt: row.approved_at,
    requestedAt: row.requested_at,
    requestedBy: row.requested_by,
    requestOutcome: toOptionalEnum(
      row.request_outcome,
      REQUEST_OUTCOMES,
      "assignments.request_outcome",
    ),
    requestNotes: row.request_notes,
    confirmedAt: row.confirmed_at,
    notifyMessage: row.notify_message,
    notifySentAt: row.notify_sent_at,
    notifySentBy: row.notify_sent_by,
    sundayConfirmedAt: row.sunday_confirmed_at,
    thankYouMessage: row.thank_you_message,
    thankYouSentAt: row.thank_you_sent_at,
    thankYouSentBy: row.thank_you_sent_by,
    completedAt: row.completed_at,
    contactWaivedAt: row.contact_waived_at,
    contactWaivedBy: row.contact_waived_by,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// The one place external speaker fields become columns. `externalSpeaker: null` CLEARS both,
// which is what a decline and a speaker swap both need; `undefined` leaves them alone.
function speakerColumns(
  fields: Pick<AssignmentFieldsInput, "memberId" | "externalSpeaker">,
): AssignmentUpdate {
  const patch: AssignmentUpdate = {};

  if (fields.memberId !== undefined) {
    patch.member_id = fields.memberId;
    // Setting a member necessarily clears the external speaker: the
    // assignments_speaker_exactly_one CHECK (migration 025) would refuse the row otherwise, and
    // a 500 carrying a constraint name is a worse answer than doing the obvious thing.
    if (fields.memberId !== null) {
      patch.external_speaker_name = null;
      patch.external_speaker_title = null;
    }
  }

  if (fields.externalSpeaker !== undefined) {
    patch.external_speaker_name = fields.externalSpeaker?.name ?? null;
    patch.external_speaker_title = fields.externalSpeaker?.title ?? null;
    if (fields.externalSpeaker !== null) patch.member_id = null;
  }

  return patch;
}

export async function listAssignments(
  wardId: string,
  filter: AssignmentFilter,
  client?: SupabaseClient<Database>,
): Promise<Assignment[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("ward_id", wardId);

  if ("sundayId" in filter) {
    query = query.eq("sunday_id", filter.sundayId);
  } else {
    // Resolved through lib/calendar/queries.ts rather than an embedded PostgREST join, so the
    // ward scope on `sundays` is applied by the module that owns that table. An empty range
    // yields an empty id list, and `.in(…, [])` correctly matches nothing.
    const sundays = await listSundays(
      wardId,
      { from: filter.from, to: filter.to },
      supabase,
    );
    query = query.in(
      "sunday_id",
      sundays.map((sunday) => sunday.id),
    );
  }

  const { data, error } = await query
    .order("sunday_id")
    .order("slot_number", { nullsFirst: false });

  if (error) {
    console.error(`Could not read the ward's assignments — ${error.message}`, {
      wardId,
      filter,
    });
    throw new Error(`Could not read the speaking assignments: ${error.message}`);
  }

  return (data ?? []).map(mapAssignmentRow);
}

// Returns null when absent — the route turns that into a 404. A row that is not in this ward and
// a row RLS refused are indistinguishable here, and both mean "not yours"
// (plans/retros/foundation-c-services.md).
export async function getAssignment(
  wardId: string,
  assignmentId: string,
  client?: SupabaseClient<Database>,
): Promise<Assignment | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", assignmentId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read an assignment — ${error.message}`, {
      wardId,
      assignmentId,
    });
    throw new Error(`Could not read that assignment: ${error.message}`);
  }

  return data ? mapAssignmentRow(data) : null;
}

// Always created at stage `plan`. There is no parameter for the stage, deliberately: an
// assignment that starts anywhere else has skipped a gate.
//
// `counts_toward_rotation` is set from the TYPE, so the user never answers the same question
// twice. It is STORED rather than derived at read time so that a later change to
// COUNTS_TOWARD_ROTATION does not silently rewrite history — what a ward decided in 2026 stays
// what it decided.
export async function createAssignment(
  wardId: string,
  input: CreateAssignmentInput,
  plannedBy: string,
  client?: SupabaseClient<Database>,
): Promise<Assignment> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("assignments")
    .insert({
      ward_id: wardId,
      sunday_id: input.sundayId,
      assignment_type: input.assignmentType,
      counts_toward_rotation: countsTowardRotation(input.assignmentType),
      slot_number: input.slotNumber,
      slot_length_minutes: input.slotLengthMinutes ?? null,
      member_id: input.memberId ?? null,
      external_speaker_name: input.externalSpeaker?.name ?? null,
      external_speaker_title: input.externalSpeaker?.title ?? null,
      topic_id: input.topicId ?? null,
      pipeline_stage: "plan",
      planned_by: plannedBy,
    })
    .select(ASSIGNMENT_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create an assignment — ${error.message}`, {
      wardId,
      sundayId: input.sundayId,
      slotNumber: input.slotNumber,
    });
    throw new Error(`Could not create that assignment: ${error.message}`);
  }

  return mapAssignmentRow(data);
}

// Cannot write pipeline_stage. There is no branch here that could, and no parameter that would
// carry one — the phase's first pitfall is an implicit stage advance, and the only defence that
// survives a future edit is that the capability is absent (04-talks-pipeline.md §Step 3).
//
// Returns null when the write was refused, which the route turns into a 404. An UPDATE denied by
// policy comes back as success with zero rows, not an error
// (plans/retros/foundation-c-services.md).
export async function updateAssignmentFields(
  wardId: string,
  assignmentId: string,
  fields: AssignmentFieldsInput,
  client?: SupabaseClient<Database>,
): Promise<Assignment | null> {
  const supabase = await resolveClient(client);

  const patch: AssignmentUpdate = {
    ...speakerColumns(fields),
  };

  if (fields.assignmentType !== undefined) {
    patch.assignment_type = fields.assignmentType;
    patch.counts_toward_rotation = countsTowardRotation(fields.assignmentType);
  }
  if (fields.slotNumber !== undefined) patch.slot_number = fields.slotNumber;
  if (fields.slotLengthMinutes !== undefined) {
    patch.slot_length_minutes = fields.slotLengthMinutes;
  }
  if (fields.topicId !== undefined) patch.topic_id = fields.topicId;
  if (fields.requestOutcome !== undefined) patch.request_outcome = fields.requestOutcome;
  if (fields.requestNotes !== undefined) patch.request_notes = fields.requestNotes;
  if (fields.notifyMessage !== undefined) patch.notify_message = fields.notifyMessage;
  if (fields.notifySentAt !== undefined) patch.notify_sent_at = fields.notifySentAt;
  if (fields.sundayConfirmedAt !== undefined) {
    patch.sunday_confirmed_at = fields.sundayConfirmedAt;
  }
  if (fields.thankYouMessage !== undefined) patch.thank_you_message = fields.thankYouMessage;
  if (fields.thankYouSentAt !== undefined) patch.thank_you_sent_at = fields.thankYouSentAt;

  const { data, error } = await supabase
    .from("assignments")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", assignmentId)
    .select(ASSIGNMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update an assignment — ${error.message}`, {
      wardId,
      assignmentId,
    });
    throw new Error(`Could not save that assignment: ${error.message}`);
  }

  return data ? mapAssignmentRow(data) : null;
}

// The stage AND its timestamp move in one update, so no reader can observe a stage that has
// arrived without the moment it arrived. `canTransition()` has already decided this is legal;
// this function does not second-guess it.
export async function transitionAssignment(
  wardId: string,
  assignmentId: string,
  to: PipelineStage,
  stamps: TransitionStamps,
  client?: SupabaseClient<Database>,
): Promise<Assignment | null> {
  const supabase = await resolveClient(client);

  const now = new Date().toISOString();

  const patch: AssignmentUpdate = { pipeline_stage: to };

  switch (to) {
    case "review":
      patch.plan_submitted_at = now;
      break;
    case "approve":
      patch.approved_at = now;
      break;
    case "request":
      patch.requested_at = now;
      patch.requested_by = stamps.actorUserId;
      break;
    case "confirm":
      patch.confirmed_at = now;
      break;
    case "complete":
      patch.completed_at = now;
      break;
    // `plan`, `notify`, `speak` and `appreciate` stamp nothing of their own: notify_sent_at and
    // sunday_confirmed_at are recorded by the planner as facts about the world, not by the
    // transition, and they are the GATE for those moves rather than a consequence of them.
    default:
      break;
  }

  const { data, error } = await supabase
    .from("assignments")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", assignmentId)
    .select(ASSIGNMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not move an assignment's stage — ${error.message}`, {
      wardId,
      assignmentId,
      to,
    });
    throw new Error(`Could not move that assignment to ${to}: ${error.message}`);
  }

  return data ? mapAssignmentRow(data) : null;
}

// A decline returns the assignment to `plan` AND clears the speaker, so the slot reads as an
// open slot rather than as one whose speaker said no and is still named in it. The stage move is
// a separate, explicit call — this only clears the fields.
export async function clearSpeaker(
  wardId: string,
  assignmentId: string,
  client?: SupabaseClient<Database>,
): Promise<Assignment | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("assignments")
    .update({
      member_id: null,
      external_speaker_name: null,
      external_speaker_title: null,
      request_outcome: "declined",
    })
    .eq("ward_id", wardId)
    .eq("id", assignmentId)
    .select(ASSIGNMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not clear an assignment's speaker — ${error.message}`, {
      wardId,
      assignmentId,
    });
    throw new Error(`Could not clear that speaker: ${error.message}`);
  }

  return data ? mapAssignmentRow(data) : null;
}

// Only settable when member_id is null. The assignments_waiver_external_only CHECK is the real
// boundary; the route refuses it first so the user reads a sentence rather than a constraint
// name.
export async function waiveContactStages(
  wardId: string,
  assignmentId: string,
  waivedBy: string,
  client?: SupabaseClient<Database>,
): Promise<Assignment | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("assignments")
    .update({
      contact_waived_at: new Date().toISOString(),
      contact_waived_by: waivedBy,
    })
    .eq("ward_id", wardId)
    .eq("id", assignmentId)
    .select(ASSIGNMENT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not waive an assignment's contact stages — ${error.message}`, {
      wardId,
      assignmentId,
    });
    throw new Error(`Could not waive the contact stages: ${error.message}`);
  }

  return data ? mapAssignmentRow(data) : null;
}

export async function listApprovals(
  wardId: string,
  assignmentId: string,
  client?: SupabaseClient<Database>,
): Promise<AssignmentApproval[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("assignment_approvals")
    .select(APPROVAL_COLUMNS)
    .eq("ward_id", wardId)
    .eq("assignment_id", assignmentId)
    .order("created_at");

  if (error) {
    console.error(`Could not read an assignment's approvals — ${error.message}`, {
      wardId,
      assignmentId,
    });
    throw new Error(`Could not read the approvals: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    assignmentId: row.assignment_id,
    userId: row.user_id,
    approved: row.approved,
    comment: row.comment,
    createdAt: row.created_at,
  }));
}

// How many DISTINCT bishopric members have approved each assignment, in one query rather than
// one per assignment. A month planner draws "2 of 3" on every card, and a per-card read would be
// a dozen round trips to render one screen.
//
// The count only, never the rows: who approved and what they said belongs on the assignment
// detail page, and shipping it in a month-wide list would put every approval comment in every
// response.
export async function countApprovalsFor(
  wardId: string,
  assignmentIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<Map<string, number>> {
  if (assignmentIds.length === 0) return new Map();

  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("assignment_approvals")
    .select("assignment_id, user_id, approved")
    .eq("ward_id", wardId)
    .eq("approved", true)
    .in("assignment_id", [...assignmentIds]);

  if (error) {
    console.error(`Could not count approvals — ${error.message}`, { wardId });
    throw new Error(`Could not count the approvals: ${error.message}`);
  }

  // Counted over distinct user ids rather than rows. assignment_approvals_one_per_user already
  // makes the two identical; counting users anyway means this stays correct if that constraint is
  // ever relaxed, and it is the same rule reviewToApprove() applies in the pure layer.
  const byAssignment = new Map<string, Set<string>>();

  for (const row of data ?? []) {
    const seen = byAssignment.get(row.assignment_id) ?? new Set<string>();
    seen.add(row.user_id);
    byAssignment.set(row.assignment_id, seen);
  }

  return new Map(
    [...byAssignment].map(([assignmentId, users]) => [assignmentId, users.size]),
  );
}

// An upsert on assignment_approvals_one_per_user (migration 025), so a bishopric member changing
// their mind updates their own row rather than stacking a second one. That constraint is also
// what stops one counselor filling a three-person gate alone.
export async function recordApproval(
  wardId: string,
  assignmentId: string,
  userId: string,
  approved: boolean,
  comment: string | null,
  client?: SupabaseClient<Database>,
): Promise<AssignmentApproval> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("assignment_approvals")
    .upsert(
      {
        ward_id: wardId,
        assignment_id: assignmentId,
        user_id: userId,
        approved,
        comment,
      },
      { onConflict: "assignment_id,user_id" },
    )
    .select(APPROVAL_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not record an approval — ${error.message}`, {
      wardId,
      assignmentId,
      userId,
    });
    throw new Error(`Could not record that decision: ${error.message}`);
  }

  return {
    id: data.id,
    assignmentId: data.assignment_id,
    userId: data.user_id,
    approved: data.approved,
    comment: data.comment,
    createdAt: data.created_at,
  };
}

// The invalidation path. Editing an approved plan clears every approval on it, because an
// approval is a decision about a plan as it stood — a counselor must never find they approved
// something that was changed underneath them (04-talks-pipeline.md §Step 3).
//
// `exceptUserId` spares one person's row. The change-request path needs it: the comment saying
// WHAT to change lives on the refusing member's approval row, and clearing it along with the
// stale approvals would delete the only explanation the planner has.
export async function clearApprovals(
  wardId: string,
  assignmentId: string,
  options?: { exceptUserId?: string },
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("assignment_approvals")
    .delete()
    .eq("ward_id", wardId)
    .eq("assignment_id", assignmentId);

  if (options?.exceptUserId !== undefined) {
    query = query.neq("user_id", options.exceptUserId);
  }

  const { data, error } = await query.select("id");

  if (error) {
    console.error(`Could not clear an assignment's approvals — ${error.message}`, {
      wardId,
      assignmentId,
    });
    throw new Error(`Could not clear the approvals: ${error.message}`);
  }

  return (data ?? []).length;
}

// Author names come from a second read rather than a PostgREST embed. `assignment_comments`
// reaches `users` through a COMPOSITE foreign key (user_id, ward_id), and two explicit queries
// are cheaper to reason about than an embed whose relationship detection depends on it. Migration
// 020 makes `users` ward-readable, so this runs on the caller's own client and RLS stays the
// boundary.
async function readAuthorNames(
  supabase: SupabaseClient<Database>,
  wardId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await supabase
    .from("users")
    .select("id, first_name, last_name")
    .eq("ward_id", wardId)
    .in("id", [...userIds]);

  if (error) {
    console.error(`Could not read comment author names — ${error.message}`, { wardId });
    throw new Error(`Could not read who wrote the comments: ${error.message}`);
  }

  return new Map(
    (data ?? []).map((row) => [
      row.id,
      [row.first_name, row.last_name].filter(Boolean).join(" ").trim(),
    ]),
  );
}

export async function listComments(
  wardId: string,
  filter: CommentFilter,
  client?: SupabaseClient<Database>,
): Promise<AssignmentComment[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("assignment_comments")
    .select(COMMENT_COLUMNS)
    .eq("ward_id", wardId);

  query =
    "assignmentId" in filter
      ? query.eq("assignment_id", filter.assignmentId)
      : query.eq("sunday_id", filter.sundayId).eq("level", "month");

  // Oldest first: a comment thread reads as a conversation, and talks-b appends new rows at the
  // bottom as Realtime delivers them.
  const { data, error } = await query.order("created_at");

  if (error) {
    console.error(`Could not read assignment comments — ${error.message}`, {
      wardId,
      filter,
    });
    throw new Error(`Could not read the comments: ${error.message}`);
  }

  const rows = (data ?? []) as AssignmentCommentRow[];
  const names = await readAuthorNames(
    supabase,
    wardId,
    [...new Set(rows.map((row) => row.user_id))],
  );

  return rows.map((row) => ({
    id: row.id,
    assignmentId: row.assignment_id,
    sundayId: row.sunday_id,
    userId: row.user_id,
    authorName: names.get(row.user_id) || null,
    comment: row.comment,
    level: toOptionalEnum(row.level, COMMENT_LEVELS, "assignment_comments.level"),
    createdAt: row.created_at,
  }));
}

// `level` is set from the schema's discriminant, and the id column is chosen by the same
// discriminant — a month comment can never carry an assignment_id and vice versa.
export async function createComment(
  wardId: string,
  input: CreateCommentInput,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<AssignmentComment> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("assignment_comments")
    .insert({
      ward_id: wardId,
      user_id: userId,
      comment: input.comment,
      level: input.level,
      assignment_id: input.level === "assignment" ? input.assignmentId : null,
      sunday_id: input.level === "month" ? input.sundayId : null,
    })
    .select(COMMENT_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create an assignment comment — ${error.message}`, {
      wardId,
      level: input.level,
    });
    throw new Error(`Could not post that comment: ${error.message}`);
  }

  const row = data as AssignmentCommentRow;
  const names = await readAuthorNames(supabase, wardId, [userId]);

  return {
    id: row.id,
    assignmentId: row.assignment_id,
    sundayId: row.sunday_id,
    userId: row.user_id,
    authorName: names.get(row.user_id) || null,
    comment: row.comment,
    level: toOptionalEnum(row.level, COMMENT_LEVELS, "assignment_comments.level"),
    createdAt: row.created_at,
  };
}

// SKIPPED ENTIRELY when the assignment has no member_id. `assignment_history.member_id` is
// `not null` (migration 005), so an external speaker cannot have a history row — which is
// ITER-004's "speaker history is not distorted" requirement enforced by the schema rather than by
// everybody remembering to check. Do not relax that column to make this function simpler.
//
// Returns whether a row was written, so the caller's audit detail can say so honestly.
export async function writeAssignmentHistory(
  wardId: string,
  assignment: Assignment,
  outcome: AssignmentHistoryOutcome,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  if (assignment.memberId === null) return false;

  const supabase = await resolveClient(client);

  const { error } = await supabase.from("assignment_history").insert({
    ward_id: wardId,
    member_id: assignment.memberId,
    assignment_id: assignment.id,
    outcome: toEnumValue(
      outcome,
      ASSIGNMENT_HISTORY_OUTCOMES,
      "assignment_history.outcome",
    ),
  });

  if (error) {
    console.error(`Could not write speaker history — ${error.message}`, {
      wardId,
      assignmentId: assignment.id,
      outcome,
    });
    throw new Error(`Could not record that in speaker history: ${error.message}`);
  }

  return true;
}

export async function countAssignmentsOnSunday(
  wardId: string,
  sundayId: string,
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = await resolveClient(client);

  const { count, error } = await supabase
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId);

  if (error) {
    console.error(`Could not count a Sunday's assignments — ${error.message}`, {
      wardId,
      sundayId,
    });
    throw new Error(`Could not check that Sunday's assignments: ${error.message}`);
  }

  return count ?? 0;
}

// The active topics a planner may attach to an assignment, as id and title and nothing else.
//
// The TOPIC LIBRARY belongs to talks-c: `lib/topics/queries.ts`, `/api/topics`, categories,
// `last_assigned_at`, the AI candidate queue. None of that exists yet, and `plan` -> `review`
// refuses without a topic_id — so without this read the planner talks-b builds could not move a
// single assignment off the first stage.
//
// Deliberately the smallest read that unblocks it, and deliberately HERE rather than in a new
// lib/topics/queries.ts that talks-c would then have to reconcile with. When talks-c lands its
// module, this should be deleted and its callers pointed at that one.
export type TopicOption = {
  id: string;
  title: string;
};

export async function listTopicOptions(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<TopicOption[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("topics")
    .select("id, title")
    .eq("ward_id", wardId)
    .eq("status", "active")
    .order("title");

  if (error) {
    console.error(`Could not read the ward's topics — ${error.message}`, { wardId });
    throw new Error(`Could not read the topic library: ${error.message}`);
  }

  return (data ?? []).map((row) => ({ id: row.id, title: row.title }));
}
