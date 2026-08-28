import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addAttendee, removeAttendee } from "@/lib/youth/attendees";
import { getActivityEvent } from "@/lib/youth/queries";

// "I'll go" and "I can't after all", for the person signed in and nobody else.
//
// ---------------------------------------------------------------------------
// THE GATE IS `youth_activities.view`, NOT `.manage`
// ---------------------------------------------------------------------------
// 08-youth-activities.md §Step 4 says anyone self-adds, and that is right rather than lax: an org
// secretary holds `view` and `log` but not `manage`, and is exactly the sort of person who turns
// up to a basketball game. Asking somebody ELSE to go is the bishopric's decision and lives in
// the sibling assign/ route.
//
// This is not a widening. The route writes `user_id = user.id` and NEVER reads a user id from the
// body or the query, so the only row it can create is the caller's own — and migration 056c's
// insert policy says the same thing again in SQL, which is the boundary (CLAUDE.md rule 2).
//
// NO NOTIFICATION ON A SELF-ADD. A season has twenty games; one notification per volunteer is the
// digest-spam pitfall arriving by another door, and app/api/youth/events/route.ts already refused
// a per-event notification on the same reasoning.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const eventIdSchema = z.uuid("That event id is not valid.");

const EVENT_NOT_FOUND = "That event is not in your ward.";

// A refused DELETE is a zero-row success, not an error (CLAUDE.md §8), so a `false` from
// removeAttendee has to be SAID rather than reported as a success that did not happen.
const REMOVE_REFUSED =
  "You are not down for that event, or it could not be changed. Reload and try again.";

// NOT A 409, DELIBERATELY. Being already down for an event is the state the caller wanted, and a
// double tap on a slow phone — the whole context this module runs in — is the ordinary case
// rather than a fault. Migration 056b's unique index is what turns the second tap into this
// sentence instead of a second row and a doubled coverage count.
const ALREADY_ATTENDING = "You are already down for this one.";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.view", roleAccess);

    const { id } = await params;
    const eventId = eventIdSchema.parse(id);

    // Checked BEFORE the insert because the composite foreign key would otherwise answer with a
    // constraint violation, and "insert or update on table violates foreign key constraint" is
    // not a sentence anybody can act on. The sibling routes do the same, word for word.
    const event = await getActivityEvent(user.wardId, eventId, supabase);

    if (!event) {
      return NextResponse.json({ error: EVENT_NOT_FOUND }, { status: 404 });
    }

    const attendee = await addAttendee(
      user.wardId,
      // `assignedBy: null` IS THE RECORD OF HOW THE ROW CAME TO EXIST. A name there means somebody
      // was asked; null means they volunteered, and the card says which.
      { eventId, userId: user.id, assignedBy: null },
      supabase,
    );

    if (attendee === null) {
      return NextResponse.json({ notice: ALREADY_ATTENDING }, { status: 200 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_attend",
        module: "youth_activities",
        detail: {
          eventId,
          profileId: event.profileId,
          eventDate: event.eventDate,
        },
      },
      supabase,
    );

    return NextResponse.json({ attendee }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/youth/events/[id]/attend",
      fallbackMessage: "Could not put you down for that event. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.view", roleAccess);

    const { id } = await params;
    const eventId = eventIdSchema.parse(id);

    const event = await getActivityEvent(user.wardId, eventId, supabase);

    if (!event) {
      return NextResponse.json({ error: EVENT_NOT_FOUND }, { status: 404 });
    }

    // ONLY `user_id = user.id`. Withdrawing somebody else's row is the assign route's DELETE, and
    // it is bishopric-only there for the same reason it is impossible here.
    const removed = await removeAttendee(user.wardId, eventId, user.id, supabase);

    if (!removed) {
      return NextResponse.json({ error: REMOVE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_unattend",
        module: "youth_activities",
        detail: {
          eventId,
          profileId: event.profileId,
          eventDate: event.eventDate,
        },
      },
      supabase,
    );

    return NextResponse.json({ removed: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/youth/events/[id]/attend",
      fallbackMessage: "Could not update that event. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
