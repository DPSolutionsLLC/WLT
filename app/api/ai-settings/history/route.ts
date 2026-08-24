import { NextResponse } from "next/server";
import { listAiSettingsVersions } from "@/lib/ai/queries";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Every saved version, newest first, each carrying who saved it and when. `ai_settings.view`
// rather than `.manage`: reading what the ward has configured is not the authority to change it.
//
// No pagination. A ward saves these a handful of times a year.

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "ai_settings.view", roleAccess);

    const versions = await listAiSettingsVersions(user.wardId, supabase);

    return NextResponse.json({ versions });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/ai-settings/history",
      fallbackMessage: "Could not load the settings history. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
