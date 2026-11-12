import { NextResponse } from "next/server";
import { respondToRouteError, type RouteErrorContext } from "@/lib/auth/routeErrors";
import { VisitTodoWriteError } from "@/lib/todos/visitLinks";
import {
  reconcileAssignmentAfterVisit,
  VisitAssignmentWriteError,
  type RecordedVisit,
  type VisitAssignmentEffect,
} from "@/lib/visits/assignments";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidInputError } from "@/lib/auth/errors";
import { listBishopricUsers } from "@/lib/calendar/queries";
import { findUsersOutsideWard } from "@/lib/callings/queries";
import type { BishopricMember } from "@/lib/visits/assignmentShares";
import type { Database } from "@/types/database";

// The checks and the error mapping the two /api/visit-assignments routes share (ITER-055 bv5).

type Client = SupabaseClient<Database>;

export const NOT_BISHOPRIC_ASSIGNEE =
  "Households can only be assigned to the bishop or one of the counselors.";

// `assignedTo` is a SUBJECT column written from a request body (CLAUDE.md §7, the 069 warning). The
// person must hold a calling in this ward (findUsersOutsideWard asks about the CALLING, never
// users.ward_id) AND that calling must be a serving bishopric one.
export async function assertAssignableBishopricMember(
  wardId: string,
  userId: string,
  client: Client,
): Promise<BishopricMember> {
  const outside = await findUsersOutsideWard(wardId, [userId], client);
  if (outside.length > 0) throw new InvalidInputError(NOT_BISHOPRIC_ASSIGNEE);

  const member = (await listBishopricUsers(wardId, client)).find((candidate) => candidate.id === userId);
  if (member === undefined) throw new InvalidInputError(NOT_BISHOPRIC_ASSIGNEE);
  return member;
}

// Read through the caller's own client, ward-filtered, so an id from another ward simply is not
// returned and the caller compares the counts.
export async function readAssignableHouseholds(
  wardId: string,
  householdIds: readonly string[],
  client: Client,
): Promise<{ id: string; familyName: string }[]> {
  const { data, error } = await client
    .from("households")
    .select("id, family_name")
    .eq("ward_id", wardId)
    .in("id", [...new Set(householdIds)]);

  if (error) {
    console.error(`Could not read households to assign — ${error.message}`, { wardId });
    throw new Error(`Could not read those households: ${error.message}`);
  }

  return (data ?? []).map((row) => ({ id: row.id, familyName: row.family_name }));
}

// Both write errors carry a sentence for a person. A to-do that failed after the assignment saved is
// a 500 that says so, because the assignment itself already happened.
export function respondToAssignmentError(error: unknown, context: RouteErrorContext): NextResponse {
  if (error instanceof VisitAssignmentWriteError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof VisitTodoWriteError) {
    console.error(`${context.route} — ${error.message}`, { ...context.detail, cause: error.cause });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return respondToRouteError(error, context);
}

export const VISIT_SAVED_TODO_FAILED =
  "The visit was saved, but the household's visit to-do could not be updated. Reload the page to check it.";

// The visits routes' half (bv5). The visit is already saved when this runs, so a failure here must
// not read "Could not save that visit": it answers 500 with a sentence that says the visit is safe.
export async function reconcileVisitAssignment(
  wardId: string,
  visit: RecordedVisit,
  service: Client,
): Promise<VisitAssignmentEffect> {
  try {
    return await reconcileAssignmentAfterVisit({ wardId, visit }, service);
  } catch (error) {
    console.error("Could not bring a visit assignment into line with a recorded visit", {
      wardId,
      householdId: visit.householdId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new VisitAssignmentWriteError(VISIT_SAVED_TODO_FAILED, error);
  }
}
