import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { writeIssueReport } from "@/lib/issues/writeIssueReport";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createIssueReportSchema } from "@/lib/validation/issueReport";

// POST ONLY. Nothing reads these rows until P12 builds the review screen, and a GET that nobody
// calls is a read path nobody has thought about the policy for.
//
// The session is resolved OUTSIDE the try block, as every route in this app does:
// requireSessionUser() redirects by THROWING an internal Next.js error, and catching that would
// turn a redirect into a 500.
//
// ---------------------------------------------------------------------------
// THERE IS NO assertCan() HERE, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------
// There is no `issues.*` permission and THERE MUST NOT BE ONE. Reporting that something is broken
// is not a ward-configurable privilege — putting it in PERMISSIONS would let
// `wards.settings.role_access` take it away, quite possibly from the role most likely to hit a
// bug, and the ward would never find out because the button would simply not be there.
//
// So RLS is the only boundary (CLAUDE.md rule 2): `issue_reports_insert` requires
// `ward_id = current_ward_id() and reported_by = auth.uid()`, which is what makes it impossible
// to file a report in another ward or in somebody else's name even if this handler forgot.
//
// ---------------------------------------------------------------------------
// `role` AND `calling_id` COME FROM THE SESSION, NEVER FROM THE BODY
// ---------------------------------------------------------------------------
// That is the entire point of the feature: a report carries real context without the person
// re-explaining where they were. A client-supplied role would be a CLAIM rather than a FACT, and
// a report tagged with the wrong calling is worse than one tagged with none. The schema the body
// is parsed with does not even have the fields (lib/validation/issueReport.ts).

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const input = createIssueReportSchema.parse(await readJsonBody(request));

    const report = await writeIssueReport(
      {
        wardId: user.wardId,
        reportedBy: user.id,
        pagePath: input.pagePath,
        body: input.body,
        // From the SESSION. See the header.
        role: user.role,
        callingId: user.callingId,
      },
      supabase,
    );

    // Rule 6. The detail names the page and the calling rather than repeating the body: the body
    // is the person's own words and an audit row is read by people the report was not addressed
    // to, which is the line writeAuditLog's own redaction draws for `note`.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "issue_reported",
        module: "admin",
        detail: {
          issueReportId: report.id,
          pagePath: report.pagePath,
          role: report.role,
          callingId: report.callingId,
        },
      },
      supabase,
    );

    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/issue-reports",
      fallbackMessage: "Could not send your report. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
