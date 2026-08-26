import { addMonths, formatDateOnly, parseDateOnly, type DateOnly } from "@/lib/calendar/dates";
import type { HouseholdVisitStatus } from "@/types/domain";

// Where one household stands against its organization's visit goal, computed.
//
// Modelled on lib/goals/goalStatus.ts — same shape, same reasoning, same fraction — because a
// ward reading "due soon" on the goals board and "due soon" on the visit dashboard is entitled
// to have both mean the same thing.
//
// CLIENT-IMPORTABLE, for the same reason as lib/goals/goalStatus.ts and
// lib/assignments/reliabilityFlags.ts: VisitProgressTable renders and sorts by this, and ONE
// import of lib/visits/queries.ts would pull next/headers into the client bundle and break the
// table. This file imports types and date helpers, and nothing else — keep it that way.
//
// `asOf` is a PARAMETER, never a `new Date()` inside the function. That is what makes the
// boundaries testable, and it is what keeps every row of one render judged against the same
// instant instead of against a clock that moves down the list.
//
// ---------------------------------------------------------------------------
// AN ATTEMPT COUNTS TOWARDS NOTHING, AND IS STILL VISIBLE
// ---------------------------------------------------------------------------
// Every date this function reads for progress is a COMPLETED visit. `visit_logs.outcome` is
// `completed` or `attempted` since visits-d, and folding an attempt into the visited numbers
// would tell a ward it had reached a family it never got past the door of.
//
// Attempts are not simply dropped either. `attempted_never_reached` is evaluated FIRST because
// it is the more specific — and the more actionable — statement about a household than "not yet
// visited": somebody has been trying, and the answer is to try something other than knocking.

export const DUE_SOON_FRACTION = 0.8;

// `periodStart` is the fifth parameter and it is not optional.
//
// It is the anchor when nothing has been completed. Without it, a goal that started last week
// and one that started two years ago give the same answer for a never-visited household —
// exactly the hole talks-d found in goalStatus() and closed with `createdAt`. "Never visited
// counts as overdue once the interval has passed" is unanswerable from a null date alone.
//
// `lastCompletedOn` is the most recent completed visit OF ALL TIME, not of the period. Comparing
// it against `periodStart` therefore answers "has this household been visited this period?" on
// its own, which is why there is no sixth parameter carrying that separately.
//
// The parameter names deliberately avoid visit vocabulary where it costs nothing: Phase 8's
// youth-activity coverage has the same due/overdue-against-a-cadence shape.
export function householdVisitStatus(
  lastCompletedOn: DateOnly | null,
  lastAttemptedInPeriodOn: DateOnly | null,
  cadenceMonths: number,
  asOf: Date,
  periodStart: DateOnly,
): HouseholdVisitStatus {
  // Date-only string comparison, which is safe because both are YYYY-MM-DD — the one format
  // this app stores a day in (lib/calendar/dates.ts).
  const completedInPeriod = lastCompletedOn !== null && lastCompletedOn >= periodStart;

  if (!completedInPeriod && lastAttemptedInPeriodOn !== null) {
    return "attempted_never_reached";
  }

  // Day-level throughout, as goalStatus() is. A household is due on a DAY, and truncating both
  // ends to a UTC date-only string keeps this on the one date idiom the app has rather than
  // introducing millisecond comparisons of two timestamps.
  const anchor = lastCompletedOn ?? periodStart;
  const today = formatDateOnly(asOf);
  const due = addMonths(anchor, cadenceMonths);

  const interval = parseDateOnly(due).getTime() - parseDateOnly(anchor).getTime();

  // A zero or negative cadence cannot divide. lib/validation/visit.ts refuses to save one, so
  // this only reaches here from a row written outside this app — and "overdue" is the honest
  // reading of an interval that has already elapsed.
  if (interval <= 0) return "overdue";

  if (today >= due) return "overdue";

  // Never completed, and the interval has not run out yet. Reported as its own state rather than
  // as `due_soon`, because "nobody has been yet" is a different job from "somebody needs to go
  // again" even when the calendar pressure is identical.
  if (lastCompletedOn === null) return "not_yet_visited";

  // A date before the anchor — clock skew between the database and the browser — comes out
  // negative and reads as `visited`, which is right: nothing is due yet.
  const elapsed = parseDateOnly(today).getTime() - parseDateOnly(anchor).getTime();

  return elapsed / interval >= DUE_SOON_FRACTION ? "due_soon" : "visited";
}

// Overdue first, then the household somebody is already failing to reach, then the calendar
// pressure, then the ones nobody has started on, then the ones that are fine. The dashboard opens
// on what a president has to act on; a list that opens on what is settled is a list nobody
// scrolls.
//
// `null` — an organization with no goal, so no interval to judge against — sorts last.
const STATUS_ORDER: Record<HouseholdVisitStatus, number> = {
  overdue: 0,
  attempted_never_reached: 1,
  due_soon: 2,
  not_yet_visited: 3,
  visited: 4,
};

export function statusRank(status: HouseholdVisitStatus | null): number {
  return status === null ? 5 : STATUS_ORDER[status];
}

export function compareByStatus(
  left: { status: HouseholdVisitStatus | null; familyName: string },
  right: { status: HouseholdVisitStatus | null; familyName: string },
): number {
  const leftRank = statusRank(left.status);
  const rightRank = statusRank(right.status);

  return leftRank === rightRank
    ? left.familyName.localeCompare(right.familyName)
    : leftRank - rightRank;
}
