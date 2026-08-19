import { describe, expect, it } from "vitest";
import { toSlotConfigJson, type SlotConfigEntry } from "@/lib/calendar/queries";
import {
  dateOnlySchema,
  MAX_SPEAKING_SLOTS,
  slotConfigSchema,
  sundayRangeSchema,
  updateSundaySchema,
} from "@/lib/validation/calendar";

// slot_config is a jsonb blob, so nothing validates it on READ. A malformed entry accepted today
// breaks Phase 6's program builder months from now, a long way from the boundary that let it in.

const VALID: SlotConfigEntry[] = [
  { slotNumber: 1, lengthMinutes: 5, type: "youth_speaker" },
  { slotNumber: 2, lengthMinutes: 10, type: "sacrament_talk" },
  { slotNumber: 3, lengthMinutes: 15, type: "sacrament_talk" },
];

describe("slotConfigSchema", () => {
  it("accepts a well-formed configuration", () => {
    expect(slotConfigSchema.safeParse(VALID).success).toBe(true);
  });

  it("accepts an empty array", () => {
    expect(slotConfigSchema.safeParse([]).success).toBe(true);
  });

  it("rejects a missing lengthMinutes", () => {
    expect(
      slotConfigSchema.safeParse([{ slotNumber: 1, type: "sacrament_talk" }]).success,
    ).toBe(false);
  });

  it("rejects a slot number of zero", () => {
    expect(
      slotConfigSchema.safeParse([
        { slotNumber: 0, lengthMinutes: 10, type: "sacrament_talk" },
      ]).success,
    ).toBe(false);
  });

  it("rejects a type that is not an assignment type", () => {
    expect(
      slotConfigSchema.safeParse([
        { slotNumber: 1, lengthMinutes: 10, type: "musical_number" },
      ]).success,
    ).toBe(false);
  });

  it("rejects duplicate slot numbers", () => {
    const result = slotConfigSchema.safeParse([
      { slotNumber: 1, lengthMinutes: 10, type: "sacrament_talk" },
      { slotNumber: 1, lengthMinutes: 12, type: "sacrament_talk" },
    ]);

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain("twice");
  });

  // The bishopric sets speaking slots per Sunday and 15 is the sanity bound, not 3. A testimony
  // meeting or a farewell with the whole family speaking must fit.
  it("accepts a full fifteen-slot meeting", () => {
    const fifteen = Array.from({ length: MAX_SPEAKING_SLOTS }, (_unused, index) => ({
      slotNumber: index + 1,
      lengthMinutes: 4,
      type: "sacrament_talk" as const,
    }));

    expect(slotConfigSchema.safeParse(fifteen).success).toBe(true);
  });

  it("rejects more slots than a meeting has", () => {
    const sixteen = Array.from({ length: MAX_SPEAKING_SLOTS + 1 }, (_unused, index) => ({
      slotNumber: index + 1,
      lengthMinutes: 4,
      type: "sacrament_talk" as const,
    }));

    expect(slotConfigSchema.safeParse(sixteen).success).toBe(false);
  });

  it("rejects a length longer than a meeting", () => {
    expect(
      slotConfigSchema.safeParse([
        { slotNumber: 1, lengthMinutes: 90, type: "sacrament_talk" },
      ]).success,
    ).toBe(false);
  });
});

describe("updateSundaySchema speakingSlots", () => {
  it("accepts any count from zero to fifteen", () => {
    for (const speakingSlots of [0, 1, 3, 8, MAX_SPEAKING_SLOTS]) {
      expect(
        updateSundaySchema.safeParse({ speakingSlots }).success,
        `${speakingSlots} slots was rejected`,
      ).toBe(true);
    }
  });

  it("rejects a count past the sanity bound or below zero", () => {
    expect(
      updateSundaySchema.safeParse({ speakingSlots: MAX_SPEAKING_SLOTS + 1 }).success,
    ).toBe(false);
    expect(updateSundaySchema.safeParse({ speakingSlots: -1 }).success).toBe(false);
  });
});

describe("updateSundaySchema slotConfig", () => {
  it("accepts null, meaning no slot configuration is set", () => {
    const result = updateSundaySchema.safeParse({ slotConfig: null });

    expect(result.success).toBe(true);
    expect(result.data?.slotConfig).toBeNull();
  });

  it("rejects a malformed configuration at the route boundary", () => {
    expect(
      updateSundaySchema.safeParse({ slotConfig: [{ slotNumber: 1 }] }).success,
    ).toBe(false);
  });
});

describe("slot config storage shape", () => {
  // The blob stays snake_case because SPEC.md specifies it and Phase 6 reads it. The mapping
  // happens once, in lib/calendar/queries.ts — this test is what stops somebody "fixing" the
  // inconsistency in either direction.
  it("writes snake_case keys into the jsonb blob", () => {
    expect(toSlotConfigJson(VALID)).toEqual([
      { slot_number: 1, length_minutes: 5, type: "youth_speaker" },
      { slot_number: 2, length_minutes: 10, type: "sacrament_talk" },
      { slot_number: 3, length_minutes: 15, type: "sacrament_talk" },
    ]);
  });

  it("writes null through unchanged", () => {
    expect(toSlotConfigJson(null)).toBeNull();
  });
});

// A date that matches the pattern but does not exist reached Postgres as `date/time field value
// out of range`, which surfaced as a 500 on a request that was simply wrong.
describe("dateOnlySchema", () => {
  it("accepts a real date", () => {
    expect(dateOnlySchema.safeParse("2026-03-01").success).toBe(true);
    expect(dateOnlySchema.safeParse("2024-02-29").success).toBe(true);
  });

  it("rejects a well-shaped date that does not exist", () => {
    for (const value of ["2026-02-31", "2026-02-29", "2026-04-31", "2026-13-01"]) {
      const result = dateOnlySchema.safeParse(value);
      expect(result.success, `${value} was accepted`).toBe(false);
      expect(result.error?.issues[0].message).toBe("That date does not exist.");
    }
  });

  it("rejects a malformed date with the shape message instead", () => {
    const result = dateOnlySchema.safeParse("2026-3-1");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Use a YYYY-MM-DD date.");
  });
});

describe("sundayRangeSchema", () => {
  it("rejects an impossible range end before it reaches the database", () => {
    expect(
      sundayRangeSchema.safeParse({ from: "2026-02-01", to: "2026-02-31" }).success,
    ).toBe(false);
  });

  it("rejects an end date before the start date", () => {
    expect(
      sundayRangeSchema.safeParse({ from: "2026-03-01", to: "2026-02-01" }).success,
    ).toBe(false);
  });

  it("accepts a well-formed range", () => {
    expect(
      sundayRangeSchema.safeParse({ from: "2026-02-01", to: "2026-02-28" }).success,
    ).toBe(true);
  });
});
