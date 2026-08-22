import { describe, expect, it } from "vitest";
import {
  resolveFastSunday,
  type FastSundayCandidate,
} from "@/lib/calendar/resolveFastSunday";
import type { SundayType } from "@/types/domain";

// The highest-priority suite in Phase 3. Fast Sunday is a resolution rule that re-runs on every
// type change in BOTH directions, and the backwards direction — clearing a conference moves Fast
// Sunday EARLIER again — is the one 03-calendar.md warns is easiest to forget.

// March 2026: five Sundays, no conferences unless a test adds one.
const MARCH = ["2026-03-01", "2026-03-08", "2026-03-15", "2026-03-22", "2026-03-29"];

function month(
  types: Partial<Record<string, SundayType>> = {},
  pinned: string | null = null,
): FastSundayCandidate[] {
  return MARCH.map((date) => ({
    id: `sunday-${date}`,
    date,
    type: types[date] ?? "standard",
    fastSundayPinned: date === pinned,
  }));
}

describe("resolveFastSunday", () => {
  it("defaults to the first Sunday of the month", () => {
    expect(resolveFastSunday(month())).toBe("sunday-2026-03-01");
  });

  it("shifts past a stake conference on the first Sunday", () => {
    expect(resolveFastSunday(month({ "2026-03-01": "stake_conference" }))).toBe(
      "sunday-2026-03-08",
    );
  });

  it("shifts past general conference the same way", () => {
    expect(resolveFastSunday(month({ "2026-03-01": "general_conference" }))).toBe(
      "sunday-2026-03-08",
    );
  });

  it("shifts past a holiday, and past two displacing Sundays in a row", () => {
    expect(resolveFastSunday(month({ "2026-03-01": "holiday" }))).toBe(
      "sunday-2026-03-08",
    );
    expect(
      resolveFastSunday(
        month({ "2026-03-01": "stake_conference", "2026-03-08": "holiday" }),
      ),
    ).toBe("sunday-2026-03-15");
  });

  // `special` is deliberately NOT displacing: a special meeting still holds a fast and testimony
  // meeting unless somebody says otherwise.
  it("does not shift past a special meeting", () => {
    expect(resolveFastSunday(month({ "2026-03-01": "special" }))).toBe(
      "sunday-2026-03-01",
    );
  });

  // The direction that is easy to get wrong: the rule must run again when a conference is
  // CLEARED, and it must move Fast Sunday back to the earlier date.
  it("moves Fast Sunday back when the conference is cleared", () => {
    const shifted = month({ "2026-03-01": "stake_conference", "2026-03-08": "fast_sunday" });
    expect(resolveFastSunday(shifted)).toBe("sunday-2026-03-08");

    const cleared = month({ "2026-03-01": "standard", "2026-03-08": "fast_sunday" });
    expect(resolveFastSunday(cleared)).toBe("sunday-2026-03-01");
  });

  it("keeps a pinned Sunday even when an earlier one is not displaced", () => {
    expect(resolveFastSunday(month({}, "2026-03-22"))).toBe("sunday-2026-03-22");
  });

  it("keeps a pinned Sunday through a change that would otherwise move Fast Sunday", () => {
    expect(
      resolveFastSunday(month({ "2026-03-01": "stake_conference" }, "2026-03-22")),
    ).toBe("sunday-2026-03-22");
  });

  // A stale second pin must not take a calendar page down. The earliest wins, silently.
  it("returns the earliest of two pins rather than throwing", () => {
    const candidates = month();
    candidates[1].fastSundayPinned = true;
    candidates[3].fastSundayPinned = true;

    expect(resolveFastSunday(candidates)).toBe("sunday-2026-03-08");
  });

  it("returns null when every Sunday in the month is displaced", () => {
    expect(
      resolveFastSunday(
        month({
          "2026-03-01": "stake_conference",
          "2026-03-08": "general_conference",
          "2026-03-15": "holiday",
          "2026-03-22": "stake_conference",
          "2026-03-29": "holiday",
        }),
      ),
    ).toBeNull();
  });

  // ward_conference is the type that proved FAST_SUNDAY_DISPLACING_TYPES and
  // NO_MEETING_SUNDAY_TYPES had to be two lists. resolveFastSunday() reads the FIRST one, whose
  // meaning did not change — it simply gained a member — so this file needed no change beyond
  // proving the new member behaves like the others.
  it("shifts past a ward conference on the first Sunday", () => {
    expect(resolveFastSunday(month({ "2026-03-01": "ward_conference" }))).toBe(
      "sunday-2026-03-08",
    );
  });

  it("shifts past a ward conference and a stake conference together", () => {
    expect(
      resolveFastSunday(
        month({
          "2026-03-01": "ward_conference",
          "2026-03-08": "stake_conference",
        }),
      ),
    ).toBe("sunday-2026-03-15");
  });

  // The other half of the split, re-proved: `holiday` still displaces Fast Sunday even though it
  // now holds a sacrament meeting. Displacing and cancelling are different questions.
  it("still shifts past a holiday on the first Sunday", () => {
    expect(resolveFastSunday(month({ "2026-03-01": "holiday" }))).toBe("sunday-2026-03-08");
  });

  it("returns null for a month of nothing but displacing types", () => {
    expect(
      resolveFastSunday(
        month({
          "2026-03-01": "ward_conference",
          "2026-03-08": "holiday",
          "2026-03-15": "stake_conference",
          "2026-03-22": "general_conference",
          "2026-03-29": "ward_conference",
        }),
      ),
    ).toBeNull();
  });

  it("returns null for an empty month", () => {
    expect(resolveFastSunday([])).toBeNull();
  });

  // A candidate already typed fast_sunday is not displacing, so it stays chosen. Without this,
  // re-resolution would walk Fast Sunday forward one week on every run.
  it("is idempotent over an already-resolved month", () => {
    const resolved = month({ "2026-03-01": "fast_sunday" });

    expect(resolveFastSunday(resolved)).toBe("sunday-2026-03-01");
    expect(resolveFastSunday(resolved)).toBe("sunday-2026-03-01");
  });

  it("sorts by date rather than trusting the caller's order", () => {
    const shuffled = [...month()].reverse();

    expect(resolveFastSunday(shuffled)).toBe("sunday-2026-03-01");
  });

  it("does not mutate the array it was given", () => {
    const candidates = [...month()].reverse();
    const before = candidates.map((candidate) => candidate.id);

    resolveFastSunday(candidates);

    expect(candidates.map((candidate) => candidate.id)).toEqual(before);
  });
});
