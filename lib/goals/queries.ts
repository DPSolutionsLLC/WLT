import type { SupabaseClient } from "@supabase/supabase-js";
import { goalStatusFor } from "@/lib/goals/goalStatus";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { CreateGoalInput, ListGoalsQuery, UpdateGoalInput } from "@/lib/validation/goal";
import type { Database } from "@/types/database";
import { GOAL_TARGET_TYPES, type GoalStatus, type GoalTargetType } from "@/types/domain";

// Every goal read and write goes through this module. Route handlers and pages never touch
// Supabase directly (conventions.md §Data Access).
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. The pure rule
// lives in goalStatus.ts precisely so GoalBoard and the calendar can render a status without
// touching this file (plans/retros/roster-b-picker-and-orgs.md).
//
// `goals.status` IS NOT SELECTED ANYWHERE IN THIS FILE. That is the point. The phase plan calls
// the column a materialized cache and the computed value the truth; leaving the column out of
// GOAL_COLUMNS means no response can carry a stale bucket even by accident, rather than everyone
// remembering not to read it. supabase/migrations/029_goal_status_refresh.sql keeps the column
// current for a future report to index — if the function and goalStatus() ever disagree,
// goalStatus() is right.

export type Goal = {
  id: string;
  // The organization that OWNS this goal. Null is a ward-level goal, which migration 030 makes
  // bishopric-only. It is not the same thing as `targetType: "org"` — a goal owned by the Elders
  // Quorum can be about a household, and a ward-level goal can be about an organization.
  orgId: string | null;
  title: string;
  targetType: GoalTargetType | null;
  targetId: string | null;
  desiredFrequencyMonths: number | null;
  lastFulfilledAt: string | null;
  notes: string | null;
  createdAt: string;
};

// The label a target resolves to, or null when it resolves to nothing. `target_id` is polymorphic
// with NO foreign key (migration 010's comment is explicit), so a household that was deleted
// leaves a goal pointing at an id nothing answers to. Null here is what lets the board say so
// instead of rendering a blank row.
export type GoalWithStatus = Goal & {
  status: GoalStatus | null;
  targetLabel: string | null;
  // The owning organization's name, for a bishopric viewer reading every org's goals at once.
  // Null for a ward-level goal.
  ownerName: string | null;
};

type GoalRow = {
  id: string;
  org_id: string | null;
  title: string;
  target_type: string | null;
  target_id: string | null;
  desired_frequency_months: number | null;
  last_fulfilled_at: string | null;
  notes: string | null;
  created_at: string;
};

type GoalUpdate = Database["public"]["Tables"]["goals"]["Update"];

// One string literal on ONE line, and never a `+` concatenation — concatenation widens the type
// to `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md).
const GOAL_COLUMNS =
  "id, org_id, title, target_type, target_id, desired_frequency_months, last_fulfilled_at, notes, created_at";

function toOptionalTargetType(value: string | null): GoalTargetType | null {
  if (value === null) return null;

  if (!(GOAL_TARGET_TYPES as readonly string[]).includes(value)) {
    throw new Error(
      `goals.target_type holds "${value}", which is not a known value. The CHECK ` +
        "constraint in migration 010 and types/domain.ts have drifted.",
    );
  }

  return value as GoalTargetType;
}

// Builds an explicit object rather than spreading the row, for the same reason mapSundayRow does:
// a column added to `goals` later cannot ride along into a response nobody reviewed. `status` is
// the column this specifically keeps out.
export function mapGoalRow(row: GoalRow): Goal {
  return {
    id: row.id,
    orgId: row.org_id,
    title: row.title,
    targetType: toOptionalTargetType(row.target_type),
    targetId: row.target_id,
    desiredFrequencyMonths: row.desired_frequency_months,
    lastFulfilledAt: row.last_fulfilled_at,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

function targetKey(targetType: GoalTargetType, targetId: string): string {
  return `${targetType}:${targetId}`;
}

// Three small ward-scoped reads, one per table a goal can point at, resolved into display labels.
//
// This module reads `members`, `households` and `organizations` directly rather than going through
// their owning modules, which is the one place it departs from conventions.md §Data Access. The
// reason: a polymorphic target has no join to follow, so what is needed is an id -> name lookup
// over an arbitrary id list, and none of the three owning modules exposes one. Adding a by-ids
// filter to each would be a refactor of three modules to serve one label.
//
// It reads ONLY the id and the display name. No address, no phone, no note ever enters a goal
// response through here.
async function resolveTargetLabels(
  wardId: string,
  targets: readonly { targetType: GoalTargetType; targetId: string }[],
  supabase: SupabaseClient<Database>,
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();

  const idsFor = (targetType: GoalTargetType): string[] => [
    ...new Set(
      targets
        .filter((target) => target.targetType === targetType)
        .map((target) => target.targetId),
    ),
  ];

  const memberIds = idsFor("member");
  const householdIds = idsFor("household");
  const orgIds = idsFor("org");

  if (memberIds.length > 0) {
    const { data, error } = await supabase
      .from("members")
      .select("id, first_name, last_name")
      .eq("ward_id", wardId)
      .in("id", memberIds);

    if (error) {
      console.error(`Could not resolve goal member targets — ${error.message}`, { wardId });
      throw new Error(`Could not read the goals: ${error.message}`);
    }

    for (const member of data ?? []) {
      labels.set(
        targetKey("member", member.id),
        `${member.first_name} ${member.last_name}`.trim(),
      );
    }
  }

  if (householdIds.length > 0) {
    const { data, error } = await supabase
      .from("households")
      .select("id, family_name")
      .eq("ward_id", wardId)
      .in("id", householdIds);

    if (error) {
      console.error(`Could not resolve goal household targets — ${error.message}`, { wardId });
      throw new Error(`Could not read the goals: ${error.message}`);
    }

    for (const household of data ?? []) {
      labels.set(targetKey("household", household.id), household.family_name);
    }
  }

  if (orgIds.length > 0) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name")
      .eq("ward_id", wardId)
      .in("id", orgIds);

    if (error) {
      console.error(`Could not resolve goal org targets — ${error.message}`, { wardId });
      throw new Error(`Could not read the goals: ${error.message}`);
    }

    for (const organization of data ?? []) {
      labels.set(targetKey("org", organization.id), organization.name);
    }
  }

  return labels;
}

// Returns the label when the target resolves to a live row in the right table, and null when it
// does not. The route calls this BEFORE an insert, because the database will not: a polymorphic
// target_id carries no foreign key, and a goal pointing at a deleted household is a permanent
// mystery on the board that nothing in the schema would have stopped.
export async function resolveGoalTarget(
  wardId: string,
  targetType: GoalTargetType,
  targetId: string,
  client?: SupabaseClient<Database>,
): Promise<string | null> {
  const supabase = await resolveClient(client);
  const labels = await resolveTargetLabels(wardId, [{ targetType, targetId }], supabase);

  return labels.get(targetKey(targetType, targetId)) ?? null;
}

// Status is attached HERE, computed, for every caller — the board, the calendar and the route all
// get the same answer from the same pure function. `asOf` is a parameter so the calendar can ask
// "what is this goal's status ON that Sunday" rather than only "today".
export function withStatus(
  goals: readonly Goal[],
  asOf: Date,
  labels: Map<string, string> = new Map(),
): GoalWithStatus[] {
  return goals.map((goal) => ({
    ...goal,
    status: goalStatusFor(goal, asOf),
    targetLabel:
      goal.targetType === null || goal.targetId === null
        ? null
        : (labels.get(targetKey(goal.targetType, goal.targetId)) ?? null),
    // Resolved from the same map as the targets — an owning org is an organization id like any
    // other, so it rides along in the one read rather than earning a query of its own.
    ownerName: goal.orgId === null ? null : (labels.get(targetKey("org", goal.orgId)) ?? null),
  }));
}

export async function listGoals(
  wardId: string,
  filter: ListGoalsQuery = {},
  client?: SupabaseClient<Database>,
): Promise<Goal[]> {
  const supabase = await resolveClient(client);

  let query = supabase.from("goals").select(GOAL_COLUMNS).eq("ward_id", wardId);

  if (filter.targetType !== undefined) {
    query = query.eq("target_type", filter.targetType);
  }

  const { data, error } = await query.order("created_at");

  if (error) {
    console.error(`Could not read the ward's goals — ${error.message}`, { wardId, filter });
    throw new Error(`Could not read the goals: ${error.message}`);
  }

  return (data ?? []).map(mapGoalRow);
}

// The board's read: goals, their computed status, and a label for every target that still exists.
export async function listGoalsWithStatus(
  wardId: string,
  filter: ListGoalsQuery,
  asOf: Date,
  client?: SupabaseClient<Database>,
): Promise<GoalWithStatus[]> {
  const supabase = await resolveClient(client);
  const goals = await listGoals(wardId, filter, supabase);

  const targets = goals.flatMap((goal) =>
    goal.targetType === null || goal.targetId === null
      ? []
      : [{ targetType: goal.targetType, targetId: goal.targetId }],
  );

  // The OWNING organizations, resolved through the same helper. resolveTargetLabels dedupes ids
  // per table, so a goal owned by the Elders Quorum and one targeting it cost one lookup between
  // them rather than two.
  const owners = goals.flatMap((goal) =>
    goal.orgId === null ? [] : [{ targetType: "org" as const, targetId: goal.orgId }],
  );

  const labels = await resolveTargetLabels(wardId, [...targets, ...owners], supabase);

  return withStatus(goals, asOf, labels);
}

export async function getGoal(
  wardId: string,
  goalId: string,
  client?: SupabaseClient<Database>,
): Promise<Goal | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("goals")
    .select(GOAL_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", goalId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a goal — ${error.message}`, { wardId, goalId });
    throw new Error(`Could not read that goal: ${error.message}`);
  }

  return data ? mapGoalRow(data) : null;
}

// `status` is not written on create and cannot be written by any function here. The nightly
// refresh owns that column; an insert that set it would be writing a value this app has already
// decided not to trust.
//
// `orgId` is a PARAMETER rather than a field on the input, for the same reason `source` is on
// createTopic(): it is decided by who is signing the request, not by what the request says. A
// caller that could name its own owning organization could write a goal into another org's board.
export async function createGoal(
  wardId: string,
  orgId: string | null,
  input: CreateGoalInput,
  client?: SupabaseClient<Database>,
): Promise<Goal> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("goals")
    .insert({
      ward_id: wardId,
      org_id: orgId,
      title: input.title,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      desired_frequency_months: input.desiredFrequencyMonths,
      notes: input.notes ?? null,
    })
    .select(GOAL_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a goal — ${error.message}`, { wardId });
    throw new Error(`Could not create that goal: ${error.message}`);
  }

  return mapGoalRow(data);
}

// Cannot write `org_id`. Ownership is settled when the goal is created and there is no parameter
// here that could move it — handing a goal to another organization is a different action with
// different consequences, and it is not one anybody has asked for. Same separation as
// `last_fulfilled_at`.
//
// Returns null when the row is absent — the route turns that into a 404. A row that is not in
// this ward and a row RLS refused are indistinguishable here, and both mean "not yours"
// (plans/retros/foundation-c-services.md).
export async function updateGoal(
  wardId: string,
  goalId: string,
  input: Extract<UpdateGoalInput, { action: "update" }>,
  client?: SupabaseClient<Database>,
): Promise<Goal | null> {
  const supabase = await resolveClient(client);

  const patch: GoalUpdate = {};

  if (input.title !== undefined) patch.title = input.title;
  if (input.targetType !== undefined) patch.target_type = input.targetType;
  if (input.targetId !== undefined) patch.target_id = input.targetId;
  if (input.desiredFrequencyMonths !== undefined) {
    patch.desired_frequency_months = input.desiredFrequencyMonths;
  }
  if (input.notes !== undefined) patch.notes = input.notes;

  const { data, error } = await supabase
    .from("goals")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", goalId)
    .select(GOAL_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update a goal — ${error.message}`, { wardId, goalId });
    throw new Error(`Could not save that goal: ${error.message}`);
  }

  return data ? mapGoalRow(data) : null;
}

// The ONLY function that writes `last_fulfilled_at`, and updateGoal() has no parameter that could
// carry it — the same separation updateAssignmentFields() and transitionAssignment() keep one
// layer up (talks-a Decision 4). An edit cannot quietly move a goal back on track.
export async function markGoalFulfilled(
  wardId: string,
  goalId: string,
  fulfilledAt: Date,
  client?: SupabaseClient<Database>,
): Promise<Goal | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("goals")
    .update({ last_fulfilled_at: fulfilledAt.toISOString() })
    .eq("ward_id", wardId)
    .eq("id", goalId)
    .select(GOAL_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not mark a goal fulfilled — ${error.message}`, { wardId, goalId });
    throw new Error(`Could not record that goal as fulfilled: ${error.message}`);
  }

  return data ? mapGoalRow(data) : null;
}
