import { describe, expect, it } from "vitest";
import {
  lastPrayedLabel,
  latestPrayerDates,
  shapeLastPrayed,
} from "@/lib/prayers/lastPrayed";

const ANNA = "00000000-0000-4000-8000-00000000000a";
const BEN = "00000000-0000-4000-8000-00000000000b";
const CARA = "00000000-0000-4000-8000-00000000000c";

describe("lastPrayedLabel", () => {
  it("formats a date as the month and the year", () => {
    expect(lastPrayedLabel("2025-03-16")).toBe("Last prayed March 2025");
  });

  // The success criterion this whole module exists for. Somebody who has not been asked is not a
  // category of person, and "Never" beside a name reads as a judgement about them.
  it("returns null for no history, and never the word Never", () => {
    const label = lastPrayedLabel(null);

    expect(label).toBeNull();
    expect(label).not.toBe("Never");
  });

  it("reads the date in UTC, so a first-of-the-month date does not slip a month", () => {
    // 2025-01-01 read in a negative-offset local zone would render as December 2024.
    expect(lastPrayedLabel("2025-01-01")).toBe("Last prayed January 2025");
    expect(lastPrayedLabel("2025-12-31")).toBe("Last prayed December 2025");
  });
});

describe("latestPrayerDates", () => {
  it("keeps the most recent date per member", () => {
    const latest = latestPrayerDates([
      { memberId: ANNA, date: "2024-05-05" },
      { memberId: ANNA, date: "2025-03-16" },
      { memberId: ANNA, date: "2024-11-10" },
      { memberId: BEN, date: "2026-01-04" },
    ]);

    expect(latest.get(ANNA)).toBe("2025-03-16");
    expect(latest.get(BEN)).toBe("2026-01-04");
  });

  it("returns an empty map for no rows", () => {
    expect(latestPrayerDates([]).size).toBe(0);
  });
});

describe("shapeLastPrayed", () => {
  it("returns one entry per member id, in the order asked for", () => {
    const shaped = shapeLastPrayed(
      [ANNA, BEN, CARA],
      [
        { memberId: ANNA, date: "2025-03-16" },
        { memberId: CARA, date: "2026-02-01" },
      ],
    );

    expect(shaped).toEqual([
      { memberId: ANNA, lastPrayedAt: "2025-03-16" },
      { memberId: BEN, lastPrayedAt: null },
      { memberId: CARA, lastPrayedAt: "2026-02-01" },
    ]);
  });

  // The rows handed in have ALREADY been filtered to the completed stage by the caller — this
  // function has no stage to look at, which is what makes "a prayer below done does not count"
  // structural rather than a rule somebody has to remember. The proof is that an unfinished
  // prayer never reaches here, so the member comes back with no history at all.
  it("leaves a member with only unfinished prayers with no history", () => {
    const completedRows = [{ memberId: ANNA, date: "2025-03-16" }];

    const shaped = shapeLastPrayed([ANNA, BEN], completedRows);

    expect(shaped.find((entry) => entry.memberId === BEN)?.lastPrayedAt).toBeNull();
    expect(lastPrayedLabel(shaped[1].lastPrayedAt)).toBeNull();
  });

  it("returns an empty list for no member ids", () => {
    expect(shapeLastPrayed([], [{ memberId: ANNA, date: "2025-03-16" }])).toEqual([]);
  });
});
