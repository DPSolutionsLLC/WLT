// @vitest-environment node
//
// THE HIGHEST-PRIORITY TEST IN SLICE B.
//
// 08-youth-activities.md: "A game showing at the wrong hour makes the whole feature useless." The
// failure mode this suite exists to catch is the one that PASSES ON THE DEV MACHINE AND SHIPS
// WRONG: `ICAL.Time.toJSDate()` resolves a floating time — and any unregistered TZID — against
// the PROCESS'S own zone, which is America/Denver here and UTC on Vercel.
//
// ---------------------------------------------------------------------------
// EVERY ASSERTION IS AN EXACT UTC INSTANT, AND THAT IS THE PROOF
// ---------------------------------------------------------------------------
// Not "the hour is 19", not "it round-trips" — the exact millisecond. There is no zone the
// process could be running in that would make one of these pass and another fail, so the
// exact-instant assertions carry the server-zone-independence guarantee on their own. The
// process.env.TZ test at the bottom is a belt-and-braces extra; if it ever proves unreliable it
// should be DELETED rather than the assertions above it weakened.

import { describe, expect, it } from "vitest";
import { parseIcs, occurrenceInstant, type IcsOccurrence } from "@/lib/youth/ics/parseIcs";
import {
  offsetMinutesFor,
  resolveOccurrenceInstant,
  wallClockToInstant,
} from "@/lib/youth/ics/resolveInstant";

const WARD_ZONE = "America/Denver";

// Pinned rather than `new Date()`: the recurrence horizon is measured from it, and a suite whose
// answers depend on the day it runs is a suite that starts failing on a particular Tuesday.
const AS_OF = new Date("2026-12-01T00:00:00Z");

const DENVER_VTIMEZONE = `BEGIN:VTIMEZONE
TZID:America/Denver
BEGIN:STANDARD
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZOFFSETFROM:-0600
TZOFFSETTO:-0700
TZNAME:MST
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZOFFSETFROM:-0700
TZOFFSETTO:-0600
TZNAME:MDT
END:DAYLIGHT
END:VTIMEZONE`;

function calendar(body: string, withDenverZone = true): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lincoln High//Athletics//EN",
    withDenverZone ? DENVER_VTIMEZONE : null,
    body,
    "END:VCALENDAR",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function vevent(lines: string[]): string {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\n");
}

function parseOne(text: string): IcsOccurrence {
  const parsed = parseIcs(text, { asOf: AS_OF, wardTimeZone: WARD_ZONE });
  expect(parsed.occurrences).toHaveLength(1);
  return parsed.occurrences[0];
}

function instantOf(text: string): string {
  return occurrenceInstant(parseOne(text), WARD_ZONE).toISOString();
}

describe("resolveInstant, driven from literals", () => {
  it("reads the offset AT THAT INSTANT, not the offset today", () => {
    // The whole DST story in two assertions. Denver is UTC-7 in January and UTC-6 in July.
    expect(offsetMinutesFor(new Date("2027-01-15T12:00:00Z"), WARD_ZONE)).toBe(-420);
    expect(offsetMinutesFor(new Date("2027-07-15T12:00:00Z"), WARD_ZONE)).toBe(-360);
  });

  it("turns a wall clock into the instant that shows that wall clock", () => {
    const january = wallClockToInstant(
      { year: 2027, month: 1, day: 15, hour: 19, minute: 30, second: 0 },
      WARD_ZONE,
    );
    expect(january.toISOString()).toBe("2027-01-16T02:30:00.000Z");

    const july = wallClockToInstant(
      { year: 2027, month: 7, day: 15, hour: 19, minute: 30, second: 0 },
      WARD_ZONE,
    );
    expect(july.toISOString()).toBe("2027-07-16T01:30:00.000Z");
  });

  // THE TWO HOURS THE SECOND CORRECTION PASS EXISTS FOR. A single-pass implementation is wrong
  // for one hour twice a year, in both directions — the kind of bug that survives a demo and
  // shows up on the first Sunday in November.
  it("lands correctly on the hour after a spring-forward transition", () => {
    // 14 March 2027 is the second Sunday: 2:00am MST becomes 3:00am MDT. 3:30am is real and is
    // UTC-6.
    expect(
      wallClockToInstant(
        { year: 2027, month: 3, day: 14, hour: 3, minute: 30, second: 0 },
        WARD_ZONE,
      ).toISOString(),
    ).toBe("2027-03-14T09:30:00.000Z");

    // 1:30am the same morning is still MST, UTC-7.
    expect(
      wallClockToInstant(
        { year: 2027, month: 3, day: 14, hour: 1, minute: 30, second: 0 },
        WARD_ZONE,
      ).toISOString(),
    ).toBe("2027-03-14T08:30:00.000Z");
  });

  it("lands on a real instant for a wall clock the spring-forward skipped", () => {
    // 2:30am on 14 March 2027 does not exist in Denver — the clocks go straight from 2:00 to
    // 3:00. There is no correct answer, and this asserts the one the fixed point settles on
    // (1:30am MST, an hour earlier) rather than pretending there is a right one. What actually
    // matters is that it is finite and on the correct morning, not NaN and not yesterday.
    const resolved = wallClockToInstant(
      { year: 2027, month: 3, day: 14, hour: 2, minute: 30, second: 0 },
      WARD_ZONE,
    );

    expect(Number.isFinite(resolved.getTime())).toBe(true);
    expect(resolved.toISOString()).toBe("2027-03-14T08:30:00.000Z");
  });

  it("resolves the ambiguous hour on a fall-back morning", () => {
    // 7 November 2027: 1:30am happens twice. Either instant is defensible; what is not
    // defensible is a NaN or a date on the wrong day.
    const resolved = wallClockToInstant(
      { year: 2027, month: 11, day: 7, hour: 1, minute: 30, second: 0 },
      WARD_ZONE,
    );

    expect(["2027-11-07T07:30:00.000Z", "2027-11-07T08:30:00.000Z"]).toContain(
      resolved.toISOString(),
    );
  });

  it("reports whether the ward's zone had to stand in", () => {
    const wall = { year: 2027, month: 1, day: 15, hour: 19, minute: 30, second: 0 };

    expect(resolveOccurrenceInstant(wall, { kind: "utc" }, WARD_ZONE).usedWardZone).toBe(false);
    expect(
      resolveOccurrenceInstant(wall, { kind: "named", tzid: "Europe/London" }, WARD_ZONE)
        .usedWardZone,
    ).toBe(false);
    expect(resolveOccurrenceInstant(wall, { kind: "floating" }, WARD_ZONE).usedWardZone).toBe(
      true,
    );
    expect(
      resolveOccurrenceInstant(wall, { kind: "named", tzid: "Mars/Olympus" }, WARD_ZONE)
        .usedWardZone,
    ).toBe(true);
  });
});

describe("parseIcs resolves each kind of DTSTART to an exact instant", () => {
  it("takes a Z-suffixed time as the instant it already is", () => {
    expect(
      instantOf(
        calendar(vevent(["UID:utc@lincoln", "SUMMARY:Away game", "DTSTART:20270116T023000Z"])),
      ),
    ).toBe("2027-01-16T02:30:00.000Z");
  });

  it("resolves a TZID whose VTIMEZONE the file defines", () => {
    const occurrence = parseOne(
      calendar(
        vevent([
          "UID:tzid@lincoln",
          "SUMMARY:Home game",
          "DTSTART;TZID=America/Denver:20270115T193000",
        ]),
      ),
    );

    expect(occurrence.zone).toEqual({ kind: "named", tzid: "America/Denver" });
    expect(occurrence.usedWardZone).toBe(false);
    expect(occurrenceInstant(occurrence, WARD_ZONE).toISOString()).toBe(
      "2027-01-16T02:30:00.000Z",
    );
  });

  it("resolves a TZID the file does NOT define, because Intl knows it anyway", () => {
    const occurrence = parseOne(
      calendar(
        vevent([
          "UID:chicago@lincoln",
          "SUMMARY:Regional",
          "DTSTART;TZID=America/Chicago:20270115T193000",
        ]),
        false,
      ),
    );

    expect(occurrence.usedWardZone).toBe(false);
    expect(occurrenceInstant(occurrence, WARD_ZONE).toISOString()).toBe(
      "2027-01-16T01:30:00.000Z",
    );
  });

  // Decision 1. A school feed publishing a floating time is the ordinary case, not an error —
  // refusing it would leave manual entry as the only path.
  it("reads a floating time in the ward's zone and says so", () => {
    const occurrence = parseOne(
      calendar(
        vevent(["UID:floating@lincoln", "SUMMARY:Scrimmage", "DTSTART:20270117T190000"]),
        false,
      ),
    );

    expect(occurrence.zone).toEqual({ kind: "floating" });
    expect(occurrence.usedWardZone).toBe(true);
    expect(occurrence.unresolvedTzid).toBeNull();
    expect(occurrenceInstant(occurrence, WARD_ZONE).toISOString()).toBe(
      "2027-01-18T02:00:00.000Z",
    );
  });

  // Decision 2, and BOTH HALVES ARE ASSERTED. The fallback without the report is the wrong hour
  // with no trace, which is worse than a wrong hour somebody was shown before confirming.
  it("falls back to the ward zone for an unresolvable TZID and names the zone it asked for", () => {
    const occurrence = parseOne(
      calendar(
        vevent([
          "UID:mars@lincoln",
          "SUMMARY:Odd feed game",
          "DTSTART;TZID=Mars/Olympus:20270210T180000",
        ]),
        false,
      ),
    );

    expect(occurrence.usedWardZone).toBe(true);
    expect(occurrence.unresolvedTzid).toBe("Mars/Olympus");
    expect(occurrenceInstant(occurrence, WARD_ZONE).toISOString()).toBe(
      "2027-02-11T01:00:00.000Z",
    );
  });

  it("stores an all-day entry at ward midnight and marks it", () => {
    const occurrence = parseOne(
      calendar(
        vevent(["UID:tourney@lincoln", "SUMMARY:Tournament", "DTSTART;VALUE=DATE:20270116"]),
        false,
      ),
    );

    expect(occurrence.allDay).toBe(true);
    expect(occurrenceInstant(occurrence, WARD_ZONE).toISOString()).toBe(
      "2027-01-16T07:00:00.000Z",
    );
  });

  it("keeps the wall clock across a DST boundary within one file", () => {
    const parsed = parseIcs(
      calendar(
        [
          vevent([
            "UID:winter@lincoln",
            "SUMMARY:Winter game",
            "DTSTART;TZID=America/Denver:20270115T190000",
          ]),
          vevent([
            "UID:summer@lincoln",
            "SUMMARY:Summer game",
            "DTSTART;TZID=America/Denver:20270715T190000",
          ]),
        ].join("\n"),
      ),
      { asOf: AS_OF, wardTimeZone: WARD_ZONE },
    );

    const instants = parsed.occurrences.map((occurrence) =>
      occurrenceInstant(occurrence, WARD_ZONE).toISOString(),
    );

    // Same wall clock, an hour apart in UTC. If these were equal the offset would be being read
    // from "today" rather than from the event.
    expect(instants).toEqual(["2027-01-16T02:00:00.000Z", "2027-07-16T01:00:00.000Z"]);
  });
});

// The extra guarantee, not the primary one. If this ever proves unreliable on Windows it should
// be deleted; the exact-instant assertions above already carry the proof.
describe("the answer does not depend on the server's own zone", () => {
  it("produces byte-identical instants with process.env.TZ set to UTC+14", () => {
    const text = calendar(
      [
        vevent(["UID:utc@lincoln", "SUMMARY:A", "DTSTART:20270116T023000Z"]),
        vevent(["UID:float@lincoln", "SUMMARY:B", "DTSTART:20270117T190000"]),
        vevent([
          "UID:tzid@lincoln",
          "SUMMARY:C",
          "DTSTART;TZID=America/Denver:20270115T193000",
        ]),
        vevent(["UID:allday@lincoln", "SUMMARY:D", "DTSTART;VALUE=DATE:20270116"]),
      ].join("\n"),
    );

    const render = (): string[] =>
      parseIcs(text, { asOf: AS_OF, wardTimeZone: WARD_ZONE }).occurrences.map((occurrence) =>
        occurrenceInstant(occurrence, WARD_ZONE).toISOString(),
      );

    const original = process.env.TZ;

    try {
      process.env.TZ = "UTC";
      const asUtc = render();

      process.env.TZ = "Pacific/Kiritimati";
      const asKiritimati = render();

      expect(asKiritimati).toEqual(asUtc);
      expect(asUtc).toEqual([
        "2027-01-16T02:30:00.000Z",
        "2027-01-18T02:00:00.000Z",
        "2027-01-16T02:30:00.000Z",
        "2027-01-16T07:00:00.000Z",
      ]);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
