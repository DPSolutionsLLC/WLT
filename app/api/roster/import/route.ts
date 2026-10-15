import { NextResponse } from "next/server";
import { InvalidInputError } from "@/lib/auth/errors";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { applyRosterPaste } from "@/lib/roster/paste/applyRosterPaste";
import { hashPaste, runPastePipeline } from "@/lib/roster/paste/pasteRequest";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { pasteApplySchema } from "@/lib/validation/rosterPaste";

// The paste is posted a second time and the checklist is RECOMPUTED here against the current
// roster. Only the ticked ids come from the client, so a tampered payload can untick things and
// nothing else.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "roster.import", roleAccess);

    const { text, pasteHash, selectedIds } = pasteApplySchema.parse(await readJsonBody(request));

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

    return NextResponse.json({ result });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/roster/import",
      fallbackMessage: "Could not apply those changes. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
