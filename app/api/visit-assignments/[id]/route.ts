import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { updateVisitAssignmentSchema } from "@/lib/validation/visit";
import {
  assertAssignableBishopricMember,
  readAssignableHouseholds,
  respondToAssignmentError,
} from "@/lib/visits/assignmentChecks";
import {
  assignHouseholds,
  getAssignment,
  listGoalAssignments,
  unassignHousehold,
} from "@/lib/visits/assignments";
import { memberDisplayName } from "@/lib/visits/assignmentShares";
import { canAssignVisits } from "@/lib/visits/visitOwnership";

// ONE HOUSEHOLD: to somebody else, or back to nobody (ITER-055 bv5, D8). The same boundary as POST
// /api/visit-assignments — canAssignVisits(), then the service role.
//
// The assignment is read through the CALLER's client first, so an id from another ward, or one this
// caller cannot see, is a 404 rather than a write on the service role. An assignment that has
// already ended is a 409 with a sentence: it is history now, and the household may have been given
// to somebody since.

const assignmentIdSchema = z.uuid("That assignment id is not valid.");

const NOT_FOUND = "That assignment is not in your ward.";
const ALREADY_ENDED =
  "This household is no longer assigned that way — somebody changed it. Reload and try again.";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canAssignVisits(user, roleAccess)) throw new ForbiddenError("visits.assign");

    const assignmentId = assignmentIdSchema.parse((await params).id);
    const input = updateVisitAssignmentSchema.parse(await readJsonBody(request));

    const existing = await getAssignment(user.wardId, assignmentId, supabase);
    if (existing === null) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    if (existing.endedAt !== null) {
      return NextResponse.json({ error: ALREADY_ENDED }, { status: 409 });
    }

    const service = createServiceSupabaseClient();

    if ("unassign" in input) {
      const ended = await unassignHousehold({ wardId: user.wardId, assignmentId }, service);
      if (!ended) return NextResponse.json({ error: ALREADY_ENDED }, { status: 409 });

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "visit_household_unassigned",
          module: "visits",
          detail: {
            assignmentId,
            orgId: existing.orgId,
            goalId: existing.goalId,
            householdId: existing.householdId,
            fromUserId: existing.assignedTo,
          },
        },
        supabase,
      );
    } else {
      const assignee = await assertAssignableBishopricMember(user.wardId, input.assignedTo, supabase);
      const households = await readAssignableHouseholds(user.wardId, [existing.householdId], supabase);

      const result = await assignHouseholds(
        {
          wardId: user.wardId,
          orgId: existing.orgId,
          goalId: existing.goalId,
          households,
          assignedTo: assignee.id,
          assigneeName: memberDisplayName(assignee),
          actorUserId: user.id,
        },
        service,
      );

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "visit_household_reassigned",
          module: "visits",
          detail: {
            previousAssignmentId: assignmentId,
            assignmentIds: result.assignedIds,
            orgId: existing.orgId,
            goalId: existing.goalId,
            householdId: existing.householdId,
            fromUserId: existing.assignedTo,
            toUserId: assignee.id,
          },
        },
        supabase,
      );
    }

    return NextResponse.json({
      assignments: await listGoalAssignments(user.wardId, existing.goalId, supabase),
    });
  } catch (error) {
    return respondToAssignmentError(error, {
      route: "PATCH /api/visit-assignments/[id]",
      fallbackMessage: "Could not change that assignment. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
