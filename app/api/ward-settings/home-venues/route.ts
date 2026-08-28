import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  BISHOPRIC_ROLES,
  assertCan,
  resolveRoleAccess,
} from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { homeVenuesSchema } from "@/lib/validation/visit";
import { readHomeVenues, writeHomeVenues } from "@/lib/ward/homeVenues";

// The places that count as the ward's own.
//
// Nested under /api/ward-settings beside the calendar defaults and the cross-org visibility
// switch, whose structure this copies — same shape, same audit-then-notify order, same guard on
// the notification. Phase 11's admin settings page adds siblings here rather than inventing a
// second shape.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

function isBishopric(role: string): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

const NOT_BISHOPRIC =
  "Only the bishop and his counselors can change which places count as home.";

// READABLE BY EVERYBODY WHO READS THE CALENDAR, not only by whoever may edit it. "Why is this
// game marked away?" is a question the page should be able to answer without a leader having to
// ask a counselor, and the answer is this list.
export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.view", roleAccess);

    const homeVenues = await readHomeVenues(user.wardId, supabase);

    return NextResponse.json({ homeVenues });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/ward-settings/home-venues",
      fallbackMessage: "Could not load the home venues. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// Two checks, same shape and same order as the assign route: the permission first, so a ward
// whose role_access override removed the module refuses before the role check can allow it; then
// the bishopric list, because `youth_activities.manage` is also held by org presidents and ward
// council members.
//
// RLS is a genuine boundary here too — wards_update (migration 019) is bishopric-only — so the
// assertCan is belt to that policy's braces, and it turns a refusal into a 403 rather than the
// confusing zero-row failure writeHomeVenues would otherwise raise.
export async function PUT(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    if (!isBishopric(user.role)) {
      return NextResponse.json({ error: NOT_BISHOPRIC }, { status: 403 });
    }

    const input = homeVenuesSchema.parse(await readJsonBody(request));

    const before = await readHomeVenues(user.wardId, supabase);
    const homeVenues = await writeHomeVenues(user.wardId, input.homeVenues, supabase);

    // THE BEFORE AND AFTER LISTS, not just "changed". This setting decides how every future
    // import classifies, so "which venue was removed, and when" is the question somebody asks
    // when a season's games start arriving as "Home or away?" — and a bare "changed" cannot
    // answer it.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "home_venues_updated",
        module: "youth_activities",
        detail: {
          homeVenues,
          previousHomeVenues: before,
        },
      },
      supabase,
    );

    // ONLY when the list actually changed, exactly as the calendar and visibility routes guard.
    // Re-saving the same venues is not news, and a notification for it would teach the other two
    // to ignore the ones that matter.
    //
    // Shared bishopric authority is a product requirement rather than a nicety (CLAUDE.md §7),
    // and this setting changes how every future import classifies — which is exactly the kind of
    // change the other two would otherwise discover from a season of miscategorised games.
    const changed =
      before.length !== homeVenues.length ||
      before.some((venue, index) => venue !== homeVenues[index]);

    if (changed) {
      await notifyOtherBishopric({
        wardId: user.wardId,
        actingUserId: user.id,
        title: "Home venues changed",
        description:
          homeVenues.length === 0
            ? "No places are marked as the ward's own, so imported events will all wait for somebody to say whether they are home or away."
            : `Imported events at these places will be marked Home automatically: ${homeVenues.join(", ")}. Existing events are not changed.`,
      });
    }

    return NextResponse.json({ homeVenues });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/ward-settings/home-venues",
      fallbackMessage: "Could not save the home venues. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
