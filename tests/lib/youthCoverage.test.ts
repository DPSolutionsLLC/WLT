// @vitest-environment node
//
// eventCoverage — the phase plan's `uncovered-detection`, and the arithmetic migration 054c
// promised when it removed `covered`/`uncovered` from the status column.
//
// ---------------------------------------------------------------------------
// WHAT THIS SUITE IS ACTUALLY GUARDING
// ---------------------------------------------------------------------------
// 1. THE NOTICE BOUNDARY, PINNED FROM BOTH SIDES. Six days out is `uncovered` and eight is
//    `unassigned`, and seven exactly is asserted rather than left to whichever way the comparison
//    happens to round. `noticeDays` is a parameter with a default precisely so a test can do this.
//
// 2. A CANCELLED EVENT NEVER REGISTERS AS UNATTENDED, AT ANY DISTANCE FROM THE CLOCK — three days
//    out AND three days past. This is the user's rule from the planning conversation and it is
//    why `cancelled` is tested BEFORE the clock is consulted in the implementation. Asserting
//    only the future half would pass against an implementation that checked the clock first.
//
// 3. AN AWAY EVENT IS NEVER `uncovered`, at any distance. An away game with nobody going is the
//    designed outcome (08-youth-activities.md §Step 4), and a warning tone on it would train
//    leaders to ignore the tone.
//
// `asOf` is a parameter everywhere, so nothing here freezes a clock or sleeps.

import { describe, expect, it } from "vitest";
import {
  COVERAGE_NOTICE_DAYS,
  describeYouthAbsence,
  eventCoverage,
  summariseCoverage,
  type EventCoverageInput,
} from "@/lib/youth/coverage";
import { COVERAGE_STATES, coverageRank } from "@/types/domain";

const ASOF = new Date("2027-01-15T12:00:00Z");

function daysFrom(days: number): string {
  return new Date(ASOF.getTime() + days * 86_400_000).toISOString();
}

function event(overrides: Partial<EventCoverageInput> = {}): EventCoverageInput {
  return {
    eventType: "home",
    eventDate: daysFrom(3),
    status: "upcoming",
    attendeeCount: 0,
    // Migration 061. NULL IS THE ORDINARY CASE — nobody has said — so every existing assertion in
    // this suite goes on describing the behaviour it described before the column existed.
    youthAttended: null,
    ...overrides,
  };
}

describe("eventCoverage", () => {
  it("marks a home event inside the notice window with nobody going as uncovered", () => {
    expect(eventCoverage(event({ eventDate: daysFrom(6) }), ASOF).state).toBe("uncovered");
  });

  it("marks a home event beyond the notice window as unassigned, not uncovered", () => {
    expect(eventCoverage(event({ eventDate: daysFrom(8) }), ASOF).state).toBe("unassigned");
  });

  // THE BOUNDARY, FROM BOTH SIDES. Inclusive at exactly seven days, because a leader would rather
  // be told a day early than a day late.
  it("pins the boundary at exactly the notice window", () => {
    const justInside = eventCoverage(
      event({ eventDate: daysFrom(COVERAGE_NOTICE_DAYS) }),
      ASOF,
    );
    const justOutside = eventCoverage(
      event({ eventDate: daysFrom(COVERAGE_NOTICE_DAYS + 0.001) }),
      ASOF,
    );

    expect(justInside.state).toBe("uncovered");
    expect(justOutside.state).toBe("unassigned");
  });

  it("takes the notice window as a parameter so a ward could widen it", () => {
    // The one argument a ward-configurable window would cost, exercised here so that the day it
    // is wanted the function is already right.
    expect(eventCoverage(event({ eventDate: daysFrom(20) }), ASOF, 30).state).toBe("uncovered");
    expect(eventCoverage(event({ eventDate: daysFrom(6) }), ASOF, 2).state).toBe("unassigned");
  });

  it("marks a home event with somebody going as covered", () => {
    const coverage = eventCoverage(event({ attendeeCount: 1 }), ASOF);

    expect(coverage.state).toBe("covered");
    expect(coverage.attendeeCount).toBe(1);
  });

  it("counts more than one attendee", () => {
    expect(eventCoverage(event({ attendeeCount: 3 }), ASOF).attendeeCount).toBe(3);
  });

  it("marks an unclassified event as needs_type", () => {
    expect(eventCoverage(event({ eventType: "tbd" }), ASOF).state).toBe("needs_type");
  });

  // `needs_type` OUTRANKS `covered`: nobody can be asked to a game whose location nobody has
  // settled, and somebody having volunteered anyway does not settle it.
  it("keeps needs_type even when somebody has volunteered", () => {
    expect(eventCoverage(event({ eventType: "tbd", attendeeCount: 2 }), ASOF).state).toBe(
      "needs_type",
    );
  });

  it("is never uncovered for an away event, at any distance", () => {
    for (const days of [0.5, 1, 3, 6, 7, 8, 30, 200]) {
      const coverage = eventCoverage(
        event({ eventType: "away", eventDate: daysFrom(days) }),
        ASOF,
      );

      expect(coverage.state).toBe("awareness");
    }
  });

  // ---------------------------------------------------------------------------
  // THE USER'S RULE, BOTH DIRECTIONS
  // ---------------------------------------------------------------------------
  it("treats a cancelled event three days out as not expected", () => {
    expect(eventCoverage(event({ status: "cancelled" }), ASOF).state).toBe("not_expected");
  });

  it("treats a cancelled event three days PAST as not expected", () => {
    expect(
      eventCoverage(event({ status: "cancelled", eventDate: daysFrom(-3) }), ASOF).state,
    ).toBe("not_expected");
  });

  it("keeps a cancelled event out of every warning state, at every distance", () => {
    for (const days of [-200, -3, -0.5, 0.5, 3, 6, 7, 8, 200]) {
      for (const eventType of ["home", "away", "tbd"] as const) {
        const coverage = eventCoverage(
          event({ status: "cancelled", eventType, eventDate: daysFrom(days) }),
          ASOF,
        );

        expect(coverage.state).toBe("not_expected");
      }
    }
  });

  it("treats a past event as not expected", () => {
    expect(eventCoverage(event({ eventDate: daysFrom(-1) }), ASOF).state).toBe("not_expected");
  });

  // "Past" is the START instant, not an end — this schema has no duration column. A game that
  // kicked off an hour ago reads not_expected while it is still being played, which is correct
  // for "does somebody still need to be asked?" and would be wrong for slice D's question.
  it("treats an event that started an hour ago as past", () => {
    expect(eventCoverage(event({ eventDate: daysFrom(-1 / 24) }), ASOF).state).toBe(
      "not_expected",
    );
  });

  it("treats an unreadable date as not expected rather than as urgent", () => {
    expect(eventCoverage(event({ eventDate: "not a date" }), ASOF).state).toBe("not_expected");
  });

  it("returns a null daysUntil exactly when the state is not_expected", () => {
    const cases: EventCoverageInput[] = [
      event({ status: "cancelled" }),
      event({ eventDate: daysFrom(-3) }),
      event({ eventDate: "not a date" }),
      event({ eventDate: daysFrom(3) }),
      event({ eventType: "away" }),
      event({ eventType: "tbd" }),
      event({ attendeeCount: 1 }),
      event({ eventDate: daysFrom(30) }),
    ];

    for (const input of cases) {
      const coverage = eventCoverage(input, ASOF);

      expect(coverage.daysUntil === null).toBe(coverage.state === "not_expected");
    }
  });

  // FRACTIONAL, so a card can say "tomorrow" rather than rounding twenty hours down to 0 days.
  it("reports daysUntil fractionally", () => {
    expect(eventCoverage(event({ eventDate: daysFrom(0.5) }), ASOF).daysUntil).toBeCloseTo(
      0.5,
      5,
    );
  });
});

// ===========================================================================
// THE YOUNG PERSON IS NOT TAKING PART (migration 061)
// ===========================================================================
//
// THE WHOLE POINT OF THIS BLOCK IS THE DISTANCES. The branch sits beside `cancelled` and BEFORE
// the clock is consulted, and the only way to prove that is to assert it at four distances at
// once — thirty days out, one day out, exactly `asOf`, and thirty days past. An implementation
// that tested it after the arithmetic would pass the "past" case and fail these, which is exactly
// the mistake the ordering exists to prevent.
describe("eventCoverage — the young person is not taking part", () => {
  it("reads not_expected at EVERY distance from the clock", () => {
    for (const days of [30, 1, 0, -30]) {
      const coverage = eventCoverage(
        event({ eventDate: daysFrom(days), youthAttended: false }),
        ASOF,
      );

      expect(coverage.state).toBe("not_expected");
      expect(coverage.daysUntil).toBeNull();
    }
  });

  // The case that matters most: without the branch this is the loudest state on the page.
  it("beats an otherwise-uncovered home game inside the notice window", () => {
    const withoutTheMark = eventCoverage(event({ eventDate: daysFrom(3) }), ASOF);
    const withTheMark = eventCoverage(
      event({ eventDate: daysFrom(3), youthAttended: false }),
      ASOF,
    );

    expect(withoutTheMark.state).toBe("uncovered");
    expect(withTheMark.state).toBe("not_expected");
  });

  // youth-e's carry-the-whole-row lesson: the badge, the count and the date come off ONE object,
  // so a branch that dropped the count would put "Covered · 0" above a card reading "· 1".
  it("preserves attendeeCount on the absent branch", () => {
    const coverage = eventCoverage(event({ youthAttended: false, attendeeCount: 3 }), ASOF);

    expect(coverage.attendeeCount).toBe(3);
  });

  // `false` ONLY. Both other states are the ordinary case, and the rest of the function is about
  // the ordinary case.
  it("changes nothing for `true` or `null`", () => {
    for (const youthAttended of [true, null]) {
      expect(
        eventCoverage(event({ eventDate: daysFrom(3), youthAttended }), ASOF).state,
      ).toBe("uncovered");
      expect(
        eventCoverage(event({ eventDate: daysFrom(30), youthAttended }), ASOF).state,
      ).toBe("unassigned");
      expect(
        eventCoverage(event({ attendeeCount: 1, youthAttended }), ASOF).state,
      ).toBe("covered");
      expect(
        eventCoverage(event({ eventType: "away", youthAttended }), ASOF).state,
      ).toBe("awareness");
      expect(
        eventCoverage(event({ eventType: "tbd", youthAttended }), ASOF).state,
      ).toBe("needs_type");
    }
  });
});

describe("describeYouthAbsence", () => {
  it("names the young person", () => {
    expect(describeYouthAbsence(false, "Ethan Brooks")).toBe(
      "Ethan Brooks is not taking part",
    );
  });

  // "Someone" beats a blank where the profile is not in the reader's list.
  it("falls back to a truthful placeholder when the name is not known", () => {
    expect(describeYouthAbsence(false, null)).toBe("This young person is not taking part");
  });

  // TAKING PART IS THE ORDINARY CASE, and a chip on every card saying so is noise. Asserted as a
  // PAIR with the case above, so "delete the sentence" is not a passing fix for an over-eager one.
  it("says nothing at all for `true` or `null`", () => {
    expect(describeYouthAbsence(true, "Ethan Brooks")).toBeNull();
    expect(describeYouthAbsence(null, "Ethan Brooks")).toBeNull();
  });

  // TENSE-FREE ON PURPOSE — it renders on a game played last month and on next Friday's alike, so
  // it takes no clock at all. A signature that grew one would be the bug.
  it("is a pure function of one field and a name", () => {
    expect(describeYouthAbsence.length).toBe(2);
  });
});

describe("coverageRank", () => {
  // The ORDER IS THE RANK, read from the one array rather than from a second map that could
  // disagree with it.
  it("orders the states as COVERAGE_STATES is written", () => {
    expect(COVERAGE_STATES.map(coverageRank)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("puts needs_type above unassigned and awareness below covered", () => {
    // The two non-obvious placements, asserted rather than left to a comment. An event nobody has
    // classified blocks every decision behind it; an away game with nobody going is the designed
    // outcome and is not a failure.
    expect(coverageRank("needs_type")).toBeLessThan(coverageRank("unassigned"));
    expect(coverageRank("uncovered")).toBeLessThan(coverageRank("needs_type"));
    expect(coverageRank("awareness")).toBeGreaterThan(coverageRank("covered"));
    expect(coverageRank("not_expected")).toBe(COVERAGE_STATES.length - 1);
  });
});

describe("summariseCoverage", () => {
  it("counts every state, including the zeroes", () => {
    const summary = summariseCoverage([
      eventCoverage(event({ eventDate: daysFrom(3) }), ASOF),
      eventCoverage(event({ eventDate: daysFrom(4) }), ASOF),
      eventCoverage(event({ attendeeCount: 1 }), ASOF),
      eventCoverage(event({ eventType: "away" }), ASOF),
    ]);

    expect(summary.uncovered).toBe(2);
    expect(summary.covered).toBe(1);
    expect(summary.awareness).toBe(1);
    // Present rather than undefined, so a caller reading a zero never has to decide what a
    // missing key meant.
    expect(summary.needs_type).toBe(0);
    expect(summary.not_expected).toBe(0);
  });

  it("returns every state at zero for an empty list", () => {
    const summary = summariseCoverage([]);

    for (const state of COVERAGE_STATES) {
      expect(summary[state]).toBe(0);
    }
  });
});
