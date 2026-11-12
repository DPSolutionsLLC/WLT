import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { TodoClosedReason, TodoLogKind } from "@/types/domain";

// WRITES THE "VISIT THE ___ FAMILY" TO-DO — ITER-055 bv5, migration 103b. The sibling of
// lib/todos/zoomLinks.ts and lib/todos/musicLinks.ts. Assigning a household to a bishopric member
// puts this on their list; a finished bishopric visit, a reassignment, an unassignment or the goal
// ending closes it.
//
// ---------------------------------------------------------------------------
// THE SERVICE ROLE, AND WHAT STANDS IN FOR RLS HERE
// ---------------------------------------------------------------------------
// `todos` is owner-only and its INSERT is open only to the owner (migration 081), and these writes
// land on ANOTHER bishopric member's list. Every caller is lib/visits/assignments.ts, which is
// called only after one of:
//   1. canAssignVisits() — `visits.assign` AND a bishopric calling — in a visit-assignments route;
//   2. the caller's own client wrote a visit, or ended a goal, in this ward, so RLS already proved
//      they could.
// The service role has no RLS behind it, so EVERY write below sets and filters `ward_id` (rule 1).
//
// NO AUDIT ROW IS WRITTEN HERE; the route writes one carrying ids. The title holds a family name,
// which is fine — the to-do is its owner's own — and it never enters an audit row.
//
// ---------------------------------------------------------------------------
// IDEMPOTENT
// ---------------------------------------------------------------------------
// Creation meets `todos_one_open_visit_todo_per_owner` (103b) and 23505 counts as "already there";
// every close is conditional on the to-do still being open.

type Client = SupabaseClient<Database>;

const VISIT_TAG = "Visits";
export const VISITED_LINE = "Visited.";

export class VisitTodoWriteError extends Error {
  constructor(cause: unknown) {
    super(
      "The visit assignment was saved, but the to-do that goes with it could not be updated. Please try again.",
    );
    this.name = "VisitTodoWriteError";
    this.cause = cause;
  }
}

function fail(context: string, error: { message: string }, detail: Record<string, unknown>): never {
  console.error(`${context} — ${error.message}`, detail);
  throw new VisitTodoWriteError(error);
}

export function visitTodoTitle(familyName: string): string {
  return `Visit the ${familyName} family`;
}

// `assigned_by` is null when the assignee assigned themselves: null means self (talks-d).
export async function createVisitTodo(
  params: {
    wardId: string;
    ownerUserId: string;
    assignedByUserId: string;
    assignmentId: string;
    familyName: string;
  },
  service: Client,
): Promise<string> {
  const detail = { wardId: params.wardId, assignmentId: params.assignmentId };

  const { data, error } = await service
    .from("todos")
    .insert({
      ward_id: params.wardId,
      user_id: params.ownerUserId,
      assigned_by: params.assignedByUserId === params.ownerUserId ? null : params.assignedByUserId,
      title: visitTodoTitle(params.familyName),
      tag: VISIT_TAG,
      notes: null,
      visit_assignment_id: params.assignmentId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code !== "23505") fail("Could not create a visit to-do", error, detail);

    const { data: existing, error: readError } = await service
      .from("todos")
      .select("id")
      .eq("ward_id", params.wardId)
      .eq("visit_assignment_id", params.assignmentId)
      .eq("user_id", params.ownerUserId)
      .is("completed_at", null)
      .single();
    if (readError) fail("Could not read an open visit to-do", readError, detail);
    return existing.id;
  }

  const { error: lineError } = await service.from("todo_log_entries").insert({
    ward_id: params.wardId,
    todo_id: data.id,
    kind: "visit_assigned",
    body: null,
  });
  if (lineError) fail("Could not write the 'assigned' line on a visit to-do", lineError, detail);

  return data.id;
}

// Closes every OPEN to-do for these assignments, whoever holds it. `closedReason` is null for a
// finished visit — the to-do did its job — and names why otherwise. One line per to-do says so.
export async function closeVisitTodos(
  params: {
    wardId: string;
    assignmentIds: readonly string[];
    closedReason: Extract<TodoClosedReason, "reassigned" | "unassigned" | "goal_ended"> | null;
    line: { kind: TodoLogKind; body: string | null };
  },
  service: Client,
): Promise<string[]> {
  if (params.assignmentIds.length === 0) return [];
  const detail = { wardId: params.wardId, assignmentIds: params.assignmentIds };
  const now = new Date().toISOString();

  const { data, error } = await service
    .from("todos")
    .update({ completed_at: now, closed_reason: params.closedReason, updated_at: now })
    .eq("ward_id", params.wardId)
    .in("visit_assignment_id", [...params.assignmentIds])
    .is("completed_at", null)
    .select("id");
  if (error) fail("Could not close a visit to-do", error, detail);

  const closedIds = (data ?? []).map((row) => row.id);
  await writeLines(params.wardId, closedIds, params.line, service, detail);
  return closedIds;
}

// A line on every OPEN to-do for these assignments, leaving it open — a household that was visited
// but still needs a visit (bv3's partly reached).
export async function addLineToVisitTodos(
  params: {
    wardId: string;
    assignmentIds: readonly string[];
    line: { kind: TodoLogKind; body: string | null };
  },
  service: Client,
): Promise<string[]> {
  if (params.assignmentIds.length === 0) return [];
  const detail = { wardId: params.wardId, assignmentIds: params.assignmentIds };

  const { data, error } = await service
    .from("todos")
    .select("id")
    .eq("ward_id", params.wardId)
    .in("visit_assignment_id", [...params.assignmentIds])
    .is("completed_at", null);
  if (error) fail("Could not read an open visit to-do", error, detail);

  const openIds = (data ?? []).map((row) => row.id);
  await writeLines(params.wardId, openIds, params.line, service, detail);
  return openIds;
}

async function writeLines(
  wardId: string,
  todoIds: readonly string[],
  line: { kind: TodoLogKind; body: string | null },
  service: Client,
  detail: Record<string, unknown>,
): Promise<void> {
  if (todoIds.length === 0) return;

  const { error } = await service.from("todo_log_entries").insert(
    todoIds.map((todoId) => ({ ward_id: wardId, todo_id: todoId, kind: line.kind, body: line.body })),
  );
  if (error) fail(`Could not write a '${line.kind}' line on a visit to-do`, error, detail);
}
