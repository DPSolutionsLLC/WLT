import { NextResponse } from "next/server";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { readVisitReportFeed } from "@/lib/visits/reportFeed";
import { decodeReportFeedCursor, reportFeedQuerySchema } from "@/lib/validation/report";

// The visits return-and-report feed.
//
// NO AUDIT ROW. This is a read, and CLAUDE.md rule 6 asks for one on every mutation.
//
// THIS FILE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT — see the header of
// app/api/visits/route.ts. The response is built from ReportTile, whose `previewText` comes from
// shared notes alone and which has no field a private note could occupy. tests/routes for this
// feed assert on the serialized body, so a future widening is caught even if the types changed to
// allow it.
//
// RLS DECIDES THE SCOPE, which is exactly where cross-org visibility takes effect: with the ward
// setting on, visit_logs_select (migration 019) ORs the other organizations in and this handler
// needs no branch of its own. Re-implementing the rule here would give the app two answers to
// "whose reports are these?" and only one of them would be the one that is enforced.
//
// The route is VISITS-SPECIFIC on purpose, unlike /api/reports/read-status. The tiles come from
// visit logs and are mapped by lib/visits/reportTiles.ts; Phase 8 adds its own GET beside this one
// and reuses the read-status route and the component.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;

    // Read here EXACTLY as components/visits/ReportFeed.tsx sends it. A name this handler does
    // not read gets no error, just a silently ignored parameter
    // (plans/retros/roster-b-picker-and-orgs.md).
    const query = reportFeedQuerySchema.parse({
      limit: searchParams.get("limit") ?? undefined,
      before: searchParams.get("before") ?? undefined,
      context: searchParams.get("context") ?? undefined,
    });

    // Non-null by here: the schema refuses a cursor this cannot decode.
    const before = query.before === undefined ? null : decodeReportFeedCursor(query.before);

    const page = await readVisitReportFeed(user.wardId, query, before, supabase);

    return NextResponse.json(page);
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/visits/feed",
      fallbackMessage: "Could not load the report feed. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
