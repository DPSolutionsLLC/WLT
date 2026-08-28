// @vitest-environment node
//
// RRULE expansion, and the bound that stops it.
//
// The success criterion this suite owns is criterion 3 of the plan: "an RRULE with no UNTIL
// produces a bounded number of rows, not an infinite loop." That is not a performance concern —
// an unbounded rule is INFINITE by definition, so without a bound the route does not return at
// all, and a request that never returns is indistinguishable from a server that is down.

import { describe, expect, it } from "vitest";
import { MAX_OCCURRENCES_PER_SERIES, RECURRENCE_HORIZON_MONTHS } from "@/lib/youth/ics/limits";
import { occurrenceInstant, parseIcs } from "@/lib/youth/ics/parseIcs";

const WARD_ZONE = "America/Denver";
const AS_OF = new Date("2026-12-01T00:00:00Z");

function calendar(lines: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lincoln High//Athletics//EN",
    "BEGIN:VEVENT",
    "UID:practice@lincoln",
    "SUMMARY:Practice",
    ...lines,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n");
}

function expand(lines: string[]) {
  return parseIcs(calendar(lines), { asOf: AS_OF, wardTimeZone: WARD_ZONE });
}

describe("bounded RRULEs", () => {
  it("yields exactly COUNT occurrences", () => {
    const parsed = expand(["DTSTART:20270105T230000Z", "RRULE:FREQ=WEEKLY;COUNT=10"]);

    expect(parsed.occurrences).toHaveLength(10);
    expect(parsed.problems).toEqual([]);
  });

  it("respects UNTIL", () => {
    const parsed = expand([
      "DTSTART:20270105T230000Z",
      "RRULE:FREQ=WEEKLY;UNTIL=20270202T000000Z",
    ]);

    expect(parsed.occurrences).toHaveLength(4);
  });

  it("drops an EXDATE, and the count falls by exactly one", () => {
    const withoutExclusion = expand(["DTSTART:20270105T230000Z", "RRULE:FREQ=WEEKLY;COUNT=8"]);
    const withExclusion = expand([
      "DTSTART:20270105T230000Z",
      "RRULE:FREQ=WEEKLY;COUNT=8",
      "EXDATE:20270119T230000Z",
    ]);

    expect(withoutExclusion.occurrences).toHaveLength(8);
    expect(withExclusion.occurrences).toHaveLength(7);
    expect(
      withExclusion.occurrences.map((occurrence) =>
        occurrenceInstant(occurrence, WARD_ZONE).toISOString(),
      ),
    ).not.toContain("2027-01-19T23:00:00.000Z");
  });
});

describe("the bound on an unbounded rule", () => {
  // AN EXPLICIT SHORT TIMEOUT, so a regression that reintroduces the infinite loop fails in two
  // seconds instead of hitting vitest's 30s ceiling and reading as a slow machine.
  it(
    "stops a weekly rule with neither COUNT nor UNTIL at the horizon",
    { timeout: 2_000 },
    () => {
      const parsed = expand(["DTSTART:20270105T230000Z", "RRULE:FREQ=WEEKLY"]);

      // Roughly a year of weeks, and definitively not infinite.
      expect(parsed.occurrences.length).toBeGreaterThan(40);
      expect(parsed.occurrences.length).toBeLessThan(60);

      const horizon = new Date(AS_OF);
      horizon.setUTCMonth(horizon.getUTCMonth() + RECURRENCE_HORIZON_MONTHS);

      for (const occurrence of parsed.occurrences) {
        expect(occurrenceInstant(occurrence, WARD_ZONE).getTime()).toBeLessThanOrEqual(
          horizon.getTime(),
        );
      }
    },
  );

  // A silent cap reads as "your file only had 400 practices", which is the failure limits.ts
  // names in its own comment on capProblems. The problem is half the assertion.
  it(
    "stops a daily rule at MAX_OCCURRENCES_PER_SERIES and reports it",
    { timeout: 5_000 },
    () => {
      // Hourly, so the per-series cap is reached long before the twelve-month horizon is.
      const parsed = expand(["DTSTART:20270105T230000Z", "RRULE:FREQ=HOURLY"]);

      expect(parsed.occurrences).toHaveLength(MAX_OCCURRENCES_PER_SERIES);
      expect(parsed.problems).toHaveLength(1);
      expect(parsed.problems[0].message).toContain(String(MAX_OCCURRENCES_PER_SERIES));
      expect(parsed.problems[0].summary).toBe("Practice");
    },
  );
});

describe("the match key cannot collapse a series into one row", () => {
  it("gives every occurrence a distinct recurrenceId under one shared uid", () => {
    const parsed = expand(["DTSTART:20270105T230000Z", "RRULE:FREQ=WEEKLY;COUNT=6"]);

    const uids = new Set(parsed.occurrences.map((occurrence) => occurrence.uid));
    const recurrenceIds = parsed.occurrences.map((occurrence) => occurrence.recurrenceId);

    expect(uids.size).toBe(1);
    expect(new Set(recurrenceIds).size).toBe(6);
    expect(recurrenceIds).not.toContain(null);
  });

  it("leaves recurrenceId null on a one-off", () => {
    const parsed = expand(["DTSTART:20270105T230000Z"]);

    expect(parsed.occurrences).toHaveLength(1);
    expect(parsed.occurrences[0].recurrenceId).toBeNull();
  });

  it("gives an all-day series a date-only recurrenceId", () => {
    const parsed = expand(["DTSTART;VALUE=DATE:20270105", "RRULE:FREQ=WEEKLY;COUNT=3"]);

    expect(parsed.occurrences.map((occurrence) => occurrence.recurrenceId)).toEqual([
      "20270105",
      "20270112",
      "20270119",
    ]);
    expect(parsed.occurrences.every((occurrence) => occurrence.allDay)).toBe(true);
  });
});
