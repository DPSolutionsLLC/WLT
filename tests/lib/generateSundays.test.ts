import { describe, expect, it } from "vitest";
import { isSunday, monthOf } from "@/lib/calendar/dates";
import { generateSundays, type GeneratedSunday } from "@/lib/calendar/generateSundays";

const YEAR_2026 = generateSundays("2026-01-01", "2026-12-31");

function fastSundayOf(month: string, rows: GeneratedSunday[] = YEAR_2026): string | null {
  return (
    rows.find((row) => monthOf(row.date) === month && row.type === "fast_sunday")?.date ??
    null
  );
}

describe("generateSundays", () => {
  it("produces every Sunday of 2026 and nothing else", () => {
    expect(YEAR_2026).toHaveLength(52);
    expect(YEAR_2026.every((row) => isSunday(row.date))).toBe(true);
    expect(YEAR_2026[0].date).toBe("2026-01-04");
    expect(YEAR_2026.at(-1)?.date).toBe("2026-12-27");
  });

  it("pre-marks the first Sunday of April and October as general conference", () => {
    const conferences = YEAR_2026.filter((row) => row.type === "general_conference");

    expect(conferences.map((row) => row.date)).toEqual(["2026-04-05", "2026-10-04"]);
  });

  it("gives a standard Sunday three speaking slots and a fast or conference Sunday none", () => {
    for (const row of YEAR_2026) {
      if (row.type === "standard") {
        expect(row.speakingSlots).toBe(3);
      } else {
        expect(row.speakingSlots).toBe(0);
      }
    }
  });

  it("puts Fast Sunday on the first Sunday of every ordinary month", () => {
    expect(fastSundayOf("2026-01")).toBe("2026-01-04");
    expect(fastSundayOf("2026-02")).toBe("2026-02-01");
    expect(fastSundayOf("2026-03")).toBe("2026-03-01");
    expect(fastSundayOf("2026-12")).toBe("2026-12-06");
  });

  // The reason general conference is pre-marked at all: it displaces Fast Sunday, and a month
  // generated with Fast Sunday in the wrong place makes every downstream speaker assignment wrong
  // before anybody looks at it.
  it("shifts Fast Sunday past general conference in April and October", () => {
    expect(fastSundayOf("2026-04")).toBe("2026-04-12");
    expect(fastSundayOf("2026-10")).toBe("2026-10-11");
  });

  it("gives every month in the range exactly one Fast Sunday", () => {
    const months = new Set(YEAR_2026.map((row) => monthOf(row.date)));

    expect(months.size).toBe(12);
    for (const month of months) {
      const fastCount = YEAR_2026.filter(
        (row) => monthOf(row.date) === month && row.type === "fast_sunday",
      ).length;
      expect(fastCount).toBe(1);
    }
  });

  // Documented behaviour, not a bug: a partially covered month resolves against only the Sundays
  // the call generated. generateSundayRange() re-resolves against the whole month afterwards, and
  // ensureMonthGenerated() only ever asks for whole months, so this does not arise in the app.
  it("resolves a partially covered month against only the Sundays it generated", () => {
    const partial = generateSundays("2026-03-10", "2026-03-31");

    expect(partial.map((row) => row.date)).toEqual([
      "2026-03-15",
      "2026-03-22",
      "2026-03-29",
    ]);
    expect(fastSundayOf("2026-03", partial)).toBe("2026-03-15");
  });

  it("returns nothing for a range containing no Sunday", () => {
    expect(generateSundays("2026-01-05", "2026-01-10")).toEqual([]);
  });
});
