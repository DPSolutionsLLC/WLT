import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateRosterMemberSchema } from "@/lib/validation/youth";
import { getActivityProfile } from "@/lib/youth/queries";
import {
  deleteRosterMember,
  getRosterMember,
  updateRosterMember,
} from "@/lib/youth/rosterQueries";

// ONE ROSTER ROW: the window a young person was on a team for, and taking them off it.
//
// ---------------------------------------------------------------------------
// "LEFT THE TEAM ON THE 15TH" IS THE PRIMARY CONTROL. `DELETE` IS THE MISTAKE-FIXER.
// ---------------------------------------------------------------------------
// The same primary-is-non-destructive shape youth-h established for an activity, arrived at for a
// DIFFERENT reason. There, `Remove` had to be narrowed to zero events because deleting an
// activity cascades to its games, its sign-ups, its follow-ups and the private notes rule 5 calls
// private forever.
//
// HERE THE DELETE IS UNCONDITIONAL, AND THE REASONING IS WHY IT CAN BE: A ROSTER ROW HOLDS
// NOTHING A PERSON WROTE. Follow-ups (`activity_logs`) and private notes
// (`activity_private_notes`) hang off EVENTS, not off a roster row, so they survive a delete
// untouched — `activity_logs.event_id` has been NOT NULL since migration 057a and references
// `activity_events`. The only cascade is participation MARKERS (migration 062d), which carry no
// text, no account and no author's words.
//
// So there is no 409 here and none is needed. What the UI still does is offer "Left the team on…"
// FIRST, because recording a leaving date keeps the record of the games they did play, and
// removing the row erases that they were ever on the team.
//
// ---------------------------------------------------------------------------
// `youth_activities.manage`, AND NOTHING NARROWER
// ---------------------------------------------------------------------------
// `activity_roster` carries ward-wide policies on all four verbs (migration 062f). The sibling
// route's header argues this at length; narrowing it needs a migration first.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const rosterIdSchema = z.uuid("That roster id is not valid.");

const ROSTER_NOT_FOUND = "That roster entry is not in your ward.";

const WRITE_REFUSED = "That roster entry could not be changed. Reload and try again.";

const BACKWARDS_WINDOW = "They cannot leave the team before they joined it.";

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
    const rosterId = rosterIdSchema.parse(id);
    const input = updateRosterMemberSchema.parse(await readJsonBody(request));

    const existing = await getRosterMember(user.wardId, rosterId, supabase);

    if (!existing) {
      return NextResponse.json({ error: ROSTER_NOT_FOUND }, { status: 404 });
    }

    // ---------------------------------------------------------------------
    // THE WINDOW IS CHECKED AGAINST THE **RESULTING** ROW, NOT AGAINST THE BODY
    // ---------------------------------------------------------------------
    // updateRosterMemberSchema refuses `endedOn < startedOn` when a caller sends BOTH, and it
    // says in its own header that it cannot do more: it sees one request, not the row. A patch
    // setting only `endedOn` against a stored `startedOn` is the ordinary case — a leader
    // recording that somebody left — and it is exactly the shape that could otherwise write a
    // window containing nothing.
    //
    // A WINDOW THAT CANNOT CONTAIN ANYTHING SILENTLY ZEROES A PERCENTAGE: every game falls
    // outside it, the denominator is nothing, and the pill reads as an em dash with nothing on
    // any screen saying why. That is the class of bug this slice exists to remove, so it is
    // refused here with the same sentence the schema uses rather than a second wording.
    const startedOn = input.startedOn !== undefined ? input.startedOn : existing.startedOn;
    const endedOn = input.endedOn !== undefined ? input.endedOn : existing.endedOn;

    if (startedOn !== null && endedOn !== null && endedOn < startedOn) {
      return NextResponse.json({ error: BACKWARDS_WINDOW }, { status: 400 });
    }

    const member = await updateRosterMember(user.wardId, rosterId, input, supabase);

    if (!member) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_roster_updated",
        module: "youth_activities",
        // BOTH DATES, BEFORE AND AFTER. "When did she leave the team?" is exactly the question
        // somebody asks months later when a percentage does not look right, and an audit row
        // carrying only the new value cannot answer "what did it say before?".
        detail: {
          rosterId,
          profileId: existing.profileId,
          memberId: existing.memberId,
          memberName: existing.memberName,
          startedOnBefore: existing.startedOn,
          endedOnBefore: existing.endedOn,
          startedOnAfter: member.startedOn,
          endedOnAfter: member.endedOn,
        },
      },
      supabase,
    );

    return NextResponse.json({ member });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/youth/roster/[id]",
      fallbackMessage: "Could not save that change. Please try again.",
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
    const rosterId = rosterIdSchema.parse(id);

    // READ BEFORE THE DELETE, so the audit row can name WHO was taken off WHAT. Afterwards there
    // is no row to ask, and three bare ids in a log is half of what youth-h's defect was.
    const existing = await getRosterMember(user.wardId, rosterId, supabase);

    if (!existing) {
      return NextResponse.json({ error: ROSTER_NOT_FOUND }, { status: 404 });
    }

    // The activity's name, for the same reason. Read BEFORE the delete but used only for the log:
    // a failure to name the team must not stop the removal being recorded, so a null here is a
    // missing name in one audit detail rather than a failed request.
    const profile = await getActivityProfile(user.wardId, existing.profileId, supabase);

    const removed = await deleteRosterMember(user.wardId, rosterId, supabase);

    // FALSE MEANS REFUSED, NOT "NOTHING TO DO". An RLS-denied DELETE is a zero-row success rather
    // than an error (CLAUDE.md §8), so reporting a success that did not happen is the silent
    // failure rule 7 forbids.
    if (!removed) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_roster_removed",
        module: "youth_activities",
        detail: {
          rosterId,
          profileId: existing.profileId,
          activityName: profile?.activityName ?? null,
          memberId: existing.memberId,
          memberName: existing.memberName,
          startedOn: existing.startedOn,
          endedOn: existing.endedOn,
        },
      },
      supabase,
    );

    return NextResponse.json({ removed: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/youth/roster/[id]",
      fallbackMessage: "Could not take them off that activity. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
