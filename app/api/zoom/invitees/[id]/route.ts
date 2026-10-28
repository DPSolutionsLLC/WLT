import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { inviteeIdSchema, updateInviteeSchema } from "@/lib/validation/zoom";
import { canManageInvitees } from "@/lib/zoom/access";
import { assertPickableMember, updateInvitee } from "@/lib/zoom/invitees";

// EDITING AN INVITEE (ITER-053, D3). The bishopric only; the audit row names WHICH fields changed and
// never their values — a phone, an email and notes about a non-member stay out of the log.

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageInvitees(user, roleAccess)) throw new ForbiddenError("zoom.manage_invitees");

    const inviteeId = inviteeIdSchema.parse((await params).id);
    const input = updateInviteeSchema.parse(await readJsonBody(request));
    if (input.memberId) await assertPickableMember(supabase, input.memberId);

    const result = await updateInvitee(
      { wardId: user.wardId, inviteeId, input },
      createServiceSupabaseClient(),
    );

    if (!result) {
      return NextResponse.json({ error: "That person isn't on this ward's list." }, { status: 404 });
    }

    if (result.changedFields.length > 0) {
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "zoom_invitee_updated",
          module: "zoom",
          detail: { inviteeId, changedFields: result.changedFields },
        },
        supabase,
      );
    }

    return NextResponse.json({ invitee: result.invitee });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/zoom/invitees/[id]",
      fallbackMessage: "Could not save the changes. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
