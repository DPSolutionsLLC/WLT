import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { readConductorName } from "@/lib/calendar/queries";
import { describeAskImpact } from "@/lib/sacrament/askImpact";
import {
  finalizeSpeakers,
  loadSpeakerImpacts,
  unfinalizeSpeakers,
} from "@/lib/sacrament/finalizePeople";
import { loadSundayAsks } from "@/lib/sacrament/sundayAsks";
import { countTalksNeedingAsk } from "@/lib/sacrament/talkAsks";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AskLinkWriteError } from "@/lib/todos/askLinks";
import { setPeopleFinalizedSchema } from "@/lib/validation/assignment";
import { readWardTimezone } from "@/lib/ward/wardTimezone";

// FINALIZING A SUNDAY'S SPEAKERS — ITER-036 (lib/sacrament/finalizePeople.ts holds the rules).
//
// PATCH { finalized: true } stamps the Sunday and puts one ask per speaker not yet asked on the
// CONDUCTOR's To Do. It replaces POST /api/sundays/[id]/asks ("Send asks"). { finalized: false }
// clears the stamp and withdraws every ask that is only on To Do (D3).
//
// GET is what the confirm shows before either: whose To Do the asks go to (D6), how many, and —
// for an un-finalize — who is already scheduled or has accepted (D4). The warning is built here
// because the appointment time is formatted in the WARD's zone (rule 12).
//
// `talks.request`, which only the bishopric holds — the permission "Send asks" carried. Its own
// route rather than a field on PATCH /api/sundays/[id] for topics-finalized's reasons: a different
// permission, and its own audit actions.

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";
const PARTLY_SENT =
  "The speakers are finalized, but not every ask could be created. Press Finalize again — nobody who already has one will be asked twice.";
const PARTLY_WITHDRAWN =
  "The speakers are un-finalized, but not every ask could be removed. Reload the page and check the conductor's To Do.";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.request", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);

    const loaded = await loadSundayAsks(user.wardId, sundayId, supabase);
    if (loaded === null) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    const conductorId = loaded.sunday.conductingUserId;
    const [conductorName, impacts, timeZone] = await Promise.all([
      conductorId === null ? null : readConductorName(user.wardId, conductorId, supabase),
      loadSpeakerImpacts({
        wardId: user.wardId,
        talks: loaded.talks,
        viewerUserId: user.id,
        client: supabase,
      }),
      readWardTimezone(user.wardId, supabase),
    ]);

    return NextResponse.json({
      finalized: loaded.sunday.speakersFinalizedAt !== null,
      hasConductor: conductorId !== null,
      conductorIsYou: conductorId === user.id,
      conductorName,
      toAsk: countTalksNeedingAsk(loaded.stateInput.talks),
      unfinalizeWarning: describeAskImpact([...impacts.values()], "unfinalize", timeZone),
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/sundays/[id]/speakers-finalized",
      fallbackMessage: "Could not load this Sunday's speakers. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.request", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);
    const input = setPeopleFinalizedSchema.parse(await readJsonBody(request));

    if (input.finalized) {
      const finalized = await finalizeSpeakers({
        wardId: user.wardId,
        sundayId,
        actingUserId: user.id,
        client: supabase,
      });
      if (!finalized.ok) {
        return NextResponse.json({ error: finalized.error }, { status: finalized.status });
      }

      // Written for a partial run too: the stamp and any asks created exist (rule 6). Ids only —
      // never a title or a note.
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "sunday_speakers_finalized",
          module: "talks",
          detail: {
            sundayId,
            date: finalized.sunday.date,
            speakersFinalizedAt: finalized.sunday.speakersFinalizedAt,
            assignmentIds: finalized.askedAssignmentIds,
            todoIds: finalized.createdIds,
          },
        },
        supabase,
      );

      if (finalized.partialFailure !== null) {
        return NextResponse.json({ error: PARTLY_SENT }, { status: 500 });
      }

      return NextResponse.json({
        sunday: finalized.sunday,
        asked: finalized.createdIds.length,
        conductorName: finalized.conductorName,
      });
    }

    let unfinalized;
    try {
      unfinalized = await unfinalizeSpeakers({ wardId: user.wardId, sundayId, client: supabase });
    } catch (error) {
      if (!(error instanceof AskLinkWriteError)) throw error;
      console.error("PATCH /api/sundays/[id]/speakers-finalized withdrew only some asks", {
        wardId: user.wardId,
        sundayId,
        cause: error.cause,
      });
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "sunday_speakers_unfinalized",
          module: "talks",
          detail: { sundayId, todoIds: [...error.completedIds], incomplete: true },
        },
        supabase,
      );
      return NextResponse.json({ error: PARTLY_WITHDRAWN }, { status: 500 });
    }

    if (!unfinalized.ok) {
      return NextResponse.json({ error: unfinalized.error }, { status: unfinalized.status });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "sunday_speakers_unfinalized",
        module: "talks",
        detail: {
          sundayId,
          date: unfinalized.sunday.date,
          deletedTodoIds: unfinalized.withdrawn.deletedIds,
          closedTodoIds: unfinalized.withdrawn.closedIds,
          keptTodoIds: unfinalized.withdrawn.keptIds,
        },
      },
      supabase,
    );

    return NextResponse.json({ sunday: unfinalized.sunday });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/sundays/[id]/speakers-finalized",
      fallbackMessage: "Could not save that. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
