import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  CreateVisitGoalInput,
  CreateVisitLogInput,
  ListVisitsQuery,
  UpdateVisitGoalInput,
  UpdateVisitLogInput,
} from "@/lib/validation/visit";
import type { Database } from "@/types/database";
import {
  VISIT_CADENCES,
  VISIT_TARGET_TYPES,
  VISIT_TYPES,
  type VisitCadence,
  type VisitTargetType,
  type VisitType,
} from "@/types/domain";

// Every `visit_goals` and `visit_logs` read and write goes through this module. Route handlers
// and pages never touch Supabase directly (conventions.md §Data Access).
//
// THIS MODULE NEVER SELECTS FROM `visit_private_notes`, AND NEVER IMPORTS THE MODULE THAT DOES.
//
// That is the mechanism, not a nicety. Private notes live in lib/visits/privateNotes.ts, so
// "did this response include a private note?" is answerable by reading the import list at the
// top of a route or a page without reading its body — the same rule lib/roster/memberNotes.ts
// states for member notes. A private note joined in here would reach a list endpoint, an
// export, a report tile and a notification body all at once, and every one of those is a
// promise this app made to the person who wrote it (CLAUDE.md rule 5).
//
// This module is the reminder. RLS is the guard: migration 019 gives visit_private_notes four
// author-only policies and no bishopric branch on any of them, and
// tests/rls/private-notes.test.ts is what proves it holds whether or not a caller remembers
// this file exists.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers.

export type VisitGoal = {
  id: string;
  // The organization that owns this goal. Null is a bishopric-authored, ward-level goal, which
  // migration 019's `org_id = current_org_id()` makes bishopric-only — null is never equal to
  // null in SQL, so no org leader can see it. Stamped from the session, never from a request.
  orgId: string | null;
  title: string | null;
  targetType: VisitTargetType | null;
  cadence: VisitCadence | null;
  cadenceMonths: number | null;
  goalPeriodStart: string | null;
  goalPeriodEnd: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type VisitLog = {
  id: string;
  orgId: string | null;
  householdId: string | null;
  visitedBy: string | null;
  visitDate: string;
  visitType: VisitType;
  sharedNotes: string | null;
  flaggedForWardCouncil: boolean;
  flagSentAt: string | null;
  createdAt: string;
};

// The display shape the list endpoint returns. Note what is NOT here and cannot be added by
// accident: there is no private-note field on VisitLog, so a response built from this type
// cannot carry one even if a future `select` widened.
export type VisitLogWithContext = VisitLog & {
  householdName: string | null;
  visitedByName: string | null;
};

type VisitGoalRow = {
  id: string;
  org_id: string | null;
  title: string | null;
  target_type: string | null;
  cadence: string | null;
  cadence_months: number | null;
  goal_period_start: string | null;
  goal_period_end: string | null;
  created_by: string | null;
  created_at: string;
};

type VisitLogRow = {
  id: string;
  org_id: string | null;
  household_id: string | null;
  visited_by: string | null;
  visit_date: string;
  visit_type: string;
  shared_notes: string | null;
  flagged_for_ward_council: boolean;
  flag_sent_at: string | null;
  created_at: string;
};

type VisitLogJoinedRow = VisitLogRow & {
  households: { id: string; family_name: string } | null;
  users: { id: string; first_name: string | null; last_name: string | null } | null;
};

// One string literal on ONE line, never a `+` concatenation — concatenation widens the type to
// `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md). And never `select("*")`: an explicit list is what
// stops a column added later riding into a response nobody reviewed.
const VISIT_GOAL_COLUMNS =
  "id, org_id, title, target_type, cadence, cadence_months, goal_period_start, goal_period_end, created_by, created_at";

const VISIT_LOG_COLUMNS =
  "id, org_id, household_id, visited_by, visit_date, visit_type, shared_notes, flagged_for_ward_council, flag_sent_at, created_at";

// Households and users, for the family/who-visited display. NOT private notes, and there is no
// arrangement of this string that could reach them — visit_private_notes has no foreign key
// from visit_logs pointing at it, so PostgREST cannot embed it here at all.
const VISIT_LOG_JOINED_COLUMNS = `${VISIT_LOG_COLUMNS}, households (id, family_name), users (id, first_name, last_name)` as const;

// A value the CHECK constraint should have made impossible means the constraint and
// types/domain.ts have drifted, and that is worth a crash rather than a silent cast — the same
// reasoning toEnumValue() uses in lib/roster/queries.ts.
function toEnum<T extends string>(
  value: string,
  allowed: readonly T[],
  column: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `${column} holds "${value}", which is not a known value. The CHECK constraint and ` +
        "types/domain.ts have drifted.",
    );
  }
  return value as T;
}

function toOptionalEnum<T extends string>(
  value: string | null,
  allowed: readonly T[],
  column: string,
): T | null {
  return value === null ? null : toEnum(value, allowed, column);
}

// Builds an explicit object rather than spreading the row, for the same reason mapGoalRow does:
// a column added to `visit_goals` later cannot ride along into a response nobody reviewed.
export function mapVisitGoalRow(row: VisitGoalRow): VisitGoal {
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    targetType: toOptionalEnum(row.target_type, VISIT_TARGET_TYPES, "visit_goals.target_type"),
    cadence: toOptionalEnum(row.cadence, VISIT_CADENCES, "visit_goals.cadence"),
    cadenceMonths: row.cadence_months,
    goalPeriodStart: row.goal_period_start,
    goalPeriodEnd: row.goal_period_end,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function mapVisitLogRow(row: VisitLogRow): VisitLog {
  return {
    id: row.id,
    orgId: row.org_id,
    householdId: row.household_id,
    visitedBy: row.visited_by,
    visitDate: row.visit_date,
    visitType: toEnum(row.visit_type, VISIT_TYPES, "visit_logs.visit_type"),
    sharedNotes: row.shared_notes,
    flaggedForWardCouncil: row.flagged_for_ward_council,
    flagSentAt: row.flag_sent_at,
    createdAt: row.created_at,
  };
}

function mapVisitLogJoinedRow(row: VisitLogJoinedRow): VisitLogWithContext {
  const visitor = row.users;
  const visitedByName =
    visitor === null
      ? null
      : `${visitor.first_name ?? ""} ${visitor.last_name ?? ""}`.trim() || null;

  return {
    ...mapVisitLogRow(row),
    householdName: row.households?.family_name ?? null,
    visitedByName,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// Every function below takes the CALLER'S session client. RLS does the org scoping, and there is
// deliberately no belt-and-braces `org_id` filter on top of it: a redundant filter would mask a
// policy regression by hiding rows the policy had started letting through, which is exactly the
// leak the RLS tests exist to catch.

export async function listVisitGoals(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<VisitGoal[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_goals")
    .select(VISIT_GOAL_COLUMNS)
    .eq("ward_id", wardId)
    .order("goal_period_start", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Could not read visit goals — ${error.message}`, { wardId });
    throw new Error(`Could not load the visit goals: ${error.message}`);
  }

  return (data ?? []).map(mapVisitGoalRow);
}

export async function getVisitGoal(
  wardId: string,
  goalId: string,
  client?: SupabaseClient<Database>,
): Promise<VisitGoal | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_goals")
    .select(VISIT_GOAL_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", goalId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a visit goal — ${error.message}`, { wardId, goalId });
    throw new Error(`Could not load that visit goal: ${error.message}`);
  }

  return data === null ? null : mapVisitGoalRow(data);
}

export async function createVisitGoal(
  wardId: string,
  orgId: string | null,
  userId: string,
  input: CreateVisitGoalInput,
  client?: SupabaseClient<Database>,
): Promise<VisitGoal> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_goals")
    .insert({
      ward_id: wardId,
      org_id: orgId,
      title: input.title,
      target_type: input.targetType,
      cadence: input.cadence,
      cadence_months: input.cadenceMonths ?? null,
      goal_period_start: input.goalPeriodStart,
      goal_period_end: input.goalPeriodEnd,
      created_by: userId,
    })
    .select(VISIT_GOAL_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a visit goal — ${error.message}`, { wardId, orgId });
    throw new Error(`Could not save that visit goal: ${error.message}`);
  }

  return mapVisitGoalRow(data);
}

// Returns null when the row did not change, which from here is indistinguishable from a row RLS
// refused — an RLS-denied UPDATE is a zero-row success, not an error
// (plans/retros/foundation-c-services.md). The route turns that into a 404.
export async function updateVisitGoal(
  wardId: string,
  goalId: string,
  input: UpdateVisitGoalInput,
  client?: SupabaseClient<Database>,
): Promise<VisitGoal | null> {
  const supabase = await resolveClient(client);

  const patch: Database["public"]["Tables"]["visit_goals"]["Update"] = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.cadence !== undefined) patch.cadence = input.cadence;
  if (input.cadenceMonths !== undefined) patch.cadence_months = input.cadenceMonths;
  if (input.goalPeriodStart !== undefined) patch.goal_period_start = input.goalPeriodStart;
  if (input.goalPeriodEnd !== undefined) patch.goal_period_end = input.goalPeriodEnd;

  const { data, error } = await supabase
    .from("visit_goals")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", goalId)
    .select(VISIT_GOAL_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update a visit goal — ${error.message}`, { wardId, goalId });
    throw new Error(`Could not save that visit goal: ${error.message}`);
  }

  return data === null ? null : mapVisitGoalRow(data);
}

export async function listVisitLogs(
  wardId: string,
  filter: ListVisitsQuery,
  client?: SupabaseClient<Database>,
): Promise<VisitLogWithContext[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("visit_logs")
    .select(VISIT_LOG_JOINED_COLUMNS)
    .eq("ward_id", wardId);

  if (filter.orgId !== undefined) query = query.eq("org_id", filter.orgId);
  if (filter.householdId !== undefined) query = query.eq("household_id", filter.householdId);
  if (filter.from !== undefined) query = query.gte("visit_date", filter.from);
  if (filter.to !== undefined) query = query.lte("visit_date", filter.to);

  // Ordered explicitly, because these tables are shared by every suite running against the
  // hosted project and heap order shifts under them (plans/retros/route-tests-and-realtime.md).
  const { data, error } = await query
    .order("visit_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Could not read visit logs — ${error.message}`, { wardId });
    throw new Error(`Could not load the visits: ${error.message}`);
  }

  return (data ?? []).map((row) => mapVisitLogJoinedRow(row as unknown as VisitLogJoinedRow));
}

export async function getVisitLog(
  wardId: string,
  visitLogId: string,
  client?: SupabaseClient<Database>,
): Promise<VisitLog | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_logs")
    .select(VISIT_LOG_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", visitLogId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a visit log — ${error.message}`, { wardId, visitLogId });
    throw new Error(`Could not load that visit: ${error.message}`);
  }

  return data === null ? null : mapVisitLogRow(data);
}

export async function createVisitLog(
  wardId: string,
  orgId: string | null,
  userId: string,
  input: CreateVisitLogInput,
  client?: SupabaseClient<Database>,
): Promise<VisitLog> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_logs")
    .insert({
      ward_id: wardId,
      org_id: orgId,
      household_id: input.householdId,
      visited_by: userId,
      visit_date: input.visitDate,
      visit_type: input.visitType,
      shared_notes: input.sharedNotes ?? null,
    })
    .select(VISIT_LOG_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a visit log — ${error.message}`, { wardId, orgId });
    throw new Error(`Could not save that visit: ${error.message}`);
  }

  return mapVisitLogRow(data);
}

// `flagSentAt` is a separate parameter rather than a field on UpdateVisitLogInput because no
// request may set it. The flag TRANSITION is the route's decision (07-visits.md §Step 3) and a
// body that could stamp its own flag_sent_at could silence the notification.
export async function updateVisitLog(
  wardId: string,
  visitLogId: string,
  input: UpdateVisitLogInput,
  flagSentAt?: string | null,
  client?: SupabaseClient<Database>,
): Promise<VisitLog | null> {
  const supabase = await resolveClient(client);

  const patch: Database["public"]["Tables"]["visit_logs"]["Update"] = {};
  if (input.sharedNotes !== undefined) patch.shared_notes = input.sharedNotes;
  if (input.flaggedForWardCouncil !== undefined) {
    patch.flagged_for_ward_council = input.flaggedForWardCouncil;
  }
  if (flagSentAt !== undefined) patch.flag_sent_at = flagSentAt;

  const { data, error } = await supabase
    .from("visit_logs")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", visitLogId)
    .select(VISIT_LOG_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update a visit log — ${error.message}`, { wardId, visitLogId });
    throw new Error(`Could not save that visit: ${error.message}`);
  }

  return data === null ? null : mapVisitLogRow(data);
}
