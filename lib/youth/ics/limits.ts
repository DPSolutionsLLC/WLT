// Every cap the ICS import enforces, in one module so the route and the wizard's copy cannot
// drift. A wizard promising "up to 500 events" while the route refuses at 200 is a bug report
// nobody can reproduce.
//
// ---------------------------------------------------------------------------
// A DELIBERATE TWIN OF lib/roster/csv/limits.ts, NOT AN IMPORT FROM IT
// ---------------------------------------------------------------------------
// `capProblems`, `hasAcceptedExtension` and `formatFileSizeLimit` exist there in a roster-typed
// form. This is their SECOND user. The repo's stated rule (plans/INDEX.md, on
// lib/visits/cadence.ts) is to lift a shared helper on the THIRD user, not the second — two
// concrete copies teach you what the general one has to be, and a premature abstraction that
// fits neither caller is harder to remove than a duplicate.
//
// So the duplication here is on purpose. When a third import flow appears, `capProblems` is the
// one to lift first: it is genuinely generic already.

export const MAX_ICS_FILE_BYTES = 1024 * 1024;

// AFTER EXPANSION, across the whole file. A season is a few dozen games; 500 covers a school
// exporting its entire athletics calendar by accident and still fits in one preview screen.
export const MAX_ICS_EVENTS = 500;

// 08-youth-activities.md §Step 2. A recurring practice is expanded this far ahead of the import
// and no further — an RRULE with no UNTIL is infinite, and a calendar is not a promise about
// 2085.
export const RECURRENCE_HORIZON_MONTHS = 12;

// SEPARATE FROM MAX_ICS_EVENTS ON PURPOSE. This is the hard stop INSIDE the expander, and it is
// what makes a single unbounded RRULE terminate before the whole-file total is even reachable.
// One cap could not do both jobs: a file of 400 one-off games would exhaust the total and leave
// nothing to protect the 401st series from looping.
export const MAX_OCCURRENCES_PER_SERIES = 400;

export const MAX_REPORTED_PROBLEMS = 100;

// The empty string is accepted because browsers frequently send NOTHING at all for a .ics, and
// Windows commonly reports application/octet-stream. MIME is a hint; the extension is checked too
// and the parse is what actually decides.
export const ACCEPTED_MIME_TYPES = [
  "text/calendar",
  "application/octet-stream",
  "text/plain",
  "",
] as const;

export const ACCEPTED_FILE_EXTENSIONS = [".ics", ".ical", ".ifb"] as const;

export function formatFileSizeLimit(): string {
  return `${MAX_ICS_FILE_BYTES / (1024 * 1024)}MB`;
}

export function hasAcceptedExtension(fileName: string): boolean {
  const lowered = fileName.toLowerCase();
  return ACCEPTED_FILE_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}

// Returns the count it dropped as well as the list. A silent cap reads as "only 100 things were
// wrong with your file", which is a worse lie than the long list would have been.
export function capProblems<Problem>(
  problems: readonly Problem[],
): { problems: Problem[]; problemsTruncated: number } {
  return {
    problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
    problemsTruncated: Math.max(0, problems.length - MAX_REPORTED_PROBLEMS),
  };
}
