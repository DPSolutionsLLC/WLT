import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createFollowUpTodo } from "@/lib/todos/visitLinks";
import { visitFollowUpSchema } from "@/lib/validation/visit";
import {
  assertAssignableBishopricMember,
  NOT_BISHOPRIC_FOLLOW_UP_OWNER,
} from "@/lib/visits/assignmentChecks";
import { getVisitLog } from "@/lib/visits/queries";
import { canAssignVisits } from "@/lib/visits/visitOwnership";

// A follow-up from a visit, onto a bishopric member's To Do (ITER-055 bv7, P14).
//
// THE SAME BOUNDARY AS DIVIDING THE HOUSEHOLDS: `visits.assign` AND a bishopric calling
// (canAssignVisits). The write lands on ANOTHER member's list through the service role, because
// migration 081's INSERT policy is owner-only, so this check is what stands in front of it. The
// visit is read through the caller's own client first, so a visit they cannot see is a 404.
// `ownerUserId` is a subject column from the body: it must hold a bishopric calling in this ward.
//
// The audit row carries ids only — never the title, which may name a family's circumstances.

const visitLogIdSchema = z.uuid("That visit id is not valid.");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canAssignVisits(user, roleAccess)) throw new ForbiddenError("visits.assign");

    const visitLogId = visitLogIdSchema.parse((await params).id);
    const input = visitFollowUpSchema.parse(await readJsonBody(request));

    const visit = await getVisitLog(user.wardId, visitLogId, supabase);
    if (visit === null) {
      return NextResponse.json({ error: "That visit is not in your ward." }, { status: 404 });
    }

    const owner = await assertAssignableBishopricMember(
      user.wardId,
      input.ownerUserId,
      supabase,
      NOT_BISHOPRIC_FOLLOW_UP_OWNER,
    );

    const todoId = await createFollowUpTodo(
      {
        wardId: user.wardId,
        ownerUserId: owner.id,
        assignedByUserId: user.id,
        visitLogId,
        title: input.title,
        dueDate: input.dueDate ?? null,
      },
      createServiceSupabaseClient(),
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "visit_follow_up_created",
        module: "visits",
        detail: {
          visitLogId,
          todoId,
          ownerUserId: owner.id,
          forSelf: owner.id === user.id,
          hasDueDate: input.dueDate != null,
        },
      },
      supabase,
    );

    return NextResponse.json({ todoId }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/visits/[id]/follow-ups",
      fallbackMessage: "Could not add that follow-up. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
