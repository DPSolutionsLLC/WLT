import { Card } from "@/components/ui/Card";
import type { ImportProblem } from "@/lib/roster/paste/normalizeReportRow";

export type ImportProblemListProps = {
  problems: ImportProblem[];
  problemsTruncated: number;
  emptyMessage: string;
};

// The rows of a pasted report that could not be used, with the reason for each.
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
          this paste has more problems than it has good rows.
        </p>
      )}

      {/* Scrollable rather than paginated: a tester comparing against a spreadsheet scrolls
          both at once. Capped height so the confirm button never sits below 200 rows. */}
      <ul className="mt-3 max-h-80 overflow-y-auto text-sm">
        {problems.map((problem, index) => (
          <li
            key={`${problem.rowNumber}-${index}`}
            className="border-t border-border py-2 first:border-t-0 first:pt-0"
          >
            {/* The row's place in the report, counting from the first person — what a leader can
                find in LCR. */}
            <span className="font-medium text-foreground">Row {problem.rowNumber}</span>
            <span className="text-muted"> — {problem.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
