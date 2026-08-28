import { Card } from "@/components/ui/Card";
import type { IcsProblem } from "@/lib/youth/ics/occurrence";

export type IcsProblemListProps = {
  problems: IcsProblem[];
  problemsTruncated: number;
  emptyMessage: string;
};

// Rendered on the preview screen AND on the result screen, from one component rather than two.
// The entries that will not import are the whole reason a user is still reading after a confirm,
// and they have to be described identically in both places or the second list reads as a
// different set of problems from the first (components/roster/ImportProblemList.tsx says the same).
//
// NO ROW NUMBERS, because an ICS file has none. The event's own name is what a person can search
// their calendar for; a made-up index would be a number they cannot find.
export function IcsProblemList({
  problems,
  problemsTruncated,
  emptyMessage,
}: IcsProblemListProps) {
  if (problems.length === 0) {
    return (
      <Card>
        <h3 className="text-sm font-semibold text-foreground">Entries that will not import</h3>
        <p className="mt-2 text-sm text-muted">{emptyMessage}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="text-sm font-semibold text-foreground">
        {problems.length} {problems.length === 1 ? "entry" : "entries"} this file could not use
      </h3>

      {problemsTruncated > 0 && (
        <p className="mt-2 text-sm text-muted">
          Showing the first {problems.length}. Another {problemsTruncated} are not listed.
        </p>
      )}

      <ul className="mt-3 max-h-80 overflow-y-auto text-sm">
        {problems.map((problem, index) => (
          <li
            key={`${problem.summary ?? "entry"}-${index}`}
            className="border-t border-border py-2 first:border-t-0 first:pt-0"
          >
            <span className="font-medium text-foreground">
              {problem.summary ?? "An unnamed entry"}
            </span>
            <span className="text-muted"> — {problem.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
