import { describe, expect, it } from "vitest";
import {
  activeRotation,
  resolveConductingUser,
  type RotationEntry,
} from "@/lib/calendar/resolveConductingUser";

import { allMeetingSeries } from "@/tests/helpers/meetingSeries";

// Every assertion in this file predates the no-meeting skip rule and asks the same question:
// what does the cycle do when NOTHING interrupts it. resolveConductingUser() now requires the
// meeting history, so that question is written down explicitly rather than assumed — an
// all-meeting series over a range wide enough to cover every date below.
//
// The assertions themselves are unchanged. A test whose expected value had to be retuned around
// a cancellation it never meant to exercise would no longer be pinning the rule it was written
// for.
const SERIES = allMeetingSeries("2025-01-01", "2027-12-31");


const BISHOP = "user-bishop";
const FIRST_COUNSELOR = "user-first";
const SECOND_COUNSELOR = "user-second";

// Every literal here carries cadence: "weekly" and every assertion below is UNCHANGED. That is
// the point of this suite after calendar-c: 'weekly' is the default the migration writes onto
// every existing row, and this file is the proof that adding the cadence changed nothing about
// the rule 03-calendar.md Step 3 describes. The monthly rule lives in tests/lib/rotationCadence.

// January 2026 Sundays: the 4th, 11th, 18th and 25th.
const JANUARY_SET: RotationEntry[] = [
  { position: 1, userId: BISHOP, effectiveFrom: "2026-01-01", cadence: "weekly" },
  { position: 2, userId: FIRST_COUNSELOR, effectiveFrom: "2026-01-01", cadence: "weekly" },
  { position: 3, userId: SECOND_COUNSELOR, effectiveFrom: "2026-01-01", cadence: "weekly" },
];

// A change inserts a WHOLE NEW SET at a new effective_from rather than updating the old one
// (migration 023), which is what makes "applies forward only" true by construction.
const MARCH_SET: RotationEntry[] = [
  { position: 1, userId: SECOND_COUNSELOR, effectiveFrom: "2026-03-01", cadence: "weekly" },
  { position: 2, userId: BISHOP, effectiveFrom: "2026-03-01", cadence: "weekly" },
  { position: 3, userId: FIRST_COUNSELOR, effectiveFrom: "2026-03-01", cadence: "weekly" },
];

describe("activeRotation", () => {
  it("returns the latest set that is not in the future", () => {
    const both = [...JANUARY_SET, ...MARCH_SET];

    expect(activeRotation(both, "2026-02-15")[0].effectiveFrom).toBe("2026-01-01");
    expect(activeRotation(both, "2026-03-01")[0].effectiveFrom).toBe("2026-03-01");
  });

  it("returns the set ordered by position", () => {
    const shuffled = [...JANUARY_SET].reverse();

    expect(activeRotation(shuffled, "2026-01-04").map((entry) => entry.position)).toEqual([
      1, 2, 3,
    ]);
  });

  it("returns nothing when every set is in the future", () => {
    expect(activeRotation(MARCH_SET, "2026-01-04")).toEqual([]);
  });

  it("returns nothing when there is no rotation at all", () => {
    expect(activeRotation([], "2026-01-04")).toEqual([]);
  });
});

describe("resolveConductingUser", () => {
  it("cycles 1 to 2 to 3 and back to 1 across four consecutive Sundays", () => {
    const anchor = "2026-01-01";

    expect(resolveConductingUser("2026-01-04", JANUARY_SET, anchor, SERIES)).toBe(BISHOP);
    expect(resolveConductingUser("2026-01-11", JANUARY_SET, anchor, SERIES)).toBe(FIRST_COUNSELOR);
    expect(resolveConductingUser("2026-01-18", JANUARY_SET, anchor, SERIES)).toBe(
      SECOND_COUNSELOR,
    );
    expect(resolveConductingUser("2026-01-25", JANUARY_SET, anchor, SERIES)).toBe(BISHOP);
  });

  it("normalises an anchor that is not itself a Sunday forward to the first Sunday", () => {
    // 2026-01-01 is a Thursday; the first Sunday on or after it is the 4th.
    expect(resolveConductingUser("2026-01-04", JANUARY_SET, "2026-01-01", SERIES)).toBe(
      resolveConductingUser("2026-01-04", JANUARY_SET, "2026-01-04", SERIES),
    );
  });

  it("keeps counting correctly across a DST boundary", () => {
    // 2026-03-01 and 2026-03-08 are consecutive Sundays with an hour lost between them.
    const anchor = "2026-03-01";

    expect(resolveConductingUser("2026-03-01", MARCH_SET, anchor, SERIES)).toBe(SECOND_COUNSELOR);
    expect(resolveConductingUser("2026-03-08", MARCH_SET, anchor, SERIES)).toBe(BISHOP);
    expect(resolveConductingUser("2026-03-15", MARCH_SET, anchor, SERIES)).toBe(FIRST_COUNSELOR);
  });

  it("applies a later set only from its own effective date", () => {
    const both = [...JANUARY_SET, ...MARCH_SET];

    // February still resolves against the January set — 2026-02-01 is the fifth Sunday from the
    // anchor, so the cycle has it at position 2.
    expect(resolveConductingUser("2026-02-01", both, "2026-01-01", SERIES)).toBe(FIRST_COUNSELOR);

    // ...and March restarts at position 1 of the new set.
    expect(resolveConductingUser("2026-03-01", both, "2026-03-01", SERIES)).toBe(
      SECOND_COUNSELOR,
    );
    expect(resolveConductingUser("2026-03-08", both, "2026-03-01", SERIES)).toBe(BISHOP);
  });

  it("returns null for a date before every effective date", () => {
    expect(resolveConductingUser("2026-01-04", MARCH_SET, "2026-03-01", SERIES)).toBeNull();
  });

  // A negative modulo in JavaScript is negative, and indexing backwards would hand back
  // position 3 — a wrong answer wearing the shape of a right one.
  it("returns null rather than wrapping when the Sunday precedes the anchor", () => {
    const early: RotationEntry[] = JANUARY_SET.map((entry) => ({
      ...entry,
      effectiveFrom: "2025-01-01",
    }));

    expect(resolveConductingUser("2026-01-04", early, "2026-02-01", SERIES)).toBeNull();
  });

  it("returns null when the ward has no rotation configured", () => {
    expect(resolveConductingUser("2026-01-04", [], "2026-01-01", SERIES)).toBeNull();
  });

  // Skipping an unfilled position would quietly give one counselor twice the turns.
  it("returns null for an unfilled position instead of skipping to the next one", () => {
    const withGap: RotationEntry[] = [
      { position: 1, userId: BISHOP, effectiveFrom: "2026-01-01", cadence: "weekly" },
      { position: 2, userId: null, effectiveFrom: "2026-01-01", cadence: "weekly" },
      { position: 3, userId: SECOND_COUNSELOR, effectiveFrom: "2026-01-01", cadence: "weekly" },
    ];

    expect(resolveConductingUser("2026-01-11", withGap, "2026-01-01", SERIES)).toBeNull();
    expect(resolveConductingUser("2026-01-18", withGap, "2026-01-01", SERIES)).toBe(
      SECOND_COUNSELOR,
    );
  });
});
