import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { createInviteeSchema } from "@/lib/validation/zoom";
import { canManageInvitees } from "@/lib/zoom/access";
import {
  assertPickableMember,
  createInvitee,
  readInvitee,
  readJoinUrl,
  ZoomLinkAssignError,
} from "@/lib/zoom/invitees";
import { countFreeLinks, describePoolLevel } from "@/lib/zoom/joinLinkPool";

// GIVING SOMEBODY A ZOOM LINK ON A VISIT (ITER-053, z2b).
//
// `zoom_invitees` has no write policy (migration 095), so canManageInvitees() IS THE WRITE BOUNDARY
// and the write is the service role. The join URL is in THIS response because the leader is about
// to text or show it; it never enters the audit row. An empty pool still saves the person, as
// waiting (D1).

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageInvitees(user, roleAccess)) throw new ForbiddenError("zoom.manage_invitees");

    const input = createInviteeSchema.parse(await readJsonBody(request));
    if (input.memberId) await assertPickableMember(supabase, input.memberId);

    const service = createServiceSupabaseClient();

    const auditCreated = (inviteeId: string, joinLinkId: string | null) =>
      writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "zoom_invitee_created",
          module: "zoom",
          detail: { inviteeId, memberId: input.memberId, linkGiven: joinLinkId !== null, joinLinkId },
        },
        supabase,
      );

    let created;
    try {
      created = await createInvitee({ wardId: user.wardId, actorUserId: user.id, input }, service);
    } catch (error) {
      if (error instanceof ZoomLinkAssignError) {
        await auditCreated(error.inviteeId, null);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }

    await auditCreated(created.inviteeId, created.joinLinkId);

    const [invitee, joinUrl, freeCount] = await Promise.all([
      readInvitee({ wardId: user.wardId, inviteeId: created.inviteeId }, service),
      created.joinLinkId
        ? readJoinUrl({ wardId: user.wardId, inviteeId: created.inviteeId }, service)
        : Promise.resolve(null),
      countFreeLinks(user.wardId, service),
    ]);

    return NextResponse.json(
      { invitee, joinUrl, pool: describePoolLevel(freeCount) },
      { status: 201 },
    );
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/zoom/invitees",
      fallbackMessage: "Could not give the Zoom link. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
