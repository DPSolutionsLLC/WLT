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
import { readInvitee, readJoinUrl } from "@/lib/zoom/invitees";
import { JOIN_LINK_EMAIL_NOT_CONFIGURED, sendJoinLinkEmail } from "@/lib/zoom/joinLinkEmail";
import { buildJoinLinkEmail } from "@/lib/zoom/joinLinkMessage";

// POST — email somebody their own Zoom link (plans/zoom-link-email-and-text.md).
//
// The bishopric only, behind the same guard as GET …/link. The link is read here with the service
// role and goes from the server to Resend; it never travels through the browser, an audit row or
// the response. Pressing again sends again, on purpose: that is how a lost email is re-sent.

type RouteContext = { params: Promise<{ id: string }> };

async function readWardName(
  wardId: string,
  service: ReturnType<typeof createServiceSupabaseClient>,
): Promise<string | null> {
  const { data, error } = await service.from("wards").select("name").eq("id", wardId).maybeSingle();
  if (error) {
    console.error(`Could not read the ward name for a Zoom link email — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward name: ${error.message}`);
  }
  return data?.name ?? null;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();

  try {
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageInvitees(user, roleAccess)) throw new ForbiddenError("zoom.manage_invitees");
    const inviteeId = inviteeIdSchema.parse((await params).id);
    const service = createServiceSupabaseClient();

    const invitee = await readInvitee({ wardId: user.wardId, inviteeId }, service);
    if (!invitee) {
      return NextResponse.json({ error: "That person isn't on this ward's list." }, { status: 404 });
    }

    const joinUrl = await readJoinUrl({ wardId: user.wardId, inviteeId }, service);
    if (!joinUrl) {
      return NextResponse.json({ error: "They don't have a Zoom link yet." }, { status: 404 });
    }

    if (!invitee.email) {
      return NextResponse.json(
        { error: "There's no email address on file for them. Add one with Edit." },
        { status: 409 },
      );
    }

    const wardName = await readWardName(user.wardId, service);
    const result = await sendJoinLinkEmail({
      inviteeId,
      to: invitee.email,
      email: buildJoinLinkEmail({ displayName: invitee.displayName, wardName, joinUrl }),
    });

    if (result.status === "not_configured") {
      return NextResponse.json({ error: JOIN_LINK_EMAIL_NOT_CONFIGURED }, { status: 409 });
    }
    if (result.status === "failed") {
      return NextResponse.json(
        { error: "The email could not be sent. Please try again, or use Text it." },
        { status: 502 },
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "zoom_invitee_link_emailed",
        module: "zoom",
        detail: { inviteeId },
      },
      supabase,
    );

    return NextResponse.json({ sent: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/zoom/invitees/[id]/email",
      fallbackMessage: "Could not email the Zoom link. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
