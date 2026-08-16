import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { redeemInvite } from "@/lib/auth/invites";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { registerRequestSchema } from "@/lib/validation/invite";

// Public by design: no requireSessionUser, no assertCan. The token in the body is the entire
// authorization, which is why it is validated by an atomic claim rather than a read-then-check.
//
// The token is a credential. It is never logged and never echoed back in an error message.
export async function POST(request: Request) {
  try {
    const { token, ...input } = registerRequestSchema.parse(await readJsonBody(request));

    const result = await redeemInvite(token, input);
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    // The service client, not the default one: the registrant has no session yet, and
    // audit_log_insert requires ward_id = current_ward_id(), which is null without one. Going
    // through the default client would leave a silent hole in the trail (CLAUDE.md rule 6).
    await writeAuditLog(
      {
        wardId: result.wardId,
        userId: result.userId,
        action: "user_registered",
        module: "auth",
        detail: { inviteId: result.inviteId, role: result.role },
      },
      createServiceSupabaseClient(),
    );

    // No automatic sign-in. One code path establishes a session in this app, and it is the
    // login form — two would mean two places to get the deactivation check right.
    return NextResponse.json({ redirectTo: "/login?registered=1" });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/auth/register",
      fallbackMessage: "Could not create the account. Please try again.",
    });
  }
}
