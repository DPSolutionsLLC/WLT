import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { bulkAssignToOrganization } from "@/lib/roster/organizations";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { bulkAssignSchema } from "@/lib/validation/roster";

// A static segment beside another static segment — /api/roster/bulk-assign will sit next to
// roster-c's /api/roster/import. Neither is dynamic, so there is no route collision here; keep
// it that way (plans/retros/auth-c-youth-pin.md).
//
// roster.manage, not RLS, is the boundary — see the note on the organizations route.
export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "roster.manage", roleAccess);

    const input = bulkAssignSchema.parse(await readJsonBody(request));

    const result = await bulkAssignToOrganization(
      user.wardId,
      input.memberIds,
      input.organizationId,
      supabase,
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    // All three numbers. "9 requested, 7 assigned, 2 already members" is debuggable a month
    // later; a bare success row is not, and `assigned` alone cannot be told apart from a write
    // that was refused (plans/retros/foundation-c-services.md).
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "members_bulk_assigned",
        module: "roster",
        detail: {
          organizationId: input.organizationId,
          requested: input.memberIds.length,
          assigned: result.assigned,
          alreadyMember: result.alreadyMember,
        },
      },
      supabase,
    );

    return NextResponse.json({
      assigned: result.assigned,
      alreadyMember: result.alreadyMember,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/roster/bulk-assign",
      fallbackMessage: "Could not assign those members. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
