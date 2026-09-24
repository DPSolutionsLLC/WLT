import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { referencesDecisionOf, setReferencesDecision } from "@/lib/calendar/queries";
import { countReferencesForSunday, loadSundayTalks } from "@/lib/references/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { referencesDecisionSchema } from "@/lib/validation/references";
import type { ReferencesDecision } from "@/types/domain";

// FINALIZE, SKIP OR REOPEN A SUNDAY'S REFERENCES — p4-sacrament-c, migration 079.
//
// ITS OWN ROUTE, NOT A FIELD ON PATCH /api/sundays/[id], for the reasons the topics-finalized
// route gives: that route asserts `calendar.manage` where this asserts `talks.plan`, and it calls
// the un-finalize helper, which would race a finalize arriving through the same handler.
//
// THREE AUDIT ACTIONS, NOT ONE WITH THE DECISION IN THE DETAIL — an auditor scanning for the
// decisions that changed what a ward sees should not have to parse a detail object.
//
// FINALIZING NOTHING IS REFUSED, AND THE REFUSAL NAMES THE ALTERNATIVE. "Ready" over zero
// references is the empty-list-means-done confusion that `skipped` exists to prevent; a Sunday
// with nothing to give is skipped, deliberately, by somebody saying so.
//
// SKIPPING IS REFUSED WHILE ANY REFERENCE EXISTS — decided by the user 2026-09-23 (defect 074-D1).
// "Not giving references this round" over references that are listed is two claims on one pill,
// the same contradiction an add clears from the other side (lib/references/finalize.ts). Nothing is
// deleted to make a skip possible: the bishop removes them, deliberately, and then skips.
//
// Slice `f` reads this decision as Talks finalize's gate; nothing in this slice reads it.

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";
const NOTHING_TO_FINALIZE = "Add at least one reference, or skip references for this Sunday.";
const REMOVE_BEFORE_SKIP = "Remove the references first to skip this Sunday.";

const AUDIT_ACTIONS: Record<"finalized" | "skipped" | "reopened", string> = {
  finalized: "sunday_references_finalized",
  skipped: "sunday_references_skipped",
  reopened: "sunday_references_reopened",
};

function auditActionFor(decision: ReferencesDecision): string {
  return AUDIT_ACTIONS[decision ?? "reopened"];
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.plan", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);
    const { decision } = referencesDecisionSchema.parse(await readJsonBody(request));

    const loaded = await loadSundayTalks(user.wardId, sundayId, supabase);
    if (!loaded) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    if (decision !== null) {
      const count = await countReferencesForSunday(
        user.wardId,
        loaded.talksWithTopics.map((talk) => talk.id),
        supabase,
      );

      if (decision === "finalized" && count === 0) {
        return NextResponse.json({ error: NOTHING_TO_FINALIZE }, { status: 409 });
      }

      if (decision === "skipped" && count > 0) {
        return NextResponse.json({ error: REMOVE_BEFORE_SKIP }, { status: 409 });
      }
    }

    // Idempotent in setReferencesDecision(): repeating a decision does not move its stamp.
    const sunday = await setReferencesDecision(user.wardId, sundayId, decision, supabase);
    if (!sunday) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: auditActionFor(decision),
        module: "talks",
        detail: {
          sundayId,
          date: sunday.date,
          referencesFinalizedAt: sunday.referencesFinalizedAt,
          referencesSkippedAt: sunday.referencesSkippedAt,
        },
      },
      supabase,
    );

    return NextResponse.json({ decision: referencesDecisionOf(sunday) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/sundays/[id]/references-decision",
      fallbackMessage: "Could not save that. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
