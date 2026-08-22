import { describe, expect, it } from "vitest";
import type { DateOnly } from "@/lib/calendar/dates";
import { buildMeetingSeries } from "@/lib/calendar/meetingSeries";
import {
  resolveConductingUser,
  type RotationEntry,
} from "@/lib/calendar/resolveConductingUser";
import type { SundayType } from "@/types/domain";
import { allMeetingSeries, seriesWithout } from "@/tests/helpers/meetingSeries";

// The heart of ITER-002: a Sunday that holds no sacrament meeting COSTS NOBODY A TURN.
//
// The rule has one shape and two projections. Weekly counts meeting-holding SUNDAYS; monthly
// counts MONTHS THAT CONTAIN at least one. That is why a cancelled Sunday shifts a weekly
// rotation and changes nothing under a monthly one — under monthly, one person already holds the
// whole month, so there is no turn to skip.

const BISHOP = "user-bishop";
const FIRST_COUNSELOR = "user-first";
const SECOND_COUNSELOR = "user-second";

function weekly(effectiveFrom: DateOnly): RotationEntry[] {
  return [
    { position: 1, userId: BISHOP, effectiveFrom, cadence: "weekly" },
    { position: 2, userId: FIRST_COUNSELOR, effectiveFrom, cadence: "weekly" },
    { position: 3, userId: SECOND_COUNSELOR, effectiveFrom, cadence: "weekly" },
  ];
}

function monthly(effectiveFrom: DateOnly): RotationEntry[] {
  return [
    { position: 1, userId: BISHOP, effectiveFrom, cadence: "monthly" },
    { position: 2, userId: FIRST_COUNSELOR, effectiveFrom, cadence: "monthly" },
    { position: 3, userId: SECOND_COUNSELOR, effectiveFrom, cadence: "monthly" },
  ];
}

describe("resolveConductingUser — a cancelled Sunday costs nobody a turn (weekly)", () => {
  const anchor = "2026-01-01";
  const rotation = weekly(anchor);

  // The baseline these assertions are read against. January 2026's Sundays are the 4th, 11th,
  // 18th and 25th.
  it("cycles 1-2-3-1 when nothing is cancelled", () => {
    const series = allMeetingSeries("2026-01-01", "2026-01-31");

    expect(resolveConductingUser("2026-01-04", rotation, anchor, series)).toBe(BISHOP);
    expect(resolveConductingUser("2026-01-11", rotation, anchor, series)).toBe(FIRST_COUNSELOR);
    expect(resolveConductingUser("2026-01-18", rotation, anchor, series)).toBe(SECOND_COUNSELOR);
    expect(resolveConductingUser("2026-01-25", rotation, anchor, series)).toBe(BISHOP);
  });

  // The whole point, in one assertion: the person the old cycle would have SPENT on the cancelled
  // Sunday conducts the next real meeting instead.
  it("does not advance the cycle across a cancelled Sunday", () => {
    const series = seriesWithout("2026-01-01", "2026-01-31", ["2026-01-11"]);

    expect(resolveConductingUser("2026-01-04", rotation, anchor, series)).toBe(BISHOP);
    expect(resolveConductingUser("2026-01-11", rotation, anchor, series)).toBeNull();

    // The 18th holds the name the 11th would have had, not the one it would have had before.
    expect(resolveConductingUser("2026-01-18", rotation, anchor, series)).toBe(FIRST_COUNSELOR);
    expect(resolveConductingUser("2026-01-25", rotation, anchor, series)).toBe(SECOND_COUNSELOR);
  });

  it("skips two cancelled Sundays in a row", () => {
    const series = seriesWithout("2026-01-01", "2026-02-28", [
      "2026-01-11",
      "2026-01-18",
    ]);

    expect(resolveConductingUser("2026-01-04", rotation, anchor, series)).toBe(BISHOP);
    expect(resolveConductingUser("2026-01-11", rotation, anchor, series)).toBeNull();
    expect(resolveConductingUser("2026-01-18", rotation, anchor, series)).toBeNull();
    expect(resolveConductingUser("2026-01-25", rotation, anchor, series)).toBe(FIRST_COUNSELOR);
    expect(resolveConductingUser("2026-02-01", rotation, anchor, series)).toBe(SECOND_COUNSELOR);
  });

  it("returns null for a target Sunday that holds no meeting", () => {
    const series = seriesWithout("2026-01-01", "2026-01-31", ["2026-01-25"]);

    expect(resolveConductingUser("2026-01-25", rotation, anchor, series)).toBeNull();
  });
});

describe("resolveConductingUser — the monthly cadence counts months, not Sundays", () => {
  const anchor = "2026-01-01";
  const rotation = monthly(anchor);

  it("gives one person the whole month when nothing is cancelled", () => {
    const series = allMeetingSeries("2026-01-01", "2026-03-31");

    expect(resolveConductingUser("2026-01-25", rotation, anchor, series)).toBe(BISHOP);
    expect(resolveConductingUser("2026-02-01", rotation, anchor, series)).toBe(FIRST_COUNSELOR);
    expect(resolveConductingUser("2026-03-01", rotation, anchor, series)).toBe(SECOND_COUNSELOR);
  });

  // Decision 1. Under a monthly cadence one person already holds the whole month, so a single
  // cancelled Sunday inside it takes nobody's turn away.
  it("is unchanged by one cancelled Sunday inside a month", () => {
    const series = seriesWithout("2026-01-01", "2026-03-31", ["2026-01-11"]);

    expect(resolveConductingUser("2026-01-25", rotation, anchor, series)).toBe(BISHOP);
    expect(resolveConductingUser("2026-02-01", rotation, anchor, series)).toBe(FIRST_COUNSELOR);
    expect(resolveConductingUser("2026-03-01", rotation, anchor, series)).toBe(SECOND_COUNSELOR);
  });

  // A month spends a turn unless EVERY Sunday in it holds no meeting. Near-impossible in
  // practice; defined anyway, because "undefined by omission" is how one list came to answer two
  // questions in the first place.
  it("skips a month whose every Sunday is cancelled", () => {
    const series = seriesWithout("2026-01-01", "2026-03-31", [
      "2026-02-01",
      "2026-02-08",
      "2026-02-15",
      "2026-02-22",
    ]);

    expect(resolveConductingUser("2026-01-25", rotation, anchor, series)).toBe(BISHOP);

    // February takes no turn, so March gets the turn February would have had.
    expect(resolveConductingUser("2026-03-01", rotation, anchor, series)).toBe(FIRST_COUNSELOR);
  });

  it("returns null for a target Sunday that holds no meeting", () => {
    const series = seriesWithout("2026-01-01", "2026-03-31", ["2026-02-08"]);

    expect(resolveConductingUser("2026-02-08", rotation, anchor, series)).toBeNull();
  });
});

// THE GAP TEST. This is the one that fails if anyone ever replaces buildMeetingSeries()'s
// prediction fallback with a plain walk over stored rows.
//
// Months are generated on demand, so a bishopric skipping from August to December leaves four
// months with no rows at all. Those months still contain a general conference, and the rotation
// still has to skip it — or December resolves to the wrong person and then STORES that answer.
describe("resolveConductingUser — a gap of un-generated months", () => {
  const anchor = "2026-01-01";
  const rotation = weekly(anchor);

  function typesFor(dates: DateOnly[]): Map<DateOnly, SundayType> {
    const types = new Map<DateOnly, SundayType>();
    for (const date of dates) {
      types.set(
        date,
        date === "2026-04-05" || date === "2026-10-04" ? "general_conference" : "standard",
      );
    }
    return types;
  }

  // Every Sunday of 2026 has a row, general conference included.
  const everyMonthGenerated = buildMeetingSeries(
    "2026-01-01",
    "2026-12-31",
    typesFor(
      buildMeetingSeries("2026-01-01", "2026-12-31", new Map()).map((entry) => entry.date),
    ),
  );

  // The same year with August through November never generated. Those four months fall back to
  // the prediction, which is exactly right: the only cancellation an un-generated month can hold
  // is a general conference.
  const augustToNovemberMissing = buildMeetingSeries(
    "2026-01-01",
    "2026-12-31",
    typesFor(
      buildMeetingSeries("2026-01-01", "2026-12-31", new Map())
        .map((entry) => entry.date)
        .filter((date) => date < "2026-08-01" || date >= "2026-12-01"),
    ),
  );

  it("resolves December the same way whether or not the gap months exist", () => {
    expect(resolveConductingUser("2026-12-06", rotation, anchor, augustToNovemberMissing)).toBe(
      resolveConductingUser("2026-12-06", rotation, anchor, everyMonthGenerated),
    );
  });

  // The value, pinned. 48 Sundays fall between the anchor and 2026-12-06; two of them are general
  // conference, so the offset is 46 and 46 % 3 puts position 2 in the chair.
  it("puts the second position in the chair, having skipped both conferences", () => {
    expect(resolveConductingUser("2026-12-06", rotation, anchor, augustToNovemberMissing)).toBe(
      FIRST_COUNSELOR,
    );
  });

  // And the answer really is different from the naive one, so the assertion above has teeth. A
  // series that counted all 48 Sundays would seat the bishop instead.
  it("differs from a walk that counted the cancelled Sundays", () => {
    const countedEverything = allMeetingSeries("2026-01-01", "2026-12-31");

    expect(resolveConductingUser("2026-12-06", rotation, anchor, countedEverything)).toBe(BISHOP);
  });
});

describe("resolveConductingUser — the series must cover the walk", () => {
  // A short series would produce a plausible wrong number rather than a failure, which is the
  // worst of the two outcomes. Same reasoning as countSundaysBetween refusing two non-Sundays.
  it("throws when the series starts after the anchor", () => {
    const series = allMeetingSeries("2026-06-01", "2026-12-31");

    expect(() =>
      resolveConductingUser("2026-12-06", weekly("2026-01-01"), "2026-01-01", series),
    ).toThrow(/meeting series/i);
  });

  it("throws when the series ends before the target's month", () => {
    const series = allMeetingSeries("2026-01-01", "2026-06-30");

    expect(() =>
      resolveConductingUser("2026-12-06", weekly("2026-01-01"), "2026-01-01", series),
    ).toThrow(/meeting series/i);
  });

  it("throws on an empty series", () => {
    expect(() =>
      resolveConductingUser("2026-12-06", weekly("2026-01-01"), "2026-01-01", []),
    ).toThrow(/meeting series/i);
  });

  // No rotation in force is decided before the series is examined: a ward that has not configured
  // a rotation must render a calendar rather than throw.
  it("returns null without inspecting the series when no rotation is in force", () => {
    expect(resolveConductingUser("2026-12-06", [], "2026-01-01", [])).toBeNull();
  });
});
