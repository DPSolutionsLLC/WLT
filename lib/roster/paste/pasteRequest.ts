import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidInputError } from "@/lib/auth/errors";
import { formatDateOnly } from "@/lib/calendar/dates";
import { buildRosterDiff, type RosterDiff } from "@/lib/roster/paste/buildRosterDiff";
import { loadRosterForDiff } from "@/lib/roster/paste/loadRosterForDiff";
import { normalizeReportRows, type ImportProblem } from "@/lib/roster/paste/normalizeReportRow";
import { parsePastedReport } from "@/lib/roster/paste/parsePastedReport";
import {
  columnsNotSupplied,
  describeDuplicateColumns,
  describeMissingColumns,
  matchReportColumns,
} from "@/lib/roster/paste/reportColumns";
import type { Database } from "@/types/database";

// The parse → normalize → diff pipeline, shared by the preview route and the apply route so the two
// halves cannot disagree about what a paste contains. Server-only: node:crypto.

export const MAX_REPORTED_PROBLEMS = 200;

export type PastePipelineResult = {
  diff: RosterDiff;
  problems: ImportProblem[];
  ignoredColumns: string[];
  notSuppliedColumns: string[];
  rowsRead: number;
  rowsWithProblems: number;
};

export function hashPaste(text: string): string {
  return createHash("sha256").update(text.replace(/\r/g, ""), "utf8").digest("hex");
}

// Returns the count it dropped too. A silent cap reads as "only 200 things were wrong".
export function capProblems(problems: readonly ImportProblem[]): {
  problems: ImportProblem[];
  problemsTruncated: number;
} {
  return {
    problems: problems.slice(0, MAX_REPORTED_PROBLEMS),
    problemsTruncated: Math.max(0, problems.length - MAX_REPORTED_PROBLEMS),
  };
}

export async function runPastePipeline(
  text: string,
  wardId: string,
  client: SupabaseClient<Database>,
  asOf: string = formatDateOnly(new Date()),
): Promise<PastePipelineResult> {
  const parsed = parsePastedReport(text);
  if (parsed.error !== null) throw new InvalidInputError(parsed.error);

  const columns = matchReportColumns(parsed.headers);
  const blocking = [
    ...describeMissingColumns(columns.missing),
    ...describeDuplicateColumns(columns.duplicates),
  ];
  if (blocking.length > 0) throw new InvalidInputError(blocking.join(" "));

  const normalized = normalizeReportRows(parsed, columns.columnIndex, asOf);
  const snapshot = await loadRosterForDiff(wardId, client);
  const diff = buildRosterDiff(snapshot, normalized.people);

  const problems = [...parsed.problems, ...normalized.problems, ...diff.problems].sort(
    (left, right) => left.rowNumber - right.rowNumber,
  );

  return {
    diff,
    problems,
    ignoredColumns: columns.ignored,
    notSuppliedColumns: columnsNotSupplied(columns.columnIndex),
    rowsRead: parsed.rows.length + parsed.problems.length,
    rowsWithProblems: new Set(problems.map((problem) => problem.rowNumber)).size,
  };
}
