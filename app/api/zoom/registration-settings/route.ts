import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { resolveSiteUrl } from "@/lib/program/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { registrationSettingsSchema } from "@/lib/validation/zoomRegistration";
import { canManageInvitees } from "@/lib/zoom/access";
import {
  type RegistrationSettings,
  revalidateSignUpPage,
  setUpRegistration,
  updateRegistrationSettings,
} from "@/lib/zoom/registrationSettings";
import { registrationPageUrl } from "@/lib/zoom/registrationTokens";

// THE ZOOM SIGN-UP SETTINGS (ITER-052). POST sets sign-ups up (idempotent — the page starts
// closed); PUT changes a switch. `zoom_registration_settings` has no write policy (migration 096),
// so canManageInvitees() is the write boundary and the write is the service role. Every change
// revalidates the public page, so closing sign-ups shows on the next reload rather than up to five
// minutes later. The audit row names the changed FIELDS only.

function respondWith(settings: RegistrationSettings, status = 200) {
  return NextResponse.json(
    { settings, registrationUrl: registrationPageUrl(resolveSiteUrl(), settings.slug) },
    { status },
  );
}

export async function POST() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageInvitees(user, roleAccess)) throw new ForbiddenError("zoom.manage_invitees");

    const result = await setUpRegistration(
      { wardId: user.wardId, actorUserId: user.id },
      createServiceSupabaseClient(),
    );

    if (result.created) {
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "zoom_registration_set_up",
          module: "zoom",
          detail: { defaultQuestionId: result.defaultQuestionId },
        },
        supabase,
      );
    }

    revalidateSignUpPage(result.settings.slug, { wardId: user.wardId });
    return respondWith(result.settings, result.created ? 201 : 200);
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/zoom/registration-settings",
      fallbackMessage: "Could not set up sign-ups. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function PUT(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageInvitees(user, roleAccess)) throw new ForbiddenError("zoom.manage_invitees");

    const input = registrationSettingsSchema.parse(await readJsonBody(request));

    const result = await updateRegistrationSettings(
      { wardId: user.wardId, actorUserId: user.id, input },
      createServiceSupabaseClient(),
    );

    if (!result) {
      return NextResponse.json(
        { error: "Sign-ups aren't set up yet. Press Set up sign-ups first." },
        { status: 409 },
      );
    }

    if (result.changedFields.length > 0) {
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "zoom_registration_settings_changed",
          module: "zoom",
          detail: { changedFields: result.changedFields },
        },
        supabase,
      );
    }

    revalidateSignUpPage(result.settings.slug, { wardId: user.wardId });
    return respondWith(result.settings);
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/zoom/registration-settings",
      fallbackMessage: "Could not save the sign-up settings. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
