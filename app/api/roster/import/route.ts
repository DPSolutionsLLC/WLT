import { NextResponse } from "next/server";
import { ForbiddenError, InvalidInputError } from "@/lib/auth/errors";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { canManageMemberLinks } from "@/lib/callings/linkAccess";
import { applyRosterPaste } from "@/lib/roster/paste/applyRosterPaste";
import { isCallingReviewId } from "@/lib/roster/paste/callingRows";
import { applyPasteCallings } from "@/lib/roster/paste/pasteCallings";
import { hashPaste, runPastePipeline } from "@/lib/roster/paste/pasteRequest";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { pasteApplySchema } from "@/lib/validation/rosterPaste";

// The paste is posted a second time and the checklist is RECOMPUTED here against the current
// roster. Only the ticked ids come from the client, so a tampered payload can untick things and
// nothing else.
//
// CALLINGS NEED MORE THAN `roster.import` (ITER-058 cr3). A ticked calling id from somebody who
// fails canManageMemberLinks() refuses the whole request before anything is written; the checklist
// never offers them one. The roster lands first, then the callings recompute from what it stored.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "roster.import", roleAccess);

    const { text, pasteHash, selectedIds } = pasteApplySchema.parse(await readJsonBody(request));

    const callingIds = selectedIds.filter(isCallingReviewId);
    if (callingIds.length > 0 && !canManageMemberLinks(user, roleAccess)) {
      throw new ForbiddenError("admin.manage_users");
    }

    if (hashPaste(text) !== pasteHash) {
      throw new InvalidInputError(
        "The pasted list changed since you reviewed it. Review it again.",
      );
    }

    const pipeline = await runPastePipeline(text, user.wardId, supabase);

    const result = await applyRosterPaste(
      {
        wardId: user.wardId,
        userId: user.id,
        diff: pipeline.diff,
        selectedIds: new Set(selectedIds),
        rowsRead: pipeline.rowsRead,
        problemCount: pipeline.problems.length,
      },
      supabase,
    );

    const callings = await applyPasteCallings(
      { actor: user, selectedIds: callingIds },
      createServiceSupabaseClient(),
    );

    return NextResponse.json({ result: { ...result, ...callings } });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/roster/import",
      fallbackMessage: "Could not apply those changes. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
