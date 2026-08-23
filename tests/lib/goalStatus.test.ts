import { describe, expect, it } from "vitest";
import { addDaysUtc, addMonths, parseDateOnly, type DateOnly } from "@/lib/calendar/dates";
import {
  compareGoalsByStatus,
  DUE_SOON_FRACTION,
  goalStatus,
  goalStatusFor,
} from "@/lib/goals/goalStatus";

// `asOf` is driven by every case; nothing here reads the clock, for the same reason
// tests/lib/reliabilityFlags.test.ts does not.
//
// The 80% boundary is built rather than guessed: a twelve-month interval anchored on 2025-01-01
// runs 365 days, and 80% of 365 is exactly 292 — so `anchor + 292 days` IS the boundary and
// `+ 291` is the last day before it. Picking a date by eye and hoping it lands on 80% is how a
// boundary test passes while testing 79%.

const ANCHOR: DateOnly = "2025-01-01";
const FREQUENCY_MONTHS = 12;
const INTERVAL_DAYS = 365;
const BOUNDARY_DAYS = INTERVAL_DAYS * DUE_SOON_FRACTION;

function on(date: DateOnly): Date {
  return parseDateOnly(date);
}

describe("goalStatus", () => {
  it("confirms the fixture really is a whole number of days at the boundary", () => {
    // If this ever fails, every boundary assertion below is testing a date near 80% rather than
    // the boundary itself.
    expect(Number.isInteger(BOUNDARY_DAYS)).toBe(true);
    expect(addMonths(ANCHOR, FREQUENCY_MONTHS)).toBe(addDaysUtc(ANCHOR, INTERVAL_DAYS));
  });

  describe("a goal that has been fulfilled", () => {
    it("is on_track below 80% of the interval", () => {
      const asOf = on(addDaysUtc(ANCHOR, BOUNDARY_DAYS - 1));

      expect(goalStatus(on(ANCHOR), FREQUENCY_MONTHS, asOf, on("2020-01-01"))).toBe("on_track");
    });

    it("is due_soon at exactly 80%", () => {
      const asOf = on(addDaysUtc(ANCHOR, BOUNDARY_DAYS));

      expect(goalStatus(on(ANCHOR), FREQUENCY_MONTHS, asOf, on("2020-01-01"))).toBe("due_soon");
    });

    it("is still due_soon the day before the interval ends", () => {
      const asOf = on(addDaysUtc(ANCHOR, INTERVAL_DAYS - 1));

      expect(goalStatus(on(ANCHOR), FREQUENCY_MONTHS, asOf, on("2020-01-01"))).toBe("due_soon");
    });

    it("is overdue on the day the interval ends", () => {
      const asOf = on(addMonths(ANCHOR, FREQUENCY_MONTHS));

      expect(goalStatus(on(ANCHOR), FREQUENCY_MONTHS, asOf, on("2020-01-01"))).toBe("overdue");
    });

    it("is overdue past the interval", () => {
      const asOf = on(addMonths(ANCHOR, FREQUENCY_MONTHS + 6));

      expect(goalStatus(on(ANCHOR), FREQUENCY_MONTHS, asOf, on("2020-01-01"))).toBe("overdue");
    });

    it("measures from the fulfilment date, not from creation", () => {
      // A goal created three years ago and fulfilled yesterday is on track. The createdAt
      // parameter exists for the NEVER-fulfilled case and must not override a real fulfilment.
      const asOf = on(addDaysUtc(ANCHOR, 1));

      expect(goalStatus(on(ANCHOR), FREQUENCY_MONTHS, asOf, on("2022-01-01"))).toBe("on_track");
    });
  });

  describe("a goal that has never been fulfilled", () => {
    it("is on_track before the interval has passed since creation", () => {
      const asOf = on(addDaysUtc(ANCHOR, 30));

      expect(goalStatus(null, FREQUENCY_MONTHS, asOf, on(ANCHOR))).toBe("on_track");
    });

    it("is due_soon at 80% of the interval since creation", () => {
      const asOf = on(addDaysUtc(ANCHOR, BOUNDARY_DAYS));

      expect(goalStatus(null, FREQUENCY_MONTHS, asOf, on(ANCHOR))).toBe("due_soon");
    });

    it("is overdue once the interval has passed since creation", () => {
      const asOf = on(addMonths(ANCHOR, FREQUENCY_MONTHS));

      expect(goalStatus(null, FREQUENCY_MONTHS, asOf, on(ANCHOR))).toBe("overdue");
    });
  });

  describe("edges", () => {
    it("reads a zero interval as overdue rather than dividing by it", () => {
      // lib/validation/goal.ts refuses a frequency below 1, so this is a row written outside this
      // app. It must not throw and it must not return NaN.
      expect(goalStatus(on(ANCHOR), 0, on(addDaysUtc(ANCHOR, 5)), on(ANCHOR))).toBe("overdue");
    });

    it("reads a negative interval as overdue", () => {
      expect(goalStatus(on(ANCHOR), -3, on(addDaysUtc(ANCHOR, 5)), on(ANCHOR))).toBe("overdue");
    });

    it("reads a fulfilment date in the future as on_track", () => {
      // Clock skew between the database and the browser, not a state the app can produce. A
      // negative elapsed fraction must not come out as due_soon.
      const asOf = on(ANCHOR);

      expect(goalStatus(on(addDaysUtc(ANCHOR, 3)), FREQUENCY_MONTHS, asOf, on(ANCHOR))).toBe(
        "on_track",
      );
    });

    it("clamps a month-end anchor rather than rolling it over", () => {
      // 2025-01-31 plus one month is 2025-02-28, not 2025-03-03. A rollover would make a goal
      // anchored on the 31st due three days later than one anchored on the 28th.
      expect(goalStatus(on("2025-01-31"), 1, on("2025-02-28"), on("2020-01-01"))).toBe("overdue");
      expect(goalStatus(on("2025-01-31"), 1, on("2025-02-27"), on("2020-01-01"))).toBe("due_soon");
    });
  });

  describe("goalStatusFor", () => {
    it("returns null when the goal has no frequency, rather than guessing a bucket", () => {
      const status = goalStatusFor(
        {
          lastFulfilledAt: null,
          desiredFrequencyMonths: null,
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        on("2026-08-22"),
      );

      expect(status).toBeNull();
    });

    it("reads a timestamptz down to the day it names", () => {
      const status = goalStatusFor(
        {
          lastFulfilledAt: `${ANCHOR}T23:59:59.000Z`,
          desiredFrequencyMonths: FREQUENCY_MONTHS,
          createdAt: "2020-01-01T00:00:00.000Z",
        },
        on(addDaysUtc(ANCHOR, BOUNDARY_DAYS)),
      );

      expect(status).toBe("due_soon");
    });
  });

  describe("compareGoalsByStatus", () => {
    it("sorts overdue first, then due_soon, then on_track, then statusless", () => {
      const goals = [
        { status: null, title: "No frequency" },
        { status: "on_track" as const, title: "Fine" },
        { status: "overdue" as const, title: "Late" },
        { status: "due_soon" as const, title: "Soon" },
      ];

      expect([...goals].sort(compareGoalsByStatus).map((goal) => goal.title)).toEqual([
        "Late",
        "Soon",
        "Fine",
        "No frequency",
      ]);
    });

    it("sorts by title within a bucket, so the same list renders the same way twice", () => {
      const goals = [
        { status: "overdue" as const, title: "Beta" },
        { status: "overdue" as const, title: "Alpha" },
      ];

      expect([...goals].sort(compareGoalsByStatus).map((goal) => goal.title)).toEqual([
        "Alpha",
        "Beta",
      ]);
    });
  });
});
