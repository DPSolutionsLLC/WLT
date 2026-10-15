import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { toReviewView } from "@/lib/roster/paste/buildRosterDiff";
import { capProblems, hashPaste, runPastePipeline } from "@/lib/roster/paste/pasteRequest";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { pastePreviewSchema } from "@/lib/validation/rosterPaste";

// This route WRITES NOTHING. No insert, no update, no rpc, and deliberately no audit row: a
// preview is not a mutation.

export async function POST(request: Request) {
  // Outside the try. requireSessionUser() redirects by throwing an internal Next.js error, and
  // catching that below would turn a redirect into a 500.
  const user = await requireSessionUser();

  try {
    // The real boundary, checked before the body is read. The members/households policies let
    // any ward member write (roster-a Decision 3), so RLS alone does not make this bishopric-only.
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "roster.import", roleAccess);

    const { text } = pastePreviewSchema.parse(await readJsonBody(request));
    const pipeline = await runPastePipeline(text, user.wardId, supabase);
    const capped = capProblems(pipeline.problems);

    return NextResponse.json({
      pasteHash: hashPaste(text),
      review: toReviewView(pipeline.diff),
      problems: capped.problems,
      problemsTruncated: capped.problemsTruncated,
      ignoredColumns: pipeline.ignoredColumns,
      notSuppliedColumns: pipeline.notSuppliedColumns,
      rowsRead: pipeline.rowsRead,
      rowsWithProblems: pipeline.rowsWithProblems,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/roster/import/preview",
      fallbackMessage: "Could not read that paste. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
