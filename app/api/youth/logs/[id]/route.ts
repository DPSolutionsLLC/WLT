import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateActivityLogSchema } from "@/lib/validation/youth";
import { getActivityLogWithContext, updateActivityLog } from "@/lib/youth/activityLogs";
import { setConfirmedAttendance } from "@/lib/youth/attendees";
import { notifyYouthWardCouncilFlag } from "@/lib/youth/flagNotification";

// Editing a follow-up: the shared note, whether the author went, and the ward-council flag.
//
// THIS FILE DOES NOT IMPORT lib/youth/privateNotes.ts, AND MUST NOT — see the header of
// app/api/youth/logs/route.ts. A private note is edited through its own endpoint, in its own
// request, so the wire format carries the boundary too (CLAUDE.md rule 5).
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const activityLogIdSchema = z.uuid("That follow-up id is not valid.");

// 404, not 403, for a follow-up the caller cannot see. A 403 would confirm that it exists, which
// tells an org leader something about another organization's work that they may not have — and
// after migration 057 that is a live distinction rather than a theoretical one.
const NOT_FOUND = "That follow-up is not in your ward.";

const WRITE_REFUSED = "That follow-up could not be saved. Reload and try again.";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.log", roleAccess);

    const { id } = await params;
    const activityLogId = activityLogIdSchema.parse(id);
    const input = updateActivityLogSchema.parse(await readJsonBody(request));

    // Read through the caller's own client, so migration 057c's SELECT policy decides whether
    // there is anything here at all. The context is needed anyway for the flag notification's two
    // labels, so this is one round trip rather than two.
    const existing = await getActivityLogWithContext(user.wardId, activityLogId, supabase);

    if (!existing) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // ---------------------------------------------------------------------
    // THE FLAG TRANSITION — 07-visits.md §Step 3, reproduced for this module
    // ---------------------------------------------------------------------
    //   false -> true,  flag_sent_at IS NULL      set flag, stamp flag_sent_at, NOTIFY
    //   false -> true,  flag_sent_at IS NOT NULL  set flag, do not notify        (re-flag)
    //   true  -> false                            clear flag, CLEAR flag_sent_at
    //
    // Clearing flag_sent_at on unflag is what lets a genuine re-raise notify again. Leaving it set
    // would make the second raise silent, and an agenda item nobody was told about is the same as
    // no agenda item.
    //
    // flag_sent_at is never taken from the request body — lib/youth/activityLogs.ts takes it as a
    // separate parameter for exactly that reason. A body that could stamp its own would be able to
    // silence the notification.
    const wasFlagged = existing.flaggedForWardCouncil;
    const nowFlagged = input.flaggedForWardCouncil ?? wasFlagged;

    const raising = !wasFlagged && nowFlagged;
    const clearing = wasFlagged && !nowFlagged;
    const shouldNotify = raising && existing.flagSentAt === null;

    let flagSentAt: string | null | undefined;
    if (shouldNotify) flagSentAt = new Date().toISOString();
    else if (clearing) flagSentAt = null;

    const log = await updateActivityLog(
      user.wardId,
      activityLogId,
      input,
      flagSentAt,
      supabase,
    );

    if (!log) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    // Only once the follow-up itself is known to have been writable. `log.loggedBy` rather than
    // the session: the attendance being confirmed belongs to the log's AUTHOR, and migration 056c
    // decides whether this caller may write it — a bishopric member may, and nobody else may write
    // somebody else's.
    let attendanceRecorded: boolean | null = null;
    if (input.attended !== undefined) {
      attendanceRecorded = await setConfirmedAttendance(
        user.wardId,
        log.eventId,
        log.loggedBy,
        input.attended,
        supabase,
      );
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: clearing
          ? "youth_activity_unflagged"
          : raising
            ? "youth_activity_flagged"
            : "youth_activity_followup_updated",
        module: "youth_activities",
        detail: {
          activityLogId,
          eventId: log.eventId,
          profileId: existing.profileId,
          // The KEYS that changed, never their values (plans/retros/program-e, ITER-017).
          changed: Object.keys(input),
          attended: input.attended ?? null,
          attendanceRecorded,
          notified: shouldNotify,
        },
      },
      supabase,
    );

    // Fired AFTER the update commits, and its failure never fails the request —
    // notifyYouthWardCouncilFlag never throws. The leader's edit is saved either way.
    //
    // The body is the one-liner and nothing else: the activity, the event, and the words
    // "requested for ward council discussion". No note text of any kind, shared or private
    // (lib/youth/flagNotification.ts argues it in full).
    //
    // The fallbacks are the same shape resolveFlagLabels uses for a visit: an activity or event
    // deleted since is not worth losing the notification over, and a one-liner naming what is left
    // beats silence for whoever builds the agenda.
    if (shouldNotify) {
      await notifyYouthWardCouncilFlag({
        wardId: user.wardId,
        activityName: existing.profileName ?? "A youth activity",
        eventTitle: existing.eventTitle ?? "An event",
      });
    }

    return NextResponse.json({ log });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/youth/logs/[id]",
      fallbackMessage: "Could not save that follow-up. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
