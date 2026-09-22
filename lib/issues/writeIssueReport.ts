import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import type { IssueReport } from "@/types/domain";
import type { IssueReportRow } from "@/lib/validation/issueReport";

// The one write to `issue_reports`. Nothing reads the table yet — P12 owns the review screen —
// so this module is deliberately one function and will gain its reads there rather than growing
// a speculative query nobody calls.
//
// EVERY FIELD EXCEPT `body` AND `pagePath` COMES FROM THE SESSION, and the caller is what proves
// it: the route resolves `wardId`, `userId`, `role` and `callingId` from SessionUser and hands
// them in as separate arguments from the parsed body. Putting them in one object with the body
// would be one careless spread away from a client-supplied role.
//
// ---------------------------------------------------------------------------
// ⚠️ IT DOES NOT READ THE ROW BACK, AND IT MUST NOT START TO
// ---------------------------------------------------------------------------
// `.insert(...).select(...)` is the idiom everywhere else in this codebase and it is WRONG here.
// PostgreSQL applies the SELECT policy to a RETURNING clause, so an insert that RETURNS a row the
// author may not read raises SQLSTATE 42501 — reported, confusingly, as "new row violates
// row-level security policy", which reads as the INSERT having been refused when it was not.
//
// And the author may not read it. `issue_reports_select` is the ward's ADMINS (migration 076b),
// deliberately: a report is typed freely and may name a household or a colleague. An ordinary
// leader filing one is the ENTIRE POINT of the feature, so reading it back would have failed for
// exactly the people it is for — and only ever in production, since a bishop testing it would
// have sailed through.
//
// Adding `reported_by = auth.uid()` to the SELECT policy is NOT the fix: that column is nullable
// so `on delete set null` can fire, and a nullable author column in a policy predicate is the
// `talks-d` hole, which migration 076a names as its seventh sighting.
//
// So the id is generated HERE and the row is written with it. The caller gets a complete object
// without a read, which is what lets the audit row name the report (rule 6).
//
// snake_case at the boundary, camelCase above it, mapped ONCE, here (CLAUDE.md §6).

export type WriteIssueReportParams = IssueReportRow & {
  wardId: string;
  reportedBy: string;
};

export async function writeIssueReport(
  params: WriteIssueReportParams,
  client?: SupabaseClient<Database>,
): Promise<IssueReport> {
  const supabase = client ?? (await createServerSupabaseClient());

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const { error } = await supabase.from("issue_reports").insert({
    id,
    ward_id: params.wardId,
    reported_by: params.reportedBy,
    page_path: params.pagePath,
    role: params.role,
    calling_id: params.callingId,
    body: params.body,
    created_at: createdAt,
  });

  if (error) {
    // NEVER SWALLOWED (CLAUDE.md rule 7). A report that silently vanished is worse than no
    // button at all: the person believes it was filed, and the defect they found is lost.
    console.error(`Could not write the issue report — ${error.message}`);
    throw new Error(`Could not send your report: ${error.message}`);
  }

  return {
    id,
    wardId: params.wardId,
    reportedBy: params.reportedBy,
    pagePath: params.pagePath,
    role: params.role,
    callingId: params.callingId,
    body: params.body,
    createdAt,
  };
}
