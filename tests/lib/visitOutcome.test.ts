import { describe, expect, it } from "vitest";
import { isDoneVisit } from "@/lib/visits/householdStatus";
import { describeVisitOutcome, type VisitOutcomeFacts } from "@/lib/visits/visitOutcome";

// ITER-055 bv3: what a visit reached, in one phrase shared by the feed and Recent visits, and the
// one rule for "done" shared by both progress pages.

function facts(overrides: Partial<VisitOutcomeFacts> = {}): VisitOutcomeFacts {
  return {
    outcome: "completed",
    visitType: "in_home",
    needsAnotherReason: null,
    attemptDetail: null,
    ...overrides,
  };
}

describe("describeVisitOutcome", () => {
  it("says a done visit was visited", () => {
    expect(describeVisitOutcome(facts())).toBe("Visited");
  });

  it("names the reason a visit still needs another", () => {
    expect(describeVisitOutcome(facts({ needsAnotherReason: "spouse_absent" }))).toBe(
      "Visited — still needs a visit · Spouse absent",
    );
  });

  it("says an attempt was attempted", () => {
    expect(describeVisitOutcome(facts({ outcome: "attempted" }))).toBe("Attempted");
  });

  it("says a call attempt was by phone, and how it went", () => {
    expect(
      describeVisitOutcome(
        facts({ outcome: "attempted", visitType: "phone", attemptDetail: "no_message_left" }),
      ),
    ).toBe("Attempted by phone · Couldn't leave a message");
  });
});

describe("isDoneVisit", () => {
  it("is true for a completed visit only when it does not still need another", () => {
    expect(isDoneVisit({ outcome: "completed", needsAnotherVisit: false })).toBe(true);
    expect(isDoneVisit({ outcome: "completed", needsAnotherVisit: true })).toBe(false);
    expect(isDoneVisit({ outcome: "attempted", needsAnotherVisit: false })).toBe(false);
  });
});
