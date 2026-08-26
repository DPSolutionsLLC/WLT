import { describe, expect, it } from "vitest";
import { addDaysUtc, addMonths, parseDateOnly, type DateOnly } from "@/lib/calendar/dates";
import {
  compareByStatus,
  DUE_SOON_FRACTION,
  householdVisitStatus,
  statusRank,
} from "@/lib/visits/householdStatus";
import { CADENCE_MONTHS } from "@/lib/validation/visit";

// `asOf` is driven by every case; nothing here reads the clock. That is the whole reason the
// function takes it as a parameter — tests/lib/goalStatus.test.ts makes the same point.
//
// ---------------------------------------------------------------------------------------------
// THE BOUNDARY IS BUILT, NOT GUESSED
// ---------------------------------------------------------------------------------------------
// A twelve-month interval anchored on 2026-01-01 runs 365 days, and 80% of 365 is exactly 292 —
// so `anchor + 292 days` IS the boundary and `+ 291` is the last day before it.
//
// visits-b's plan named 2026-10-21 and 2026-10-22 as those two dates. They are 2026-10-19 and
// 2026-10-20: the plan's table was a day or two out, and asserting the dates it named would have
// been a boundary test quietly checking 80.3% instead of 80%. Recorded as a deviation in this
// slice's retro. Picking a date by eye and hoping it lands on the boundary is how a boundary test
// passes while testing the wrong number.

const PERIOD_START: DateOnly = "2026-01-01";
const CADENCE = CADENCE_MONTHS.annual;
const INTERVAL_DAYS = 365;
const BOUNDARY_DAYS = INTERVAL_DAYS * DUE_SOON_FRACTION;

function on(date: DateOnly): Date {
  return parseDateOnly(date);
}

// Named arguments at the call site would be nicer, but the function is positional to match
// goalStatus(). This wrapper keeps the five arguments from being read in the wrong order fifty
// times below.
function statusOn(
  asOf: DateOnly,
  options: {
    lastCompletedOn?: DateOnly | null;
    lastAttemptedInPeriodOn?: DateOnly | null;
    cadenceMonths?: number;
    periodStart?: DateOnly;
  } = {},
) {
  return householdVisitStatus(
    options.lastCompletedOn ?? null,
    options.lastAttemptedInPeriodOn ?? null,
    options.cadenceMonths ?? CADENCE,
    on(asOf),
    options.periodStart ?? PERIOD_START,
  );
}

describe("householdVisitStatus", () => {
  it("confirms the fixture really is a whole number of days at the boundary", () => {
    // If this ever fails, every boundary assertion below is testing a date NEAR 80% rather than
    // the boundary itself.
    expect(Number.isInteger(BOUNDARY_DAYS)).toBe(true);
    expect(addMonths(PERIOD_START, CADENCE)).toBe(addDaysUtc(PERIOD_START, INTERVAL_DAYS));
  });

  describe("a household visited inside the period", () => {
    const lastCompletedOn = PERIOD_START;

    // Table-driven, at the boundaries and nowhere in the middle of the range.
    const cases: { asOf: DateOnly; expected: string; why: string }[] = [
      { asOf: PERIOD_START, expected: "visited", why: "the day of the visit" },
      {
        asOf: addDaysUtc(PERIOD_START, BOUNDARY_DAYS - 1),
        expected: "visited",
        why: "the last day below 80% of the interval",
      },
      {
        asOf: addDaysUtc(PERIOD_START, BOUNDARY_DAYS),
        expected: "due_soon",
        why: "exactly 80% of the interval",
      },
      {
        asOf: addDaysUtc(PERIOD_START, INTERVAL_DAYS - 1),
        expected: "due_soon",
        why: "one day short of the interval",
      },
      {
        asOf: addMonths(PERIOD_START, CADENCE),
        expected: "overdue",
        why: "the interval has elapsed exactly",
      },
      {
        asOf: addDaysUtc(PERIOD_START, INTERVAL_DAYS + 400),
        expected: "overdue",
        why: "long past the interval",
      },
    ];

    for (const { asOf, expected, why } of cases) {
      it(`is ${expected} on ${asOf} — ${why}`, () => {
        expect(statusOn(asOf, { lastCompletedOn })).toBe(expected);
      });
    }
  });

  describe("a household never visited", () => {
    // The reason periodStart is a required parameter. Without it, a goal that started last week
    // and one that started two years ago give the same answer — the hole talks-d found in
    // goalStatus() and closed with `createdAt`.
    it("anchors on the period start, not on nothing", () => {
      expect(statusOn(addMonths(PERIOD_START, CADENCE))).toBe("overdue");
    });

    it("is not_yet_visited inside a period that has only just started", () => {
      expect(statusOn(addDaysUtc(PERIOD_START, 3))).toBe("not_yet_visited");
    });

    // Deliberately NOT due_soon. "Nobody has been yet" is a different job from "somebody needs to
    // go again", even when the calendar pressure is identical.
    it("is still not_yet_visited at 80% of the period", () => {
      expect(statusOn(addDaysUtc(PERIOD_START, BOUNDARY_DAYS))).toBe("not_yet_visited");
    });

    it("becomes overdue once the interval has passed since the period started", () => {
      expect(statusOn(addDaysUtc(PERIOD_START, INTERVAL_DAYS + 1))).toBe("overdue");
    });
  });

  describe("attempts", () => {
    // The fifth state, and the reason it is evaluated first: it is the more specific — and the
    // more actionable — statement about a household than "not yet visited".
    it("reads attempted_never_reached when there is an attempt and no completed visit", () => {
      expect(
        statusOn(addDaysUtc(PERIOD_START, 30), {
          lastAttemptedInPeriodOn: addDaysUtc(PERIOD_START, 20),
        }),
      ).toBe("attempted_never_reached");
    });

    // An attempt counts towards NOTHING. A household with an attempt and no completed visit is
    // not visited, however many times somebody knocked.
    it("does not become visited however recent the attempt is", () => {
      expect(
        statusOn(PERIOD_START, { lastAttemptedInPeriodOn: PERIOD_START }),
      ).not.toBe("visited");
    });

    it("outranks overdue — somebody is already trying, and knocking again is not the answer", () => {
      expect(
        statusOn(addDaysUtc(PERIOD_START, INTERVAL_DAYS + 30), {
          lastAttemptedInPeriodOn: addDaysUtc(PERIOD_START, INTERVAL_DAYS),
        }),
      ).toBe("attempted_never_reached");
    });

    // A completed visit INSIDE the period settles it. The attempt is then just an extra knock on
    // a household already reached.
    it("is ignored once the household has been visited in the period", () => {
      expect(
        statusOn(addDaysUtc(PERIOD_START, 30), {
          lastCompletedOn: addDaysUtc(PERIOD_START, 10),
          lastAttemptedInPeriodOn: addDaysUtc(PERIOD_START, 20),
        }),
      ).toBe("visited");
    });

    // A visit BEFORE the period does not settle it — that is a household this period has not
    // reached, which is exactly what `attempted_never_reached` says.
    it("still reports attempted_never_reached when the only visit predates the period", () => {
      expect(
        statusOn(addDaysUtc(PERIOD_START, 30), {
          lastCompletedOn: "2024-06-01",
          lastAttemptedInPeriodOn: addDaysUtc(PERIOD_START, 20),
        }),
      ).toBe("attempted_never_reached");
    });
  });

  describe("cadences other than annual", () => {
    it("finds its own boundary for biannual", () => {
      const months = CADENCE_MONTHS.biannual;
      const due = addMonths(PERIOD_START, months);
      const intervalDays =
        (parseDateOnly(due).getTime() - parseDateOnly(PERIOD_START).getTime()) / 86_400_000;
      const boundary = Math.ceil(intervalDays * DUE_SOON_FRACTION);

      expect(
        statusOn(addDaysUtc(PERIOD_START, boundary - 1), {
          lastCompletedOn: PERIOD_START,
          cadenceMonths: months,
        }),
      ).toBe("visited");

      expect(
        statusOn(addDaysUtc(PERIOD_START, boundary), {
          lastCompletedOn: PERIOD_START,
          cadenceMonths: months,
        }),
      ).toBe("due_soon");

      expect(
        statusOn(due, { lastCompletedOn: PERIOD_START, cadenceMonths: months }),
      ).toBe("overdue");
    });

    it("finds its own boundary for a custom three-month cadence", () => {
      const months = 3;
      const due = addMonths(PERIOD_START, months);

      expect(
        statusOn(addDaysUtc(due, -1), { lastCompletedOn: PERIOD_START, cadenceMonths: months }),
      ).toBe("due_soon");

      expect(
        statusOn(due, { lastCompletedOn: PERIOD_START, cadenceMonths: months }),
      ).toBe("overdue");
    });
  });

  describe("intervals that cannot divide", () => {
    // lib/validation/visit.ts refuses to save either, so these only reach the function from a row
    // written outside this app. "Overdue" is the honest reading of an interval that has already
    // elapsed — it is never a silent NaN or a crash.
    it("reads a zero cadence as overdue", () => {
      expect(statusOn("2026-06-01", { lastCompletedOn: PERIOD_START, cadenceMonths: 0 })).toBe(
        "overdue",
      );
    });

    it("reads a negative cadence as overdue", () => {
      expect(statusOn("2026-06-01", { lastCompletedOn: PERIOD_START, cadenceMonths: -1 })).toBe(
        "overdue",
      );
    });
  });

  // Clock skew between the database and the browser. Negative elapsed time reads as `visited`,
  // which is right: nothing is due yet.
  it("reads a date before the anchor as visited", () => {
    expect(statusOn("2025-11-01", { lastCompletedOn: PERIOD_START })).toBe("visited");
  });
});

describe("compareByStatus", () => {
  // The dashboard opens on what somebody has to act on. A list that opens on what is settled is
  // a list nobody scrolls.
  it("ranks overdue first and visited last", () => {
    expect(statusRank("overdue")).toBeLessThan(statusRank("attempted_never_reached"));
    expect(statusRank("attempted_never_reached")).toBeLessThan(statusRank("due_soon"));
    expect(statusRank("due_soon")).toBeLessThan(statusRank("not_yet_visited"));
    expect(statusRank("not_yet_visited")).toBeLessThan(statusRank("visited"));
  });

  it("sorts a statusless household — no goal to judge it against — last of all", () => {
    expect(statusRank(null)).toBeGreaterThan(statusRank("visited"));
  });

  it("falls back to the family name within one status", () => {
    const rows = [
      { status: "overdue" as const, familyName: "Whitfield" },
      { status: "overdue" as const, familyName: "Brooks" },
      { status: "visited" as const, familyName: "Andersen" },
    ];

    expect([...rows].sort(compareByStatus).map((row) => row.familyName)).toEqual([
      "Brooks",
      "Whitfield",
      "Andersen",
    ]);
  });
});
