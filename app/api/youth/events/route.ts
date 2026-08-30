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
import { readHomeVenues } from "@/lib/ward/homeVenues";
import { classifyEventLocation } from "@/lib/youth/classifyLocation";
import { createOccasion, setEventOccasion } from "@/lib/youth/occasions";
import {
  createActivityEvent,
  getActivityEvent,
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
      occasionId: url.searchParams.get("occasionId") ?? undefined,
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

    // ABSENT MEANS "DECIDE FROM THE LOCATION"; PRESENT MEANS A PERSON DECIDED. That distinction
    // is only expressible because createActivityEventSchema dropped its `.default("tbd")` — with
    // a default, classifying anything would mean overriding an explicit human choice.
    //
    // The venues are read only when they are needed, so a leader who chose home or away by hand
    // does not pay for a settings read to be ignored.
    const chosenEventType = input.eventType;
    const eventType =
      chosenEventType ??
      classifyEventLocation(input.location, await readHomeVenues(user.wardId, supabase));

    // ---------------------------------------------------------------------------
    // ADDING A YOUNG PERSON TO A GAME THAT ALREADY EXISTS
    // ---------------------------------------------------------------------------
    // `occasionWithEventId` names ANOTHER EVENT, not an occasion, and lib/validation/youth.ts
    // argues why: when the game is not yet an occasion there is no id for a client to hold, so
    // naming the other event is what removes an impossible client state and keeps WHICH OCCASION
    // a server decision.
    //
    // THIS BRANCH REQUIRES `youth_activities.manage`, WHICH THIS ROUTE ALREADY ASSERTED. Adding a
    // young person to somebody else's game is the same coordination decision
    // POST /api/youth/events/[id]/occasion gates, and the two must not disagree.
    //
    // AND `eventType` IS NOT COPIED FROM THE SOURCE ROW. The rule above stands unchanged: absent
    // means classify from the location, present means a person decided. A row added to an
    // occasion whose location matches no venue becomes `tbd` — `away` IS ALWAYS A HUMAN'S WORD
    // (youth-c), and spreading one leader's hand correction onto a row they never looked at is
    // exactly what that rule refuses. `tbd` is loud: it renders "Home or away?" and asks somebody.
    let occasionId: string | null = null;

    if (input.occasionWithEventId !== undefined) {
      // Resolved before the write for the reason the profile check directly above is: the
      // composite foreign key would otherwise answer with a constraint violation nobody can act
      // on.
      const sourceEvent = await getActivityEvent(
        user.wardId,
        input.occasionWithEventId,
        supabase,
      );

      if (!sourceEvent) {
        return NextResponse.json(
          { error: "That event is not in your ward." },
          { status: 404 },
        );
      }

      if (sourceEvent.occasionId !== null) {
        occasionId = sourceEvent.occasionId;
      } else {
        // CREATED AND STAMPED IN THE SAME REQUEST, so the two rows come out of it either both
        // linked or neither — rather than leaving a leader with a brand-new event that shares
        // nothing with the game they added it to.
        occasionId = (await createOccasion(user.wardId, user.id, supabase)).id;
        await setEventOccasion(user.wardId, sourceEvent.id, occasionId, supabase);
      }
    }

    const event = await createActivityEvent(
      user.wardId,
      input,
      eventType,
      occasionId,
      supabase,
    );

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
          // Null on the ordinary case — a game that is only this young person's.
          occasionId: event.occasionId,
          // WHETHER A PERSON CHOSE IT OR THE VENUE LIST DID. Without this, the audit row cannot
          // answer "why is this marked home?" and a reader has to guess — which is the question
          // somebody asks precisely when the classification turns out to be wrong.
          eventTypeSource:
            chosenEventType === undefined ? "classified_from_location" : "chosen",
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
