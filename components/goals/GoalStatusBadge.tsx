import type { GoalStatus } from "@/types/domain";

// A Record rather than a lookup with a fallback, for the same reason PIPELINE_STAGE_LABELS is
// one: a bucket added to GOAL_STATUSES must not render as its own snake_case key.
const STATUS_LABELS: Record<GoalStatus, string> = {
  on_track: "On track",
  due_soon: "Due soon",
  overdue: "Overdue",
};

// Colour is never the only signal (calendar-b): the word is always there, so somebody who cannot
// separate amber from red still reads the same badge. The tokens carry their own contrast in both
// themes — they are defined in app/globals.css, where the numbers were measured.
const STATUS_CLASSES: Record<GoalStatus, string> = {
  on_track: "text-success",
  due_soon: "text-warning",
  overdue: "text-danger",
};

export type GoalStatusBadgeProps = {
  status: GoalStatus | null;
};

export function GoalStatusBadge({ status }: GoalStatusBadgeProps) {
  // A goal with no frequency has no interval and therefore no status. Migration 010 allows the
  // null, lib/validation/goal.ts does not, so this is a row written outside this app — and "No
  // frequency set" is what it is, rather than a bucket guessed on its behalf.
  if (status === null) {
    return (
      <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted">
        No frequency set
      </span>
    );
  }

  return (
    <span
      className={`rounded-full border border-border bg-surface px-2 py-0.5 text-xs ${STATUS_CLASSES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
