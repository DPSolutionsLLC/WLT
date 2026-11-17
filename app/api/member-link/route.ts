import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { displayName } from "@/lib/auth/adminUsers";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { needsRosterLink } from "@/lib/callings/linkAccess";
import { confirmEmailMatch, readMyLinkState, requestLink } from "@/lib/callings/memberLinks";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { myMemberLinkSchema } from "@/lib/validation/memberLink";

// MY OWN ROSTER LINK IN THE WARD I AM ACTING IN (ITER-058 cr1).
//
// The only two things an account may do for itself: confirm its EMAIL MATCH ("Yes, this is me"),
// or ASK the bishopric to link it. Neither lets the caller choose a roster record — confirm is
// re-checked against the login email in lib/callings/memberLinks.ts, so a member id sent by hand
// links nothing that is not the caller's own match (P3, P4).
//
// Writes on the SERVICE ROLE: `user_member_links` has no write policy (migration 105a).
// NO PERMISSION CHECK beyond a signed-in session, like the dashboard: an account acting on its own
// link is account-level, and gating it on a module (`personal_tools`) would leave a ward that has
// not released To Do unable ever to link anybody. The audit row carries ids and the method only.

export async function GET() {
  const user = await requireSessionUser();

  try {
    if (!needsRosterLink(user)) {
      return NextResponse.json({ needed: false, link: null, emailCandidate: null });
    }

    const state = await readMyLinkState(user.id, user.wardId, createServiceSupabaseClient());
    return NextResponse.json({ needed: true, ...state });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/member-link",
      fallbackMessage: "Could not check whether your account is linked to the ward list. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    if (!needsRosterLink(user)) {
      return NextResponse.json(
        { error: "This account does not need linking to the ward list." },
        { status: 400 },
      );
    }

    const input = myMemberLinkSchema.parse(await readJsonBody(request));
    const supabase = await createServerSupabaseClient();
    const service = createServiceSupabaseClient();

    const result =
      input.action === "confirm"
        ? await confirmEmailMatch({ userId: user.id, wardId: user.wardId, memberId: input.memberId }, service)
        : await requestLink({ userId: user.id, wardId: user.wardId }, service);

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status });
    }

    const linked = result.link.status === "active";

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: linked ? "member_link_created" : "member_link_requested",
        module: "admin",
        detail: { linkId: result.link.id, memberId: result.link.memberId, method: result.link.method },
      },
      supabase,
    );

    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      title: linked ? "Account linked to the ward list" : "Account waiting to be linked",
      description: linked
        ? `${displayName(user)} confirmed which person on the ward list they are.`
        : `${displayName(user)} asked to be linked to the ward list. Link them on Admin → Users.`,
    });

    return NextResponse.json({ link: result.link }, { status: linked ? 201 : 200 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/member-link",
      fallbackMessage: "Could not link your account. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
