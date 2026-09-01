import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { setParticipationSchema } from "@/lib/validation/youth";
import { getActivityEvent } from "@/lib/youth/queries";
import {
  clearParticipation,
  listRosterForProfile,
  setParticipation,
} from "@/lib/youth/rosterQueries";

// "SOMEBODY WASN'T THERE" — one young person, one event.
//
// ---------------------------------------------------------------------------
// WHY THIS GETS ITS OWN ROUTE WHERE migration 061's COLUMN DID NOT
// ---------------------------------------------------------------------------
// A reader will weigh this against youth-i, which put `youthAttended` on the ordinary event PATCH
// and argued the case: `Cancel` is the exact sibling — same table, same gate, same effect on the
// support number — so a separate action name would have earned nothing.
//
// THAT ARGUMENT DEPENDED ON THE FACT LIVING ON THE EVENT ROW, AND IT NO LONGER DOES. This is a
// write to a DIFFERENT TABLE (`activity_event_participation`, migration 062d) about a DIFFERENT
// SUBJECT — a young person, not a game — and it takes a `memberId` that no event patch could
// carry. A team's game serves a whole roster, so a field on the event schema could only ever mark
// everybody at once, which is the bug this slice exists to remove. Same reasoning `close` and
// `occasion` give for their own routes: a different verb on a different table.
//
// ---------------------------------------------------------------------------
// `youth_activities.manage`, MATCHING WHAT MIGRATION 061 REQUIRED
// ---------------------------------------------------------------------------
// The same boundary `Cancel` already runs under, and migration 062f moved none of it: both new
// tables carry ward-wide policies on all four verbs, exactly as `activity_events` does. A leader
// from another organization marking a young person as not taking part is the same trust level as
// calling off their game, which this app already permits.
//
// So the control gates on the permission ALONE. There is deliberately no ownership mirror, for
// the reason lib/youth/activityOwnership.ts gives for having no `canManageActivityEvent()`: a
// helper would either restate `true` or invent a rule the database does not enforce.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const eventIdSchema = z.uuid("That event id is not valid.");

const EVENT_NOT_FOUND = "That event is not in your ward.";

// REPLACES MIGRATION 061'S CHECK CONSTRAINT, and it is a strictly better answer than one.
//
// That constraint existed because `activity_events.profile_id` is nullable: on a ward-wide event
// "did THEY go?" had no referent. Migration 062d needs no successor to it — `member_id` is
// `not null`, so the constraint is the column — but there is a NEW meaningless row it cannot
// express: a young person who is not on this team at all.
//
// A PERSON CAN ACT ON "Ethan is not on this team". Nobody can act on a constraint violation, which
// is migration 061's own stated reason for refusing in the route first (CLAUDE.md rule 7).
// VALIDATION, NOT A PERMISSION — the caller may write this event's participation in every other
// way, and rule 2's boundary is untouched.
const NOT_ON_ROSTER =
  "They are not on this activity, so there is nothing to record for them here. Add them to it first.";

const NO_TEAM =
  "That event is not on an activity, so there is nobody on a roster to record.";

const WRITE_REFUSED = "That could not be recorded. Reload and try again.";

export async function PATCH(
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
    const input = setParticipationSchema.parse(await readJsonBody(request));

    const event = await getActivityEvent(user.wardId, eventId, supabase);

    if (!event) {
      return NextResponse.json({ error: EVENT_NOT_FOUND }, { status: 404 });
    }

    // A ward-wide event belongs to no team, so it has no roster and there is nobody to ask about.
    if (event.profileId === null) {
      return NextResponse.json({ error: NO_TEAM }, { status: 400 });
    }

    const roster = await listRosterForProfile(user.wardId, event.profileId, supabase);
    const membership = roster.find((entry) => entry.memberId === input.memberId);

    if (membership === undefined) {
      return NextResponse.json({ error: NOT_ON_ROSTER }, { status: 400 });
    }

    // ---------------------------------------------------------------------
    // `null` DELETES THE ROW, AND THAT IS THE WAY BACK THAT IS NOT THE OPPOSITE CLAIM
    // ---------------------------------------------------------------------
    // Pressing the active answer again sends `null`, so a mark made on the wrong game — or on the
    // right game for the wrong young person — is undone to "NOBODY HAS SAID" rather than to "they
    // were there", which is a different claim nobody made. Migration 061's reversibility rule kept
    // verbatim, on storage where the third state is the ABSENCE of the row (migration 062d).
    //
    // It breaks no rule. Migration 060a's "never a delete" protects a record somebody WROTE; this
    // row holds no text, no account and no author's words.
    if (input.takingPart === null) {
      await clearParticipation(user.wardId, eventId, input.memberId, supabase);

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "youth_activity_participation_cleared",
          module: "youth_activities",
          detail: {
            eventId,
            eventTitle: event.title,
            profileId: event.profileId,
            memberId: input.memberId,
            memberName: membership.memberName,
          },
        },
        supabase,
      );

      return NextResponse.json({ takingPart: null });
    }

    const recorded = await setParticipation(
      user.wardId,
      {
        eventId,
        memberId: input.memberId,
        takingPart: input.takingPart,
        // FROM THE SESSION, never from the body — the rule lib/validation/youth.ts's header states
        // for `wardId` and `enteredBy`. No policy compares against this column; it is a record.
        recordedBy: user.id,
      },
      supabase,
    );

    if (!recorded) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_participation_recorded",
        module: "youth_activities",
        // WHAT IT BECAME, beside the names, so "why did Ethan's number move?" is answerable from
        // the log. `writeAuditLog()` runs redactSensitive() over this object; a boolean and a
        // member's own name carry nothing this module holds back elsewhere.
        detail: {
          eventId,
          eventTitle: event.title,
          profileId: event.profileId,
          memberId: input.memberId,
          memberName: membership.memberName,
          takingPart: input.takingPart,
        },
      },
      supabase,
    );

    return NextResponse.json({ takingPart: input.takingPart });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/youth/events/[id]/participation",
      fallbackMessage: "Could not record that. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
