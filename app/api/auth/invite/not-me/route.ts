import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { declineInvite, INVITE_REFUSED_MESSAGE } from "@/lib/auth/invites";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { declineInviteSchema } from "@/lib/validation/invite";

// "NO, THIS ISN'T ME" (ITER-058 cr4, decided walking scenario 105, migration 107).
//
// Public by design, like POST /api/auth/register: the token in the body is the whole authorization,
// and the decline is one conditional UPDATE, so only a still-usable person invite can be declined and
// a second press answers like an unknown token. The link is dead afterwards.
//
// The sender is told by an `invite_declined` notification naming the person and the email the link
// went to, which is what they need to check. The audit row has no user (the person declining has no
// account, the public Zoom sign-up's precedent) and carries ids only — never the token, never a name.
export async function POST(request: Request) {
  try {
    const { token } = declineInviteSchema.parse(await readJsonBody(request));
    const service = createServiceSupabaseClient();

    const declined = await declineInvite(token, service);
    if (!declined) {
      return NextResponse.json({ error: INVITE_REFUSED_MESSAGE }, { status: 400 });
    }

    await writeAuditLog(
      {
        wardId: declined.wardId,
        userId: null,
        action: "invite_declined",
        module: "auth",
        detail: { inviteId: declined.inviteId, memberId: declined.memberId },
      },
      service,
    );

    const { data: member, error: memberError } = await service
      .from("members")
      .select("first_name, last_name")
      .eq("id", declined.memberId)
      .eq("ward_id", declined.wardId)
      .maybeSingle();

    if (memberError) {
      console.error(`Could not read the person a declined invite named — ${memberError.message}`, {
        inviteId: declined.inviteId,
      });
    }

    const memberName =
      [member?.first_name, member?.last_name].filter(Boolean).join(" ") || "The person you invited";

    await emitNotification({
      wardId: declined.wardId,
      triggerKey: "invite_declined",
      title: "Invite answered \"not me\"",
      body: `Whoever opened the invite for ${memberName} said it isn't them${
        declined.email ? ` (sent to ${declined.email})` : ""
      }. Check the email on the ward list, then invite again from Admin → Users.`,
      ...(declined.invitedBy ? { recipientUserIds: [declined.invitedBy] } : {}),
    });

    return NextResponse.json({ declined: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/auth/invite/not-me",
      fallbackMessage: "Could not send your answer. Please try again.",
    });
  }
}
