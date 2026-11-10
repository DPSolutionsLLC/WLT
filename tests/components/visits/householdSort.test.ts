import { describe, expect, it } from "vitest";
import { sortHouseholdRows } from "@/app/(app)/visits/HouseholdsPanel";
import type { VisitProgressRow } from "@/lib/visits/progress";

// The Households tab's Sort by (ITER-055 bv2; kept from the old table on the user's choice).

function row(familyName: string, overrides: Partial<VisitProgressRow> = {}): VisitProgressRow {
  return {
    householdId: familyName,
    familyName,
    lastVisitedOn: null,
    lastAttemptedOn: null,
    attemptsSinceLastVisit: 0,
    partlyReached: null,
    doNotContact: false,
    priority: null,
    conductedBy: null,
    ...overrides,
  };
}

const rows = [
  row("Chen", { lastVisitedOn: "2026-05-01" }),
  row("Adams"),
  row("Baker", { lastVisitedOn: "2026-01-01" }),
];

describe("sortHouseholdRows", () => {
  it("sorts by name", () => {
    expect(sortHouseholdRows(rows, "familyName").map((each) => each.familyName)).toEqual([
      "Adams",
      "Baker",
      "Chen",
    ]);
  });

  it("puts a household with no date last, ties broken by name", () => {
    expect(sortHouseholdRows(rows, "lastVisitedOn").map((each) => each.familyName)).toEqual([
      "Baker",
      "Chen",
      "Adams",
    ]);
  });

  it("does not reorder the list it was given", () => {
    sortHouseholdRows(rows, "familyName");
    expect(rows.map((each) => each.familyName)).toEqual(["Chen", "Adams", "Baker"]);
  });
});
