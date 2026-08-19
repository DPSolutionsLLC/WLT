import { describe, expect, it, vi } from "vitest";
import { generateSundays } from "@/lib/calendar/generateSundays";
import {
  FALLBACK_SPEAKING_SLOTS,
  parseDefaultSpeakingSlots,
} from "@/lib/calendar/wardCalendarSettings";
import {
  MAX_SPEAKING_SLOTS,
  wardCalendarSettingsSchema,
} from "@/lib/validation/calendar";

// The ward's default speaker count is a SETTING, not a constant. These tests pin the two halves
// that must agree: the reader falls back safely on anything malformed, and generation actually
// honours the value it is given.

describe("parseDefaultSpeakingSlots", () => {
  it("reads a valid whole number", () => {
    expect(parseDefaultSpeakingSlots({ default_speaking_slots: 5 })).toBe(5);
    expect(parseDefaultSpeakingSlots({ default_speaking_slots: 1 })).toBe(1);
    expect(
      parseDefaultSpeakingSlots({ default_speaking_slots: MAX_SPEAKING_SLOTS }),
    ).toBe(MAX_SPEAKING_SLOTS);
  });

  it("falls back when the ward has never set one", () => {
    expect(parseDefaultSpeakingSlots({})).toBe(FALLBACK_SPEAKING_SLOTS);
    expect(parseDefaultSpeakingSlots({ timezone: "America/Denver" })).toBe(
      FALLBACK_SPEAKING_SLOTS,
    );
  });

  it("falls back rather than throwing on settings that are not an object", () => {
    for (const settings of [null, undefined, "3", 3, ["3"]]) {
      expect(parseDefaultSpeakingSlots(settings)).toBe(FALLBACK_SPEAKING_SLOTS);
    }
  });

  // A malformed setting must not be able to take a calendar page down. Same rule as
  // mergeRoleAccess() in lib/auth/permissions.ts: warn, fall back, keep going.
  it("warns and falls back on a value that is out of range or not a whole number", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const raw of ["5", 0, -1, 2.5, MAX_SPEAKING_SLOTS + 1, true, {}]) {
      expect(parseDefaultSpeakingSlots({ default_speaking_slots: raw })).toBe(
        FALLBACK_SPEAKING_SLOTS,
      );
    }

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("wardCalendarSettingsSchema", () => {
  it("accepts any whole number of speakers up to the cap", () => {
    for (const defaultSpeakingSlots of [1, 3, 7, MAX_SPEAKING_SLOTS]) {
      expect(
        wardCalendarSettingsSchema.safeParse({ defaultSpeakingSlots }).success,
        `${defaultSpeakingSlots} was rejected`,
      ).toBe(true);
    }
  });

  // A ward whose DEFAULT is zero would generate a year of empty meetings. An individual Sunday
  // may still be set to zero through updateSundaySchema.
  it("refuses a default of zero, a fraction, or more than the cap", () => {
    for (const defaultSpeakingSlots of [0, -1, 2.5, MAX_SPEAKING_SLOTS + 1]) {
      expect(
        wardCalendarSettingsSchema.safeParse({ defaultSpeakingSlots }).success,
        `${defaultSpeakingSlots} was accepted`,
      ).toBe(false);
    }
  });
});

describe("generateSundays honours the ward default", () => {
  it("gives every standard Sunday the ward's number of speakers", () => {
    const march = generateSundays("2026-03-01", "2026-03-31", 6);

    const standard = march.filter((sunday) => sunday.type === "standard");
    expect(standard).toHaveLength(4);
    expect(standard.every((sunday) => sunday.speakingSlots === 6)).toBe(true);
  });

  it("still gives Fast Sunday and general conference no speakers", () => {
    const april = generateSundays("2026-04-01", "2026-04-30", 12);

    expect(
      april.find((sunday) => sunday.date === "2026-04-05")?.speakingSlots,
    ).toBe(0);
    expect(
      april.find((sunday) => sunday.date === "2026-04-12")?.speakingSlots,
    ).toBe(0);
    expect(
      april.find((sunday) => sunday.date === "2026-04-19")?.speakingSlots,
    ).toBe(12);
  });

  it("falls back to three when no default is passed", () => {
    const march = generateSundays("2026-03-01", "2026-03-31");

    expect(
      march.find((sunday) => sunday.date === "2026-03-08")?.speakingSlots,
    ).toBe(FALLBACK_SPEAKING_SLOTS);
  });
});
