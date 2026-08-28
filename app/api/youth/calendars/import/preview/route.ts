import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readWardTimezone } from "@/lib/ward/wardTimezone";
import { buildImportPreview } from "@/lib/youth/ics/buildImportPreview";
import {
  assertAcceptableIcsFile,
  isIcsImportError,
  readIcsFile,
  readIcsFormData,
} from "@/lib/youth/ics/importRequest";
import { capProblems } from "@/lib/youth/ics/limits";
import { getActivityProfile, getIcsCalendarForProfile, listActivityEvents } from "@/lib/youth/queries";

// This route WRITES NOTHING. No insert, no update, no rpc, and deliberately no audit row: a
// preview is not a mutation, and a route with no write path at all is a guarantee that can be
// read off the imports rather than re-argued every time it changes. The same sentence stands at
// the top of app/api/roster/import/preview/route.ts, and for the same reason.
//
// THE IMPORT IS OFFERED AGAINST EVERY PROFILE IN THE WARD (Decision 4). `activity_calendars` and
// `activity_events` both keep migration 019's ward-wide write policies, so anybody holding
// `youth_activities.manage` in this ward may genuinely import against any activity — an event
// inherits its organization through its profile. Narrowing this here would hide a control the API
// allows, which is the mirror of defect youth-a-D1. Narrowing it properly means a migration first.

export async function POST(request: Request) {
  // Outside the try. requireSessionUser() redirects by throwing an internal Next.js error, and
  // catching that below would turn a redirect into a 500.
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // `.view` is not enough. Reading the ward's schedule and writing thirty rows into it are
    // different things, and `org_secretary` holds the first and not the second.
    assertCan(user, "youth_activities.manage", roleAccess);

    const { file, profileId } = await readIcsFormData(request);
    assertAcceptableIcsFile(file);

    // Resolved through the caller's own client, so a profile in another ward simply is not there.
    // Matches POST /api/youth/events word for word, so the two answers cannot drift.
    const profile = await getActivityProfile(user.wardId, profileId, supabase);

    if (!profile) {
      return NextResponse.json({ error: "That activity is not in your ward." }, { status: 404 });
    }

    // ONE INSTANT for the whole request, handed to the parser and used for nothing else. The
    // recurrence horizon is measured from it, so a long request cannot expand a series against
    // two different "now"s.
    const asOf = new Date();
    const wardTimeZone = await readWardTimezone(user.wardId, supabase);

    const read = await readIcsFile(file, { asOf, wardTimeZone });

    const calendar = await getIcsCalendarForProfile(user.wardId, profileId, supabase);

    // `includePast: true` deliberately. The diff's window is the file's own span, which routinely
    // starts before today — a season half over is the ordinary case for a re-import, and the
    // default upcoming-only filter would make every past game look absent from the file.
    const existingEvents =
      calendar === null
        ? []
        : await listActivityEvents(
            user.wardId,
            { calendarId: calendar.id, includePast: true, asOf },
            supabase,
          );

    const preview = buildImportPreview({
      occurrences: read.occurrences,
      problems: read.problems,
      occurrencesDropped: read.occurrencesDropped,
      existingEvents,
      wardTimeZone,
      fileHash: read.fileHash,
      calendarExists: calendar !== null,
      lastSyncedAt: calendar?.lastSyncedAt ?? null,
    });

    const capped = capProblems(preview.problems);

    return NextResponse.json({
      preview: { ...preview, problems: capped.problems },
      problemsTruncated: capped.problemsTruncated,
      profileId,
    });
  } catch (error) {
    if (isIcsImportError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return respondToRouteError(error, {
      route: "POST /api/youth/calendars/import/preview",
      fallbackMessage: "Could not read that calendar file. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
