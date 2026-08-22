import { NextResponse } from "next/server";
import { listWardOrganizations, listWardUsers } from "@/lib/auth/adminUsers";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// No audit row: a read is not a mutation (CLAUDE.md rule 6 covers POST/PATCH/DELETE).
export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "admin.manage_users", roleAccess);

    const [users, organizations] = await Promise.all([
      listWardUsers(user.wardId, supabase),
      listWardOrganizations(user.wardId, supabase),
    ]);

    return NextResponse.json({ users, organizations });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/admin/users",
      fallbackMessage: "Could not load the ward's accounts. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
