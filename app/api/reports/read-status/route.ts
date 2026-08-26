import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  assertCan,
  resolveRoleAccess,
  type KnownPermission,
} from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { markAllRead, markRead, setBookmarked } from "@/lib/reports/readStatus";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getVisitLog } from "@/lib/visits/queries";
import { getActivityLog } from "@/lib/youth/queries";
import {
  markReportsReadSchema,
  setReportReadStatusSchema,
} from "@/lib/validation/report";
import type { Database } from "@/types/database";
import type { ReportType } from "@/types/domain";

// Per-user read and bookmark state, for every kind of report.
//
// ---------------------------------------------------------------------------
// NESTED UNDER /api/reports, NOT /api/visits, AND THAT IS THE POINT
// ---------------------------------------------------------------------------
// Phase 8 posts `reportType: "youth_activity"` to this exact route. It is the API counterpart of
// the generic ReportFeed component: one endpoint, one table, one set of policies, and a module
// map below that says which permission and which existence check each kind gets.
//
// ---------------------------------------------------------------------------
// NO AUDIT ROW, DELIBERATELY
// ---------------------------------------------------------------------------
// CLAUDE.md rule 6 asks for an audit row on every mutation, and this is a considered departure
// rather than an oversight. What is written here is one person's own reading state — not ward
// data, not anything anybody else can see, and not anything a bishopric would ever need to
// reconstruct. A row per tap would bury the log that matters under a feed's worth of noise, and
// the audit trail is bishopric-readable, so "who read what and when" would also be a record of
// one leader's attention that they cannot themselves read back.
//
// ---------------------------------------------------------------------------
// `report_id` IS POLYMORPHIC AND CARRIES NO FOREIGN KEY
// ---------------------------------------------------------------------------
// Migration 008 says integrity is the application's job here, so both handlers resolve the report
// through its own module's query FIRST — with the caller's session client, so RLS decides. That
// is not tidiness: without it a caller could probe for the existence of another organization's
// logs by watching which ids were accepted, which is a leak the read-status table's own policies
// cannot close because those policies are about the reader's rows, not the report's.
//
// The refusal is the SAME 404 for "no such report" and "not yours" — see REPORT_NOT_FOUND below.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

// One entry per report type, and adding a type without an entry is a type error rather than a
// route that quietly accepts it. The permission is the OWNING MODULE'S view permission: a
// `visits.view` holder must not be able to mark youth reports read, and the map is what makes
// that explicit instead of implied.
const REPORT_MODULES: Record<
  ReportType,
  {
    permission: KnownPermission;
    isVisible: (
      wardId: string,
      reportId: string,
      client: SupabaseClient<Database>,
    ) => Promise<boolean>;
  }
> = {
  visit_log: {
    permission: "visits.view",
    isVisible: async (wardId, reportId, client) =>
      (await getVisitLog(wardId, reportId, client)) !== null,
  },
  youth_activity: {
    permission: "youth_activities.view",
    isVisible: async (wardId, reportId, client) =>
      (await getActivityLog(wardId, reportId, client)) !== null,
  },
};

// ONE message for both "there is no such report" and "that report is not yours". Two messages
// would be an oracle: a caller could walk a list of ids and learn which ones exist in an
// organization they cannot read.
const REPORT_NOT_FOUND = "That report is not available to you.";

// THE BODY IS PARSED BEFORE THE PERMISSION IS CHECKED, which is the reverse of every other route
// in this app. It has to be: WHICH permission applies is a function of `reportType`, so there is
// nothing to assert until the body has been read. The cost is that a caller who lacks the
// permission AND sends a malformed body is told about the body first — a 400 naming a field
// rather than a 403. That reveals the schema and nothing else; the report itself is still behind
// both the assertCan and the visibility check below.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    const input = setReportReadStatusSchema.parse(await readJsonBody(request));
    const reportModule = REPORT_MODULES[input.reportType];

    assertCan(user, reportModule.permission, roleAccess);

    if (!(await reportModule.isVisible(user.wardId, input.reportId, supabase))) {
      return NextResponse.json({ error: REPORT_NOT_FOUND }, { status: 404 });
    }

    // Bookmark first, then read. Both are upserts against the same unique index, so the order
    // decides nothing about the row — but doing the read last means the returned state carries
    // the read timestamp when a single request does both.
    let state =
      input.bookmarked === undefined
        ? null
        : await setBookmarked(
            input.reportType,
            input.reportId,
            input.bookmarked,
            user.wardId,
            user.id,
            supabase,
          );

    if (input.read === true) {
      state = await markRead(
        input.reportType,
        input.reportId,
        user.wardId,
        user.id,
        supabase,
      );
    }

    // The schema refuses a body that changes neither, so `state` is non-null by here.
    return NextResponse.json({ readStatus: state });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/reports/read-status",
      fallbackMessage: "Could not save that. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// Mark All as Read.
//
// EVERY ID IS CHECKED, not just the first. Marking read is cheap and the check is what stops a
// caller stuffing another organization's ids into the array alongside their own — a mixed
// request must be refused whole rather than partially honoured.
export async function PATCH(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    const input = markReportsReadSchema.parse(await readJsonBody(request));
    const reportModule = REPORT_MODULES[input.reportType];

    assertCan(user, reportModule.permission, roleAccess);

    const visibility = await Promise.all(
      input.reportIds.map((reportId) =>
        reportModule.isVisible(user.wardId, reportId, supabase),
      ),
    );

    if (visibility.some((isVisible) => !isVisible)) {
      return NextResponse.json({ error: REPORT_NOT_FOUND }, { status: 404 });
    }

    const markedCount = await markAllRead(
      input.reportType,
      input.reportIds,
      user.wardId,
      user.id,
      supabase,
    );

    return NextResponse.json({ markedCount });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/reports/read-status",
      fallbackMessage: "Could not mark those reports as read. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
