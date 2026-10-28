import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { joinLinkIdSchema } from "@/lib/validation/zoom";
import { canManageInvitees } from "@/lib/zoom/access";
import { removeJoinLink } from "@/lib/zoom/joinLinkPool";

// Removing a FREE pool link — a typo in a paste (ITER-053, P4). A link somebody holds stays with
// them (D2); remove_unassigned_zoom_link() checks and deletes in one statement.

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageInvitees(user, roleAccess)) throw new ForbiddenError("zoom.manage_invitees");

    const joinLinkId = joinLinkIdSchema.parse((await params).id);

    const removed = await removeJoinLink(
      { wardId: user.wardId, linkId: joinLinkId },
      createServiceSupabaseClient(),
    );

    if (!removed) {
      return NextResponse.json(
        { error: "That link has been given to someone, so it can't be removed." },
        { status: 409 },
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "zoom_join_link_removed",
        module: "zoom",
        detail: { joinLinkId },
      },
      supabase,
    );

    return NextResponse.json({ removed: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/zoom/join-links/[id]",
      fallbackMessage: "Could not remove the Zoom link. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
