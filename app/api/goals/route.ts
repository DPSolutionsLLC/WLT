import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createGoal, listGoalsWithStatus, resolveGoalTarget } from "@/lib/goals/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createGoalSchema, listGoalsQuerySchema } from "@/lib/validation/goal";
import type { Role } from "@/types/domain";

// RLS IS THE BOUNDARY HERE, and the route agrees with it.
//
// `goals` was ward-scoped until migration 030 — every authenticated member of the ward could read
// and write every goal, and only this route stood in the way. That gap was closed rather than
// handed to Phase 11, by copying the org-scoped policy `visit_goals` has carried since migration
// 019: `ward_id = current_ward_id() and (is_bishopric() or org_id = current_org_id())`.
//
// So ownership decides visibility, and ownership is stamped HERE from the session:
//   a bishopric author -> org_id null, a WARD-LEVEL goal only the bishopric sees
//   anyone else        -> org_id = their own organization
//
// The request cannot name its own owner. A caller that could would be able to write a goal onto
// another organization's board, or make one invisible to the org that has to act on it.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "goals.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;

    // Read here EXACTLY as GoalBoard sends it. A name this handler does not read gets no error,
    // just a silently ignored filter (plans/retros/roster-b-picker-and-orgs.md).
    const filter = listGoalsQuerySchema.parse({
      targetType: searchParams.get("targetType") ?? undefined,
    });

    // Every goal carries a COMPUTED status. The `goals.status` column is never selected and never
    // returned — 04-talks-pipeline.md §Step 9's rule, made structural in lib/goals/queries.ts.
    const goals = await listGoalsWithStatus(user.wardId, filter, new Date(), supabase);

    return NextResponse.json({ goals });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/goals",
      fallbackMessage: "Could not load the goals. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "goals.manage", roleAccess);

    const input = createGoalSchema.parse(await readJsonBody(request));

    // The database will NOT check this. `target_id` is polymorphic and carries no foreign key
    // (migration 010), so nothing but this line stands between a typo and a goal that points at
    // an id no table answers to — a permanent mystery on the board with no way to diagnose it.
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

    // A non-bishopric author with no organization would write a goal that migration 030's policy
    // hides from everyone including its author — `org_id = current_org_id()` is never true when
    // both are null. Refused with a sentence rather than written into a hole.
    const bishopricAuthor = isBishopric(user.role);

    if (!bishopricAuthor && user.orgId === null) {
      return NextResponse.json(
        {
          error:
            "Your account is not attached to an organization, so it cannot own a goal. " +
            "Ask a member of the bishopric to set your organization.",
        },
        { status: 409 },
      );
    }

    const goal = await createGoal(
      user.wardId,
      bishopricAuthor ? null : user.orgId,
      input,
      supabase,
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "goal_created",
        module: "goals",
        detail: {
          goalId: goal.id,
          orgId: goal.orgId,
          targetType: goal.targetType,
          desiredFrequencyMonths: goal.desiredFrequencyMonths,
        },
      },
      supabase,
    );

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/goals",
      fallbackMessage: "Could not create that goal. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
