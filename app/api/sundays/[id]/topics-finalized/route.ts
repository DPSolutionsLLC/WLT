import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday, setTopicsFinalized } from "@/lib/calendar/queries";
import {
  describeMusicHandoff,
  handTopicsToMusic,
  reopenMusicForTopicChange,
} from "@/lib/music/topicsHandoff";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { setTopicsFinalizedSchema } from "@/lib/validation/topic";
import type { Database } from "@/types/database";

// SAYING A SUNDAY'S TOPICS ARE DECIDED — p4-sacrament-b2, migration 078.
//
// ---------------------------------------------------------------------------
// ITS OWN ROUTE, NOT A FIELD ON PATCH /api/sundays/[id]
// ---------------------------------------------------------------------------
// Three reasons, and the first is the one that matters.
//
// THE PERMISSION IS DIFFERENT. PATCH /api/sundays/[id] asserts `calendar.manage`; this asserts
// `topics.manage`, which is BISHOPRIC-ONLY. Folding it in would have meant one handler with two
// boundaries in it, and the shape of that mistake is a field that quietly rides in on the wider
// one.
//
// IT MUST NOT UN-FINALIZE ITSELF. That route calls unfinalizeTopicsIfNeeded() whenever
// `speakingSlots` is in the patch (lib/topics/finalize.ts), so a finalize arriving through the
// same handler would be racing the rule that exists to clear it.
//
// AND IT GETS ITS OWN AUDIT ACTIONS. `sunday_topics_finalized` / `sunday_topics_unfinalized`
// rather than `sunday_updated` with `changedFields: ["topicsFinalized"]` — the precedent
// PATCH /api/youth/profiles/[id]/close sets, for the reason it gives: an auditor scanning for the
// decisions that changed what a ward sees should not have to parse a detail object.
//
// TWO ACTIONS, NOT ONE WITH A BOOLEAN IN THE DETAIL, for the same reason.
//
// ---------------------------------------------------------------------------
// THE ROUTE IS THE BOUNDARY HERE, AND MIGRATION 078 SAYS SO
// ---------------------------------------------------------------------------
// Migration 019 grants UPDATE on `sundays` to every authenticated member of the ward, so RLS
// stops a cross-WARD write and nothing else. This `assertCan` is what stops an org secretary
// finalizing the bishopric's topics — the same split `calendar.manage` already has on this table.
// tests/rls/topics-finalized.test.ts asserts both halves rather than claiming a policy that does
// not exist.
//
// ---------------------------------------------------------------------------
// THE MUSIC COORDINATOR IS TOLD — ITER-038 slice mc, REVERSING b2's "NOTHING IS NOTIFIED"
// ---------------------------------------------------------------------------
// b2 notified nobody, following the prototype, which refused because a message "would still require
// assuming a group with the music-coordinator role exists". The user asked for the handoff (plan
// D1), and WLT does not assume: lib/music/topicsHandoff.ts resolves the ward's real coordinator
// callings and says in words when there are none. The /music pill stays as well.
//
// FINALIZING puts "Choose the music" on each coordinator's To Do (plus a notification row, plus an
// email to anybody who switched it on). Whether it is a first handout, a "topics changed", or
// nothing new depends on whether the Sunday was ALREADY finalized, so the Sunday is read before the
// write. UN-FINALIZING returns submitted or approved music to draft and tells nobody (D2) — telling
// happens on the next finalize.
//
// THE FINALIZE STANDS WHATEVER THE HANDOFF DOES. The stamp is the bishopric's decision; a to-do
// that could not be written is reported beside it as a sentence, never as a 500 that would read as
// "not saved" over a Sunday that was.

const HANDOFF_FAILED =
  "Topics are finalized, but the music coordinator couldn't be told. Undo and finalize again to retry.";
const REOPEN_FAILED =
  "Topics are no longer finalized, but this Sunday's submitted music couldn't be returned to draft. Reload the Music page and check it.";

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    // Before the body is parsed, so an unauthorized caller is refused rather than handed a
    // validation message describing the route's shape.
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "topics.manage", roleAccess);

    // `params` is a PROMISE in Next 16. A route test calls this as
    // `PATCH(request, { params: Promise.resolve({ id }) })`.
    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);
    const input = setTopicsFinalizedSchema.parse(await readJsonBody(request));

    // IDEMPOTENCE LIVES IN setTopicsFinalized(), not here — finalizing an already-finalized Sunday
    // writes nothing and the stamp does not move, so the recorded instant stays the one somebody
    // actually decided at. Two callers reach that function and they must agree about it.
    const before = await getSunday(user.wardId, sundayId, supabase);
    const sunday = await setTopicsFinalized(user.wardId, sundayId, input.finalized, supabase);

    // A Sunday in another ward and a write RLS refused are indistinguishable here, and both mean
    // "not yours" (plans/retros/foundation-c-services.md).
    if (!sunday) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    // WRITTEN EVEN WHEN THE CALL WAS A NO-OP, deliberately. Pressing finalize on an already
    // finalized Sunday is still somebody stating the day is settled, and an audit log that
    // recorded only state CHANGES would be unable to answer "who kept saying this was ready".
    // The stamp in the detail is what tells the two apart: unchanged means nothing moved.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: input.finalized ? "sunday_topics_finalized" : "sunday_topics_unfinalized",
        module: "talks",
        detail: {
          sundayId,
          date: sunday.date,
          topicsFinalizedAt: sunday.topicsFinalizedAt,
        },
      },
      supabase,
    );

    const wasFinalized = before !== null && before.topicsFinalizedAt !== null;
    const music = input.finalized
      ? await handOff(user.wardId, sundayId, user.id, wasFinalized, supabase)
      : await reopenForTopicChange(user.wardId, sundayId);

    return NextResponse.json({ sunday, music });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/sundays/[id]/topics-finalized",
      fallbackMessage: "Could not save that. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

async function handOff(
  wardId: string,
  sundayId: string,
  actingUserId: string,
  wasAlreadyFinalized: boolean,
  client: SupabaseClient<Database>,
): Promise<{ message: string | null; error: string | null }> {
  try {
    const handoff = await handTopicsToMusic({
      wardId,
      sundayId,
      actingUserId,
      wasAlreadyFinalized,
      client,
    });
    return { message: describeMusicHandoff(handoff), error: null };
  } catch (error) {
    console.error("Topics were finalized but the music coordinator could not be told", {
      wardId,
      sundayId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { message: null, error: HANDOFF_FAILED };
  }
}

async function reopenForTopicChange(
  wardId: string,
  sundayId: string,
): Promise<{ message: string | null; error: string | null }> {
  try {
    await reopenMusicForTopicChange({ wardId, sundayId });
    return { message: null, error: null };
  } catch (error) {
    console.error("Topics were un-finalized but the music could not be reopened", {
      wardId,
      sundayId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { message: null, error: REOPEN_FAILED };
  }
}
