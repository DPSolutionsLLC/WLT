// @vitest-environment node
//
// worstCoverage() — the one badge that goes above an occasion, reduced from every young person on
// it.
//
// ---------------------------------------------------------------------------
// WHAT THIS SUITE IS ACTUALLY GUARDING
// ---------------------------------------------------------------------------
// 1. THE WHOLE EventCoverage IS CARRIED, NOT JUST ITS STATE. This is the youth-e regression
//    written as a test. That walk found every covered card reading `Covered · 0` above an event
//    card reading `Covered · 1`, because the value being carried held the STATE and the DATE but
//    not the COUNT of the event it described — and the check that existed pinned the state, so
//    the wrong number passed it. The version of this suite that only asserted `.state` would pass
//    against exactly the implementation that ships the bug.
//
// 2. THE ORDERING IS DRIVEN OFF COVERAGE_STATES, not hardcoded. A state added later ranks
//    somewhere deliberate or fails here, rather than silently landing last.
//
// 3. AN EMPTY LIST IS `null`, NOT "FINE". Returning a `covered` would say something nobody has
//    established, which is visits-f's comparator lesson.
//
// 4. TIES BREAK ON THE SOONEST daysUntil, AND A null NEVER BEATS A NUMBER. Two games with nobody
//    going are not equally urgent, and a past one has nothing left to act on.
//
// Nothing here freezes a clock: worstCoverage takes finished EventCoverage values, so the suite
// is literals all the way down.

import { describe, expect, it } from "vitest";
import { worstCoverage, type EventCoverage } from "@/lib/youth/coverage";
import { COVERAGE_STATES, coverageRank, type CoverageState } from "@/types/domain";

function coverage(
  state: CoverageState,
  overrides: Partial<EventCoverage> = {},
): EventCoverage {
  return { state, daysUntil: 3, attendeeCount: 0, ...overrides };
}

describe("worstCoverage", () => {
  // NO SIGNAL IS NOT "FINE". An occasion with no rows tells a reader nothing, and a badge saying
  // "Covered" would be an answer nobody gave.
  it("returns null for an empty list", () => {
    expect(worstCoverage([])).toBeNull();
  });

  it("returns the only value it is given", () => {
    const only = coverage("covered", { attendeeCount: 4 });

    expect(worstCoverage([only])).toEqual(only);
  });

  // DRIVEN OFF THE ARRAY. Every ordered pair of states is asserted, so a state added to
  // COVERAGE_STATES later cannot quietly rank below everything.
  it("prefers the more urgent state across every pair", () => {
    for (const worse of COVERAGE_STATES) {
      for (const better of COVERAGE_STATES) {
        if (coverageRank(worse) >= coverageRank(better)) continue;

        expect(worstCoverage([coverage(better), coverage(worse)])?.state).toBe(worse);
        expect(worstCoverage([coverage(worse), coverage(better)])?.state).toBe(worse);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // THE youth-e REGRESSION, AS A TEST
  // ---------------------------------------------------------------------------
  // A `covered` row with three attendees beside an `uncovered` row with none. The result must be
  // the UNCOVERED one carrying ITS OWN attendeeCount and daysUntil — not the uncovered state
  // wearing the covered row's numbers. An implementation that returned only the state, and left
  // the caller to look the numbers up somewhere else, is exactly what put `Covered · 0` above
  // `Covered · 1`.
  it("carries the whole object, not just the state", () => {
    const covered = coverage("covered", { attendeeCount: 3, daysUntil: 1 });
    const uncovered = coverage("uncovered", { attendeeCount: 0, daysUntil: 6 });

    expect(worstCoverage([covered, uncovered])).toEqual(uncovered);
    expect(worstCoverage([covered, uncovered])?.attendeeCount).toBe(0);
    expect(worstCoverage([covered, uncovered])?.daysUntil).toBe(6);
  });

  it("breaks a tie on the soonest daysUntil", () => {
    const sooner = coverage("uncovered", { daysUntil: 2 });
    const later = coverage("uncovered", { daysUntil: 6 });

    expect(worstCoverage([later, sooner])).toEqual(sooner);
    expect(worstCoverage([sooner, later])).toEqual(sooner);
  });

  // A null daysUntil is a past or cancelled event: there is nothing left to act on, so it never
  // wins a tie against a real one however the list happens to be ordered.
  it("never lets a null daysUntil beat a real one in a tie", () => {
    const real = coverage("uncovered", { daysUntil: 9 });
    const past = coverage("uncovered", { daysUntil: null });

    expect(worstCoverage([past, real])).toEqual(real);
    expect(worstCoverage([real, past])).toEqual(real);
  });

  it("still returns a null-dated value when it is the only one holding the worst state", () => {
    const past = coverage("not_expected", { daysUntil: null });

    expect(worstCoverage([past, past])).toEqual(past);
  });

  // THE OCCASION-LEVEL ALERT, WHICH IS ITER-020 ITEM 4. One young person with nobody going makes
  // the whole evening an alert, even when everybody else is covered.
  it("reads as an alert when one young person of three has nobody going", () => {
    const rows = [
      coverage("covered", { attendeeCount: 2, daysUntil: 3 }),
      coverage("uncovered", { attendeeCount: 0, daysUntil: 3 }),
      coverage("covered", { attendeeCount: 1, daysUntil: 3 }),
    ];

    expect(worstCoverage(rows)?.state).toBe("uncovered");
  });
});
