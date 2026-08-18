import { Card } from "@/components/ui/Card";
import type { RowProblem } from "@/lib/roster/csv/normalizeRow";

export type ImportProblemListProps = {
  problems: RowProblem[];
  problemsTruncated: number;
  emptyMessage: string;
};

// Rendered on the preview screen AND on the result screen, from one component rather than two.
// The rows that did not import are the whole reason a user is still reading after a confirm,
// and they have to be described identically in both places or the second list reads as a
// different set of problems from the first.
export function ImportProblemList({
  problems,
  problemsTruncated,
  emptyMessage,
}: ImportProblemListProps) {
  if (problems.length === 0) {
    return (
      <Card>
        <h3 className="text-sm font-semibold text-foreground">Problems</h3>
        <p className="mt-2 text-sm text-muted">{emptyMessage}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold text-foreground">
        {problems.length} {problems.length === 1 ? "problem" : "problems"}
      </h3>

      {problemsTruncated > 0 && (
        <p className="mt-2 text-sm text-muted">
          Showing the first {problems.length}. Another {problemsTruncated} are not listed —
          this file has more problems than it has good rows.
        </p>
      )}

      {/* Scrollable rather than paginated: a tester comparing against a spreadsheet scrolls
          both at once. Capped height so the confirm button never sits below 200 rows. */}
      <ul className="mt-3 max-h-80 overflow-y-auto text-sm">
        {problems.map((problem, index) => (
          <li
            key={`${problem.rowNumber}-${problem.field ?? "row"}-${index}`}
            className="border-t border-border py-2 first:border-t-0 first:pt-0"
          >
            {/* The row number as a spreadsheet shows it — the header is row 1. A number the
                user cannot locate in their file is worse than no number. */}
            <span className="font-medium text-foreground">Row {problem.rowNumber}</span>
            <span className="text-muted"> — {problem.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
