import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { referencesDecisionOf } from "@/lib/calendar/queries";
import { unfinalizeReferencesIfNeeded } from "@/lib/references/finalize";
import { getReference, loadSundayTalks, removeReference } from "@/lib/references/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// REMOVING A REFERENCE — p4-sacrament-c.
//
// The reference must belong to a talk on THE SUNDAY IN THE URL. Deleting through another
// Sunday's URL would reopen the wrong Sunday's decision, so it answers 404 exactly as a
// reference in another ward does — both mean "not here".
//
// A removal reopens a FINALIZED Sunday and leaves a SKIP standing (lib/references/finalize.ts).

const idSchema = z.uuid("That id is not valid.");

const NOT_FOUND = "That reference is not on this Sunday.";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; referenceId: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.plan", roleAccess);

    const { id, referenceId: rawReferenceId } = await params;
    const sundayId = idSchema.parse(id);
    const referenceId = idSchema.parse(rawReferenceId);

    const [loaded, reference] = await Promise.all([
      loadSundayTalks(user.wardId, sundayId, supabase),
      getReference(user.wardId, referenceId, supabase),
    ]);

    const isOnThisSunday =
      loaded !== null &&
      reference !== null &&
      loaded.assignments.some((assignment) => assignment.id === reference.assignmentId);

    if (!loaded || !reference || !isOnThisSunday) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // Zero rows is not found OR refused — a denied DELETE is a quiet success, never an error.
    const removed = await removeReference(user.wardId, referenceId, supabase);
    if (!removed) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    const sunday =
      (await unfinalizeReferencesIfNeeded(
        user.wardId,
        sundayId,
        { clearSkip: false },
        supabase,
      )) ?? loaded.sunday;

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "talk_reference_removed",
        module: "talks",
        detail: {
          sundayId,
          assignmentId: removed.assignmentId,
          referenceId,
          kind: reference.kind,
          source: reference.source,
        },
      },
      supabase,
    );

    return NextResponse.json({ decision: referencesDecisionOf(sunday) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/sundays/[id]/references/[referenceId]",
      fallbackMessage: "Could not remove that reference. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
