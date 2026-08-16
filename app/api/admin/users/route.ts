import { NextResponse } from "next/server";
import { listWardOrganizations, listWardUsers } from "@/lib/auth/adminUsers";
import { assertCan } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// No audit row: a read is not a mutation (CLAUDE.md rule 6 covers POST/PATCH/DELETE).
export async function GET() {
  const user = await requireSessionUser();

  try {
    assertCan(user, "admin.manage_users");

    const supabase = await createServerSupabaseClient();
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
