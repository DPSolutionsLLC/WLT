import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { displayName, updateWardUser } from "@/lib/auth/adminUsers";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateUserSchema } from "@/lib/validation/adminUser";

const targetUserIdSchema = z.uuid("That account id is not valid.");

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "admin.manage_users", roleAccess);

    const { id } = await params;
    const targetUserId = targetUserIdSchema.parse(id);
    const changes = updateUserSchema.parse(await readJsonBody(request));

    const result = await updateWardUser(
      { wardId: user.wardId, targetUserId, changes },
      supabase,
    );

    // A refusal is a bad request the caller can act on — the last-bishop guard and the
    // cross-ward check both land here — not a server fault.
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "user_updated",
        module: "admin",
        detail: { targetUserId, changes },
      },
      supabase,
    );

    // FEATURES.md §Module 15 requires a description of what changed, not just a ping. A
    // deactivation says so here; the account itself keeps a valid cookie until its next
    // request, at which point getSessionUser() returns null (built in auth-a).
    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      description: `${displayName(user)} updated ${displayName(result.user)}: ${result.changeSummaries.join("; ")}.`,
    });

    return NextResponse.json({ user: result.user });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/admin/users/[id]",
      fallbackMessage: "Could not update the account. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
