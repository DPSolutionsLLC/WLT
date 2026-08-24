import { NextResponse } from "next/server";
import {
  getAiSettingsVersion,
  insertAiSettingsVersion,
} from "@/lib/ai/queries";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// RESTORE CREATES A NEW VERSION; IT NEVER DELETES THE ONES AFTER IT. That is the whole reason
// this endpoint exists rather than a DELETE on everything newer. A bishopric that restores a
// six-month-old configuration and then regrets it can restore what they had back — which is only
// true because nothing was thrown away.
//
// Never leak whether the id exists in some other ward: a version outside this ward is simply
// "not in your ward".
const NOT_FOUND = "That version is not in your ward.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "ai_settings.manage", roleAccess);

    // params is a Promise in Next 16.
    const { id } = await params;

    const source = await getAiSettingsVersion(user.wardId, id, supabase);
    if (!source) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // Every field copied forward; `savedBy` is the person restoring, not the person who first
    // saved it. The history then reads truthfully: this configuration is theirs now.
    const settings = await insertAiSettingsVersion(
      user.wardId,
      user.id,
      {
        toneVoice: source.toneVoice,
        doctrinalEmphasis: source.doctrinalEmphasis,
        scripturePreferences: source.scripturePreferences
          ? {
              canonPriority: [...source.scripturePreferences.canonPriority],
              maxReferences: source.scripturePreferences.maxReferences,
              relevanceNotes: source.scripturePreferences.relevanceNotes,
            }
          : null,
        conferencePreferences: source.conferencePreferences
          ? { ...source.conferencePreferences }
          : null,
        topicPreferences: source.topicPreferences,
        wardContext: source.wardContext,
        thankYouPreferences: source.thankYouPreferences,
      },
      supabase,
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "ai_settings_restored",
        module: "ai",
        detail: { settingsId: settings.id, restoredFromId: source.id },
      },
      supabase,
    );

    await notifyOtherBishopric(
      {
        wardId: user.wardId,
        actingUserId: user.id,
        title: "AI settings changed",
        description: "An earlier version of the AI settings was restored.",
      },
      supabase,
    );

    // The NEW row, not the one it was restored from. A caller that refreshed from `source` would
    // show the right values under the wrong id and date.
    return NextResponse.json({ settings });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/ai-settings/restore/[id]",
      fallbackMessage: "Could not restore that version. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
