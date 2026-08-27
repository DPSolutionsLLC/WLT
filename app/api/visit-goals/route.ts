import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createVisitGoal, listVisitGoals } from "@/lib/visits/queries";
import { createVisitGoalSchema } from "@/lib/validation/visit";
import type { Role } from "@/types/domain";

// Visit goals, per organization. RLS is the boundary and this route agrees with it: migration
// 019 scopes visit_goals to `ward_id = current_ward_id() and (is_bishopric() or org_id =
// current_org_id())`, so ownership decides visibility — and ownership is stamped HERE, from the
// session, never from the request body.
//
// READ IS WIDER THAN WRITE, ON PURPOSE. `visits.view` reaches an org secretary;
// `visits.manage_goals` does not (lib/auth/permissions.ts). That is what makes a secretary
// read-only, and it is checked through assertCan rather than by comparing `user.role` to
// "org_secretary" — a hardcoded role string bypasses the ward's role_access override, which is
// exactly the bug plans/retros/role-access-overrides.md records. 07-visits.md §Step 1 advises
// the role comparison; do not follow it.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.view", roleAccess);

    const goals = await listVisitGoals(user.wardId, supabase);

    return NextResponse.json({ goals });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/visit-goals",
      fallbackMessage: "Could not load the visit goals. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.manage_goals", roleAccess);

    const input = createVisitGoalSchema.parse(await readJsonBody(request));
    const bishopricAuthor = isBishopric(user.role);

    // A bishopric member configures ANY organization, so they have to say which one — and it is
    // checked against the ward's live organizations, because `visit_goals.org_id` carries a
    // composite foreign key that would refuse a foreign id with a constraint violation rather
    // than a sentence anybody can act on.
    if (bishopricAuthor) {
      if (input.orgId === undefined) {
        return NextResponse.json(
          { error: "Choose which organization this goal belongs to." },
          { status: 400 },
        );
      }

      const organizations = await listWardOrganizations(user.wardId, supabase);

      if (!organizations.some((organization) => organization.id === input.orgId)) {
        return NextResponse.json(
          { error: "That organization is not in your ward." },
          { status: 404 },
        );
      }
    } else if (input.orgId !== undefined && input.orgId !== user.orgId) {
      // Refused rather than ignored. Silently overwriting it would let a leader believe they had
      // just configured the Relief Society's goal.
      return NextResponse.json(
        { error: "You can only set goals for your own organization." },
        { status: 403 },
      );
    }

    // An org leader with no organization would write a goal that migration 019's policy hides
    // from everyone including its author — `org_id = current_org_id()` is never true when both
    // are null. Refused with a sentence rather than written into a hole
    // (plans/retros/talks-d-reliability-goals.md).
    if (!bishopricAuthor && user.orgId === null) {
      return NextResponse.json(
        {
          error:
            "Your account is not attached to an organization, so it cannot own a visit goal. " +
            "Ask a member of the bishopric to set your organization.",
        },
        { status: 409 },
      );
    }

    const orgId = bishopricAuthor ? (input.orgId ?? null) : user.orgId;

    const goal = await createVisitGoal(user.wardId, orgId, user.id, input, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "visit_goal_created",
        module: "visits",
        detail: {
          visitGoalId: goal.id,
          orgId: goal.orgId,
          targetType: goal.targetType,
          cadenceAmount: goal.cadence?.amount ?? null,
          cadenceUnit: goal.cadence?.unit ?? null,
          noticeAmount: goal.notice?.amount ?? null,
          noticeUnit: goal.notice?.unit ?? null,
          deadline: goal.deadline,
        },
      },
      supabase,
    );

    return NextResponse.json({ goal }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/visit-goals",
      fallbackMessage: "Could not create that visit goal. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
