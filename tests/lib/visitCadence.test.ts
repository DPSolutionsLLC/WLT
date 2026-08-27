import { describe, expect, it } from "vitest";
import {
  addCadence,
  CADENCE_COMPARISON_ANCHOR,
  compareCadences,
  describeCadence,
  subtractCadence,
} from "@/lib/visits/cadence";

// The arithmetic every band boundary and every validation message is built on. Cheap to test and
// the source of every off-by-a-day further up, so the boundaries here are computed from the
// calendar rather than transcribed.

describe("addCadence", () => {
  it("adds days", () => {
    expect(addCadence("2026-08-26", { amount: 10, unit: "day" })).toBe("2026-09-05");
  });

  it("adds weeks as seven days each", () => {
    expect(addCadence("2026-08-26", { amount: 3, unit: "week" })).toBe("2026-09-16");
  });

  it("adds months", () => {
    expect(addCadence("2026-08-26", { amount: 3, unit: "month" })).toBe("2026-11-26");
  });

  // A YEAR IS TWELVE MONTHS, NOT 365 DAYS. That is what makes the leap-day case below behave the
  // way addMonths() already decided a month-clamping calendar should.
  it("adds a year as twelve months", () => {
    expect(addCadence("2026-08-26", { amount: 1, unit: "year" })).toBe("2027-08-26");
    expect(addCadence("2026-08-26", { amount: 2, unit: "year" })).toBe("2028-08-26");
  });

  // addMonths() CLAMPS rather than rolling over: 31 January plus one month is 28 February, not
  // 3 March. Rolling over would silently skip a month.
  it("clamps a month that has no 31st", () => {
    expect(addCadence("2026-01-31", { amount: 1, unit: "month" })).toBe("2026-02-28");
  });

  it("clamps 29 February to 28 February a year later", () => {
    expect(addCadence("2024-02-29", { amount: 1, unit: "year" })).toBe("2025-02-28");
  });

  it("keeps 29 February when the target year is itself a leap year", () => {
    expect(addCadence("2024-02-29", { amount: 4, unit: "year" })).toBe("2028-02-29");
  });
});

describe("subtractCadence", () => {
  it("subtracts each unit", () => {
    expect(subtractCadence("2026-09-05", { amount: 10, unit: "day" })).toBe("2026-08-26");
    expect(subtractCadence("2026-09-16", { amount: 3, unit: "week" })).toBe("2026-08-26");
    expect(subtractCadence("2026-11-26", { amount: 3, unit: "month" })).toBe("2026-08-26");
    expect(subtractCadence("2027-08-26", { amount: 1, unit: "year" })).toBe("2026-08-26");
  });

  it("round-trips addCadence where the calendar allows", () => {
    const from = "2026-06-15";

    for (const cadence of [
      { amount: 45, unit: "day" as const },
      { amount: 6, unit: "week" as const },
      { amount: 4, unit: "month" as const },
      { amount: 2, unit: "year" as const },
    ]) {
      expect(subtractCadence(addCadence(from, cadence), cadence)).toBe(from);
    }
  });

  // ASSERTED, NOT ASSUMED. subtractCadence is not an exact inverse at every date and cannot be:
  // addMonths clamps, so a round trip through the end of a short month lands on the clamped day
  // rather than the original one. That is lib/calendar/dates.ts's deliberate behaviour, and a
  // test that only checked the symmetric cases would leave it undocumented.
  it("does not round-trip through a clamped month, and says so", () => {
    const forward = addCadence("2026-01-31", { amount: 1, unit: "month" });
    expect(forward).toBe("2026-02-28");
    expect(subtractCadence(forward, { amount: 1, unit: "month" })).toBe("2026-01-28");
  });
});

describe("compareCadences", () => {
  // The point of the function: a month is not thirty days, so these are DIFFERENT lengths and a
  // day-approximation would call them equal.
  it("does not treat 2 months as 60 days", () => {
    expect(
      compareCadences({ amount: 2, unit: "month" }, { amount: 60, unit: "day" }),
    ).not.toBe(0);
  });

  it("treats 1 year and 12 months as the same length", () => {
    expect(compareCadences({ amount: 1, unit: "year" }, { amount: 12, unit: "month" })).toBe(0);
  });

  it("treats 52 weeks and 1 year as different lengths", () => {
    expect(
      compareCadences({ amount: 52, unit: "week" }, { amount: 1, unit: "year" }),
    ).not.toBe(0);
  });

  it("orders shorter before longer", () => {
    expect(compareCadences({ amount: 1, unit: "week" }, { amount: 1, unit: "month" })).toBe(-1);
    expect(compareCadences({ amount: 1, unit: "year" }, { amount: 1, unit: "month" })).toBe(1);
    expect(compareCadences({ amount: 3, unit: "day" }, { amount: 3, unit: "day" })).toBe(0);
  });

  // No clock reading. If the anchor were `new Date()` this comparison would answer differently in
  // February than in July, and a goal a ward saved in one month would be refused in another.
  it("takes no clock reading — the anchor is a constant", () => {
    expect(CADENCE_COMPARISON_ANCHOR).toBe("2000-07-01");
  });

  // THE ANCHOR IS LOAD-BEARING, not decorative. From 2000-01-01 — January plus a leap February —
  // two months is exactly 60 days and this comparison would return 0, which would let a ward save
  // a 2-month warning window on a 60-day cadence and mark every household approaching forever.
  // Pinned so a "tidier" anchor cannot be swapped in without this failing.
  it("is anchored where a month is measured at its longest", () => {
    expect(addCadence(CADENCE_COMPARISON_ANCHOR, { amount: 2, unit: "month" })).toBe("2000-09-01");
    expect(compareCadences({ amount: 2, unit: "month" }, { amount: 60, unit: "day" })).toBe(1);
  });
});

describe("describeCadence", () => {
  it("drops the number when the amount is one", () => {
    expect(describeCadence({ amount: 1, unit: "day" })).toBe("Every day");
    expect(describeCadence({ amount: 1, unit: "week" })).toBe("Every week");
    expect(describeCadence({ amount: 1, unit: "month" })).toBe("Every month");
    expect(describeCadence({ amount: 1, unit: "year" })).toBe("Every year");
  });

  it("uses the plural label above one", () => {
    expect(describeCadence({ amount: 10, unit: "day" })).toBe("Every 10 days");
    expect(describeCadence({ amount: 3, unit: "week" })).toBe("Every 3 weeks");
    expect(describeCadence({ amount: 6, unit: "month" })).toBe("Every 6 months");
    expect(describeCadence({ amount: 2, unit: "year" })).toBe("Every 2 years");
  });
});
