import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { decodeReportFeedCursor, reportFeedQuerySchema } from "@/lib/validation/report";
import { readYouthReportFeed } from "@/lib/youth/reportFeed";

// The youth activity return-and-report feed.
//
// NO AUDIT ROW. This is a read, and CLAUDE.md rule 6 asks for one on every mutation.
//
// THIS FILE DOES NOT IMPORT lib/youth/privateNotes.ts, AND MUST NOT. The response is built from
// ReportTile, whose `previewText` comes from shared notes alone and which has no field a private
// note could occupy. tests/routes/youthPrivateNote.test.ts asserts on this handler's SERIALIZED
// BODY, so a future widening is caught even if the types changed to allow it (CLAUDE.md rule 5).
//
// RLS DECIDES THE SCOPE, which is exactly where cross-org visibility takes effect: with the ward
// setting on, migration 057c's `activity_logs_select` ORs the other organizations in and this
// handler needs no branch of its own. Re-implementing the rule here would give the app two answers
// to "whose follow-ups are these?" and only one of them would be the one that is enforced.
//
// The route is YOUTH-SPECIFIC on purpose, unlike /api/reports/read-status. The tiles come from
// activity logs and are mapped by lib/youth/reportTiles.ts; the read-status route and the
// ReportFeed component are the shared halves, and this is the second module to reuse them rather
// than the first to fork one.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;

    // Read here EXACTLY as components/visits/ReportFeed.tsx sends it — `before`, `context` and
    // `limit`, checked against that file rather than assumed. A name this handler does not read
    // gets no error, just a silently ignored parameter
    // (plans/retros/roster-b-picker-and-orgs.md).
    const query = reportFeedQuerySchema.parse({
      limit: searchParams.get("limit") ?? undefined,
      before: searchParams.get("before") ?? undefined,
      context: searchParams.get("context") ?? undefined,
    });

    // Non-null by here: the schema refuses a cursor this cannot decode.
    //
    // ONLY THE `createdAt` HALF IS USED. This feed pages on the LOG's creation instant, not on the
    // event's date — lib/youth/reportFeed.ts's header argues why, and the `occurredOn` half of the
    // shared cursor carries the same instant reduced to a date so the shared decoder still
    // validates it.
    const cursor = query.before === undefined ? null : decodeReportFeedCursor(query.before);
    const before = cursor === null ? null : { createdAt: cursor.createdAt };

    const page = await readYouthReportFeed(user.wardId, query, before, supabase);

    return NextResponse.json(page);
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/youth/feed",
      fallbackMessage: "Could not load the follow-up feed. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
