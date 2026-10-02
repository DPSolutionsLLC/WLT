import type { SupabaseClient } from "@supabase/supabase-js";
import { canTransitionPrayer } from "@/lib/prayers/prayerPipeline";
import { setPrayerMember, transitionPrayer, type Prayer } from "@/lib/prayers/queries";
import { AskLinkWriteError, resolveAsksForPrayer } from "@/lib/todos/askLinks";
import type { Database } from "@/types/database";
import type { PrayerStage } from "@/types/domain";

// RECORDING A PRAYER'S ANSWER — ITER-036 fb. SERVER-ONLY. lib/assignments/requestOutcome.ts's
// shape, for prayers, and the ONLY writer of a prayer's answer.
//
//   Accepted  → the prayer moves forward to `confirm`, one legal step at a time through
//               canTransitionPrayer(): `assign → ask` (stamping `asked_by` = whoever recorded it,
//               who is the ask's owner) then `ask → confirm`. A prayer already further on stays.
//   Declined  → nobody is down to pray any more. setPrayerMember(null) clears the person and starts
//               the prayer over at `assign` (a change of person always does). A prayer keeps no
//               record of a decline — there is no prayer history — so nothing else is written.
//
// THEN EVERY OPEN COPY OF THE ASK CLOSES (resolveAsksForPrayer). Order: the prayer, then the to-dos.
// The prayer is the truth; a failed close is reported, never swallowed, and retrying is safe.
//
// A BOARD MOVE TO `confirm` OR `done` IS AN ANSWER TOO (the user's decision, 2026-10-01). Somebody
// heard yes outside To Do, so the open ask closes as Accepted rather than asking the person twice:
// closeAsksAfterBoardMove(). A move to `ask` is not an answer and leaves the ask open.
//
// `client` is the caller's own RLS-scoped client — the prayer write runs under migration 019's
// policies. The to-do writes use the service role, behind the route's `talks.request` check.

type Client = SupabaseClient<Database>;

export type PrayerOutcomeResult =
  | { ok: false; message: string }
  | { ok: true; prayer: Prayer; todosClosed: string[]; closeFailure: AskLinkWriteError | null };

const GONE = "That prayer is no longer on the calendar.";
const NOBODY = "Nobody is down to give this prayer any more, so there is no answer to record.";

export async function recordPrayerOutcome(params: {
  wardId: string;
  existing: Prayer;
  outcome: "accepted" | "declined";
  actorUserId: string;
  client: Client;
}): Promise<PrayerOutcomeResult> {
  const { wardId, existing, client } = params;
  if (existing.cancelledAt !== null) return { ok: false, message: GONE };
  if (existing.memberId === null) return { ok: false, message: NOBODY };

  const prayer =
    params.outcome === "accepted"
      ? await acceptPrayer(wardId, existing, params.actorUserId, client)
      : await setPrayerMember(wardId, existing, null, client);

  if (prayer === null) return { ok: false, message: GONE };
  if ("message" in prayer) return { ok: false, message: prayer.message };

  const closed = await closeAsks(wardId, existing.id, params.outcome);
  return { ok: true, prayer, ...closed };
}

async function acceptPrayer(
  wardId: string,
  existing: Prayer,
  actorUserId: string,
  client: Client,
): Promise<Prayer | { message: string } | null> {
  let prayer: Prayer = existing;
  for (const to of ["ask", "confirm"] as const satisfies readonly PrayerStage[]) {
    if (prayer.stage !== previousOf(to)) continue;
    const verdict = canTransitionPrayer(prayer.stage, to, {
      memberId: prayer.memberId,
      askedAt: prayer.askedAt,
      confirmedAt: prayer.confirmedAt,
      actorIsBishopric: true,
    });
    if (!verdict.ok) return { message: verdict.message };
    const moved = await transitionPrayer(wardId, prayer.id, to, { actorUserId }, client);
    if (moved === null) return null;
    prayer = moved;
  }
  return prayer;
}

function previousOf(stage: "ask" | "confirm"): PrayerStage {
  return stage === "ask" ? "assign" : "ask";
}

async function closeAsks(
  wardId: string,
  prayerId: string,
  outcome: "accepted" | "declined",
): Promise<{ todosClosed: string[]; closeFailure: AskLinkWriteError | null }> {
  try {
    return { todosClosed: await resolveAsksForPrayer({ wardId, prayerId, outcome }), closeFailure: null };
  } catch (error) {
    if (!(error instanceof AskLinkWriteError)) throw error;
    console.error("A prayer's answer was recorded but not every copy of its ask closed", {
      wardId,
      prayerId,
      cause: error.cause,
    });
    return { todosClosed: [...error.completedIds], closeFailure: error };
  }
}

// After a board move (PATCH /api/prayers/[id]). Only `confirm` and `done` are answers.
export async function closeAsksAfterBoardMove(params: {
  wardId: string;
  prayerId: string;
  to: PrayerStage;
}): Promise<{ todosClosed: string[]; closeFailure: AskLinkWriteError | null }> {
  if (params.to !== "confirm" && params.to !== "done") {
    return { todosClosed: [], closeFailure: null };
  }
  return closeAsks(params.wardId, params.prayerId, "accepted");
}
