import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { joinOccasionSchema } from "@/lib/validation/youth";
import {
  createOccasion,
  deleteOccasionIfEmpty,
  setEventOccasion,
} from "@/lib/youth/occasions";
import { getActivityEvent, listActivityEvents } from "@/lib/youth/queries";

// "This is the same game as that one", and "no it is not".
//
// ---------------------------------------------------------------------------
// THE GATE IS `youth_activities.manage`, NOT `.view`
// ---------------------------------------------------------------------------
// The sibling attend/ route gates on `.view` because putting YOURSELF down for a game is
// something any org secretary who turns up to it may do. Linking two young people's games is a
// different act: it is a COORDINATION DECISION about somebody else's record, and it is the same
// decision POST /api/youth/events gates when it adds a young person to an existing occasion. The
// two must not disagree, or the same outcome would be reachable through one door and refused at
// the other.
//
// ---------------------------------------------------------------------------
// THERE IS NO ORGANIZATION CHECK HERE, AND ITS ABSENCE IS DELIBERATE
// ---------------------------------------------------------------------------
// `activity_occasions` carries migration 019's ward-wide policies on all four verbs (059c), for
// the reason `activity_events` does: an event inherits its organization through its profile, and
// a CROSS-ORGANIZATION OCCASION IS THE POINT — a Young Men row and a Young Women row at the same
// game. lib/youth/activityOwnership.ts ends by saying there is deliberately no
// `canManageActivityEvent()`, because a helper there would either restate `true` or invent a rule
// the policy does not enforce. No fourth mirror is added for this.
//
// ---------------------------------------------------------------------------
// MERGING TWO OCCASIONS IS REFUSED, AND THE SENTENCE NAMES THE ALTERNATIVE
// ---------------------------------------------------------------------------
// Silently absorbing one occasion into the other would move rows NOBODY NAMED — a leader joining
// two games would quietly reassign a third young person's row — and the audit entry would record
// it as an ordinary join. Refusing with a sentence that says what to do instead is the visits-f
// empty-bulk-replace precedent: a refusal that names the alternative is a decision rather than a
// wall.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const eventIdSchema = z.uuid("That event id is not valid.");

const EVENT_NOT_FOUND = "That event is not in your ward.";

const SAME_EVENT = "An event cannot be the same game as itself.";

const ALREADY_JOINED = "Those two are already recorded as the same game.";

const BOTH_IN_OCCASIONS =
  "Both of those are already part of a game with other young people. Take one out of its " +
  "game first, then join it to this one.";

const NOT_IN_AN_OCCASION = "That event is not part of a game with anybody else.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    const { id } = await params;
    const eventId = eventIdSchema.parse(id);
    const input = joinOccasionSchema.parse(await readJsonBody(request));

    if (eventId === input.otherEventId) {
      return NextResponse.json({ error: SAME_EVENT }, { status: 400 });
    }

    // BOTH resolved through the caller's own client, so an event in another ward simply is not
    // there. Checked BEFORE the write because the composite foreign key would otherwise answer
    // with a constraint violation, and "insert or update on table violates foreign key
    // constraint" is not a sentence anybody can act on. POST /api/youth/events does the same,
    // word for word.
    const [event, otherEvent] = await Promise.all([
      getActivityEvent(user.wardId, eventId, supabase),
      getActivityEvent(user.wardId, input.otherEventId, supabase),
    ]);

    if (!event || !otherEvent) {
      return NextResponse.json({ error: EVENT_NOT_FOUND }, { status: 404 });
    }

    if (
      event.occasionId !== null &&
      otherEvent.occasionId !== null &&
      event.occasionId === otherEvent.occasionId
    ) {
      return NextResponse.json({ error: ALREADY_JOINED }, { status: 409 });
    }

    if (
      event.occasionId !== null &&
      otherEvent.occasionId !== null &&
      event.occasionId !== otherEvent.occasionId
    ) {
      return NextResponse.json({ error: BOTH_IN_OCCASIONS }, { status: 409 });
    }

    // A DATE MISMATCH IS NOT REFUSED, AND THAT IS A DECISION. An all-day tournament entry and a
    // 7:30pm game genuinely can be the same occasion, and youth-c's rule applies unchanged: a
    // near-miss a clever matcher would catch is exactly the case where a person should be asked.
    // Here a person HAS been asked and has answered. The picker narrows what is OFFERED; the
    // route does not second-guess the answer.
    const existingOccasionId = event.occasionId ?? otherEvent.occasionId;
    const created = existingOccasionId === null;

    const occasionId =
      existingOccasionId ?? (await createOccasion(user.wardId, user.id, supabase)).id;

    // Only the rows that are not already in it. Writing the same value again would be harmless
    // and is left out anyway, so a zero-row result below always means something was refused.
    const toStamp = [event, otherEvent]
      .filter((candidate) => candidate.occasionId !== occasionId)
      .map((candidate) => candidate.id);

    for (const targetId of toStamp) {
      const linked = await setEventOccasion(user.wardId, targetId, occasionId, supabase);

      if (!linked) {
        // A zero-row UPDATE is a refusal, not an error (CLAUDE.md §8). Saying so is the whole
        // point; reporting a success that did not happen would leave a leader looking at a
        // screen that claims two rows are one game when the database says otherwise.
        return NextResponse.json(
          {
            error:
              "That event could not be linked. Reload and try again — somebody may have " +
              "changed it.",
          },
          { status: 409 },
        );
      }
    }

    const events = await listActivityEvents(
      user.wardId,
      { occasionId, includePast: true },
      supabase,
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_occasion_joined",
        module: "youth_activities",
        detail: {
          occasionId,
          eventId,
          otherEventId: otherEvent.id,
          // WHETHER THIS STARTED A GAME OR ADDED TO ONE. Without it the audit row cannot answer
          // "when did these three become one evening?", which is exactly the question somebody
          // asks at the moment they care.
          created,
        },
      },
      supabase,
    );

    return NextResponse.json({ occasionId, events });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/youth/events/[id]/occasion",
      fallbackMessage: "Could not record those as the same game. Please try again.",
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

    assertCan(user, "youth_activities.manage", roleAccess);

    const { id } = await params;
    const eventId = eventIdSchema.parse(id);

    const event = await getActivityEvent(user.wardId, eventId, supabase);

    if (!event) {
      return NextResponse.json({ error: EVENT_NOT_FOUND }, { status: 404 });
    }

    if (event.occasionId === null) {
      return NextResponse.json({ error: NOT_IN_AN_OCCASION }, { status: 409 });
    }

    const occasionId = event.occasionId;
    const unlinked = await setEventOccasion(user.wardId, eventId, null, supabase);

    if (!unlinked) {
      return NextResponse.json(
        {
          error:
            "That event could not be taken out of its game. Reload and try again — somebody " +
            "may have changed it.",
        },
        { status: 409 },
      );
    }

    const occasionRemoved = await deleteOccasionIfEmpty(user.wardId, occasionId, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_occasion_left",
        module: "youth_activities",
        detail: { occasionId, eventId, occasionRemoved },
      },
      supabase,
    );

    return NextResponse.json({ occasionId: null });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/youth/events/[id]/occasion",
      fallbackMessage: "Could not take that event out of its game. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
