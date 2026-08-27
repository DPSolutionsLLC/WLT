import { describe, expect, it } from "vitest";
import { formatOverdueFor, formatVisitDate, NO_DATE } from "@/lib/visits/visitDates";

// `formatOverdueFor` replaced the percentage the priority badge used to carry.
//
// A percentage is the right thing to SORT on and the wrong thing to read: 109% and 110% are a
// month apart on a yearly cadence and a day apart on a monthly one, and the reader cannot tell
// which without doing the arithmetic. This function is the same fact in the unit somebody acts in.
//
// Every boundary below is stated as a pair — the last value in one band and the first value in the
// next — because a unit that steps up at the wrong place is invisible until somebody reads a
// household as "1 week overdue" when it is nine days.

// A UTC-midnight Date for a YYYY-MM-DD day, so `asOf` and the date-only strings agree.
function at(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

describe("formatOverdueFor — days", () => {
  it("reads a single day in the singular", () => {
    expect(formatOverdueFor("2026-08-01", at("2026-08-02"))).toBe("1 day overdue");
  });

  it("counts whole days up to the last day before two weeks", () => {
    expect(formatOverdueFor("2026-08-01", at("2026-08-03"))).toBe("2 days overdue");
    expect(formatOverdueFor("2026-08-01", at("2026-08-14"))).toBe("13 days overdue");
  });
});

describe("formatOverdueFor — weeks", () => {
  // THE BOUNDARY. 13 days is still days; 14 is two weeks.
  it("steps up to weeks at exactly fourteen days", () => {
    expect(formatOverdueFor("2026-08-01", at("2026-08-14"))).toBe("13 days overdue");
    expect(formatOverdueFor("2026-08-01", at("2026-08-15"))).toBe("2 weeks overdue");
  });

  it("floors to whole weeks rather than rounding", () => {
    // 20 days is two weeks and six days, and reads as two — never "3 weeks", which would
    // overstate how late the household is.
    expect(formatOverdueFor("2026-08-01", at("2026-08-21"))).toBe("2 weeks overdue");
    expect(formatOverdueFor("2026-08-01", at("2026-08-22"))).toBe("3 weeks overdue");
  });
});

describe("formatOverdueFor — months", () => {
  // Months come from countMonthsBetween(), not from dividing days, so "2 months overdue" means
  // the calendar month actually turned twice rather than 60-odd days having passed.
  it("steps up to months once two calendar months have turned", () => {
    expect(formatOverdueFor("2026-06-15", at("2026-08-14"))).toBe("8 weeks overdue");
    expect(formatOverdueFor("2026-06-15", at("2026-08-15"))).toBe("2 months overdue");
  });

  it("counts months up to the last month before a year", () => {
    expect(formatOverdueFor("2025-09-15", at("2026-08-15"))).toBe("11 months overdue");
  });
});

describe("formatOverdueFor — years", () => {
  // A HOUSEHOLD TWELVE MONTHS PAST DUE READS "1 year overdue", not "12 months overdue".
  it("steps up to years at exactly twelve months", () => {
    expect(formatOverdueFor("2025-09-15", at("2026-08-15"))).toBe("11 months overdue");
    expect(formatOverdueFor("2025-08-15", at("2026-08-15"))).toBe("1 year overdue");
  });

  it("carries the remaining months when there are any", () => {
    expect(formatOverdueFor("2025-01-15", at("2026-08-15"))).toBe("1y 7m overdue");
    expect(formatOverdueFor("2023-08-15", at("2026-08-15"))).toBe("3 years overdue");
  });

  it("drops the remainder when the years are whole", () => {
    expect(formatOverdueFor("2024-08-15", at("2026-08-15"))).toBe("2 years overdue");
  });
});

describe("formatOverdueFor — the guard", () => {
  // The badge only calls this for an overdue row, so a non-positive gap means a caller has
  // drifted rather than a state a user can reach. It returns a sentence rather than a negative
  // count, because a badge reading "-3 days overdue" is worse than one reading something true.
  it("says due today on the due date itself", () => {
    expect(formatOverdueFor("2026-08-15", at("2026-08-15"))).toBe("due today");
  });

  it("says due today for a date still in the future", () => {
    expect(formatOverdueFor("2026-09-15", at("2026-08-15"))).toBe("due today");
  });
});

describe("formatOverdueFor — the clock is a parameter", () => {
  // The same discipline householdVisitPriority() keeps. A `new Date()` inside would make every
  // assertion above depend on the day the suite ran, and would let the top of a long list be
  // judged against a different instant from the bottom.
  it("answers only from its arguments", () => {
    const dueOn = "2026-01-01";
    expect(formatOverdueFor(dueOn, at("2026-03-01"))).toBe("2 months overdue");
    expect(formatOverdueFor(dueOn, at("2026-03-01"))).toBe("2 months overdue");
  });
});

describe("formatVisitDate", () => {
  // Kept alongside the new formatter because they are the same decision: this module renders the
  // YEAR on every date, since a visits list spans years and "June 7" above "June 2" hides that
  // those are two years apart.
  it("renders the year", () => {
    expect(formatVisitDate("2025-07-23")).toBe("Jul 23, 2025");
    expect(formatVisitDate("2026-07-28")).toBe("Jul 28, 2026");
  });

  it("renders an em dash rather than an empty string for no date", () => {
    expect(formatVisitDate(null)).toBe(NO_DATE);
    expect(NO_DATE).toBe("—");
  });
});
