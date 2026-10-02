import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { readConductorName } from "@/lib/calendar/queries";
import { countPrayersNeedingAsk } from "@/lib/prayers/prayerAsks";
import { describeAskImpact } from "@/lib/sacrament/askImpact";
import {
  finalizePrayers,
  loadPrayerImpacts,
  loadSundayPrayerAsks,
  unfinalizePrayers,
} from "@/lib/sacrament/finalizePeople";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AskLinkWriteError } from "@/lib/todos/askLinks";
import { setPeopleFinalizedSchema } from "@/lib/validation/assignment";
import { readWardTimezone } from "@/lib/ward/wardTimezone";

// FINALIZING A SUNDAY'S PRAYERS — ITER-036 fb. app/api/sundays/[id]/speakers-finalized/route.ts's
// shape exactly, for the invocation and the benediction (lib/sacrament/finalizePeople.ts holds the
// rules).
//
// PATCH { finalized: true } stamps the Sunday and puts one ask per prayer not yet asked on the
// CONDUCTOR's To Do. { finalized: false } clears the stamp and withdraws every prayer ask that is
// only on To Do (D3). GET is what the confirm shows first: whose To Do (D6), how many, and — for an
// un-finalize — who has already confirmed or is scheduled (D4), in the ward's zone (rule 12).
//
// `talks.request`, the speakers finalize's permission: asking somebody to pray is the same act.

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";
const PARTLY_SENT =
  "The prayers are finalized, but not every ask could be created. Press Finalize again — nobody who already has one will be asked twice.";
const PARTLY_WITHDRAWN =
  "The prayers are un-finalized, but not every ask could be removed. Reload the page and check the conductor's To Do.";

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

    const loaded = await loadSundayPrayerAsks(user.wardId, sundayId, supabase);
    if (loaded === null) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    const conductorId = loaded.sunday.conductingUserId;
    const [conductorName, impacts, timeZone] = await Promise.all([
      conductorId === null ? null : readConductorName(user.wardId, conductorId, supabase),
      loadPrayerImpacts({
        wardId: user.wardId,
        prayers: loaded.prayers,
        viewerUserId: user.id,
        client: supabase,
      }),
      readWardTimezone(user.wardId, supabase),
    ]);

    return NextResponse.json({
      finalized: loaded.sunday.prayersFinalizedAt !== null,
      hasConductor: conductorId !== null,
      conductorIsYou: conductorId === user.id,
      conductorName,
      toAsk: countPrayersNeedingAsk(loaded.stateInput.prayers),
      unfinalizeWarning: describeAskImpact([...impacts.values()], "unfinalize", timeZone),
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/sundays/[id]/prayers-finalized",
      fallbackMessage: "Could not load this Sunday's prayers. Please try again.",
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
      const finalized = await finalizePrayers({
        wardId: user.wardId,
        sundayId,
        actingUserId: user.id,
        client: supabase,
      });
      if (!finalized.ok) {
        return NextResponse.json({ error: finalized.error }, { status: finalized.status });
      }

      // Written for a partial run too (rule 6). Ids only — never a title or a note.
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "sunday_prayers_finalized",
          module: "talks",
          detail: {
            sundayId,
            date: finalized.sunday.date,
            prayersFinalizedAt: finalized.sunday.prayersFinalizedAt,
            prayerIds: finalized.askedPrayerIds,
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
      unfinalized = await unfinalizePrayers({ wardId: user.wardId, sundayId, client: supabase });
    } catch (error) {
      if (!(error instanceof AskLinkWriteError)) throw error;
      console.error("PATCH /api/sundays/[id]/prayers-finalized withdrew only some asks", {
        wardId: user.wardId,
        sundayId,
        cause: error.cause,
      });
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "sunday_prayers_unfinalized",
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
        action: "sunday_prayers_unfinalized",
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
      route: "PATCH /api/sundays/[id]/prayers-finalized",
      fallbackMessage: "Could not save that. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
