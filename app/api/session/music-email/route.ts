import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import {
  MUSIC_EMAIL_TRIGGERS,
  writeMusicEmailEnabled,
} from "@/lib/notifications/musicEmailPreference";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { musicEmailPreferenceSchema } from "@/lib/validation/music";

// A person's own "email me about the music" switch — ITER-038 slice mc (plan A5).
//
// The row written is always the caller's: the body cannot name a user, and migration 019's
// `notification_user_prefs_own_*` policies are the boundary (rule 2). `music.view` gates it only so
// that a role with no music screen cannot collect preferences for triggers it will never receive.
// The toggle renders only for a music coordinator — a DISPLAY decision, not this route's.
//
// Audit detail is the triggers and the new value — never an address.

export async function PUT(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    assertCan(user, "music.view", roleAccess);

    const input = musicEmailPreferenceSchema.parse(await readJsonBody(request));
    const enabled = await writeMusicEmailEnabled(user.id, user.wardId, input.enabled, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "notification_email_preference_changed",
        module: "music",
        detail: { triggers: [...MUSIC_EMAIL_TRIGGERS], enabled },
      },
      supabase,
    );

    return NextResponse.json({ enabled });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/session/music-email",
      fallbackMessage: "Could not save your email setting. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
