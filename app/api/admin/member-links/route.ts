import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { displayName } from "@/lib/auth/adminUsers";
import { ForbiddenError, InvalidInputError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { canManageMemberLinks } from "@/lib/callings/linkAccess";
import { linkByAdmin, SELF_LINK_MESSAGE } from "@/lib/callings/memberLinks";
import { findUsersOutsideWard } from "@/lib/callings/queries";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { adminMemberLinkSchema } from "@/lib/validation/memberLink";

// A BISHOPRIC MEMBER LINKS ANOTHER ACCOUNT TO ITS ROSTER PERSON (ITER-058 cr1).
//
// canManageMemberLinks() — `admin.manage_users` AND a bishopric calling, or the super admin — is
// the write boundary: `user_member_links` has no write policy (migration 105a). Linking YOUR OWN
// account is refused here and again in the library, whoever you are (P3).
//
// `userId` is a SUBJECT column from a request body (CLAUDE.md §7), so the account must hold a
// calling in this ward. `memberId` is checked against the ward's active roster by the library.
// The audit row carries ids and the method only; the notification names the people.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageMemberLinks(user, roleAccess)) throw new ForbiddenError("admin.manage_users");

    const input = adminMemberLinkSchema.parse(await readJsonBody(request));

    if (input.userId === user.id) {
      return NextResponse.json({ error: SELF_LINK_MESSAGE }, { status: 403 });
    }

    const outside = await findUsersOutsideWard(user.wardId, [input.userId], supabase);
    if (outside.length > 0) throw new InvalidInputError("That account is not in your ward.");

    const result = await linkByAdmin(
      { actorUserId: user.id, userId: input.userId, wardId: user.wardId, memberId: input.memberId },
      createServiceSupabaseClient(),
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "member_link_approved",
        module: "admin",
        detail: {
          linkId: result.link.id,
          targetUserId: input.userId,
          memberId: input.memberId,
          method: result.link.method,
        },
      },
      supabase,
    );

    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      title: "Account linked to the ward list",
      description: `${displayName(user)} linked an account to the ward list on Admin → Users.`,
    });

    return NextResponse.json({ link: result.link }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/admin/member-links",
      fallbackMessage: "Could not link that account. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
