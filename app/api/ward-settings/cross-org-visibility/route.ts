import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  readCrossOrgVisibility,
  writeCrossOrgVisibility,
} from "@/lib/ward/crossOrgVisibility";
import { crossOrgVisibilitySchema } from "@/lib/validation/visit";
import {
  CROSS_ORG_VISIBILITY_SCOPE_NOTE,
  CROSS_ORG_VISIBILITY_STATE_LABELS,
} from "@/types/domain";

// Whether one organization's leaders may read another organization's visit reports.
//
// Nested under /api/ward-settings beside the calendar defaults, whose structure this copies —
// same shape, same audit-then-notify order, same guard on the notification. Phase 11's admin
// settings page adds siblings here rather than inventing a second shape.
//
// ---------------------------------------------------------------------------
// THE SETTING DOES NOT DECIDE ANYTHING AT REQUEST TIME
// ---------------------------------------------------------------------------
// `ward_allows_cross_org_visibility()` (migration 019) is read inside visit_logs_select. Nothing
// in the app branches on the value to decide what a caller may read — the query already returns
// the right rows (CLAUDE.md rule 2). This route only writes the switch.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

// The wording lives in types/domain.ts, not here. The toggle is a "use client" component and
// importing a constant out of this file would pull the whole route — Supabase server client,
// audit helper and all — into the browser bundle.

export async function GET() {
  const user = await requireSessionUser();

  try {
    // visits.view, not admin. Everyone who reads the feed needs to know which mode they are in —
    // "why can I see the Relief Society's visits?" is a question the page should answer without a
    // leader having to ask a counselor.
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.view", roleAccess);

    const crossOrgVisibility = await readCrossOrgVisibility(user.wardId, supabase);

    return NextResponse.json({ crossOrgVisibility });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/ward-settings/cross-org-visibility",
      fallbackMessage: "Could not load the visibility setting. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// admin.manage_ward, which only bishop and counselor hold — and they hold it identically
// (CLAUDE.md §7). Never build a check that grants the bishop something a counselor lacks.
//
// RLS is a genuine boundary here too: wards_update (migration 019) is bishopric-only. The
// assertCan is still first, so a refusal is a 403 rather than the confusing zero-row failure
// writeCrossOrgVisibility would otherwise raise.
export async function PATCH(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "admin.manage_ward", roleAccess);

    const input = crossOrgVisibilitySchema.parse(await readJsonBody(request));

    const before = await readCrossOrgVisibility(user.wardId, supabase);
    const crossOrgVisibility = await writeCrossOrgVisibility(
      user.wardId,
      input.crossOrgVisibility,
      supabase,
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "cross_org_visibility_updated",
        module: "visits",
        detail: {
          crossOrgVisibility,
          previousCrossOrgVisibility: before,
        },
      },
      supabase,
    );

    // ONLY when the value actually changed, exactly as the calendar route guards. Re-saving the
    // switch at the value it already holds is not news, and a notification for it would teach the
    // other two to ignore the ones that matter.
    if (before !== crossOrgVisibility) {
      await notifyOtherBishopric({
        wardId: user.wardId,
        actingUserId: user.id,
        title: "Visit report visibility changed",
        description: crossOrgVisibility
          ? `${CROSS_ORG_VISIBILITY_STATE_LABELS.on} ${CROSS_ORG_VISIBILITY_SCOPE_NOTE}`
          : CROSS_ORG_VISIBILITY_STATE_LABELS.off,
      });
    }

    return NextResponse.json({ crossOrgVisibility });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/ward-settings/cross-org-visibility",
      fallbackMessage: "Could not save the visibility setting. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
