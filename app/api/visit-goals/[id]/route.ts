import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getVisitGoal, updateVisitGoal } from "@/lib/visits/queries";
import { updateVisitGoalSchema } from "@/lib/validation/visit";

// A row that vanished between the read and the write, and a row RLS refused, are the same thing
// from here: not yours (plans/retros/foundation-c-services.md).
const WRITE_REFUSED = "That visit goal could not be saved. Reload and try again.";

const visitGoalIdSchema = z.uuid("That visit goal id is not valid.");

// `org_id` is NOT patchable. Moving a goal between organizations would take it out of the view
// of the org that has been working towards it, and the audit row would record it as an ordinary
// edit. If it is ever wanted it is its own action with its own audit entry, the way talks-a split
// an edit from a fulfilment.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // Not `visits.view`. An org secretary can read this goal and cannot change it, and the
    // permission matrix is what says so (plans/retros/role-access-overrides.md).
    assertCan(user, "visits.manage_goals", roleAccess);

    const { id } = await params;
    const goalId = visitGoalIdSchema.parse(id);
    const input = updateVisitGoalSchema.parse(await readJsonBody(request));

    const existing = await getVisitGoal(user.wardId, goalId, supabase);

    if (!existing) {
      return NextResponse.json({ error: "That visit goal is not in your ward." }, { status: 404 });
    }

    // A partial patch can make a period incoherent even though every field in the body is
    // valid on its own — sending only `goalPeriodEnd` cannot be checked against a start the
    // request never mentioned. Merged with the stored row and re-checked here.
    const mergedStart = input.goalPeriodStart ?? existing.goalPeriodStart;
    const mergedEnd = input.goalPeriodEnd ?? existing.goalPeriodEnd;

    if (mergedStart !== null && mergedEnd !== null && mergedEnd <= mergedStart) {
      return NextResponse.json(
        { error: "The goal period has to end after it starts." },
        { status: 400 },
      );
    }

    // Same reasoning for the cadence: switching an annual goal to `custom` without sending
    // months, or back to annual while a stale month count sits in the column, would leave two
    // sources of truth for one interval.
    const mergedCadence = input.cadence ?? existing.cadence;
    const mergedMonths =
      input.cadenceMonths !== undefined ? input.cadenceMonths : existing.cadenceMonths;

    if (mergedCadence === "custom" && mergedMonths === null) {
      return NextResponse.json(
        { error: "A custom cadence needs a number of months." },
        { status: 400 },
      );
    }

    if (mergedCadence !== "custom" && mergedCadence !== null && mergedMonths !== null) {
      return NextResponse.json(
        { error: `A ${mergedCadence} cadence already sets its own interval.` },
        { status: 400 },
      );
    }

    const goal = await updateVisitGoal(user.wardId, goalId, input, supabase);

    if (!goal) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "visit_goal_updated",
        module: "visits",
        detail: {
          visitGoalId: goalId,
          orgId: goal.orgId,
          changed: Object.keys(input),
        },
      },
      supabase,
    );

    return NextResponse.json({ goal });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/visit-goals/[id]",
      fallbackMessage: "Could not save that visit goal. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
