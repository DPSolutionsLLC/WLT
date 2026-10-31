import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { matchRegistrationSchema, registrationIdSchema } from "@/lib/validation/zoomRegistration";
import { canManageInvitees } from "@/lib/zoom/access";
import { MatchTodoCloseError, matchRegistration } from "@/lib/zoom/registrationMatch";
import { readRegistration } from "@/lib/zoom/registrations";

// MATCH A PUBLIC SIGN-UP TO THE ROSTER (ITER-052 z3b, plan D3). POST { memberId }.
//
// The bishopric only (canManageInvitees(), the write boundary — the table has no write policy).
// Closes every open "Match ___ to the roster" to-do, whoever holds it. The audit row carries ids
// and a boolean, never a name.

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();

  try {
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageInvitees(user, roleAccess)) throw new ForbiddenError("zoom.manage_invitees");

    const registrationId = registrationIdSchema.parse((await params).id);
    const { memberId } = matchRegistrationSchema.parse(await readJsonBody(request));
    const service = createServiceSupabaseClient();
    const ids = { wardId: user.wardId, registrationId };

    const audit = (previousMemberId: boolean, closedTodoIds: string[]) =>
      writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "zoom_registration_matched",
          module: "zoom",
          detail: { registrationId, memberId, previousMemberId, closedTodoIds },
        },
        supabase,
      );

    let result;
    try {
      result = await matchRegistration({ ...ids, memberId, userId: user.id }, supabase, service);
    } catch (error) {
      if (error instanceof MatchTodoCloseError) {
        await audit(error.previousMemberId, []);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }

    if (result.status === "not_found") {
      return NextResponse.json({ error: "That sign-up isn't on this ward's list." }, { status: 404 });
    }
    if (result.status === "declined") {
      return NextResponse.json(
        { error: "This sign-up was declined, so there is nobody to match." },
        { status: 409 },
      );
    }

    await audit(result.previousMemberId, result.closedTodoIds);
    return NextResponse.json({ registration: await readRegistration(ids, service) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/zoom/registrations/[id]/match",
      fallbackMessage: "Could not save the match. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
