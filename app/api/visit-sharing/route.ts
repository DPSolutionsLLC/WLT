import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { displayName } from "@/lib/auth/adminUsers";
import { ForbiddenError } from "@/lib/auth/errors";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { visitSharingSchema } from "@/lib/validation/visit";
import { readVisitSharing, writeVisitSharing } from "@/lib/visits/sharing";
import { canManageVisitSharing } from "@/lib/visits/visitOwnership";

// WHICH ORGANIZATIONS MAY READ WHICH ORGANIZATION'S VISITS (ITER-055, migration 099).
//
// GET reads through the caller's own client — the grants are readable ward-wide, and the release
// policy still applies. PUT replaces the ward's whole set on the SERVICE ROLE, because
// `visit_org_sharing` has no write policy: canManageVisitSharing() is the write boundary here and
// can never be skipped.

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    assertCan(user, "visits.view", roleAccess);

    return NextResponse.json({ grants: await readVisitSharing(user.wardId, supabase) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/visit-sharing",
      fallbackMessage: "Could not load who can see each organization's visits. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function PUT(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);
    if (!canManageVisitSharing(user, roleAccess)) {
      throw new ForbiddenError("visits.manage_sharing");
    }

    const { grants } = visitSharingSchema.parse(await readJsonBody(request));

    const result = await writeVisitSharing(
      { wardId: user.wardId, grants, actorUserId: user.id },
      createServiceSupabaseClient(),
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "visit_sharing_updated",
        module: "visits",
        detail: {
          grantCount: result.grantCount,
          added: result.added,
          removed: result.removed,
        },
      },
      supabase,
    );

    if (result.added.length > 0 || result.removed.length > 0) {
      await notifyOtherBishopric({
        wardId: user.wardId,
        actingUserId: user.id,
        title: "Visit sharing changed",
        description: `${displayName(user)} changed which organizations can see each organization's visits.`,
      });
    }

    return NextResponse.json({ grants: await readVisitSharing(user.wardId, supabase) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/visit-sharing",
      fallbackMessage: "Could not save who can see each organization's visits. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
