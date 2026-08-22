import { describe, expect, it } from "vitest";
import type { DateOnly } from "@/lib/calendar/dates";
import { buildMeetingSeries } from "@/lib/calendar/meetingSeries";
import type { SundayType } from "@/types/domain";

// buildMeetingSeries answers one question — which Sundays between two dates hold a sacrament
// meeting — and its whole reason for existing is the PREDICTION FALLBACK for months that have no
// rows yet. Months are generated on demand, so gaps are routine, and a walk over only the stored
// rows would count a gap as zero cancellations.

function stored(entries: Array<[DateOnly, SundayType]>): Map<DateOnly, SundayType> {
  return new Map(entries);
}

function holdsMeetingOn(
  series: ReturnType<typeof buildMeetingSeries>,
  date: DateOnly,
): boolean | undefined {
  return series.find((entry) => entry.date === date)?.holdsMeeting;
}

describe("buildMeetingSeries", () => {
  it("includes every Sunday in the range and nothing else", () => {
    const series = buildMeetingSeries("2026-01-01", "2026-01-31", stored([]));

    expect(series.map((entry) => entry.date)).toEqual([
      "2026-01-04",
      "2026-01-11",
      "2026-01-18",
      "2026-01-25",
    ]);
  });

  it("is inclusive at both ends when the bounds are themselves Sundays", () => {
    const series = buildMeetingSeries("2026-01-04", "2026-01-25", stored([]));

    expect(series[0].date).toBe("2026-01-04");
    expect(series[series.length - 1].date).toBe("2026-01-25");
  });

  it("treats an ordinary Sunday as holding a meeting", () => {
    const series = buildMeetingSeries("2026-01-01", "2026-01-31", stored([]));

    expect(series.every((entry) => entry.holdsMeeting)).toBe(true);
  });

  // The two types that hold no meeting, and only those two.
  it("marks stake and general conference as holding no meeting", () => {
    const series = buildMeetingSeries(
      "2026-01-01",
      "2026-01-31",
      stored([
        ["2026-01-11", "stake_conference"],
        ["2026-01-18", "general_conference"],
      ]),
    );

    expect(holdsMeetingOn(series, "2026-01-11")).toBe(false);
    expect(holdsMeetingOn(series, "2026-01-18")).toBe(false);
  });

  // The split this module exists downstream of. Both of these cannot BE Fast Sunday, and both
  // hold a perfectly ordinary meeting.
  it("treats holiday and ward conference as holding a meeting", () => {
    const series = buildMeetingSeries(
      "2026-01-01",
      "2026-01-31",
      stored([
        ["2026-01-11", "holiday"],
        ["2026-01-18", "ward_conference"],
      ]),
    );

    expect(holdsMeetingOn(series, "2026-01-11")).toBe(true);
    expect(holdsMeetingOn(series, "2026-01-18")).toBe(true);
  });

  it("predicts general conference for a month that has no rows at all", () => {
    const april = buildMeetingSeries("2026-04-01", "2026-04-30", stored([]));
    const october = buildMeetingSeries("2026-10-01", "2026-10-31", stored([]));

    expect(holdsMeetingOn(april, "2026-04-05")).toBe(false);
    expect(holdsMeetingOn(october, "2026-10-04")).toBe(false);

    // And nothing else in those months is predicted away.
    expect(april.filter((entry) => !entry.holdsMeeting)).toHaveLength(1);
    expect(october.filter((entry) => !entry.holdsMeeting)).toHaveLength(1);
  });

  // A gap month can only ever contain a general conference: setting a stake conference requires a
  // row to set it on, and an un-generated month has none.
  it("contributes a gap month's predicted general conference and nothing else", () => {
    const series = buildMeetingSeries(
      "2026-09-01",
      "2026-11-30",
      stored([["2026-09-06", "standard"]]),
    );

    expect(series.filter((entry) => !entry.holdsMeeting).map((entry) => entry.date)).toEqual([
      "2026-10-04",
    ]);
  });

  // A stored row ALWAYS wins. A bishopric that cleared a general conference the Church actually
  // moved must be respected, or the app argues with them twice a year.
  it("lets a stored type override the prediction in both directions", () => {
    const cleared = buildMeetingSeries(
      "2026-04-01",
      "2026-04-30",
      stored([["2026-04-05", "standard"]]),
    );
    expect(holdsMeetingOn(cleared, "2026-04-05")).toBe(true);

    const movedOnto = buildMeetingSeries(
      "2026-04-01",
      "2026-04-30",
      stored([["2026-04-12", "general_conference"]]),
    );
    expect(holdsMeetingOn(movedOnto, "2026-04-12")).toBe(false);
  });

  it("ignores stored entries outside the range", () => {
    const series = buildMeetingSeries(
      "2026-01-01",
      "2026-01-31",
      stored([["2026-02-01", "stake_conference"]]),
    );

    expect(series.map((entry) => entry.date)).not.toContain("2026-02-01");
    expect(series.every((entry) => entry.holdsMeeting)).toBe(true);
  });
});
