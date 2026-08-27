import { formatDateOnly, parseDateOnly, type DateOnly } from "@/lib/calendar/dates";
import {
  addCadence,
  compareCadences,
  subtractCadence,
  type Cadence,
} from "@/lib/visits/cadence";
import { VISIT_PRIORITY_BANDS, type VisitPriorityBand } from "@/types/domain";

// Where one household stands against its organization's cadence, computed.
//
// A POSITION ON A SCALE, NOT A BUCKET. The old five statuses answered "has this household been
// visited this period?", which is a question about a shared calendar boundary rather than about
// the household — and it produced the contradiction visits-b shipped, where a row read
// "✓ Visited" above a banner counting it as unvisited. Progress is now measured from each
// household's OWN last completed visit, so there is one notion of progress and nothing to
// disagree with.
//
// `elapsedFraction` is the point of the redesign: a household at 95% of its interval and one at
// 10% no longer read the same. The badge shows it, and the sort uses it.
//
// CLIENT-IMPORTABLE, for the same reason lib/goals/goalStatus.ts and
// lib/assignments/reliabilityFlags.ts are: VisitProgressTable renders and sorts by this, and ONE
// import of lib/visits/queries.ts would pull next/headers into the client bundle and break the
// table. This file imports types and pure date helpers, and nothing else — keep it that way.
//
// `asOf` is a PARAMETER, never a `new Date()` inside the function. That is what makes the
// boundaries testable, and it is what keeps every row of one render judged against the same
// instant instead of against a clock that moves down the list.
//
// ---------------------------------------------------------------------------
// AN ATTEMPT COUNTS TOWARDS NOTHING, AND IS STILL VISIBLE
// ---------------------------------------------------------------------------
// `lastCompletedOn` is a COMPLETED visit. `visit_logs.outcome` is `completed` or `attempted`
// since visits-d, and folding an attempt into it would tell a ward it had reached a family it
// never got past the door of.
//
// Attempts are not dropped either — but they are no longer a BAND. `attempted_never_reached`
// was a REASON, not a position: a household somebody has knocked on four times is a different
// problem from one nobody has been to at EVERY level of urgency, so it must not displace the
// urgency. It is expressible from `attemptsSinceLastVisit` alongside any band, and the table
// renders it as a separate mark beside the badge.
//
// The parameter names deliberately avoid visit vocabulary where it costs nothing —
// `lastCompletedOn`, not `lastVisitedOn`. Phase 8's youth-activity coverage has the same
// due/overdue-against-a-cadence shape and should import this rather than write a second meaning
// of "overdue".

export type VisitPriority = {
  band: VisitPriorityBand;
  // Null for `never_visited` — there is no anchor to measure from, which is the whole reason
  // that band exists (ITER-018 Decision 3).
  //
  // NOT clamped above 1. 1.4 means 40% past due, and the sort reads it so the most-overdue
  // household leads the overdue group. Floored at 0 so clock skew between the database and the
  // browser cannot produce a negative.
  elapsedFraction: number | null;
  dueOn: DateOnly | null;
  // The cadence this answer was computed against, and where it came from. A row reading
  // "Overdue" under a goal that alone would say "On track" has to be able to explain itself.
  cadence: Cadence;
  cadenceSource: "household" | "goal";
};

export type HouseholdVisitPriorityInput = {
  lastCompletedOn: DateOnly | null;
  cadence: Cadence;
  cadenceSource: "household" | "goal";
  notice: Cadence;
  asOf: Date;
};

// ---------------------------------------------------------------------------
// THE CLAMP
// ---------------------------------------------------------------------------
// If the notice window is as long as the cadence or longer, it swallows the whole interval and
// EVERY household would read `approaching` — a dashboard that has stopped saying anything.
//
// In that case the window is ignored entirely: no household reads `approaching`, and each is
// `on_track` or `overdue`. That is the safe direction. A dashboard that under-warns is
// recoverable by looking at the due dates, which are all still there; one that flags everything
// tells a president nothing about where to go first.
//
// lib/validation/visit.ts refuses to SAVE such a goal, so this is reachable only from a row
// written outside the app — the same class as the `interval <= 0` guard below, which stays.
// The goal-level consequence is reported ONCE, on VisitProgressGoalSummary.noticeIgnored in
// lib/visits/progress.ts, so the banner can say it plainly. It is deliberately not repeated per
// row: one name for one fact.
//
// A HOUSEHOLD OVERRIDE SHORTER THAN THE GOAL'S NOTICE WINDOW hits the same clamp — that one
// household reads on_track or overdue and never approaching. It is the same safe direction, and
// the row still shows its due date, which is the actionable half.
export function householdVisitPriority({
  lastCompletedOn,
  cadence,
  cadenceSource,
  notice,
  asOf,
}: HouseholdVisitPriorityInput): VisitPriority {
  const noticeIgnored = compareCadences(notice, cadence) >= 0;

  // FIRST, AND UNCONDITIONALLY. `never_visited` outranks `overdue` (ITER-018 Decision 3): a
  // family nobody has ever been to is a different problem from one visited thirteen months ago,
  // and it has no anchor to measure a fraction from at all. Computing one would mean inventing
  // an anchor, which is exactly what the old `goal_period_start` did and what this replaces.
  if (lastCompletedOn === null) {
    return {
      band: "never_visited",
      elapsedFraction: null,
      dueOn: null,
      cadence,
      cadenceSource,
    };
  }

  const today = formatDateOnly(asOf);
  const dueOn = addCadence(lastCompletedOn, cadence);

  const anchorMs = parseDateOnly(lastCompletedOn).getTime();
  const dueMs = parseDateOnly(dueOn).getTime();
  const interval = dueMs - anchorMs;

  // A zero or negative interval cannot divide. lib/validation/visit.ts and migration 050's CHECK
  // both refuse to store one, so this only reaches here from a row written outside this app —
  // and "overdue" is the honest reading of an interval that has already elapsed.
  if (interval <= 0) {
    return {
      band: "overdue",
      elapsedFraction: 1,
      dueOn,
      cadence,
      cadenceSource,
    };
  }

  // Floored at 0 rather than allowed negative: a `lastCompletedOn` in the future is clock skew
  // between the database and the browser, and "0% elapsed" is the honest reading of it.
  const elapsedFraction = Math.max(
    0,
    (parseDateOnly(today).getTime() - anchorMs) / interval,
  );

  // Date-only string comparison, safe because both are YYYY-MM-DD — the one format this app
  // stores a day in (lib/calendar/dates.ts).
  if (today >= dueOn) {
    return { band: "overdue", elapsedFraction, dueOn, cadence, cadenceSource };
  }

  if (!noticeIgnored) {
    const noticeStartsOn = subtractCadence(dueOn, notice);

    if (today >= noticeStartsOn) {
      return {
        band: "approaching",
        elapsedFraction,
        dueOn,
        cadence,
        cadenceSource,
      };
    }
  }

  return { band: "on_track", elapsedFraction, dueOn, cadence, cadenceSource };
}

// THE ARRAY ORDER IS THE RANK. VISIT_PRIORITY_BANDS is declared highest-priority-first, and this
// reads its index rather than carrying a second map that could drift from it — the bug the old
// STATUS_ORDER constant was one edit away from at all times.
//
// `null` sorts last, covering BOTH an organization with no goal and a do-not-contact household.
// The dashboard opens on what a president has to act on; a list that opens on what is settled is
// a list nobody scrolls.
export function priorityRank(priority: VisitPriority | null): number {
  return priority === null
    ? VISIT_PRIORITY_BANDS.length
    : VISIT_PRIORITY_BANDS.indexOf(priority.band);
}

// Rank ascending, then elapsedFraction DESCENDING inside a band so the most-overdue household
// leads the overdue group, then family name as the stable tie-break — the discipline the old
// compareByStatus already had.
//
// A null fraction (never_visited) sorts before a numeric one, which costs nothing: every row in
// that band has a null fraction, so the comparison only ever runs between two nulls there.
export function compareByPriority(
  left: { priority: VisitPriority | null; familyName: string },
  right: { priority: VisitPriority | null; familyName: string },
): number {
  const rankDelta = priorityRank(left.priority) - priorityRank(right.priority);
  if (rankDelta !== 0) return rankDelta;

  const leftFraction = left.priority?.elapsedFraction ?? null;
  const rightFraction = right.priority?.elapsedFraction ?? null;

  if (leftFraction !== null && rightFraction !== null && leftFraction !== rightFraction) {
    return rightFraction - leftFraction;
  }

  if (leftFraction === null && rightFraction !== null) return -1;
  if (leftFraction !== null && rightFraction === null) return 1;

  return left.familyName.localeCompare(right.familyName);
}
