import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { compareCadences } from "@/lib/visits/cadence";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { endVisitGoal, getVisitGoal, updateVisitGoal } from "@/lib/visits/queries";
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
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

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

    // AN ENDED GOAL IS A RECORD (ITER-055 bv4). Goal history recomputes its numbers against the
    // instant it ended; changing its cadence or its start afterwards would change what that page
    // says happened.
    if (existing.endedAt !== null) {
      return NextResponse.json(
        { error: "This goal has ended. It stays as it was in Goal history." },
        { status: 409 },
      );
    }

    if (input.end !== undefined) {
      const ended = await endVisitGoal(user.wardId, goalId, input.end, new Date(), supabase);

      if (!ended) {
        return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
      }

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "visit_goal_ended",
          module: "visits",
          detail: {
            visitGoalId: goalId,
            orgId: ended.orgId,
            kind: ended.kind,
            endReason: ended.endReason,
          },
        },
        supabase,
      );

      return NextResponse.json({ goal: ended });
    }

    // A sweep has no schedule (migration 102's `visit_goals_sweep_has_no_cadence`). Refused with a
    // sentence rather than left to the CHECK, whose violation would be a 500.
    if (
      existing.kind === "sweep" &&
      (input.cadenceAmount !== undefined ||
        input.cadenceUnit !== undefined ||
        input.noticeAmount !== undefined ||
        input.noticeUnit !== undefined)
    ) {
      return NextResponse.json(
        { error: "A goal to visit every household once has no schedule to set." },
        { status: 400 },
      );
    }

    // ONE merged check, replacing the two the period model needed.
    //
    // A partial patch can make a goal incoherent even when every field in the body is valid on
    // its own — sending only `noticeAmount` cannot be checked against a cadence the request
    // never mentioned. So the merged cadence and merged notice are built from `input ?? stored`
    // and the same comparison the schema runs is re-run here.
    //
    // compareCadences() rather than a day conversion, for the same reason lib/validation/visit.ts
    // uses it: 2 months and 60 days are not the same length, and this must be the comparison
    // householdVisitPriority() will make.
    const mergedCadenceAmount = input.cadenceAmount ?? existing.cadence?.amount;
    const mergedCadenceUnit = input.cadenceUnit ?? existing.cadence?.unit;
    const mergedNoticeAmount = input.noticeAmount ?? existing.notice?.amount;
    const mergedNoticeUnit = input.noticeUnit ?? existing.notice?.unit;

    if (
      mergedCadenceAmount !== undefined &&
      mergedCadenceUnit !== undefined &&
      mergedNoticeAmount !== undefined &&
      mergedNoticeUnit !== undefined &&
      compareCadences(
        { amount: mergedNoticeAmount, unit: mergedNoticeUnit },
        { amount: mergedCadenceAmount, unit: mergedCadenceUnit },
      ) >= 0
    ) {
      return NextResponse.json(
        {
          error:
            "The warning has to start inside the interval, so it must be shorter than the " +
            "cadence. A warning as long as the cadence would mark every household as " +
            "approaching.",
        },
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
