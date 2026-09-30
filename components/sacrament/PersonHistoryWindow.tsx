"use client";

import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import type { SpeakerHistoryRow } from "@/lib/assignments/queries";
import { ASSIGNMENT_TYPE_LABELS, DECLINE_REASON_LABELS } from "@/types/domain";

// ONE PERSON'S SPEAKING HISTORY, opened from the speaker window's History button (Topics rebuild
// t4, the prototype's history view). It is NOT a second window: Modal does not stack
// (talks-b-month-planner), so it REPLACES the speaker window's list, with a way back.
//
// Bishopric-only, because `assignment_history` is (migration 019); the History button is absent for
// anybody else. Dates are `date` columns, so they render in UTC through lib/calendar/dates.ts.

export type PersonHistoryWindowProps = {
  name: string;
  history: readonly SpeakerHistoryRow[];
  onBack: () => void;
};

function dateOf(row: SpeakerHistoryRow): string {
  return row.sundayDate === null ? "Date unknown" : formatSundayLabelWithYear(row.sundayDate);
}

function newestFirst(left: SpeakerHistoryRow, right: SpeakerHistoryRow): number {
  if (left.sundayDate === right.sundayDate) return 0;
  if (left.sundayDate === null) return 1;
  if (right.sundayDate === null) return -1;
  return left.sundayDate < right.sundayDate ? 1 : -1;
}

export function PersonHistoryWindow({ name, history, onBack }: PersonHistoryWindowProps) {
  const talks = history.filter((row) => row.outcome === "completed").sort(newestFirst);
  const declines = history.filter((row) => row.outcome === "declined").sort(newestFirst);

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center self-start text-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        ← Back to the list
      </button>

      <div>
        <h3 className="text-base font-semibold text-foreground">{name}</h3>
        <p className="text-sm text-muted">
          Speaking history — {talks.length} {talks.length === 1 ? "talk" : "talks"}
        </p>
      </div>

      {talks.length === 0 && declines.length === 0 ? (
        <p className="text-sm text-muted">No talks on record yet.</p>
      ) : (
        <>
          {talks.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {talks.map((row) => (
                <li key={row.id} className="flex flex-col py-2 text-sm">
                  <span className="text-muted">{dateOf(row)}</span>
                  <span className="text-foreground">{row.topicTitle ?? "No topic recorded"}</span>
                  {row.assignmentType !== null && (
                    <span className="text-xs text-muted">
                      {ASSIGNMENT_TYPE_LABELS[row.assignmentType]}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}

          {declines.length > 0 && (
            <section className="flex flex-col gap-1">
              <h4 className="text-sm font-semibold text-foreground">
                Declined asks — {declines.length}, for pattern-spotting
              </h4>
              <ul className="flex flex-col divide-y divide-border">
                {declines.map((row) => (
                  <li key={row.id} className="flex flex-col py-2 text-sm">
                    <span className="text-muted">
                      {dateOf(row)} · Talk
                      {row.declineReason !== null && ` · ${DECLINE_REASON_LABELS[row.declineReason]}`}
                    </span>
                    {row.notes !== null && row.notes.trim() !== "" && (
                      <span className="text-foreground">{row.notes}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
