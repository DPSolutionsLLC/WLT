import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError, InvalidInputError } from "@/lib/auth/errors";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { assignVisitsSchema } from "@/lib/validation/visit";
import {
  assertAssignableBishopricMember,
  readAssignableHouseholds,
  respondToAssignmentError,
} from "@/lib/visits/assignmentChecks";
import {
  assignHouseholds,
  listGoalAssignments,
  NO_ACTIVE_GOAL,
  NO_BISHOPRIC_ORGANIZATION,
  resolveAssignmentContext,
} from "@/lib/visits/assignments";
import { memberDisplayName } from "@/lib/visits/assignmentShares";
import { canAssignVisits } from "@/lib/visits/visitOwnership";

// DIVIDING THE BISHOPRIC'S HOUSEHOLDS (ITER-055 bv5, migration 103).
//
// GET reads through the caller's own client: migration 103a's policy decides which assignments are
// visible (the bishopric all of them, an assignee their own).
//
// POST writes on the SERVICE ROLE, because `visit_assignments` has no write policy and the to-do it
// creates lands on another member's list. canAssignVisits() — `visits.assign` AND a bishopric
// calling — is the write boundary and can never be skipped. `assignedTo` is a SUBJECT column from
// the request body (CLAUDE.md §7): the person must be in this ward AND hold a bishopric calling here.
//
// The audit row carries ids and counts only; never a family name.

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    assertCan(user, "visits.view", roleAccess);

    const context = await resolveAssignmentContext(user.wardId, supabase);
    const assignments =
      context.kind === "ready"
        ? await listGoalAssignments(user.wardId, context.goalId, supabase)
        : [];

    return NextResponse.json({ assignments });
  } catch (error) {
    return respondToAssignmentError(error, {
      route: "GET /api/visit-assignments",
      fallbackMessage: "Could not load who is assigned which household. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canAssignVisits(user, roleAccess)) throw new ForbiddenError("visits.assign");

    const input = assignVisitsSchema.parse(await readJsonBody(request));

    const context = await resolveAssignmentContext(user.wardId, supabase);
    if (context.kind === "no_bishopric_organization") {
      return NextResponse.json({ error: NO_BISHOPRIC_ORGANIZATION }, { status: 409 });
    }
    if (context.kind === "no_active_goal") {
      return NextResponse.json({ error: NO_ACTIVE_GOAL }, { status: 409 });
    }

    const assignee = await assertAssignableBishopricMember(user.wardId, input.assignedTo, supabase);
    const households = await readAssignableHouseholds(user.wardId, input.householdIds, supabase);
    if (households.length !== new Set(input.householdIds).size) {
      throw new InvalidInputError("One of those households is not in this ward. Reload and try again.");
    }

    const result = await assignHouseholds(
      {
        wardId: user.wardId,
        orgId: context.orgId,
        goalId: context.goalId,
        households,
        assignedTo: assignee.id,
        assigneeName: memberDisplayName(assignee),
        actorUserId: user.id,
      },
      createServiceSupabaseClient(),
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "visit_households_assigned",
        module: "visits",
        detail: {
          orgId: context.orgId,
          goalId: context.goalId,
          assignedTo: assignee.id,
          assignmentIds: result.assignedIds,
          reassignedCount: result.reassigned.length,
          unchangedCount: result.unchangedHouseholdIds.length,
        },
      },
      supabase,
    );

    return NextResponse.json(
      {
        assignments: await listGoalAssignments(user.wardId, context.goalId, supabase),
        assignedCount: result.assignedIds.length,
        reassignedCount: result.reassigned.length,
        unchangedCount: result.unchangedHouseholdIds.length,
      },
      { status: 201 },
    );
  } catch (error) {
    return respondToAssignmentError(error, {
      route: "POST /api/visit-assignments",
      fallbackMessage: "Could not assign those households. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
