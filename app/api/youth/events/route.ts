import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  createActivityEventSchema,
  listActivityEventsQuerySchema,
} from "@/lib/validation/youth";
import {
  createActivityEvent,
  getActivityProfile,
  listActivityEvents,
} from "@/lib/youth/queries";

// The games, concerts and meets themselves, entered by hand.
//
// SIMPLER OWNERSHIP THAN A PROFILE, AND THAT IS DELIBERATE. `activity_events` keeps migration
// 019's ward-wide policies and gets no org column of its own: an event inherits its organization
// through the PROFILE it hangs off, and the composite foreign key already refuses an event
// pointing at another ward's profile. A second scoping rule here would be a second place for the
// same answer to live, and two places that disagree is worse than either being wrong
// (plans/retros/visits-b-*, visits-f-*).
//
// NO NOTIFICATION ON AN EVENT. 08-youth-activities.md lists `youth_activity_added` against the
// PROFILE; one notification per game would be the digest-spam pitfall arriving early, and a
// season has twenty of them.

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

    // The clock enters ONCE and is handed down, so every event in one response is judged against
    // the same instant rather than against a fresh Date per filter.
    const events = await listActivityEvents(
      user.wardId,
      { ...query, asOf: new Date() },
      supabase,
    );

    return NextResponse.json({ events });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/youth/events",
      fallbackMessage: "Could not load the activity events. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    const input = createActivityEventSchema.parse(await readJsonBody(request));

    // Resolved through the caller's own client, so a profile in another ward simply is not
    // there. Checked BEFORE the insert because the composite foreign key would otherwise answer
    // with a constraint violation, and "insert or update on table violates foreign key
    // constraint" is not a sentence anybody can act on.
    const profile = await getActivityProfile(user.wardId, input.profileId, supabase);

    if (!profile) {
      return NextResponse.json(
        { error: "That activity is not in your ward." },
        { status: 404 },
      );
    }

    const event = await createActivityEvent(user.wardId, input, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_event_created",
        module: "youth_activities",
        detail: {
          eventId: event.id,
          profileId: event.profileId,
          orgId: profile.orgId,
          eventDate: event.eventDate,
          eventType: event.eventType,
        },
      },
      supabase,
    );

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/youth/events",
      fallbackMessage: "Could not save that event. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
