import { describe, expect, it } from "vitest";
import {
  compareSweepStatus,
  sweepProgress,
  sweepStatusFor,
  type SweepLog,
} from "@/lib/visits/sweep";
import type { VisitNeedsAnotherReason } from "@/types/domain";

// A sweep: every household once (ITER-055 bv4, P6). Only visits on or after the start count; a
// done visit makes a household done for good in this sweep (decided with the user at bv4 start).

const START = "2027-03-01";

function done(householdId: string, visitDate: string): SweepLog {
  return {
    householdId,
    visitDate,
    outcome: "completed",
    needsAnotherVisit: false,
    needsAnotherReason: null,
  };
}

function partly(
  householdId: string,
  visitDate: string,
  reason: VisitNeedsAnotherReason = "spouse_absent",
): SweepLog {
  return {
    householdId,
    visitDate,
    outcome: "completed",
    needsAnotherVisit: true,
    needsAnotherReason: reason,
  };
}

function attempt(householdId: string, visitDate: string): SweepLog {
  return {
    householdId,
    visitDate,
    outcome: "attempted",
    needsAnotherVisit: false,
    needsAnotherReason: null,
  };
}

describe("sweepStatusFor", () => {
  it("reads not yet when nothing has happened", () => {
    expect(sweepStatusFor([], START)).toEqual({ status: "not_yet", on: null, reason: null });
  });

  it("counts a done visit on or after the start", () => {
    expect(sweepStatusFor([done("h", "2027-03-01")], START)).toEqual({
      status: "done",
      on: "2027-03-01",
      reason: null,
    });
  });

  it("ignores a done visit before the start", () => {
    expect(sweepStatusFor([done("h", "2027-02-28")], START).status).toBe("not_yet");
  });

  it("reads partly reached with the latest reason", () => {
    expect(
      sweepStatusFor(
        [partly("h", "2027-03-05", "not_home"), partly("h", "2027-03-20", "asked_to_return")],
        START,
      ),
    ).toEqual({ status: "partly_reached", on: "2027-03-20", reason: "asked_to_return" });
  });

  it("reaches nobody with an attempt", () => {
    expect(sweepStatusFor([attempt("h", "2027-03-05")], START).status).toBe("not_yet");
  });

  it("moves partly reached to done when a done visit follows", () => {
    expect(
      sweepStatusFor([partly("h", "2027-03-05"), done("h", "2027-03-12")], START).status,
    ).toBe("done");
  });

  // The user's decision: once reached in this sweep, a later partial visit does not undo it.
  it("stays done when a partial visit follows", () => {
    expect(
      sweepStatusFor([done("h", "2027-03-05"), partly("h", "2027-03-12")], START),
    ).toEqual({ status: "done", on: "2027-03-05", reason: null });
  });

  it("names the first done visit, whatever order the logs arrive in", () => {
    expect(sweepStatusFor([done("h", "2027-04-01"), done("h", "2027-03-02")], START).on).toBe(
      "2027-03-02",
    );
  });
});

describe("sweepProgress", () => {
  it("counts over the households it is given, and nothing else", () => {
    const progress = sweepProgress(
      ["a", "b", "c", "d"],
      [
        done("a", "2027-03-02"),
        partly("b", "2027-03-03"),
        attempt("c", "2027-03-04"),
        // Not in the denominator — a do-not-contact household the caller left out.
        done("z", "2027-03-05"),
        done("d", "2027-01-15"),
      ],
      START,
    );

    expect(progress.counts).toEqual({ total: 4, done: 1, partlyReached: 1, notYet: 2 });
    expect(progress.byHousehold.has("z")).toBe(false);
    expect(progress.byHousehold.get("d")?.status).toBe("not_yet");
  });

  it("adds up to its total", () => {
    const { counts } = sweepProgress(
      ["a", "b", "c"],
      [done("a", "2027-03-02"), partly("b", "2027-03-02")],
      START,
    );
    expect(counts.done + counts.partlyReached + counts.notYet).toBe(counts.total);
  });

  it("skips a log with no household", () => {
    const log = { ...done("a", "2027-03-02"), householdId: null };
    expect(sweepProgress(["a"], [log], START).counts.notYet).toBe(1);
  });
});

describe("compareSweepStatus", () => {
  it("puts what is left to do first", () => {
    const notYet = sweepStatusFor([], START);
    const partlyReached = sweepStatusFor([partly("h", "2027-03-03")], START);
    const doneStatus = sweepStatusFor([done("h", "2027-03-03")], START);

    const sorted = [doneStatus, partlyReached, notYet].sort(compareSweepStatus);
    expect(sorted.map((status) => status.status)).toEqual(["not_yet", "partly_reached", "done"]);
  });
});
