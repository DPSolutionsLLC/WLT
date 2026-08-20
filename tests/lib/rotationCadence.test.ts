import { describe, expect, it } from "vitest";
import { countMonthsBetween } from "@/lib/calendar/dates";
import {
  resolveConductingUser,
  type RotationEntry,
} from "@/lib/calendar/resolveConductingUser";

// The monthly cadence: one person takes every Sunday in a month, and the rotation hands over at
// the month boundary rather than the week boundary. Scenario 010's walkthrough found that this,
// not the weekly cycle 03-calendar.md Step 3 describes, is how this ward actually runs — and no
// test could have caught it, because the code matched the spec exactly.
//
// The weekly rule is pinned by tests/lib/conductingRotation.test.ts, whose assertions are
// deliberately unchanged. This file adds the second cadence and re-proves the two guarantees
// that must survive both: a negative offset returns null rather than wrapping, and an unfilled
// position returns null rather than skipping.

const BISHOP = "user-bishop";
const FIRST_COUNSELOR = "user-first";
const SECOND_COUNSELOR = "user-second";

function monthlySet(effectiveFrom: string): RotationEntry[] {
  return [
    { position: 1, userId: BISHOP, effectiveFrom, cadence: "monthly" },
    { position: 2, userId: FIRST_COUNSELOR, effectiveFrom, cadence: "monthly" },
    { position: 3, userId: SECOND_COUNSELOR, effectiveFrom, cadence: "monthly" },
  ];
}

function weeklySet(effectiveFrom: string): RotationEntry[] {
  return [
    { position: 1, userId: BISHOP, effectiveFrom, cadence: "weekly" },
    { position: 2, userId: FIRST_COUNSELOR, effectiveFrom, cadence: "weekly" },
    { position: 3, userId: SECOND_COUNSELOR, effectiveFrom, cadence: "weekly" },
  ];
}

describe("countMonthsBetween", () => {
  it("returns 0 for two dates in the same month", () => {
    expect(countMonthsBetween("2026-06-01", "2026-06-30")).toBe(0);
    expect(countMonthsBetween("2026-06-30", "2026-06-01")).toBe(0);
  });

  it("counts whole months forward regardless of the day", () => {
    expect(countMonthsBetween("2026-06-30", "2026-07-01")).toBe(1);
    expect(countMonthsBetween("2026-01-15", "2026-04-02")).toBe(3);
  });

  it("counts across a year boundary in both directions", () => {
    expect(countMonthsBetween("2026-12-06", "2027-01-03")).toBe(1);
    expect(countMonthsBetween("2027-01-03", "2026-12-06")).toBe(-1);
    expect(countMonthsBetween("2025-11-02", "2027-02-07")).toBe(15);
  });

  // A negative result is returned as-is, matching countSundaysBetween. The caller decides what a
  // date before the anchor means.
  it("returns a negative count rather than clamping to zero", () => {
    expect(countMonthsBetween("2026-06-07", "2026-05-31")).toBe(-1);
  });

  // Pure string arithmetic, but the arguments still go through parseDateOnly so a malformed
  // input throws here rather than producing a plausible number.
  it("rejects a value that is not a real date", () => {
    expect(() => countMonthsBetween("2026-02-30", "2026-03-01")).toThrow();
    expect(() => countMonthsBetween("2026-06-07", "June 2026")).toThrow();
  });
});

describe("resolveConductingUser — monthly cadence", () => {
  // June 2026 Sundays: the 7th, 14th, 21st and 28th.
  it("gives every Sunday in a month to the same person", () => {
    const june = monthlySet("2026-06-01");

    for (const sunday of ["2026-06-07", "2026-06-14", "2026-06-21", "2026-06-28"]) {
      expect(resolveConductingUser(sunday, june, "2026-06-01"), sunday).toBe(BISHOP);
    }
  });

  it("hands over at the month boundary, not the week boundary", () => {
    const june = monthlySet("2026-06-01");

    // 2026-06-28 and 2026-07-05 are consecutive Sundays either side of a month boundary.
    expect(resolveConductingUser("2026-06-28", june, "2026-06-01")).toBe(BISHOP);
    expect(resolveConductingUser("2026-07-05", june, "2026-06-01")).toBe(FIRST_COUNSELOR);
    expect(resolveConductingUser("2026-08-02", june, "2026-06-01")).toBe(SECOND_COUNSELOR);
    expect(resolveConductingUser("2026-09-06", june, "2026-06-01")).toBe(BISHOP);
  });

  // May 2026 has FIVE Sundays and opens on a Friday, so the monthly cadence has to hold across
  // five rather than four — the case a four-Sunday month cannot show.
  it("holds across a five-Sunday month", () => {
    const may = monthlySet("2026-05-01");

    for (const sunday of [
      "2026-05-03",
      "2026-05-10",
      "2026-05-17",
      "2026-05-24",
      "2026-05-31",
    ]) {
      expect(resolveConductingUser(sunday, may, "2026-05-01"), sunday).toBe(BISHOP);
    }

    expect(resolveConductingUser("2026-06-07", may, "2026-05-01")).toBe(FIRST_COUNSELOR);
  });

  // Decision 7: monthly anchors on the month CONTAINING effective_from. Starting at the next
  // whole month would leave the rest of March with no rule at all.
  it("governs the rest of the month it takes effect in, at position 1", () => {
    const midMonth = monthlySet("2026-03-15");

    expect(resolveConductingUser("2026-03-15", midMonth, "2026-03-15")).toBe(BISHOP);
    expect(resolveConductingUser("2026-03-22", midMonth, "2026-03-15")).toBe(BISHOP);
    expect(resolveConductingUser("2026-03-29", midMonth, "2026-03-15")).toBe(BISHOP);
    expect(resolveConductingUser("2026-04-05", midMonth, "2026-03-15")).toBe(
      FIRST_COUNSELOR,
    );
  });

  it("carries the cycle across a year boundary", () => {
    const november = monthlySet("2026-11-01");

    expect(resolveConductingUser("2026-11-01", november, "2026-11-01")).toBe(BISHOP);
    expect(resolveConductingUser("2026-12-06", november, "2026-11-01")).toBe(
      FIRST_COUNSELOR,
    );
    expect(resolveConductingUser("2027-01-03", november, "2026-11-01")).toBe(
      SECOND_COUNSELOR,
    );
    expect(resolveConductingUser("2027-02-07", november, "2026-11-01")).toBe(BISHOP);
  });

  // A cadence change INSERTS a new set at a new effective_from rather than updating the old one
  // (migration 024, Part 1), so "applies forward only" is true of the cadence exactly as it is
  // of the order — with no second mechanism to keep in step.
  it("applies a cadence change only from its own effective date", () => {
    const both = [...weeklySet("2026-05-01"), ...monthlySet("2026-06-01")];

    // May still resolves weekly: 05-03 is the anchor Sunday, 05-10 the next.
    expect(resolveConductingUser("2026-05-03", both, "2026-05-01")).toBe(BISHOP);
    expect(resolveConductingUser("2026-05-10", both, "2026-05-01")).toBe(FIRST_COUNSELOR);
    expect(resolveConductingUser("2026-05-17", both, "2026-05-01")).toBe(SECOND_COUNSELOR);

    // June resolves monthly against the new set, whose anchor is its own effective date.
    expect(resolveConductingUser("2026-06-07", both, "2026-06-01")).toBe(BISHOP);
    expect(resolveConductingUser("2026-06-28", both, "2026-06-01")).toBe(BISHOP);
  });

  // A negative modulo in JavaScript is negative, and indexing backwards from the end would hand
  // back position 3 — a wrong answer wearing the shape of a right one.
  it("returns null rather than wrapping when the Sunday precedes the anchor", () => {
    const july = monthlySet("2025-01-01").map((entry) => ({
      ...entry,
      effectiveFrom: "2025-01-01" as const,
    }));

    expect(resolveConductingUser("2026-06-07", july, "2026-07-01")).toBeNull();
  });

  it("returns null for a date before every effective date", () => {
    expect(resolveConductingUser("2026-05-03", monthlySet("2026-06-01"), "2026-06-01")).toBeNull();
  });

  // Skipping an unfilled position would quietly give one counselor twice the turns — and under a
  // monthly cadence it would cost them a whole month rather than one Sunday.
  it("returns null for an unfilled position instead of skipping to the next one", () => {
    const withGap: RotationEntry[] = [
      { position: 1, userId: BISHOP, effectiveFrom: "2026-06-01", cadence: "monthly" },
      { position: 2, userId: null, effectiveFrom: "2026-06-01", cadence: "monthly" },
      {
        position: 3,
        userId: SECOND_COUNSELOR,
        effectiveFrom: "2026-06-01",
        cadence: "monthly",
      },
    ];

    expect(resolveConductingUser("2026-07-05", withGap, "2026-06-01")).toBeNull();
    expect(resolveConductingUser("2026-07-26", withGap, "2026-06-01")).toBeNull();
    expect(resolveConductingUser("2026-08-02", withGap, "2026-06-01")).toBe(
      SECOND_COUNSELOR,
    );
  });

  it("returns null when the ward has no rotation configured", () => {
    expect(resolveConductingUser("2026-06-07", [], "2026-06-01")).toBeNull();
  });

  // The monthly branch never constructs a Date and never counts weeks, so a month containing a
  // daylight-saving transition cannot shift it. 2026-03-08 is the US transition.
  it("is unaffected by a daylight-saving transition inside the month", () => {
    const march = monthlySet("2026-03-01");

    for (const sunday of ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-29"]) {
      expect(resolveConductingUser(sunday, march, "2026-03-01"), sunday).toBe(BISHOP);
    }
  });
});
