import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addLineToVisitTodos,
  closeVisitTodos,
  createVisitTodo,
  VISITED_LINE,
} from "@/lib/todos/visitLinks";
import { isDoneVisit } from "@/lib/visits/householdStatus";
import { selectActiveGoal } from "@/lib/visits/progress";
import { listVisitGoals } from "@/lib/visits/queries";
import type { Database } from "@/types/database";
import {
  VISIT_ASSIGNMENT_END_REASONS,
  VISIT_NEEDS_ANOTHER_REASON_LABELS,
  type VisitAssignment,
  type VisitAssignmentEndReason,
  type VisitNeedsAnotherReason,
} from "@/types/domain";

// WHICH BISHOPRIC MEMBER IS TO VISIT WHICH HOUSEHOLD (ITER-055 bv5, migration 103).
//
// ---------------------------------------------------------------------------
// THE ONLY WRITER OF `visit_assignments`
// ---------------------------------------------------------------------------
// The table has a SELECT policy and no write policy. Every write below runs on the service role,
// and is reached only:
//   - from POST / PATCH /api/visit-assignments, behind canAssignVisits() (`visits.assign` AND a
//     bishopric calling), after the route checked the assignee holds a bishopric calling here and
//     every household is in this ward; or
//   - after the caller's OWN client wrote a visit or ended a goal in this ward (the visits and
//     visit-goals routes), so RLS has already proved they could.
// tests/lib/visitTodoSites.test.ts reads the source to keep it the only writer.
//
// ENDED, NEVER DELETED. Who held which household, and why it stopped, is the history.
//
// ---------------------------------------------------------------------------
// THE ORDER OF A REASSIGNMENT (the sacrament-finalize-hands-off-asks pitfall)
// ---------------------------------------------------------------------------
// End the old assignment → close the old holder's to-do → insert the new assignment → create the
// new holder's to-do. The one-open-per-household index (103a) would refuse the insert before the
// end; the to-do index (103b) is per owner and per assignment, so the two to-dos never collide.
// supabase-js has no transactions: a failure part way leaves the household unassigned or assigned
// with no to-do, both of which the next assign repairs, never two holders at once.
//
// ---------------------------------------------------------------------------
// WHICH VISITS CLOSE AN ASSIGNMENT (decided with the user at bv5 start)
// ---------------------------------------------------------------------------
// A FINISHED visit (`isDoneVisit()`, the one meaning of done) recorded for the household by the
// ORGANIZATION whose goal it is, on or after the goal started — exactly what sweepProgress() counts
// as done, so the to-do and the progress cannot disagree. A Bishopric visit is stored with
// `org_id = null` (P1) and stands for the ward's bishopric-typed organization here.

type Client = SupabaseClient<Database>;

const ASSIGNMENT_COLUMNS =
  "id, org_id, household_id, goal_id, assigned_to, assigned_by, created_at, ended_at, end_reason";

type AssignmentRow = {
  id: string;
  org_id: string;
  household_id: string;
  goal_id: string;
  assigned_to: string;
  assigned_by: string | null;
  created_at: string;
  ended_at: string | null;
  end_reason: string | null;
};

function toEndReason(value: string | null): VisitAssignmentEndReason | null {
  if (value === null) return null;
  if (!(VISIT_ASSIGNMENT_END_REASONS as readonly string[]).includes(value)) {
    throw new Error(
      `visit_assignments.end_reason holds "${value}", which is not a known value. Migration 103a ` +
        "and VISIT_ASSIGNMENT_END_REASONS in types/domain.ts have drifted.",
    );
  }
  return value as VisitAssignmentEndReason;
}

function mapAssignmentRow(row: AssignmentRow): VisitAssignment {
  return {
    id: row.id,
    orgId: row.org_id,
    householdId: row.household_id,
    goalId: row.goal_id,
    assignedTo: row.assigned_to,
    assignedBy: row.assigned_by,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    endReason: toEndReason(row.end_reason),
  };
}

// `status` is what the route answers: 409 when somebody else changed the same household a moment
// earlier, 500 when the database failed. The message is already a sentence for a person.
export class VisitAssignmentWriteError extends Error {
  readonly status: 409 | 500;

  constructor(message: string, cause: unknown, status: 409 | 500 = 500) {
    super(message);
    this.name = "VisitAssignmentWriteError";
    this.cause = cause;
    this.status = status;
  }
}

function fail(context: string, error: { message: string }, detail: Record<string, unknown>): never {
  console.error(`${context} — ${error.message}`, detail);
  throw new VisitAssignmentWriteError(`${context}. Please try again.`, error);
}

// ---------------------------------------------------------------------------
// READS — through the caller's client, so migration 103a's policy decides what is visible
// ---------------------------------------------------------------------------

// Every assignment made under one goal, open and ended, oldest first. The progress shares need the
// ended `visited` rows as well as the open ones.
export async function listGoalAssignments(
  wardId: string,
  goalId: string,
  client: Client,
): Promise<VisitAssignment[]> {
  const { data, error } = await client
    .from("visit_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("ward_id", wardId)
    .eq("goal_id", goalId)
    .order("created_at");

  if (error) {
    console.error(`Could not read visit assignments — ${error.message}`, { wardId, goalId });
    throw new Error(`Could not read who is assigned which household: ${error.message}`);
  }

  return (data ?? []).map(mapAssignmentRow);
}

export async function getAssignment(
  wardId: string,
  assignmentId: string,
  client: Client,
): Promise<VisitAssignment | null> {
  const { data, error } = await client
    .from("visit_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", assignmentId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a visit assignment — ${error.message}`, { wardId, assignmentId });
    throw new Error(`Could not read that assignment: ${error.message}`);
  }

  return data === null ? null : mapAssignmentRow(data);
}

// The ward's `bishopric`-typed organization, where the Bishopric's goal lives (bv4). Null when the
// ward has none, in which case nothing can be assigned.
export async function readBishopricOrganizationId(
  wardId: string,
  client: Client,
): Promise<string | null> {
  const { data, error } = await client
    .from("organizations")
    .select("id")
    .eq("ward_id", wardId)
    .eq("type", "bishopric")
    .eq("is_active", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the Bishopric organization — ${error.message}`, { wardId });
    throw new Error(`Could not read the Bishopric organization: ${error.message}`);
  }

  return data?.id ?? null;
}

// What the bishopric's households are being divided under: its organization and its ACTIVE goal.
// Assigning needs a goal (decided with the user at bv5 start) — dividing up the current goal is the
// whole act, and a goal ending is what cleanly ends its assignments.
export type AssignmentContext =
  | { kind: "ready"; orgId: string; goalId: string }
  | { kind: "no_bishopric_organization" }
  | { kind: "no_active_goal"; orgId: string };

export async function resolveAssignmentContext(
  wardId: string,
  client: Client,
): Promise<AssignmentContext> {
  const orgId = await readBishopricOrganizationId(wardId, client);
  if (orgId === null) return { kind: "no_bishopric_organization" };

  const goal = selectActiveGoal(await listVisitGoals(wardId, client), orgId);
  return goal === null ? { kind: "no_active_goal", orgId } : { kind: "ready", orgId, goalId: goal.id };
}

export const NO_BISHOPRIC_ORGANIZATION =
  "This ward has no Bishopric organization, so there is no bishopric goal to divide up.";
export const NO_ACTIVE_GOAL =
  "Set a visit goal for the Bishopric first — assigning divides up the current goal.";

// ---------------------------------------------------------------------------
// WRITES — service role only
// ---------------------------------------------------------------------------

async function endAssignments(
  wardId: string,
  assignmentIds: readonly string[],
  reason: VisitAssignmentEndReason,
  service: Client,
): Promise<string[]> {
  if (assignmentIds.length === 0) return [];
  const { data, error } = await service
    .from("visit_assignments")
    .update({ ended_at: new Date().toISOString(), end_reason: reason })
    .eq("ward_id", wardId)
    .in("id", [...assignmentIds])
    .is("ended_at", null)
    .select("id");

  if (error) fail("Could not end a visit assignment", error, { wardId, assignmentIds, reason });
  return (data ?? []).map((row) => row.id);
}

async function readOpenAssignments(
  wardId: string,
  filter: { orgId: string; householdIds: readonly string[] } | { goalId: string },
  service: Client,
): Promise<VisitAssignment[]> {
  let query = service
    .from("visit_assignments")
    .select(ASSIGNMENT_COLUMNS)
    .eq("ward_id", wardId)
    .is("ended_at", null);

  query =
    "goalId" in filter
      ? query.eq("goal_id", filter.goalId)
      : query.eq("org_id", filter.orgId).in("household_id", [...filter.householdIds]);

  const { data, error } = await query;
  if (error) fail("Could not read the open visit assignments", error, { wardId });
  return (data ?? []).map(mapAssignmentRow);
}

export type AssignHouseholdsResult = {
  assignedIds: string[];
  // Households that moved from somebody else to this person.
  reassigned: { householdId: string; fromUserId: string }[];
  // Households this person already held, left exactly as they were.
  unchangedHouseholdIds: string[];
};

// Gives each household to `assignedTo` under the goal. A household already theirs is left alone; a
// household somebody else holds is reassigned (D8): their to-do closes with "Reassigned to {name}"
// and any visit they scheduled stays on their appointments — the window warned about it first.
export async function assignHouseholds(
  params: {
    wardId: string;
    orgId: string;
    goalId: string;
    households: readonly { id: string; familyName: string }[];
    assignedTo: string;
    assigneeName: string;
    actorUserId: string;
  },
  service: Client,
): Promise<AssignHouseholdsResult> {
  const { wardId, orgId, goalId, assignedTo } = params;
  const householdIds = params.households.map((household) => household.id);

  const open = await readOpenAssignments(wardId, { orgId, householdIds }, service);
  const openByHousehold = new Map(open.map((assignment) => [assignment.householdId, assignment]));

  const unchangedHouseholdIds = params.households
    .filter((household) => openByHousehold.get(household.id)?.assignedTo === assignedTo)
    .map((household) => household.id);

  const movingAway = open.filter((assignment) => assignment.assignedTo !== assignedTo);
  const movingIds = movingAway.map((assignment) => assignment.id);

  await endAssignments(wardId, movingIds, "reassigned", service);
  await closeVisitTodos(
    {
      wardId,
      assignmentIds: movingIds,
      closedReason: "reassigned",
      line: { kind: "visit_reassigned", body: params.assigneeName },
    },
    service,
  );

  const toAssign = params.households.filter((household) => !unchangedHouseholdIds.includes(household.id));
  const assignedIds: string[] = [];

  if (toAssign.length > 0) {
    const { data, error } = await service
      .from("visit_assignments")
      .insert(
        toAssign.map((household) => ({
          ward_id: wardId,
          org_id: orgId,
          household_id: household.id,
          goal_id: goalId,
          assigned_to: assignedTo,
          assigned_by: params.actorUserId,
        })),
      )
      .select("id, household_id");

    if (error) {
      // 23505: somebody else assigned one of these households in the moment between the read and
      // the insert. Nothing was half-written by this insert, which is all-or-nothing.
      if (error.code === "23505") {
        throw new VisitAssignmentWriteError(
          "Somebody else assigned one of these households just now. Reload the page and try again.",
          error,
          409,
        );
      }
      fail("Could not save the visit assignments", error, { wardId, goalId });
    }

    const familyNameById = new Map(toAssign.map((household) => [household.id, household.familyName]));
    for (const row of data ?? []) {
      assignedIds.push(row.id);
      await createVisitTodo(
        {
          wardId,
          ownerUserId: assignedTo,
          assignedByUserId: params.actorUserId,
          assignmentId: row.id,
          familyName: familyNameById.get(row.household_id) ?? "this",
        },
        service,
      );
    }
  }

  return {
    assignedIds,
    reassigned: movingAway.map((assignment) => ({
      householdId: assignment.householdId,
      fromUserId: assignment.assignedTo,
    })),
    unchangedHouseholdIds,
  };
}

// The household goes back to nobody. Returns false when it was not open any more.
export async function unassignHousehold(
  params: { wardId: string; assignmentId: string },
  service: Client,
): Promise<boolean> {
  const ended = await endAssignments(params.wardId, [params.assignmentId], "unassigned", service);
  if (ended.length === 0) return false;

  await closeVisitTodos(
    {
      wardId: params.wardId,
      assignmentIds: ended,
      closedReason: "unassigned",
      line: { kind: "visit_unassigned", body: null },
    },
    service,
  );
  return true;
}

// The goal ended, completed or set aside (decided with the user at bv5 start: both close). Every
// household still assigned under it is released and its to-do closes with a line saying why.
export async function endAssignmentsForGoal(
  params: { wardId: string; goalId: string },
  service: Client,
): Promise<number> {
  const open = await readOpenAssignments(params.wardId, { goalId: params.goalId }, service);
  const ended = await endAssignments(
    params.wardId,
    open.map((assignment) => assignment.id),
    "goal_ended",
    service,
  );

  await closeVisitTodos(
    {
      wardId: params.wardId,
      assignmentIds: ended,
      closedReason: "goal_ended",
      line: { kind: "visit_goal_ended", body: null },
    },
    service,
  );
  return ended.length;
}

export type RecordedVisit = {
  orgId: string | null;
  householdId: string | null;
  visitDate: string;
  outcome: "completed" | "attempted";
  needsAnotherVisit: boolean;
  needsAnotherReason: VisitNeedsAnotherReason | null;
};

export type VisitAssignmentEffect = "closed" | "noted" | "none";

// Called after a visit is recorded, or edited into a new outcome. A finished visit closes the
// household's assignment and its to-do ("Visited."); a visit that still needs another leaves both
// open and adds a line naming the reason. An attempt changes nothing.
//
// Only an assignment under a goal that had STARTED by the visit's date is touched: a sweep does not
// count a visit before its start, and the to-do must agree with the count.
export async function reconcileAssignmentAfterVisit(
  params: { wardId: string; visit: RecordedVisit },
  service: Client,
): Promise<VisitAssignmentEffect> {
  const { wardId, visit } = params;
  if (visit.householdId === null) return "none";

  const done = isDoneVisit(visit);
  if (!done && !visit.needsAnotherVisit) return "none";

  const orgId = visit.orgId ?? (await readBishopricOrganizationId(wardId, service));
  if (orgId === null) return "none";

  const open = await readOpenAssignments(
    wardId,
    { orgId, householdIds: [visit.householdId] },
    service,
  );
  if (open.length === 0) return "none";

  const { data: goals, error } = await service
    .from("visit_goals")
    .select("id, started_on")
    .eq("ward_id", wardId)
    .in("id", open.map((assignment) => assignment.goalId));
  if (error) fail("Could not read a visit assignment's goal", error, { wardId });

  const startedOnByGoal = new Map((goals ?? []).map((goal) => [goal.id, goal.started_on]));
  const applicable = open.filter((assignment) => {
    const startedOn = startedOnByGoal.get(assignment.goalId);
    return startedOn !== undefined && visit.visitDate >= startedOn;
  });
  if (applicable.length === 0) return "none";

  const ids = applicable.map((assignment) => assignment.id);

  if (done) {
    const ended = await endAssignments(wardId, ids, "visited", service);
    await closeVisitTodos(
      {
        wardId,
        assignmentIds: ended,
        closedReason: null,
        line: { kind: "source_completed", body: VISITED_LINE },
      },
      service,
    );
    return "closed";
  }

  await addLineToVisitTodos(
    {
      wardId,
      assignmentIds: ids,
      line: {
        kind: "visit_partly_reached",
        body:
          visit.needsAnotherReason === null
            ? null
            : VISIT_NEEDS_ANOTHER_REASON_LABELS[visit.needsAnotherReason],
      },
    },
    service,
  );
  return "noted";
}
