import { describe, expect, it } from "vitest";
import {
  addMonths,
  lastDayOfMonth,
  monthStart,
  sundaysInRange,
  type DateOnly,
} from "@/lib/calendar/dates";
import { CALENDAR_HORIZON_MONTHS } from "@/lib/calendar/queries";

// The arithmetic behind ensureHorizonGenerated()'s coverage check, tested where it is pure.
//
// WHY THIS SUITE IS WORTH HAVING: the check is what makes the horizon a NO-OP once the year is
// full. It compares a COUNT of stored rows against sundaysInRange(from, to).length, so if the
// range these two lines produce is off by even one Sunday the count can never match, and a read
// becomes a ~52-row upsert on EVERY calendar page load — plans/retros/calendar-c-rotation-
// cadence.md is about exactly that failure. The bug is silent: the page still renders correctly.
//
// No database and no clock. `today` is supplied, so nothing here can pass by accident on the day
// it is run.

// Deliberately re-derived here rather than imported from the module under test, so a change to
// the range inside ensureHorizonGenerated() fails this suite instead of moving with it.
function horizonRange(today: DateOnly): { from: DateOnly; to: DateOnly } {
  const from = monthStart(today);
  return { from, to: lastDayOfMonth(addMonths(from, CALENDAR_HORIZON_MONTHS - 1)) };
}

describe("the calendar horizon range", () => {
  it("is twelve months", () => {
    expect(CALENDAR_HORIZON_MONTHS).toBe(12);
  });

  it("spans twelve whole months from a date mid-month", () => {
    expect(horizonRange("2026-09-23")).toEqual({ from: "2026-09-01", to: "2027-08-31" });
  });

  it("spans twelve whole months from the first of a month", () => {
    expect(horizonRange("2026-09-01")).toEqual({ from: "2026-09-01", to: "2027-08-31" });
  });

  // addMonths() clamps rather than rolling over, and the range is built from monthStart() anyway
  // — so the 31st and the 1st of the same month produce the identical range. A rolling addMonths
  // would have skipped a month here.
  it("spans twelve whole months from the last day of a 31-day month", () => {
    expect(horizonRange("2026-01-31")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("crosses the year boundary and lands in the following December", () => {
    expect(horizonRange("2026-12-15")).toEqual({ from: "2026-12-01", to: "2027-11-30" });
  });

  it("ends on a February that a leap year makes 29 days long", () => {
    expect(horizonRange("2027-03-10")).toEqual({ from: "2027-03-01", to: "2028-02-29" });
  });
});

describe("the number of Sundays the horizon expects", () => {
  // A year contains at least 52 Sundays and at most 53. An off-by-one in either direction is the
  // dangerous case: expecting 51 would make the stored count permanently exceed the expectation
  // (harmless), while expecting 54 would make it permanently short and generate on every view.
  it("is 52 or 53 for every start month of a year, leap year included", () => {
    const starts: DateOnly[] = [
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
      "2026-05-15",
      "2026-06-15",
      "2026-07-15",
      "2026-08-15",
      "2026-09-15",
      "2026-10-15",
      "2026-11-15",
      "2026-12-15",
      // Spans 29 February 2028.
      "2027-06-15",
      "2027-09-15",
    ];

    for (const today of starts) {
      const { from, to } = horizonRange(today);
      const count = sundaysInRange(from, to).length;

      expect(count, `${today} produced ${count} Sundays`).toBeGreaterThanOrEqual(52);
      expect(count, `${today} produced ${count} Sundays`).toBeLessThanOrEqual(53);
    }
  });

  // The count is inclusive at both ends — sundaysInRange() says so — and the horizon leans on
  // that. A range whose first day is itself a Sunday must include it, or the very first month of
  // a ward's first visit would come up one short for ever.
  it("includes a first day that is itself a Sunday", () => {
    const { from } = horizonRange("2026-11-01");

    expect(from).toBe("2026-11-01");
    expect(sundaysInRange(from, "2026-11-01")).toEqual(["2026-11-01"]);
  });

  // The other end, asserted separately: 2027-10-31 is a Sunday, and it is the last day of the
  // horizon that starts in November 2026.
  it("includes a last day that is itself a Sunday", () => {
    const { to } = horizonRange("2026-11-15");

    expect(to).toBe("2027-10-31");
    expect(sundaysInRange("2027-10-24", to)).toEqual(["2027-10-24", "2027-10-31"]);
  });
});
