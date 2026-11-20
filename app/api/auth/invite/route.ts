import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { createInvite, readWaitingInvite } from "@/lib/auth/invites";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { displayName } from "@/lib/auth/adminUsers";
import { canManageMemberLinks } from "@/lib/callings/linkAccess";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createInviteSchema, waitingInviteQuerySchema } from "@/lib/validation/invite";

// The invite URL has to work on localhost and on Vercel, so the origin comes from the request
// rather than an environment variable that would be wrong in one of the two.
function resolveOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;

  const protocol =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  return `${protocol}://${host}`;
}

export async function POST(request: Request) {
  // Outside the try, deliberately: requireSessionUser() redirects by throwing an internal
  // Next.js error, and catching that below would turn the redirect into a 500.
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    // An invite now ends in a ward list link as well as a calling (ITER-058 cr4), so it takes the
    // link gate: `admin.manage_users` AND a bishopric calling or the super admin.
    if (!canManageMemberLinks(user, roleAccess)) {
      return NextResponse.json(
        { error: "Inviting people is limited to the bishopric." },
        { status: 403 },
      );
    }

    const input = createInviteSchema.parse(await readJsonBody(request));

    const result = await createInvite(
      {
        wardId: user.wardId,
        invitedBy: user.id,
        origin: resolveOrigin(request),
        input,
      },
      supabase,
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    // The token is not in this detail object and must never be added to it. writeAuditLog
    // redacts a key named `token`, but that is a backstop, not the rule.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "invite_created",
        module: "admin",
        detail: {
          inviteId: result.invite.id,
          memberId: result.invite.memberId,
          role: result.invite.role,
          orgId: result.invite.orgId,
        },
      },
      supabase,
    );

    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      description: `${displayName(user)} created an invite for ${result.invite.callingLabel} (${
        result.invite.email ?? "no email"
      }).`,
    });

    return NextResponse.json({ invite: result.invite, url: result.url, warning: result.warning });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/auth/invite",
      fallbackMessage: "Could not create the invite. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// THE PERSON'S WAITING LINK, for the invite window to show again (decided walking scenario 105).
// Same gate as making one, and read through the caller's own client, so 019's bishopric-only policy
// is the boundary. The URL is never written into the page; it is fetched when the window opens.
export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    if (!canManageMemberLinks(user, roleAccess)) {
      return NextResponse.json(
        { error: "Inviting people is limited to the bishopric." },
        { status: 403 },
      );
    }

    const { memberId } = waitingInviteQuerySchema.parse({
      memberId: new URL(request.url).searchParams.get("memberId"),
    });

    const waiting = await readWaitingInvite(user.wardId, memberId, resolveOrigin(request), supabase);
    return NextResponse.json({ waiting });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/auth/invite",
      fallbackMessage: "Could not read the waiting invite. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
