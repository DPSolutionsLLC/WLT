import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { displayName } from "@/lib/auth/adminUsers";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { canManageMemberLinks } from "@/lib/callings/linkAccess";
import { declineLink, endLink, readLink, SELF_LINK_MESSAGE } from "@/lib/callings/memberLinks";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { decideMemberLinkSchema } from "@/lib/validation/memberLink";

// DECLINE A PENDING REQUEST, OR END AN ACTIVE LINK (ITER-058 cr1). Never a delete: the row stays as
// history. Same gate as linking. Ending your OWN link is refused like linking it — undoing a link
// is as much a change to whose calling you hold as making one.

const linkIdSchema = z.uuid("That link is not valid.");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageMemberLinks(user, roleAccess)) throw new ForbiddenError("admin.manage_users");

    const { id } = await params;
    const linkId = linkIdSchema.parse(id);
    const input = decideMemberLinkSchema.parse(await readJsonBody(request));
    const service = createServiceSupabaseClient();

    const existing = await readLink(linkId, user.wardId, service);
    if (!existing) {
      return NextResponse.json({ error: "That link is not in your ward." }, { status: 404 });
    }
    if (existing.userId === user.id) {
      return NextResponse.json({ error: SELF_LINK_MESSAGE }, { status: 403 });
    }

    const decide = { actorUserId: user.id, linkId, wardId: user.wardId };
    const result = input.action === "decline" ? await declineLink(decide, service) : await endLink(decide, service);

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: input.action === "decline" ? "member_link_declined" : "member_link_ended",
        module: "admin",
        detail: { linkId, targetUserId: existing.userId, memberId: existing.memberId },
      },
      supabase,
    );

    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      title: input.action === "decline" ? "Link request declined" : "Account unlinked from the ward list",
      description:
        input.action === "decline"
          ? `${displayName(user)} declined a request to be linked to the ward list.`
          : `${displayName(user)} unlinked an account from the ward list on Admin → Users.`,
    });

    return NextResponse.json({ link: result.link });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/admin/member-links/[id]",
      fallbackMessage: "Could not change that link. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
