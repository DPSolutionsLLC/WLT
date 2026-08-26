import { z } from "zod";
import { REPORT_TYPES } from "@/types/domain";

// The return-and-report feed's boundary schemas.
//
// MODULE-AGNOSTIC, like the route they validate. Phase 8 posts `reportType: "youth_activity"` to
// the same endpoint and adds nothing here.
//
// No wardId and no userId on any schema, ever. Both come from the session (conventions.md
// §Validation). A request that could name its own user could mark a report read on somebody
// else's behalf — or, worse, read that it had been.

export const DEFAULT_FEED_PAGE_SIZE = 25;
export const MAX_FEED_PAGE_SIZE = 100;

// The ceiling on one Mark All as Read. The client sends the ids of the unread tiles it has
// loaded, so this bounds a request rather than the feature: a reader who has scrolled past 500
// unread reports marks them in two taps instead of one.
export const MAX_MARK_ALL_REPORTS = 500;

export const TOO_MANY_REPORTS_MESSAGE =
  `Mark at most ${MAX_MARK_ALL_REPORTS} reports as read at once. ` +
  "Scroll back, mark what is loaded, then carry on.";

// An ENUM, not a string. An unknown value is a 400 from here with a sentence attached, rather
// than a row migration 008's CHECK constraint rejects at the database — which surfaces as a 500
// reporting the server's own fault for the caller's bad input.
const reportTypeSchema = z.enum(REPORT_TYPES);

const reportIdSchema = z.uuid("That report is not valid.");

// ---------------------------------------------------------------------------
// `read` AND `bookmarked` ARE INDEPENDENT
// ---------------------------------------------------------------------------
// Both are optional and at least one is required. They are separate columns and separate
// decisions: bookmarking a report you have not opened is a real thing to want, and so is opening
// one you never bookmark. Collapsing them into a single "state" field would make the pair
// unrepresentable.
//
// `read` accepts only `true`. There is no un-read: the row records WHEN it was read, and a
// request to make that untrue is a request to falsify a timestamp. Bookmarks toggle both ways.
export const setReportReadStatusSchema = z
  .object({
    reportType: reportTypeSchema,
    reportId: reportIdSchema,
    read: z.literal(true).optional(),
    bookmarked: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (value.read === undefined && value.bookmarked === undefined) {
      context.addIssue({ code: "custom", message: "Nothing was changed." });
    }
  });
export type SetReportReadStatusInput = z.infer<typeof setReportReadStatusSchema>;

export const markReportsReadSchema = z.object({
  reportType: reportTypeSchema,
  reportIds: z
    .array(reportIdSchema)
    .min(1, "Name at least one report.")
    .max(MAX_MARK_ALL_REPORTS, TOO_MANY_REPORTS_MESSAGE),
});
export type MarkReportsReadInput = z.infer<typeof markReportsReadSchema>;

// ---------------------------------------------------------------------------
// The feed cursor
// ---------------------------------------------------------------------------
// `visitDate|createdAt`, opaque to the client. Both halves are needed because the feed is ordered
// on two columns: several visits share a date, and a cursor holding the date alone would either
// repeat them on the next page or skip them.
//
// Parsed here rather than trusted: it arrives in a query string, and a malformed one must be a
// sentence rather than a PostgREST filter built from whatever was in the URL.
const CURSOR_SEPARATOR = "|";

export const REPORT_FEED_CURSOR_MESSAGE = "That page marker is not valid. Reload the feed.";

export type ReportFeedCursor = {
  occurredOn: string;
  createdAt: string;
};

export function encodeReportFeedCursor(cursor: ReportFeedCursor): string {
  return `${cursor.occurredOn}${CURSOR_SEPARATOR}${cursor.createdAt}`;
}

export function decodeReportFeedCursor(raw: string): ReportFeedCursor | null {
  const [occurredOn, createdAt] = raw.split(CURSOR_SEPARATOR);

  if (occurredOn === undefined || createdAt === undefined) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return null;
  if (Number.isNaN(Date.parse(createdAt))) return null;

  return { occurredOn, createdAt };
}

// Parsed with EXACTLY the names components/visits/ReportFeed.tsx sends, checked against that file
// rather than assumed. A parameter this schema does not carry gets no error, just a filter that is
// silently ignored (plans/retros/roster-b-picker-and-orgs.md).
export const reportFeedQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int("Give the page size as a whole number.")
    .min(1, "A page holds at least one report.")
    .max(MAX_FEED_PAGE_SIZE, `Keep the page size to ${MAX_FEED_PAGE_SIZE} reports.`)
    .default(DEFAULT_FEED_PAGE_SIZE),
  before: z
    .string()
    .refine((value) => decodeReportFeedCursor(value) !== null, REPORT_FEED_CURSOR_MESSAGE)
    .optional(),
  // Which context the reader has filtered to — an organization for visits. A DISPLAY PREFERENCE,
  // never a permission: RLS has already decided which reports exist for this caller, so naming an
  // organization they cannot read returns an empty page rather than a 403. Absent means "all".
  context: z.uuid("That organization is not valid.").optional(),
});
export type ReportFeedQuery = z.infer<typeof reportFeedQuerySchema>;
