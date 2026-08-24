import { NextResponse } from "next/server";
import { getActiveAiSettings, insertAiSettingsVersion } from "@/lib/ai/queries";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { aiSettingsInputSchema } from "@/lib/validation/aiSettings";

// The ward's AI configuration. GET reads the active version; POST APPENDS a new one.
//
// There is no PATCH and no DELETE, here or in lib/ai/queries.ts. `ai_settings` is append-only,
// and the absence of those verbs is what makes the history impossible to destroy.
//
// The session is resolved OUTSIDE the try: requireSessionUser() redirects by throwing an internal
// Next.js error, and catching that would turn a redirect into a 500.

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "ai_settings.view", roleAccess);

    // null when the ward has never saved. That is a legitimate state, not an error — the form
    // renders empty and buildSystemPrompt has a branch for it.
    const settings = await getActiveAiSettings(user.wardId, supabase);

    return NextResponse.json({ settings });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/ai-settings",
      fallbackMessage: "Could not load the AI settings. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "ai_settings.manage", roleAccess);

    const input = aiSettingsInputSchema.parse(await readJsonBody(request));

    const settings = await insertAiSettingsVersion(user.wardId, user.id, input, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "ai_settings_saved",
        module: "ai",
        detail: { settingsId: settings.id },
      },
      supabase,
    );

    // FEATURES.md §Module 15 and CLAUDE.md §7: every admin change notifies the other two
    // bishopric members. This is a product requirement, not a nicety.
    await notifyOtherBishopric(
      {
        wardId: user.wardId,
        actingUserId: user.id,
        title: "AI settings changed",
        description: "AI settings were updated.",
      },
      supabase,
    );

    return NextResponse.json({ settings });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/ai-settings",
      fallbackMessage: "Could not save the AI settings. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
