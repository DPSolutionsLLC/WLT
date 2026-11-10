import { describeCadence } from "@/lib/visits/cadence";
// Type-only: the builder reads through server-only modules.
import type { GoalHistoryEntry } from "@/lib/visits/goalHistory";
import { formatVisitDate } from "@/lib/visits/visitDates";
import { VISIT_GOAL_END_REASON_LABELS } from "@/types/domain";

// The Past goals tab (ITER-055 bv4): every ended goal, newest first, with where it stood when it
// ended. The numbers are recomputed from the visits, never stored (lib/visits/goalHistory.ts).

export function describeGoalResult(entry: GoalHistoryEntry): string {
  if (entry.sweep !== null) {
    const { done, total, partlyReached, notYet } = entry.sweep;
    return `${done} of ${total} done · ${partlyReached} partly reached · ${notYet} not yet`;
  }

  if (entry.onTrack !== null) {
    return `${entry.onTrack.percent}% on track (${entry.onTrack.onTrack} of ${entry.onTrack.counted})`;
  }

  return "No numbers to show for this goal.";
}

export function describeGoalKind(entry: GoalHistoryEntry): string {
  if (entry.kind === "sweep") return "Every household once";
  return entry.cadence === null ? "No schedule set" : describeCadence(entry.cadence);
}

export function GoalHistory({ entries }: { entries: readonly GoalHistoryEntry[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Goals that have ended, newest first, with where each stood on the day it ended. The
        households are today&rsquo;s: a family that has since moved out is not counted.
      </p>

      {entries.length === 0 ? (
        <p className="text-sm text-muted">
          No goal has ended yet. Ending one from Visit goal on the Households tab puts it here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li
              key={entry.goalId}
              className="rounded-lg border border-border bg-surface-raised px-3 py-2"
            >
              <p className="py-1 text-sm font-medium text-foreground">
                {entry.orgName}
                {entry.title === null ? null : (
                  <span className="font-normal text-muted"> · {entry.title}</span>
                )}
              </p>
              <p className="text-xs text-muted">
                {describeGoalKind(entry)} · {formatVisitDate(entry.startedOn)} to{" "}
                {formatVisitDate(entry.endedOn)} · {VISIT_GOAL_END_REASON_LABELS[entry.endReason]}
              </p>
              <p className="text-xs text-foreground">{describeGoalResult(entry)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
