import { describe, expect, it } from "vitest";
import {
  FAST_SUNDAY_DISPLACING_TYPES,
  holdsSacramentMeeting,
  NO_MEETING_SUNDAY_TYPES,
  SUNDAY_TYPE_LABELS,
  SUNDAY_TYPES,
  type SundayType,
} from "@/types/domain";

// THIS IS THE TEST THAT MAKES ADDING A FUTURE SUNDAY TYPE A DECISION RATHER THAN A DEFAULT.
//
// One list used to answer two questions — "can this Sunday BE Fast Sunday" and "does it hold a
// sacrament meeting" — because the two sets happened to coincide. `ward_conference` forced them
// apart from one side and `holiday` from the other. Nothing in the type system stops a future
// type from silently inheriting whichever answer the list it was added to happens to give, so the
// table below states BOTH answers for every type and fails when a type is added without one.

type Answers = {
  canBeFastSunday: boolean;
  holdsMeeting: boolean;
};

const EXPECTED: Record<SundayType, Answers> = {
  standard: { canBeFastSunday: true, holdsMeeting: true },
  // It already IS Fast Sunday; it is not displaced by itself, which is what makes re-resolution
  // idempotent rather than walking Fast Sunday forward a week per run.
  fast_sunday: { canBeFastSunday: true, holdsMeeting: true },
  stake_conference: { canBeFastSunday: false, holdsMeeting: false },
  general_conference: { canBeFastSunday: false, holdsMeeting: false },
  // The type that forced the split from one side: a ward marking Christmas Sunday as a holiday
  // still meets, often with a shortened or music-focused service.
  holiday: { canBeFastSunday: false, holdsMeeting: true },
  // And from the other side: the first type that cannot be Fast Sunday while holding a completely
  // ordinary meeting, with a conductor, speakers and organization meetings.
  ward_conference: { canBeFastSunday: false, holdsMeeting: true },
  // A special meeting still holds a fast and testimony meeting unless somebody says otherwise.
  special: { canBeFastSunday: true, holdsMeeting: true },
};

describe("every Sunday type answers both questions", () => {
  // The guard itself. A type added to SUNDAY_TYPES without an entry above is a compile error on
  // the Record; this proves the table has not drifted the other way either.
  it("states an expectation for exactly the types that exist", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...SUNDAY_TYPES].sort());
  });

  it("gives every type a label", () => {
    for (const type of SUNDAY_TYPES) {
      expect(SUNDAY_TYPE_LABELS[type], type).toBeTruthy();
    }
  });

  it.each(SUNDAY_TYPES)("%s: can it be Fast Sunday?", (type) => {
    expect(!FAST_SUNDAY_DISPLACING_TYPES.includes(type)).toBe(EXPECTED[type].canBeFastSunday);
  });

  it.each(SUNDAY_TYPES)("%s: does it hold a sacrament meeting?", (type) => {
    expect(holdsSacramentMeeting(type)).toBe(EXPECTED[type].holdsMeeting);
  });
});

describe("the two lists are genuinely different", () => {
  // If these ever coincide again, the split has been undone and the two meanings have quietly
  // merged back into one.
  it("does not hold the same members", () => {
    expect([...FAST_SUNDAY_DISPLACING_TYPES].sort()).not.toEqual(
      [...NO_MEETING_SUNDAY_TYPES].sort(),
    );
  });

  it("names exactly stake and general conference as holding no meeting", () => {
    expect([...NO_MEETING_SUNDAY_TYPES].sort()).toEqual([
      "general_conference",
      "stake_conference",
    ]);
  });

  it("names four types that cannot be Fast Sunday", () => {
    expect([...FAST_SUNDAY_DISPLACING_TYPES].sort()).toEqual([
      "general_conference",
      "holiday",
      "stake_conference",
      "ward_conference",
    ]);
  });

  // Every type that holds no meeting must also be unable to be Fast Sunday. The reverse does not
  // hold, and that asymmetry is the entire point.
  it("makes no-meeting a strict subset of cannot-be-Fast-Sunday", () => {
    for (const type of NO_MEETING_SUNDAY_TYPES) {
      expect(FAST_SUNDAY_DISPLACING_TYPES, type).toContain(type);
    }

    expect(NO_MEETING_SUNDAY_TYPES.length).toBeLessThan(
      FAST_SUNDAY_DISPLACING_TYPES.length,
    );
  });
});
