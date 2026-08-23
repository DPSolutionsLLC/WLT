import { describe, expect, it } from "vitest";
import {
  FREQUENT_DECLINE_COUNT,
  LATE_CANCELLATION_DAYS,
  NOT_ASKED_MONTHS,
  NOT_SPOKEN_MONTHS,
  reliabilityFlags,
  type SpeakerHistoryEntry,
} from "@/lib/assignments/reliabilityFlags";
import { addDaysUtc, addMonths, parseDateOnly, type DateOnly } from "@/lib/calendar/dates";

// Every case drives `asOf` explicitly. NOTHING here reads the clock — a flag that fires on a
// boundary cannot be tested by a suite whose "today" moves, and the whole reason
// reliabilityFlags() takes asOf as a parameter is to make this possible.
//
// Each flag is tested ON its boundary and one day before it. "Fires eventually" is not the claim;
// "fires on the day the rule names and not the day before" is.

const TODAY: DateOnly = "2026-08-22";
const AS_OF = parseDateOnly(TODAY);

function entry(overrides: Partial<SpeakerHistoryEntry> = {}): SpeakerHistoryEntry {
  return {
    outcome: "completed",
    cancellationDaysNotice: null,
    sundayDate: "2026-08-16",
    ...overrides,
  };
}

// The date that is exactly `months` before today, and the one that is one day later — the pair
// every "recently" boundary needs.
function monthsBeforeToday(months: number): { onBoundary: DateOnly; oneDayInside: DateOnly } {
  const onBoundary = addMonths(TODAY, -months);
  return { onBoundary, oneDayInside: addDaysUtc(onBoundary, 1) };
}

describe("reliabilityFlags", () => {
  it("gives a member with no history no flags at all", () => {
    // Not four flags. A member nobody has asked is a member with no history, and reading "not
    // asked in over a year" off an empty table invents a pattern from an absence.
    expect(reliabilityFlags([], AS_OF)).toEqual([]);
  });

  describe("frequent_decliner", () => {
    it("fires on the second decline", () => {
      const history = Array.from({ length: FREQUENT_DECLINE_COUNT }, () =>
        entry({ outcome: "declined" }),
      );

      expect(reliabilityFlags(history, AS_OF)).toContain("frequent_decliner");
    });

    it("does not fire on the first", () => {
      expect(reliabilityFlags([entry({ outcome: "declined" })], AS_OF)).not.toContain(
        "frequent_decliner",
      );
    });

    it("counts declines only — an accepted and a cancelled assignment are not declines", () => {
      const history = [
        entry({ outcome: "declined" }),
        entry({ outcome: "accepted" }),
        entry({ outcome: "cancelled" }),
      ];

      expect(reliabilityFlags(history, AS_OF)).not.toContain("frequent_decliner");
    });
  });

  describe("late_canceller", () => {
    it("fires at exactly seven days' notice", () => {
      const history = [
        entry({ outcome: "cancelled", cancellationDaysNotice: LATE_CANCELLATION_DAYS }),
      ];

      expect(reliabilityFlags(history, AS_OF)).toContain("late_canceller");
    });

    it("does not fire at eight", () => {
      const history = [
        entry({ outcome: "cancelled", cancellationDaysNotice: LATE_CANCELLATION_DAYS + 1 }),
      ];

      expect(reliabilityFlags(history, AS_OF)).not.toContain("late_canceller");
    });

    it("does not fire when the notice was never recorded", () => {
      // An unrecorded number is not a short one. Firing here would flag every cancellation ever
      // written by a path that does not capture notice — which, today, is all of them.
      const history = [entry({ outcome: "cancelled", cancellationDaysNotice: null })];

      expect(reliabilityFlags(history, AS_OF)).not.toContain("late_canceller");
    });

    it("does not fire on a short-notice DECLINE — only a cancellation cancels", () => {
      const history = [
        entry({ outcome: "declined", cancellationDaysNotice: 1 }),
      ];

      expect(reliabilityFlags(history, AS_OF)).not.toContain("late_canceller");
    });
  });

  describe("not_asked_recently", () => {
    it("fires when the last assignment was exactly 18 months ago", () => {
      const { onBoundary } = monthsBeforeToday(NOT_ASKED_MONTHS);

      expect(
        reliabilityFlags([entry({ outcome: "declined", sundayDate: onBoundary })], AS_OF),
      ).toContain("not_asked_recently");
    });

    it("does not fire one day short of 18 months", () => {
      const { oneDayInside } = monthsBeforeToday(NOT_ASKED_MONTHS);

      expect(
        reliabilityFlags([entry({ outcome: "declined", sundayDate: oneDayInside })], AS_OF),
      ).not.toContain("not_asked_recently");
    });

    it("does not fire at 17 months", () => {
      const { onBoundary } = monthsBeforeToday(NOT_ASKED_MONTHS - 1);

      expect(
        reliabilityFlags([entry({ outcome: "declined", sundayDate: onBoundary })], AS_OF),
      ).not.toContain("not_asked_recently");
    });

    it("measures from the most recent assignment, not the oldest", () => {
      const { onBoundary } = monthsBeforeToday(NOT_ASKED_MONTHS);
      const history = [
        entry({ outcome: "declined", sundayDate: addMonths(TODAY, -36) }),
        entry({ outcome: "declined", sundayDate: addDaysUtc(onBoundary, 1) }),
      ];

      expect(reliabilityFlags(history, AS_OF)).not.toContain("not_asked_recently");
    });

    it("ignores a history row that lost its date with its assignment", () => {
      // `assignment_history.assignment_id` is `on delete set null`, so a dateless row is real.
      // It must not read as the most recent assignment, and it must not read as none at all.
      const { onBoundary } = monthsBeforeToday(NOT_ASKED_MONTHS);
      const history = [
        entry({ outcome: "declined", sundayDate: null }),
        entry({ outcome: "declined", sundayDate: onBoundary }),
      ];

      expect(reliabilityFlags(history, AS_OF)).toContain("not_asked_recently");
    });
  });

  describe("not_spoken_recently", () => {
    it("fires when the last completed talk was exactly two years ago", () => {
      const { onBoundary } = monthsBeforeToday(NOT_SPOKEN_MONTHS);

      expect(
        reliabilityFlags([entry({ outcome: "completed", sundayDate: onBoundary })], AS_OF),
      ).toContain("not_spoken_recently");
    });

    it("does not fire one day short of two years", () => {
      const { oneDayInside } = monthsBeforeToday(NOT_SPOKEN_MONTHS);

      expect(
        reliabilityFlags([entry({ outcome: "completed", sundayDate: oneDayInside })], AS_OF),
      ).not.toContain("not_spoken_recently");
    });

    it("does not fire at 23 months", () => {
      const { onBoundary } = monthsBeforeToday(NOT_SPOKEN_MONTHS - 1);

      expect(
        reliabilityFlags([entry({ outcome: "completed", sundayDate: onBoundary })], AS_OF),
      ).not.toContain("not_spoken_recently");
    });

    it("does not fire for a member who has been asked but has never completed a talk", () => {
      // Two declines three years ago is "declined twice", not "has not spoken in two years".
      // Saying the second would be reading a speaking pattern off a member who has never spoken.
      const history = [
        entry({ outcome: "declined", sundayDate: addMonths(TODAY, -36) }),
        entry({ outcome: "declined", sundayDate: addMonths(TODAY, -30) }),
      ];

      const flags = reliabilityFlags(history, AS_OF);

      expect(flags).not.toContain("not_spoken_recently");
      expect(flags).toContain("frequent_decliner");
      expect(flags).toContain("not_asked_recently");
    });

    it("measures from the last COMPLETED talk, not the last assignment of any kind", () => {
      const history = [
        entry({ outcome: "completed", sundayDate: addMonths(TODAY, -30) }),
        entry({ outcome: "declined", sundayDate: addMonths(TODAY, -1) }),
      ];

      const flags = reliabilityFlags(history, AS_OF);

      expect(flags).toContain("not_spoken_recently");
      expect(flags).not.toContain("not_asked_recently");
    });
  });

  it("returns the flags in enum order regardless of the order of the history", () => {
    const history = [
      entry({ outcome: "completed", sundayDate: addMonths(TODAY, -30) }),
      entry({ outcome: "cancelled", cancellationDaysNotice: 2, sundayDate: addMonths(TODAY, -25) }),
      entry({ outcome: "declined", sundayDate: addMonths(TODAY, -26) }),
      entry({ outcome: "declined", sundayDate: addMonths(TODAY, -27) }),
    ];

    expect(reliabilityFlags(history, AS_OF)).toEqual([
      "frequent_decliner",
      "late_canceller",
      "not_asked_recently",
      "not_spoken_recently",
    ]);
  });

  it("gives a member with recent, clean history no flags", () => {
    const history = [
      entry({ outcome: "completed", sundayDate: addMonths(TODAY, -2) }),
      entry({ outcome: "accepted", sundayDate: addMonths(TODAY, -1) }),
    ];

    expect(reliabilityFlags(history, AS_OF)).toEqual([]);
  });
});
