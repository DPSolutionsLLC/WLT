import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { inviteeIdSchema } from "@/lib/validation/zoom";
import { canManageInvitees } from "@/lib/zoom/access";
import { giveWaitingInviteeALink, readInvitee, readJoinUrl } from "@/lib/zoom/invitees";
import { countFreeLinks, describePoolLevel } from "@/lib/zoom/joinLinkPool";

// ONE PERSON'S JOIN LINK (ITER-053).
//
//   GET  — the URL, to show or text it again. The bishopric only; a read, so no audit row.
//   POST — give a waiting person the next free link (D1).
//
// No signed-in client can select `join_url` (migration 095), so this route, behind
// canManageInvitees(), is the only way a URL reaches a browser after the hand-out.

type RouteContext = { params: Promise<{ id: string }> };

async function requireManager() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
  return { user, supabase, allowed: canManageInvitees(user, roleAccess) };
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { user, allowed } = await requireManager();

  try {
    if (!allowed) throw new ForbiddenError("zoom.manage_invitees");
    const inviteeId = inviteeIdSchema.parse((await params).id);

    const joinUrl = await readJoinUrl(
      { wardId: user.wardId, inviteeId },
      createServiceSupabaseClient(),
    );
    if (!joinUrl) {
      return NextResponse.json({ error: "They don't have a Zoom link yet." }, { status: 404 });
    }

    return NextResponse.json({ joinUrl });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/zoom/invitees/[id]/link",
      fallbackMessage: "Could not read the Zoom link. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(_request: Request, { params }: RouteContext) {
  const { user, supabase, allowed } = await requireManager();

  try {
    if (!allowed) throw new ForbiddenError("zoom.manage_invitees");
    const inviteeId = inviteeIdSchema.parse((await params).id);
    const service = createServiceSupabaseClient();

    const result = await giveWaitingInviteeALink({ wardId: user.wardId, inviteeId }, service);

    if (result.status === "not_found") {
      return NextResponse.json({ error: "That person isn't on this ward's list." }, { status: 404 });
    }
    if (result.status === "pool_empty") {
      return NextResponse.json(
        { error: "There are no free links. Paste more on the Link pool tab." },
        { status: 409 },
      );
    }
    if (result.status === "already_has_link") {
      return NextResponse.json({ error: "They already have a link." }, { status: 409 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "zoom_invitee_link_given",
        module: "zoom",
        detail: { inviteeId, joinLinkId: result.joinLinkId },
      },
      supabase,
    );

    const [invitee, joinUrl, freeCount] = await Promise.all([
      readInvitee({ wardId: user.wardId, inviteeId }, service),
      readJoinUrl({ wardId: user.wardId, inviteeId }, service),
      countFreeLinks(user.wardId, service),
    ]);

    return NextResponse.json({ invitee, joinUrl, pool: describePoolLevel(freeCount) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/zoom/invitees/[id]/link",
      fallbackMessage: "Could not give the Zoom link. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
