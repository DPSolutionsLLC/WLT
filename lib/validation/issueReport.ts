import { z } from "zod";
import { ROLES } from "@/types/domain";

// No wardId, no reportedBy, no role and no callingId — every one of those comes from the SESSION
// (conventions.md §Validation, and it is the whole point of this feature). A body that could name
// the role would make the tag a CLAIM rather than a FACT, and the fact is what saves somebody
// re-explaining where they were a day later.
//
// `role` IS in the schema below anyway, in a second schema used at the boundary between the route
// and the writer — not parsed from the request. Keeping the two apart is what makes it impossible
// for a body-supplied role to reach the column by accident.

export const createIssueReportSchema = z.object({
  // A REPORT WITH NO WORDS IS NOT A REPORT. The column is NOT NULL besides (migration 076a), so
  // this refuses at the boundary with a sentence rather than as a constraint violation nobody can
  // act on — the same argument `access_requests.reason` carries.
  body: z
    .string()
    .trim()
    .min(1, "Say what went wrong — a sentence is enough.")
    .max(2000, "That is longer than it needs to be — keep it under 2000 characters."),

  // WHERE THEY WERE. Supplied by the client because only the client knows which page the modal
  // was opened from; it is a fact about the browser, not about the session. Constrained to a
  // path so it cannot become a URL pointing somewhere else entirely.
  pagePath: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .startsWith("/", "A page path starts with a slash.")
    // Rejects "//evil.example.com", which a browser resolves as a protocol-relative URL.
    .refine((value) => !value.startsWith("//"), "That is not a page in this app."),
});
export type CreateIssueReportInput = z.infer<typeof createIssueReportSchema>;

// The route's own hand-off to lib/issues/writeIssueReport.ts. `role` is validated against the
// REAL constant rather than against a CHECK in the database, which would be another copy of a
// list that grows every phase (`notification-trigger-drift`, and migration 076a says so).
export const issueReportRowSchema = createIssueReportSchema.extend({
  role: z.enum(ROLES),
  callingId: z.uuid().nullable(),
});
export type IssueReportRow = z.infer<typeof issueReportRowSchema>;
