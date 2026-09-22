import { NextResponse } from "next/server";
import {
  createAccessRequest,
  listAccessRequests,
  listActiveSuperAdminIds,
} from "@/lib/access/requests";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAccessRequestSchema } from "@/lib/validation/accessRequest";

// A WARD ASKS FOR A PERMISSION. GET lists what this session may see; POST files a request.
//
// ---------------------------------------------------------------------------
// ASKING IS A WARD ADMIN ACT. DECIDING IS NOT HERE AT ALL.
// ---------------------------------------------------------------------------
// This route cannot approve anything — the decision lives on
// app/api/access-requests/[id]/route.ts behind a `super_admin` check, and `access_requests` has
// NO WRITE POLICIES (migration 073b) so RLS refuses either way. A ward admin cannot approve their
// own request, and that is enforced by the absence of a policy rather than by a predicate.
//
// The GET is governed entirely by `access_requests_select`: a super admin sees every request, a
// ward sees its own. Nothing here filters for security (CLAUDE.md rule 2).

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    // `admin.view` and not `admin.manage_roles`: this list is the ward's own record of what it
    // asked for and what came back, and a counselor who did not file the request still needs to
    // read the outcome. Bishopric admin authority is shared (CLAUDE.md §7).
    assertCan(user, "admin.view", roleAccess);

    const requests = await listAccessRequests(supabase);

    return NextResponse.json({ requests });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/access-requests",
      fallbackMessage: "Could not load the access requests. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    // `admin.manage_roles` — asking to change what a role holds is the same authority as
    // configuring one, which is what that permission already names. It is NON-OVERRIDABLE, so a
    // ward cannot widen who may ask.
    assertCan(user, "admin.manage_roles", roleAccess);

    const input = createAccessRequestSchema.parse(await readJsonBody(request));

    // The ward and the requester come from the SESSION, never from the body — otherwise one ward
    // could file a request in another's name.
    const accessRequest = await createAccessRequest({
      wardId: user.wardId,
      requestedBy: user.id,
      role: input.role,
      permission: input.permission,
      level: input.level,
      reason: input.reason,
    });

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "access_requested",
        module: "admin",
        detail: {
          requestId: accessRequest.id,
          role: accessRequest.role,
          permission: accessRequest.permission,
          level: accessRequest.level,
        },
      },
      supabase,
    );

    // TELL THE PEOPLE WHO CAN ANSWER IT. Addressed EXPLICITLY, because a super admin is not a
    // ward role and the role-based resolution inside emitNotification cannot reach them from the
    // ward that asked — see listActiveSuperAdminIds().
    //
    // A request nobody is told about sits in a queue nobody opens, which is the same failure as
    // a denial the requester cannot read: the flow teaches leaders that asking does nothing.
    await emitNotification(
      {
        wardId: accessRequest.wardId,
        triggerKey: "access_request_submitted",
        title: "A ward has asked for access",
        body: `${accessRequest.role} · ${accessRequest.permission}`,
        recipientUserIds: await listActiveSuperAdminIds(),
      },
      supabase,
    );

    return NextResponse.json({ request: accessRequest }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/access-requests",
      fallbackMessage: "Could not send the request. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
