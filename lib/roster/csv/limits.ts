// One module so the route enforcement and the UI copy cannot drift. A wizard that promises
// "up to 2000 rows" while the route refuses at 1000 is a bug report nobody can reproduce.

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

// Decision 4: Windows-1252 decoded as UTF-8 does not throw, it yields U+FFFD. A handful can
// come from a stray byte in a comment column; more than this means the whole file is in the
// wrong encoding and every accented name in it is already corrupted.
export const MAX_REPLACEMENT_CHARACTERS = 5;

// Windows reports a .csv as application/vnd.ms-excel and some browsers send text/plain, so
// refusing either would refuse a perfectly good export. MIME is never trustworthy on its own —
// the extension is checked too, and the real guard is that the parse produces no mappable
// header for anything that is not delimited text.
export const ACCEPTED_MIME_TYPES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/csv",
  "text/plain",
] as const;

export const ACCEPTED_FILE_EXTENSIONS = [".csv", ".txt"] as const;

// The problems array is capped before it is sent. A file where every row fails would otherwise
// return a 40,000-entry payload that no browser renders and no user reads.
export const MAX_REPORTED_PROBLEMS = 200;

export function formatFileSizeLimit(): string {
  return `${MAX_IMPORT_FILE_BYTES / (1024 * 1024)}MB`;
}

// Returns the count it dropped as well as the list. A silent cap reads as "only 200 things were
// wrong with your file", which is a worse lie than the long list would have been.
export function capProblems<Problem>(
  problems: readonly Problem[],
): { problems: Problem[]; problemsTruncated: number } {
  return {
    problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
    problemsTruncated: Math.max(0, problems.length - MAX_REPORTED_PROBLEMS),
  };
}

export function hasAcceptedExtension(fileName: string): boolean {
  const lowered = fileName.toLowerCase();
  return ACCEPTED_FILE_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}
