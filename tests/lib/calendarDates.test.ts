import { describe, expect, it } from "vitest";
import {
  addDaysUtc,
  addMonths,
  countSundaysBetween,
  isValidDateOnly,
  lastDayOfMonth,
  firstSundayOnOrAfter,
  formatDateOnly,
  isSunday,
  monthOf,
  monthStart,
  parseDateOnly,
  sundaysInRange,
} from "@/lib/calendar/dates";

// The suite that pins 03-calendar.md's headline pitfall. Every assertion here fails on a machine
// west of UTC if any of these helpers touches local time, which is exactly the point — these run
// on a developer machine in America/Denver and in CI in UTC and must agree.

describe("parseDateOnly", () => {
  it("rejects a month that does not exist", () => {
    expect(() => parseDateOnly("2026-13-01")).toThrow();
  });

  it("rejects a day the month does not have", () => {
    expect(() => parseDateOnly("2026-02-30")).toThrow();
  });

  it("rejects an unpadded date", () => {
    expect(() => parseDateOnly("2026-3-1")).toThrow();
  });

  it("rejects a full ISO timestamp", () => {
    expect(() => parseDateOnly("2026-03-01T00:00:00.000Z")).toThrow();
  });

  it("accepts a leap day that exists and rejects one that does not", () => {
    expect(() => parseDateOnly("2024-02-29")).not.toThrow();
    expect(() => parseDateOnly("2026-02-29")).toThrow();
  });

  it("parses to UTC midnight, not local midnight", () => {
    expect(parseDateOnly("2026-03-01").toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("formatDateOnly", () => {
  it("round-trips every day of a year without drifting", () => {
    let current = "2026-01-01";

    for (let index = 0; index < 365; index += 1) {
      expect(formatDateOnly(parseDateOnly(current))).toBe(current);
      current = addDaysUtc(current, 1);
    }

    expect(current).toBe("2027-01-01");
  });
});

describe("addDaysUtc", () => {
  // US daylight saving in 2026 starts on March 8 and ends on November 1. A helper built on
  // setDate() or on a local-time Date loses or gains a day at exactly these two points.
  it("crosses the start of daylight saving without shifting the day", () => {
    expect(addDaysUtc("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDaysUtc("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDaysUtc("2026-03-01", 7)).toBe("2026-03-08");
  });

  it("crosses the end of daylight saving without shifting the day", () => {
    expect(addDaysUtc("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysUtc("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDaysUtc("2026-10-25", 7)).toBe("2026-11-01");
  });

  it("goes backwards and across a year boundary", () => {
    expect(addDaysUtc("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysUtc("2024-02-28", 1)).toBe("2024-02-29");
  });
});

describe("isSunday and firstSundayOnOrAfter", () => {
  it("reads the weekday in UTC", () => {
    expect(isSunday("2026-01-04")).toBe(true);
    expect(isSunday("2026-01-05")).toBe(false);
  });

  it("returns a Sunday unchanged", () => {
    expect(firstSundayOnOrAfter("2026-01-04")).toBe("2026-01-04");
  });

  it("moves forward to the next Sunday from any other day", () => {
    expect(firstSundayOnOrAfter("2026-01-01")).toBe("2026-01-04");
    expect(firstSundayOnOrAfter("2026-01-05")).toBe("2026-01-11");
  });
});

describe("sundaysInRange", () => {
  it("is inclusive at both ends when both are Sundays", () => {
    expect(sundaysInRange("2026-01-04", "2026-01-25")).toEqual([
      "2026-01-04",
      "2026-01-11",
      "2026-01-18",
      "2026-01-25",
    ]);
  });

  it("crosses a month boundary", () => {
    expect(sundaysInRange("2026-01-26", "2026-02-08")).toEqual([
      "2026-02-01",
      "2026-02-08",
    ]);
  });

  it("crosses a year boundary", () => {
    expect(sundaysInRange("2025-12-28", "2026-01-04")).toEqual([
      "2025-12-28",
      "2026-01-04",
    ]);
  });

  it("handles a leap year February", () => {
    expect(sundaysInRange("2024-02-01", "2024-02-29")).toEqual([
      "2024-02-04",
      "2024-02-11",
      "2024-02-18",
      "2024-02-25",
    ]);
  });

  it("returns nothing for a range with no Sunday in it", () => {
    expect(sundaysInRange("2026-01-05", "2026-01-10")).toEqual([]);
  });
});

describe("monthStart, monthOf and addMonths", () => {
  it("derives the first of the month and the grouping key", () => {
    expect(monthStart("2026-03-29")).toBe("2026-03-01");
    expect(monthOf("2026-03-29")).toBe("2026-03");
  });

  it("rejects a malformed value rather than slicing it", () => {
    expect(() => monthStart("2026-3-29")).toThrow();
    expect(() => monthOf("not-a-date")).toThrow();
  });

  it("clamps rather than rolling over into the following month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("crosses a year boundary in both directions", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
  });
});

describe("countSundaysBetween", () => {
  it("counts adjacent Sundays as one and the same Sunday as zero", () => {
    expect(countSundaysBetween("2026-01-04", "2026-01-11")).toBe(1);
    expect(countSundaysBetween("2026-01-04", "2026-01-04")).toBe(0);
  });

  it("counts across a DST boundary in whole weeks", () => {
    expect(countSundaysBetween("2026-03-01", "2026-03-29")).toBe(4);
    expect(countSundaysBetween("2026-10-25", "2026-11-08")).toBe(2);
  });

  it("returns a negative count for a date before the anchor", () => {
    expect(countSundaysBetween("2026-01-11", "2026-01-04")).toBe(-1);
  });

  it("refuses two dates that are not both Sundays", () => {
    expect(() => countSundaysBetween("2026-01-05", "2026-01-11")).toThrow();
    expect(() => countSundaysBetween("2026-01-04", "2026-01-12")).toThrow();
  });
});

describe("isValidDateOnly", () => {
  it("answers yes or no rather than throwing", () => {
    expect(isValidDateOnly("2026-03-01")).toBe(true);
    expect(isValidDateOnly("2024-02-29")).toBe(true);
    expect(isValidDateOnly("2026-02-29")).toBe(false);
    expect(isValidDateOnly("2026-02-31")).toBe(false);
    expect(isValidDateOnly("2026-13-01")).toBe(false);
    expect(isValidDateOnly("2026-3-1")).toBe(false);
    expect(isValidDateOnly("")).toBe(false);
  });
});

describe("lastDayOfMonth", () => {
  // Pasting "-31" onto a month is how you ask Postgres for 2026-02-31 and get a 500.
  it("works the day out rather than assuming 31", () => {
    expect(lastDayOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(lastDayOfMonth("2024-02-10")).toBe("2024-02-29");
    expect(lastDayOfMonth("2026-04-01")).toBe("2026-04-30");
    expect(lastDayOfMonth("2026-01-01")).toBe("2026-01-31");
    expect(lastDayOfMonth("2026-12-31")).toBe("2026-12-31");
  });
});
