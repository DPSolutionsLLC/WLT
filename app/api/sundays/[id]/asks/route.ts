import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { buildAsksForTalks, loadSundayAsks } from "@/lib/sacrament/sundayAsks";
import { TALKS_LOCK_REASON_TEXT, talkNeedsAsk } from "@/lib/sacrament/talkAsks";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AskLinkWriteError, createAsksForSunday } from "@/lib/todos/askLinks";
import { wardDateOnly } from "@/lib/ward/wardDate";
import { readWardTimezone } from "@/lib/ward/wardTimezone";

// SEND ASKS — Sacrament slice f1.
//
// POST creates one "Ask ___ to speak" to-do per speaker not yet asked, on the list of whoever is
// CONDUCTING this Sunday (U1). "Not yet asked" is computed (lib/sacrament/talkAsks.ts), so pressing
// it again later sends only the new ones and a double press sends nothing (U9, migration 083b).
//
// GET is the Sunday's ask state, the same value the hub's Talks pill shows.
//
// `talks.request`, which only the bishopric holds. The conductor's to-dos are written with the
// service role (lib/todos/askLinks.ts), after this route has read the Sunday and its talks through
// the caller's own client.

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";
const NOBODY_TO_ASK = "Everyone on this Sunday has been asked.";
const PARTLY_SENT =
  "Not every ask could be created. Press Send asks again — nobody who already has one will be asked twice.";

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

    return NextResponse.json({ ...loaded.stateInput, state: loaded.state });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/sundays/[id]/asks",
      fallbackMessage: "Could not load this Sunday's asks. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(
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

    const { sunday, talks, inputs, stateInput } = loaded;

    // Refuse, and say what would unlock it. Checked in the order a bishopric works through a
    // Sunday: references, then a speaker, then somebody to hold the asks.
    if (!stateInput.referencesDecided) {
      return badRequest(TALKS_LOCK_REASON_TEXT.references_open);
    }
    if (!stateInput.talks.some((talk) => talk.hasSpeaker)) {
      return badRequest(TALKS_LOCK_REASON_TEXT.no_speaker);
    }
    const conductorId = sunday.conductingUserId;
    if (conductorId === null) {
      return badRequest(
        "Nobody is conducting this Sunday yet. Choose who conducts first — the asks go to them.",
      );
    }

    const toAsk = talks.filter((talk) => {
      const input = inputs.get(talk.id);
      return input !== undefined && talkNeedsAsk(input);
    });
    if (toAsk.length === 0) return badRequest(NOBODY_TO_ASK);

    const [asks, timeZone] = await Promise.all([
      buildAsksForTalks({
        wardId: user.wardId,
        sundayDate: sunday.date,
        talks: toAsk,
        client: supabase,
      }),
      readWardTimezone(user.wardId, supabase),
    ]);

    let todoIds: string[];
    let partialFailure: AskLinkWriteError | null = null;
    try {
      todoIds = await createAsksForSunday({
        wardId: user.wardId,
        sundayId,
        ownerUserIds: [conductorId],
        asks,
        assignedByUserId: user.id,
        today: wardDateOnly(new Date(), timeZone),
      });
    } catch (error) {
      if (!(error instanceof AskLinkWriteError)) throw error;
      console.error("POST /api/sundays/[id]/asks created only some of its asks", {
        wardId: user.wardId,
        sundayId,
        cause: error.cause,
      });
      partialFailure = error;
      todoIds = [...error.completedIds];
    }

    // Written for a partial run too, when anything was created: those to-dos exist (rule 6).
    if (partialFailure !== null && todoIds.length === 0) {
      return NextResponse.json({ error: PARTLY_SENT }, { status: 500 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "talk_asks_sent",
        module: "talks",
        detail: {
          sundayId,
          assignmentIds: asks.map((ask) => ask.assignmentId),
          todoIds,
        },
      },
      supabase,
    );

    if (partialFailure !== null) {
      return NextResponse.json({ error: PARTLY_SENT }, { status: 500 });
    }

    return NextResponse.json({ sent: asks.length, todoIds }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/sundays/[id]/asks",
      fallbackMessage: "Could not send the asks. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: message }, { status: 400 });
}
