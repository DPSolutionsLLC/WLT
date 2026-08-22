import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import {
  readDefaultSpeakingSlots,
  writeDefaultSpeakingSlots,
} from "@/lib/calendar/wardCalendarSettings";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MAX_SPEAKING_SLOTS, wardCalendarSettingsSchema } from "@/lib/validation/calendar";

// The ward's calendar defaults, editable in the app rather than in code. calendar-b puts a control
// on the calendar page and Phase 11's admin settings page reads and writes this same route — one
// API, two entry points, no duplicated rule.
//
// Nested under /api/ward-settings so Phase 11 can add siblings without inventing a second shape.

export async function GET() {
  const user = await requireSessionUser();

  try {
    // calendar.view, not admin: everyone who reads the calendar needs to know what a new Sunday
    // will be generated with.
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "calendar.view", roleAccess);

    const defaultSpeakingSlots = await readDefaultSpeakingSlots(user.wardId, supabase);

    return NextResponse.json({
      defaultSpeakingSlots,
      maxSpeakingSlots: MAX_SPEAKING_SLOTS,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/ward-settings/calendar",
      fallbackMessage: "Could not load the calendar settings. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// admin.manage_ward, which only bishop and counselor hold. Changing the default speaker count is a
// ward-wide decision, not per-Sunday maintenance — a ward_secretary may edit any individual Sunday
// but does not set what every future Sunday starts as.
//
// Unlike `sundays`, RLS is a genuine boundary here: wards_update (migration 019) is bishopric-only.
// The assertCan is still first, so a refusal is a 403 rather than a confusing zero-row failure.
export async function PATCH(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "admin.manage_ward", roleAccess);

    const input = wardCalendarSettingsSchema.parse(await readJsonBody(request));

    const before = await readDefaultSpeakingSlots(user.wardId, supabase);
    const defaultSpeakingSlots = await writeDefaultSpeakingSlots(
      user.wardId,
      input.defaultSpeakingSlots,
      supabase,
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "calendar_settings_updated",
        module: "calendar",
        detail: { defaultSpeakingSlots, previousDefaultSpeakingSlots: before },
      },
      supabase,
    );

    if (before !== defaultSpeakingSlots) {
      await notifyOtherBishopric({
        wardId: user.wardId,
        actingUserId: user.id,
        title: "Calendar settings changed",
        description:
          `Sundays are now created with ${defaultSpeakingSlots} ` +
          `${defaultSpeakingSlots === 1 ? "speaker" : "speakers"} by default, ` +
          `${defaultSpeakingSlots > before ? "up" : "down"} from ${before}.`,
      });
    }

    return NextResponse.json({
      defaultSpeakingSlots,
      maxSpeakingSlots: MAX_SPEAKING_SLOTS,
      // calendar-b renders this. A bishopric changing the default needs to know it did not
      // rewrite the Sundays already on their calendar.
      note: "This applies to Sundays generated from now on. Sundays already on the calendar keep the number of speakers they have.",
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/ward-settings/calendar",
      fallbackMessage: "Could not save the calendar settings. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
