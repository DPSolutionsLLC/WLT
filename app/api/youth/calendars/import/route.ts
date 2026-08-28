import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fileHashSchema } from "@/lib/validation/youthImport";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import { applyIcsImport } from "@/lib/youth/ics/applyImport";
import {
  assertAcceptableIcsFile,
  IcsImportError,
  isIcsImportError,
  readIcsFile,
  readIcsFormData,
} from "@/lib/youth/ics/importRequest";
import { capProblems } from "@/lib/youth/ics/limits";
import { getActivityProfile, getIcsCalendarForProfile, listActivityEvents } from "@/lib/youth/queries";

// THE FILE IS UPLOADED A SECOND TIME AND EVERYTHING IS RE-DERIVED FROM IT HERE.
//
// The alternative — posting back the events the preview returned — makes a client-supplied diff
// the thing that gets written, and a tampered confirm payload is a far more expensive problem
// than a second 1MB upload. app/api/roster/import/route.ts carries this reasoning verbatim.
//
// NO NOTIFICATION IS EMITTED. 08-youth-activities.md lists `youth_activity_added` against the
// PROFILE, and slice A already chose no notification per event because a season has twenty of
// them. An import has more. One audit row carrying the counts, and nothing sent.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    const { file, profileId, fileHash } = await readIcsFormData(request);
    assertAcceptableIcsFile(file);

    if (fileHash === null) {
      throw new IcsImportError(400, "Preview the file before importing it.");
    }

    const expectedHash = fileHashSchema.parse(fileHash);

    const profile = await getActivityProfile(user.wardId, profileId, supabase);

    if (!profile) {
      return NextResponse.json({ error: "That activity is not in your ward." }, { status: 404 });
    }

    const asOf = new Date();
    const wardTimeZone = await readWardTimezone(user.wardId, supabase);

    const read = await readIcsFile(file, { asOf, wardTimeZone });

    // The file was edited between preview and confirm. Importing it anyway would write something
    // the user never saw — the exact failure the two-step flow exists to prevent. The sentence is
    // worded identically to the wizard's own copy of it, so the user reads one sentence whichever
    // side catches it.
    if (read.fileHash !== expectedHash) {
      throw new IcsImportError(400, "The file changed since you previewed it. Preview again.");
    }

    const calendar = await getIcsCalendarForProfile(user.wardId, profileId, supabase);

    const existingEvents =
      calendar === null
        ? []
        : await listActivityEvents(
            user.wardId,
            { calendarId: calendar.id, includePast: true, asOf },
            supabase,
          );

    const { result } = await applyIcsImport(
      {
        wardId: user.wardId,
        profileId,
        calendar,
        syncedAt: asOf,
        occurrences: read.occurrences,
        problems: read.problems,
        occurrencesDropped: read.occurrencesDropped,
        existingEvents,
        wardTimeZone,
        fileHash: read.fileHash,
      },
      supabase,
    );

    // COUNTS, NOT THE EVENTS THEMSELVES. An audit row is a record that something happened and by
    // whom, not a payload dump — a hundred game titles in a jsonb column is a copy of the data
    // that will disagree with the table the first time somebody edits a row.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_calendar_imported",
        module: "youth_activities",
        detail: {
          profileId,
          orgId: profile.orgId,
          calendarId: result.calendarId,
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          notInFile: result.notInFile.length,
          problems: result.problems.length,
        },
      },
      supabase,
    );

    const capped = capProblems(result.problems);

    return NextResponse.json(
      {
        result: { ...result, problems: capped.problems },
        problemsTruncated: capped.problemsTruncated,
      },
      { status: 201 },
    );
  } catch (error) {
    if (isIcsImportError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return respondToRouteError(error, {
      route: "POST /api/youth/calendars/import",
      fallbackMessage: "Could not import that calendar file. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
