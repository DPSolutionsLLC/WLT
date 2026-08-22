import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { applyRosterImport } from "@/lib/roster/csv/applyImport";
import {
  assertAcceptableFile,
  ImportRequestError,
  isImportRequestError,
  readImportFile,
  readImportFormData,
} from "@/lib/roster/csv/importRequest";
import { capProblems } from "@/lib/roster/csv/limits";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fileHashSchema } from "@/lib/validation/rosterImport";

// Decision 2: the file is uploaded a second time and everything is re-derived from it here. The
// alternative — posting back the rows the preview returned — makes a client-supplied diff the
// thing that gets written, and a tampered confirm payload is a much more expensive problem than
// a second 5MB upload.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "roster.import", roleAccess);

    const { file, mapping, fileHash } = await readImportFormData(request);
    assertAcceptableFile(file);

    if (fileHash === null) {
      throw new ImportRequestError(
        400,
        "Preview the file before importing it.",
      );
    }

    const expectedHash = fileHashSchema.parse(fileHash);

    if (mapping === null) {
      throw new ImportRequestError(
        400,
        "The column mapping is missing. Go back to the mapping step and continue again.",
      );
    }

    const read = await readImportFile(file, mapping);

    // The file was edited between preview and confirm. Importing it anyway would write something
    // the user never saw — the exact failure this whole three-step flow exists to prevent.
    if (read.fileHash !== expectedHash) {
      throw new ImportRequestError(
        400,
        "The file changed since you previewed it. Preview again.",
      );
    }

    const result = await applyRosterImport(
      user.wardId,
      user.id,
      read.normalized,
      read.problems,
      supabase,
    );

    const capped = capProblems(result.problems);

    return NextResponse.json({
      result: { ...result, problems: capped.problems },
      problemsTruncated: capped.problemsTruncated,
    });
  } catch (error) {
    if (isImportRequestError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return respondToRouteError(error, {
      route: "POST /api/roster/import",
      fallbackMessage: "Could not import that file. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
