import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday } from "@/lib/calendar/queries";
import { findPrayerSlot, listPrayers, upsertPrayer } from "@/lib/prayers/queries";
import { afterPrayerPersonChanged } from "@/lib/sacrament/finalizePeople";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AskLinkWriteError, type WithdrawnAsks } from "@/lib/todos/askLinks";
import { listPrayersQuerySchema, upsertPrayerSchema } from "@/lib/validation/prayer";

// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.
//
// Prayers ride on `talks.view` and `talks.plan`. There is deliberately NO `prayers.*`
// permission: a prayer is part of planning the meeting, and 04-talks-pipeline.md puts the whole
// phase behind bishopric access. A separate permission would be one more thing to keep in step
// with talks for no behaviour anybody asked for.

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";

const WRITE_REFUSED = "That prayer could not be saved. Reload and try again.";

const ASK_NOT_WITHDRAWN =
  "Who is praying was saved, but the earlier ask could not be taken off the conductor's To Do. Reload and check it.";

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;
    const sundayId = searchParams.get("sundayId");

    // The parameter names are read here EXACTLY as PrayerBoard sends them. A client sending a
    // name this handler does not read gets no error, just a silently ignored filter
    // (plans/retros/roster-b-picker-and-orgs.md).
    const filter = listPrayersQuerySchema.parse(
      sundayId !== null
        ? { sundayId }
        : {
            from: searchParams.get("from") ?? undefined,
            to: searchParams.get("to") ?? undefined,
          },
    );

    const prayers = await listPrayers(user.wardId, filter, supabase);

    return NextResponse.json({ prayers });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/prayers",
      fallbackMessage: "Could not load the prayer assignments. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// Assigning a prayer, by SLOT rather than by id: a Sunday has exactly one invocation and one
// benediction, so "who is giving the invocation on this Sunday" is the whole identity of the
// thing being written. A second POST to the same slot replaces the member rather than adding a
// second row (migration 028's unique index is what makes that true).
//
// assertCan runs BEFORE the body is parsed, so an unauthorized caller is refused rather than
// handed a validation message that describes the route's shape.
export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.plan", roleAccess);

    const input = upsertPrayerSchema.parse(await readJsonBody(request));

    const sunday = await getSunday(user.wardId, input.sundayId, supabase);
    if (!sunday) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    // DELIBERATELY no speakingSlots check. A fast Sunday carries speaking_slots = 0 and still has
    // an invocation and a benediction — the slot count is a fact about SPEAKERS, and gating
    // prayers on it would make the one Sunday a month with the most prayers the only one that
    // could not have any (04-talks-pipeline.md, lib/calendar/queries.ts).
    // Read BEFORE the write: a change of person withdraws the old person's ask and un-finalizes
    // the prayers (ITER-036 fb, D2 and D3), and only the slot as it was can say who that was.
    const before = await findPrayerSlot(user.wardId, input.sundayId, input.prayerType, supabase);
    const prayer = await upsertPrayer(user.wardId, input, supabase);

    if (!prayer) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    let withdrawn: WithdrawnAsks | null = null;
    let prayersUnfinalized = false;
    let askFailure: AskLinkWriteError | null = null;
    try {
      const changed = await afterPrayerPersonChanged({
        wardId: user.wardId,
        before,
        after: prayer,
        client: supabase,
      });
      withdrawn = changed.withdrawn;
      prayersUnfinalized = changed.unfinalized;
    } catch (error) {
      if (!(error instanceof AskLinkWriteError)) throw error;
      askFailure = error;
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "prayer_assigned",
        module: "talks",
        detail: {
          prayerId: prayer.id,
          sundayId: prayer.sundayId,
          date: sunday.date,
          prayerType: prayer.prayerType,
          assigned: prayer.memberId !== null,
          stage: prayer.stage,
          prayersUnfinalized,
          deletedTodoIds: withdrawn?.deletedIds ?? [],
          closedTodoIds: withdrawn?.closedIds ?? [],
          keptTodoIds: withdrawn?.keptIds ?? [...(askFailure?.completedIds ?? [])],
        },
      },
      supabase,
    );

    if (askFailure !== null) {
      console.error("POST /api/prayers saved the person but did not withdraw the old ask", {
        wardId: user.wardId,
        prayerId: prayer.id,
        cause: askFailure.cause,
      });
      return NextResponse.json({ error: ASK_NOT_WITHDRAWN }, { status: 500 });
    }

    return NextResponse.json({ prayer }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/prayers",
      fallbackMessage: "Could not assign that prayer. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
