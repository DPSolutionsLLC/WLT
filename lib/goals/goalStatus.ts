import { addMonths, formatDateOnly, parseDateOnly } from "@/lib/calendar/dates";
import type { GoalStatus } from "@/types/domain";

// Goal status, computed. `goals.status` is a COLUMN and this function is the truth; the column is
// a cache that supabase/migrations/029_goal_status_refresh.sql refreshes for a future report to
// index. Nothing in the UI reads it — lib/goals/queries.ts does not even select it, which is the
// structural version of "compute on read" rather than a rule everyone has to remember
// (04-talks-pipeline.md §Step 9).
//
// CLIENT-IMPORTABLE, for the same reason as lib/assignments/reliabilityFlags.ts: GoalBoard renders
// this, and one import of lib/goals/queries.ts would pull next/headers into a client bundle.
//
// `asOf` is a PARAMETER. The calendar calls this once per Sunday cell with that Sunday's own date,
// which is what makes an alert a statement about a cell rather than about today repeated six times.

export const DUE_SOON_FRACTION = 0.8;

// `createdAt` is not in the phase plan's signature. It is here because "never fulfilled counts as
// overdue once the interval has passed since creation" is unanswerable without it — with only a
// null last-fulfilled date, a goal created this morning and a goal created three years ago are the
// same value. Recorded as a deviation in 04-talks-pipeline.md.
export function goalStatus(
  lastFulfilledAt: Date | null,
  frequencyMonths: number,
  asOf: Date,
  createdAt: Date,
): GoalStatus {
  // Day-level throughout. A goal is due on a DAY, not at an instant, and truncating both ends to
  // a UTC date-only string keeps this on the one date idiom the app already has rather than
  // introducing millisecond comparisons of two timestamptz values.
  const anchor = formatDateOnly(lastFulfilledAt ?? createdAt);
  const today = formatDateOnly(asOf);
  const due = addMonths(anchor, frequencyMonths);

  if (today >= due) return "overdue";

  const elapsed = parseDateOnly(today).getTime() - parseDateOnly(anchor).getTime();
  const interval = parseDateOnly(due).getTime() - parseDateOnly(anchor).getTime();

  // A zero or negative frequency is rejected by lib/validation/goal.ts, so this is a row written
  // before that schema existed rather than something a user can produce. It cannot divide, and
  // "overdue" is the honest reading of an interval that has already elapsed.
  if (interval <= 0) return "overdue";

  // A date before the anchor — clock skew between the database and the browser — comes out
  // negative and reads as on_track, which is right: nothing is due yet.
  return elapsed / interval >= DUE_SOON_FRACTION ? "due_soon" : "on_track";
}

// The shape the data layer and the board both hold. `desiredFrequencyMonths` is nullable in
// migration 010, and a goal with no frequency has no interval and therefore no status — null,
// not a guessed bucket. lib/validation/goal.ts requires one on every goal this app creates, so
// null only reaches here from a row written outside it.
export type GoalStatusInput = {
  lastFulfilledAt: string | null;
  desiredFrequencyMonths: number | null;
  createdAt: string;
};

export function goalStatusFor(goal: GoalStatusInput, asOf: Date): GoalStatus | null {
  if (goal.desiredFrequencyMonths === null) return null;

  return goalStatus(
    goal.lastFulfilledAt === null ? null : new Date(goal.lastFulfilledAt),
    goal.desiredFrequencyMonths,
    asOf,
    new Date(goal.createdAt),
  );
}

// Overdue first, then due_soon, then on_track, and a statusless goal last. The board opens on the
// thing somebody has to act on; a list that opens on what is fine is a list nobody scrolls.
const STATUS_ORDER: Record<GoalStatus, number> = {
  overdue: 0,
  due_soon: 1,
  on_track: 2,
};

export function compareGoalsByStatus(
  left: { status: GoalStatus | null; title: string },
  right: { status: GoalStatus | null; title: string },
): number {
  const leftRank = left.status === null ? 3 : STATUS_ORDER[left.status];
  const rightRank = right.status === null ? 3 : STATUS_ORDER[right.status];

  return leftRank === rightRank
    ? left.title.localeCompare(right.title)
    : leftRank - rightRank;
}
