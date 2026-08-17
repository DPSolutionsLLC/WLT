import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { displayName } from "@/lib/auth/adminUsers";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { resetYouthPin } from "@/lib/auth/youthAccounts";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resetPinSchema } from "@/lib/validation/youthAccount";

const targetUserIdSchema = z.uuid("That account id is not valid.");

// The new PIN is shown once to the admin who set it, in the browser, and is never returned by
// this route. The audit detail names the account and nothing else (CLAUDE.md rule 8).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    assertCan(user, "admin.manage_users");

    const { id } = await params;
    const targetUserId = targetUserIdSchema.parse(id);
    const { pin } = resetPinSchema.parse(await readJsonBody(request));

    const result = await resetYouthPin({
      wardId: user.wardId,
      actingUserId: user.id,
      targetUserId,
      pin,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_pin_reset",
        module: "admin",
        detail: { targetUserId },
      },
      supabase,
    );

    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      description: `${displayName(user)} reset the PIN for the youth account ${displayName(
        result.account,
      )} (username ${result.account.username}).`,
    });

    return NextResponse.json({ account: result.account });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/admin/users/[id]/reset-pin",
      fallbackMessage: "Could not reset the PIN. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
