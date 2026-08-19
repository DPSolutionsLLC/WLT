import { afterEach, describe, expect, it, vi } from "vitest";
import {
  daysInMonth,
  formatSundayLabel,
  leadingBlankDays,
  monthLabel,
  parseMonthParam,
} from "@/lib/calendar/dates";

// The month-view half of the timezone defence. calendarDates.test.ts pins the arithmetic; this
// suite pins what a USER READS — the point 03-calendar.md's headline pitfall actually bites.

describe("parseMonthParam", () => {
  it("accepts a well-formed month and returns its first day", () => {
    expect(parseMonthParam("2026-03", "2026-08-18")).toBe("2026-03-01");
    expect(parseMonthParam("2026-12", "2026-08-18")).toBe("2026-12-01");
  });

  it("falls back to the month containing today rather than erroring", () => {
    // A mistyped URL should show a calendar, not a stack trace.
    expect(parseMonthParam("2026-13", "2026-08-18")).toBe("2026-08-01");
    expect(parseMonthParam("march", "2026-08-18")).toBe("2026-08-01");
    expect(parseMonthParam("2026-3", "2026-08-18")).toBe("2026-08-01");
    expect(parseMonthParam("2026-00", "2026-08-18")).toBe("2026-08-01");
    expect(parseMonthParam("", "2026-08-18")).toBe("2026-08-01");
    expect(parseMonthParam(undefined, "2026-08-18")).toBe("2026-08-01");
  });

  it("never reads the system clock", () => {
    // `today` is a parameter precisely so this holds. A helper that reached for new Date() would
    // answer 1999 here, and would be untestable without freezing the clock everywhere it is used.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("1999-01-01T00:00:00.000Z"));

    expect(parseMonthParam(undefined, "2026-07-14")).toBe("2026-07-01");
    expect(parseMonthParam("2026-03", "2026-07-14")).toBe("2026-03-01");
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("leadingBlankDays", () => {
  it("is zero for a month that opens on a Sunday", () => {
    // 2026-03-01 is a Sunday.
    expect(leadingBlankDays("2026-03-01")).toBe(0);
  });

  it("is six for a month that opens on a Saturday", () => {
    // 2026-08-01 is a Saturday.
    expect(leadingBlankDays("2026-08-01")).toBe(6);
  });

  it("works from any day in the month, not just the first", () => {
    expect(leadingBlankDays("2026-03-29")).toBe(0);
    expect(leadingBlankDays("2026-08-31")).toBe(6);
  });

  it("reads the weekday in UTC", () => {
    // 2026-02-01 is a Sunday in UTC and a Saturday in every US zone from 5pm on Jan 31. A helper
    // built on a local-time Date returns 6 here and pushes the whole grid a column right.
    expect(leadingBlankDays("2026-02-01")).toBe(0);
  });
});

describe("daysInMonth", () => {
  it("works the length out rather than assuming 31", () => {
    expect(daysInMonth("2026-02-10")).toBe(28);
    expect(daysInMonth("2024-02-10")).toBe(29);
    expect(daysInMonth("2026-04-01")).toBe(30);
    expect(daysInMonth("2026-03-01")).toBe(31);
  });
});

describe("monthLabel and formatSundayLabel", () => {
  it("names the month and year", () => {
    expect(monthLabel("2026-03-01")).toBe("March 2026");
    expect(monthLabel("2026-12-01")).toBe("December 2026");
  });

  it("spells the Sunday out", () => {
    expect(formatSundayLabel("2026-03-08")).toBe("Sunday, March 8");
    expect(formatSundayLabel("2026-03-29")).toBe("Sunday, March 29");
  });

  // The assertion that matters. 2026-03-08 is UTC midnight on the day US daylight saving starts;
  // formatted without timeZone: "UTC" a browser in America/Denver renders "Saturday, March 7" —
  // a visibly wrong date on the phase's headline pitfall.
  it("formats the UTC day, not the local one", () => {
    expect(formatSundayLabel("2026-03-08")).toContain("March 8");
    expect(formatSundayLabel("2026-03-08")).toContain("Sunday");
    expect(formatSundayLabel("2026-01-01")).toBe("Thursday, January 1");
    expect(monthLabel("2026-01-01")).toBe("January 2026");
  });

  it("refuses a value that is not a date-only string", () => {
    expect(() => monthLabel("2026-03")).toThrow();
    expect(() => formatSundayLabel("2026-03-08T00:00:00Z")).toThrow();
  });
});
