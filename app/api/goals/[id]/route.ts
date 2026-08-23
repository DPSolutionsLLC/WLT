import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import {
  getGoal,
  markGoalFulfilled,
  resolveGoalTarget,
  updateGoal,
} from "@/lib/goals/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateGoalSchema } from "@/lib/validation/goal";

// A row that vanished between the read and the write, and a row RLS refused, are the same thing
// from here: not yours (plans/retros/foundation-c-services.md).
const WRITE_REFUSED = "That goal could not be saved. Reload and try again.";

const goalIdSchema = z.uuid("That goal id is not valid.");

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "goals.manage", roleAccess);

    const { id } = await params;
    const goalId = goalIdSchema.parse(id);
    const input = updateGoalSchema.parse(await readJsonBody(request));

    const existing = await getGoal(user.wardId, goalId, supabase);

    if (!existing) {
      return NextResponse.json({ error: "That goal is not in your ward." }, { status: 404 });
    }

    // Two actions, never both in one request (talks-a Decision 4). An edit and a fulfilment are
    // different events with different audit rows, and the schema is what keeps them apart.
    if (input.action === "fulfill") {
      const goal = await markGoalFulfilled(user.wardId, goalId, new Date(), supabase);

      if (!goal) {
        return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
      }

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "goal_fulfilled",
          module: "goals",
          detail: {
            goalId,
            previousFulfilledAt: existing.lastFulfilledAt,
            fulfilledAt: goal.lastFulfilledAt,
          },
        },
        supabase,
      );

      return NextResponse.json({ goal });
    }

    // Re-checked on EDIT as well as on create. Retargeting a goal is the other way it comes to
    // point at nothing, and the database checks it on neither path.
    if (input.targetType != null && input.targetId != null) {
      const label = await resolveGoalTarget(
        user.wardId,
        input.targetType,
        input.targetId,
        supabase,
      );

      if (label === null) {
        return NextResponse.json(
          { error: "That target is not in your ward." },
          { status: 404 },
        );
      }
    }

    const goal = await updateGoal(user.wardId, goalId, input, supabase);

    if (!goal) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "goal_updated",
        module: "goals",
        detail: {
          goalId,
          changed: Object.keys(input).filter((key) => key !== "action"),
        },
      },
      supabase,
    );

    return NextResponse.json({ goal });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/goals/[id]",
      fallbackMessage: "Could not save that goal. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
