import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { buildImportPreview } from "@/lib/roster/csv/buildImportPreview";
import {
  assertAcceptableFile,
  isImportRequestError,
  readImportFile,
  readImportFormData,
} from "@/lib/roster/csv/importRequest";
import { capProblems } from "@/lib/roster/csv/limits";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// This route WRITES NOTHING. No insert, no update, no rpc, and deliberately no audit row: a
// preview is not a mutation, and a route with no write path at all is a guarantee that can be
// read off the imports rather than re-argued every time it changes.

export async function POST(request: Request) {
  // Outside the try. requireSessionUser() redirects by throwing an internal Next.js error, and
  // catching that below would turn a redirect into a 500.
  const user = await requireSessionUser();

  try {
    // The real boundary. Migration 019's ward-scoped policy loop would happily let an org
    // secretary insert members (roster-a Decision 3), so RLS alone does not make this bishopric
    // only — this line does.
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "roster.import", roleAccess);

    const { file, mapping } = await readImportFormData(request);
    assertAcceptableFile(file);

    const read = await readImportFile(file, mapping);

    const preview = await buildImportPreview(
      user.wardId,
      read.normalized,
      read.fileHash,
      read.problems,
      supabase,
    );

    const capped = capProblems(preview.problems);

    return NextResponse.json({
      preview: { ...preview, problems: capped.problems },
      problemsTruncated: capped.problemsTruncated,
      headers: read.headers,
      mapping: read.mapping,
      sampleRow: read.sampleRow,
      totalFileRows: read.totalFileRows,
    });
  } catch (error) {
    if (isImportRequestError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return respondToRouteError(error, {
      route: "POST /api/roster/import/preview",
      fallbackMessage: "Could not read that file. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
