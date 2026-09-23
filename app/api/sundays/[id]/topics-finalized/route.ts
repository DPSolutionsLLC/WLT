import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { setTopicsFinalized } from "@/lib/calendar/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { setTopicsFinalizedSchema } from "@/lib/validation/topic";

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
// NOTHING IS NOTIFIED
// ---------------------------------------------------------------------------
// The prototype considered exactly this and chose against it, twice, and wrote down why: an
// auto-posted message to the music coordinator "would still require assuming a group with the
// music-coordinator role exists" (build note §topics-finalized-readiness). The signal is a PILL
// on /music instead — visible where the work is done, owed to nobody in particular, and correct
// for a ward with no music coordinator at all.

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

    return NextResponse.json({ sunday });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/sundays/[id]/topics-finalized",
      fallbackMessage: "Could not save that. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
