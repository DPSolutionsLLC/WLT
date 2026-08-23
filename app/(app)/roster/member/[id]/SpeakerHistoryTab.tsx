import { ReliabilityFlag } from "@/components/roster/ReliabilityFlag";
import { reliabilityFlags } from "@/lib/assignments/reliabilityFlags";
import type { SpeakerHistoryRow } from "@/lib/assignments/queries";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import { ASSIGNMENT_TYPE_LABELS } from "@/types/domain";

// The bishopric-only speaker profile: the flags, then the history they were computed from.
//
// Flags ABOVE the table on purpose. A bishopric opens this to answer "can we ask them again",
// and the flags are the answer while the table is the evidence. Anyone who distrusts a flag can
// read the rows underneath it, which is the difference between a pattern and a verdict.
//
// A Server Component. Nothing here is interactive, and the data is bishopric-only — rendering it
// on the server means the rows never travel to a browser that was not entitled to them.

export type SpeakerHistoryTabProps = {
  history: readonly SpeakerHistoryRow[];
  asOf: Date;
};

const OUTCOME_LABELS: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Spoke",
};

export function SpeakerHistoryTab({ history, asOf }: SpeakerHistoryTabProps) {
  // No history is an EMPTY STATE, not an empty table with headers. A table of column names above
  // nothing reads as a rendering fault; one sentence reads as the truth.
  if (history.length === 0) {
    return (
      <div>
        <h2 className="text-base font-semibold text-foreground">Speaking history</h2>
        <p className="mt-2 text-sm text-muted">No speaking history yet.</p>
      </div>
    );
  }

  const flags = reliabilityFlags(history, asOf);

  return (
    <div>
      <h2 className="text-base font-semibold text-foreground">Speaking history</h2>

      {flags.length > 0 && (
        <div className="mt-3">
          <ReliabilityFlag flags={flags} />
          {/* Said out loud rather than left implied. These are patterns in the rows below, not a
              recommendation, and nothing in this app refuses an assignment because of one. */}
          <p className="mt-2 text-xs text-muted">
            Patterns in the history below. They are for context only — nothing here prevents an
            assignment.
          </p>
        </div>
      )}

      {/* Scrolls inside its own container at 375px rather than pushing the page sideways. */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th scope="col" className="py-2 pr-3 font-medium">Sunday</th>
              <th scope="col" className="py-2 pr-3 font-medium">Assignment</th>
              <th scope="col" className="py-2 pr-3 font-medium">Outcome</th>
              <th scope="col" className="py-2 pr-3 font-medium">Notice given</th>
              <th scope="col" className="py-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {history.map((entry) => (
              <tr key={entry.id} className="border-b border-border last:border-b-0">
                <td className="py-2 pr-3 text-foreground">
                  {/* A history row can outlive the assignment that dated it — `assignment_id` is
                      `on delete set null`. The outcome still happened, so the row stays and says
                      what it does not know. */}
                  {entry.sundayDate
                    ? formatSundayLabelWithYear(entry.sundayDate)
                    : "Date not recorded"}
                </td>
                <td className="py-2 pr-3 text-muted">
                  {entry.assignmentType
                    ? ASSIGNMENT_TYPE_LABELS[entry.assignmentType]
                    : "Not recorded"}
                </td>
                <td className="py-2 pr-3 text-muted">
                  {entry.outcome ? OUTCOME_LABELS[entry.outcome] : "Not recorded"}
                </td>
                <td className="py-2 pr-3 text-muted">
                  {entry.cancellationDaysNotice === null
                    ? "—"
                    : `${entry.cancellationDaysNotice} ${
                        entry.cancellationDaysNotice === 1 ? "day" : "days"
                      }`}
                </td>
                <td className="py-2 text-muted">{entry.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
