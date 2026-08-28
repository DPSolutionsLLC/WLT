import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listActivityEventsQuerySchema } from "@/lib/validation/youth";
import { listAttendeesForEvents } from "@/lib/youth/attendees";
import { listActivityEvents } from "@/lib/youth/queries";

// Who is going, for every event on the screen, in one request.
//
// ---------------------------------------------------------------------------
// IT RESOLVES ITS OWN EVENT SET RATHER THAN TAKING A LIST OF IDS
// ---------------------------------------------------------------------------
// It reads the SAME query schema GET /api/youth/events reads and calls the SAME listActivityEvents
// with it, so the attendee map and the event list are two views of one query. A route taking a
// list of ids would let the two drift apart — and a list of two hundred uuids is seven kilobytes
// of URL besides.
//
// A parameter this schema does not carry gets no error, just a filter that is silently ignored
// (plans/retros/roster-b-picker-and-orgs.md), which is why it parses rather than reading
// searchParams directly.
//
// ---------------------------------------------------------------------------
// THE GATE IS `youth_activities.view`, AND THE READ IS WARD-WIDE
// ---------------------------------------------------------------------------
// `activity_attendees_ward_select` is migration 019's policy, deliberately untouched by migration
// 056: coverage is computed from an attendee COUNT, so if one reader could see rows another could
// not, the same event would read covered to one leader and uncovered to another from the same
// data. Migration 056c's header argues that in full — a rule that is not uniformly evaluable is
// not a rule.
//
// The response is an OBJECT keyed by event id rather than the Map lib/youth/attendees.ts returns,
// because a Map does not survive JSON. Events with nobody going are simply absent, and the client
// reads a missing key as an empty list.

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

    const byEvent = await listAttendeesForEvents(
      user.wardId,
      events.map((event) => event.id),
      supabase,
    );

    return NextResponse.json({ attendees: Object.fromEntries(byEvent) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/youth/attendees",
      fallbackMessage: "Could not load who is going. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
