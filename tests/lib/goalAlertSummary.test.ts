import { describe, expect, it } from "vitest";
import { summarizeAlerts } from "@/components/goals/GoalAlertBanner";

// The banner's heading used to count only the overdue goals, which was accurate and read wrong —
// "3 ward goals are overdue" above four lines invites the reader to count the lines and doubt the
// number. Walking scenario 019 surfaced it; this pins the replacement.
//
// It is a pure string function, so it is tested here rather than by rendering: the plural and
// subject rules are the whole content, and a render test would assert them through three layers of
// markup for no extra confidence.

describe("summarizeAlerts", () => {
  it("names BOTH numbers when both kinds are present", () => {
    expect(summarizeAlerts(3, 1)).toBe("3 ward goals are overdue, 1 is due soon");
  });

  it("does not repeat the subject in the second clause", () => {
    // "…, 1 ward goal is due soon" reads as two separate announcements rather than one sentence.
    expect(summarizeAlerts(3, 1)).not.toContain("1 ward goal is due soon");
  });

  it("says only what is true when there are no due-soon goals", () => {
    expect(summarizeAlerts(3, 0)).toBe("3 ward goals are overdue");
  });

  it("establishes the subject on the due-soon clause when nothing is overdue", () => {
    // With no overdue clause in front of it, "2 are due soon" has no subject to lean on.
    expect(summarizeAlerts(0, 2)).toBe("2 ward goals are due soon");
  });

  describe("plurals", () => {
    it("uses the singular for one overdue goal", () => {
      expect(summarizeAlerts(1, 0)).toBe("1 ward goal is overdue");
    });

    it("uses the singular for one due-soon goal", () => {
      expect(summarizeAlerts(0, 1)).toBe("1 ward goal is due soon");
    });

    it("gets both singulars right in one sentence", () => {
      expect(summarizeAlerts(1, 1)).toBe("1 ward goal is overdue, 1 is due soon");
    });

    it("gets both plurals right in one sentence", () => {
      expect(summarizeAlerts(2, 3)).toBe("2 ward goals are overdue, 3 are due soon");
    });
  });

  // The banner returns null before it ever calls this, so an empty summary can never render. It is
  // asserted anyway: a caller added later must not get the string "" silently rendered as a heading.
  it("returns an empty string when there is nothing to report", () => {
    expect(summarizeAlerts(0, 0)).toBe("");
  });

  it("never claims a count it was not given", () => {
    // A guard against the failure this replaced — a heading whose number does not match the list.
    for (const [overdue, dueSoon] of [[3, 1], [0, 4], [5, 0], [1, 2]]) {
      const summary = summarizeAlerts(overdue, dueSoon);
      const numbers = (summary.match(/\d+/g) ?? []).map(Number);
      const expected = [overdue, dueSoon].filter((count) => count > 0);

      expect(numbers).toEqual(expected);
    }
  });
});
