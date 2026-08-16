import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { createInvite } from "@/lib/auth/invites";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { displayName } from "@/lib/auth/adminUsers";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createInviteSchema } from "@/lib/validation/invite";
import { ROLE_LABELS } from "@/types/domain";

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
    assertCan(user, "admin.manage_users");

    const input = createInviteSchema.parse(await readJsonBody(request));
    const supabase = await createServerSupabaseClient();

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
          role: result.invite.role,
          orgId: result.invite.orgId,
        },
      },
      supabase,
    );

    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      description: `${displayName(user)} created an invite for ${
        ROLE_LABELS[result.invite.role]
      } (${result.invite.email ?? "no email"}).`,
    });

    return NextResponse.json({ invite: result.invite, url: result.url });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/auth/invite",
      fallbackMessage: "Could not create the invite. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
