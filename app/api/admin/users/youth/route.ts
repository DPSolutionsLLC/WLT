import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { displayName } from "@/lib/auth/adminUsers";
import { assertCan } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createYouthAccount } from "@/lib/auth/youthAccounts";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createYouthAccountSchema } from "@/lib/validation/youthAccount";

// `/api/admin/users/youth` sits beside `/api/admin/users/[id]`. Next.js matches a static
// segment before a dynamic one, so "youth" is never read as an account id.
//
// The PIN arrives in the body, goes to Supabase Auth, and stops there. It is not in the audit
// detail, not in the notification, and not in the response (CLAUDE.md rule 8). writeAuditLog
// redacts a key matching /pin/i as a backstop — this route does not rely on it.
export async function POST(request: Request) {
  // Outside the try, deliberately: requireSessionUser() redirects by throwing an internal
  // Next.js error, and catching that below would turn the redirect into a 500.
  const user = await requireSessionUser();

  try {
    assertCan(user, "admin.manage_users");

    const input = createYouthAccountSchema.parse(await readJsonBody(request));

    const result = await createYouthAccount({
      wardId: user.wardId,
      actingUserId: user.id,
      input,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    const supabase = await createServerSupabaseClient();

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_account_created",
        module: "admin",
        detail: { targetUserId: result.account.id, username: result.account.username },
      },
      supabase,
    );

    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      description: `${displayName(user)} created a youth sacrament account for ${displayName(
        result.account,
      )} (username ${result.account.username}).`,
    });

    return NextResponse.json({ account: result.account });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/admin/users/youth",
      fallbackMessage: "Could not create the account. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
