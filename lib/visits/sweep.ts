import type { DateOnly } from "@/lib/calendar/dates";
import { isDoneVisit } from "@/lib/visits/householdStatus";
import type { VisitNeedsAnotherReason, VisitOutcome } from "@/types/domain";

// A SWEEP: every household once (ITER-055 D5, P6). Pure and client-safe — the Households tab sorts
// with compareSweepStatus() in the browser, and Goal history recomputes an ended sweep on the
// server with the same function.
//
// THREE STATES, decided only by visits dated on or after the goal's start:
//   done            — a done visit (isDoneVisit(), the one meaning of done in this app).
//   partly_reached  — no done visit, but a "Visited, but still needs a visit" one. Its latest
//                     reason is the one shown.
//   not_yet         — neither. An attempt or a phone call reaches nobody, so it leaves a household
//                     here.
//
// ONCE DONE, ALWAYS DONE FOR THIS SWEEP (decided with the user at bv4 start). A later "still needs
// a visit" visit shows on the household's card but does not undo it: the sweep asks whether the
// household was reached, and it was.
//
// Computed on read, never stored — nothing in this project refreshes a stored count.

export const SWEEP_STATUSES = ["not_yet", "partly_reached", "done"] as const;
export type SweepStatus = (typeof SWEEP_STATUSES)[number];

export type SweepLog = {
  householdId: string | null;
  visitDate: DateOnly;
  outcome: VisitOutcome;
  needsAnotherVisit: boolean;
  needsAnotherReason: VisitNeedsAnotherReason | null;
};

export type SweepHouseholdStatus = {
  status: SweepStatus;
  // The first done visit in the sweep for `done`, the latest partial one for `partly_reached`,
  // null for `not_yet`.
  on: DateOnly | null;
  reason: VisitNeedsAnotherReason | null;
};

export type SweepCounts = {
  total: number;
  done: number;
  partlyReached: number;
  notYet: number;
};

export type SweepProgress = {
  counts: SweepCounts;
  byHousehold: Map<string, SweepHouseholdStatus>;
};

const NOT_YET: SweepHouseholdStatus = { status: "not_yet", on: null, reason: null };

// One household's logs, already narrowed to that household. Order does not matter.
export function sweepStatusFor(
  logs: readonly SweepLog[],
  startedOn: DateOnly,
): SweepHouseholdStatus {
  let firstDone: DateOnly | null = null;
  let latestPartly: { on: DateOnly; reason: VisitNeedsAnotherReason } | null = null;

  for (const log of logs) {
    if (log.visitDate < startedOn) continue;

    if (isDoneVisit(log)) {
      if (firstDone === null || log.visitDate < firstDone) firstDone = log.visitDate;
    } else if (log.outcome === "completed" && log.needsAnotherReason !== null) {
      if (latestPartly === null || log.visitDate > latestPartly.on) {
        latestPartly = { on: log.visitDate, reason: log.needsAnotherReason };
      }
    }
  }

  if (firstDone !== null) return { status: "done", on: firstDone, reason: null };
  if (latestPartly !== null) {
    return { status: "partly_reached", on: latestPartly.on, reason: latestPartly.reason };
  }
  return NOT_YET;
}

// `householdIds` is the DENOMINATOR, decided by the caller through describeHouseholdForVisits()
// (visits-b: the picker and the count come from one rule). This function never decides which
// households count; a log for a household outside the list is ignored.
export function sweepProgress(
  householdIds: readonly string[],
  logs: readonly SweepLog[],
  startedOn: DateOnly,
): SweepProgress {
  const logsByHousehold = new Map<string, SweepLog[]>();

  for (const log of logs) {
    if (log.householdId === null) continue;
    const list = logsByHousehold.get(log.householdId);
    if (list === undefined) logsByHousehold.set(log.householdId, [log]);
    else list.push(log);
  }

  const byHousehold = new Map<string, SweepHouseholdStatus>();
  const counts: SweepCounts = { total: householdIds.length, done: 0, partlyReached: 0, notYet: 0 };

  for (const householdId of householdIds) {
    const status = sweepStatusFor(logsByHousehold.get(householdId) ?? [], startedOn);
    byHousehold.set(householdId, status);

    if (status.status === "done") counts.done += 1;
    else if (status.status === "partly_reached") counts.partlyReached += 1;
    else counts.notYet += 1;
  }

  return { counts, byHousehold };
}

// What is left to do first: not yet, then partly reached, then done. Ties fall to the caller's
// name order.
export function compareSweepStatus(
  left: SweepHouseholdStatus | null,
  right: SweepHouseholdStatus | null,
): number {
  const rank = (value: SweepHouseholdStatus | null): number =>
    value === null ? SWEEP_STATUSES.length : SWEEP_STATUSES.indexOf(value.status);
  return rank(left) - rank(right);
}
