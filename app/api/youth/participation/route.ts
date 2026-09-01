import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listActivityEventsQuerySchema } from "@/lib/validation/youth";
import { listActivityEvents } from "@/lib/youth/queries";
import { listParticipationForEvents } from "@/lib/youth/rosterQueries";

// Who is and is not taking part, for every event on the screen, in one request.
//
// A COPY OF GET /api/youth/attendees' SHAPE, DELIBERATELY, down to the query schema it parses.
// The two answer different questions about the same event set, and answering them through the
// same `listActivityEvents` call is what stops the participation map and the event list
// describing different screens — the roster-b lesson, which the attendees route's header states
// in full and which applies here without a word changed.
//
// ---------------------------------------------------------------------------
// THE GATE IS `youth_activities.view`, AND THE READ IS WARD-WIDE
// ---------------------------------------------------------------------------
// `activity_event_participation_ward_select` (migration 062f) is ward-wide for the reason
// `activity_attendees_ward_select` is: COVERAGE IS COMPUTED FROM IT. If one reader could see
// participation rows another could not, the same game would read `not_expected` to one leader and
// uncovered to another from the same data at the same instant. That is migration 056c's
// uniform-evaluability rule, which 062f's third reason restates for exactly this route.
//
// WRITING it is a different question and a narrower gate — `youth_activities.manage`, on
// PATCH /api/youth/events/[id]/participation.
//
// The response is an OBJECT keyed by event id rather than the Map
// lib/youth/rosterQueries.ts returns, because a Map does not survive JSON. An event nobody has
// answered for is simply absent, and the client reads a missing key as an empty list — which is
// migration 062d's third state arriving intact at the browser.

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.view", roleAccess);

    const url = new URL(request.url);
    const query = listActivityEventsQuerySchema.parse({
      profileId: url.searchParams.get("profileId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      includePast: url.searchParams.get("includePast") ?? undefined,
    });

    // The clock enters ONCE and is handed down, so this response and the events response taken a
    // moment apart describe the same window rather than two.
    const events = await listActivityEvents(
      user.wardId,
      { ...query, asOf: new Date() },
      supabase,
    );

    const byEvent = await listParticipationForEvents(
      user.wardId,
      events.map((event) => event.id),
      supabase,
    );

    return NextResponse.json({ participation: Object.fromEntries(byEvent) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/youth/participation",
      fallbackMessage: "Could not load who is taking part. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
