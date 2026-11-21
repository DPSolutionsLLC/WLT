import { describe, expect, it } from "vitest";
import { groupByStreet, NO_STREET_LABEL, streetKeyFor } from "@/lib/visits/streetKey";

// Street grouping on the Households tab (ITER-055 bv8, plan P16).

describe("streetKeyFor", () => {
  it("puts two spellings of one street together", () => {
    expect(streetKeyFor("123 N Main St")).toEqual(streetKeyFor("45 North Main Street Apt 2"));
    expect(streetKeyFor("123 N Main St")).toEqual({
      key: "north main street",
      label: "North Main Street",
    });
  });

  it("folds case, spacing, periods and the common suffixes", () => {
    const cases: [string, string][] = [
      ["15 Maple St.", "11 maple   STREET"],
      ["4 Ridge Rd", "12 Ridge Road"],
      ["305 Cedar Ln", "301 Cedar Lane"],
      ["9 Oak Ave", "10 Oak Avenue"],
      ["2 Elm Dr", "3 Elm Drive"],
      ["7 Fox Ct", "8 Fox Court"],
      ["1 Sky Cir", "5 Sky Circle"],
    ];
    for (const [left, right] of cases) {
      expect(streetKeyFor(left)?.key).toBe(streetKeyFor(right)?.key);
    }
  });

  it("drops a unit and anything after the first comma", () => {
    expect(streetKeyFor("22 Maple Street Apt 3")?.key).toBe("maple street");
    expect(streetKeyFor("22 Maple Street #3")?.key).toBe("maple street");
    expect(streetKeyFor("22 Maple Street Unit B, Springfield, UT 84000")?.key).toBe("maple street");
  });

  it("reads a grid address with a direction at each end", () => {
    expect(streetKeyFor("450 N 300 E")).toEqual(streetKeyFor("460 North 300 East"));
  });

  it("keeps a saint at the front as a name, not a street", () => {
    expect(streetKeyFor("10 St Charles Ave")?.key).toBe("st charles avenue");
  });

  it("gives no street for a blank, a post office box or a bare number", () => {
    expect(streetKeyFor(null)).toBeNull();
    expect(streetKeyFor("")).toBeNull();
    expect(streetKeyFor("   ")).toBeNull();
    expect(streetKeyFor("PO Box 9")).toBeNull();
    expect(streetKeyFor("P.O. Box 12")).toBeNull();
    expect(streetKeyFor("123")).toBeNull();
  });

  // A near-miss is its own street, never a guess (classifyLocation.ts's rule).
  it("never merges a misspelling", () => {
    expect(streetKeyFor("11 Mapel St")?.key).not.toBe(streetKeyFor("11 Maple St")?.key);
  });
});

describe("groupByStreet", () => {
  const rows = [
    { id: "jensen", address: "" },
    { id: "hughes", address: "305 Cedar Ln" },
    { id: "abbott", address: "11 Maple Street" },
    { id: "garcia", address: "301 Cedar Lane" },
    { id: "nobody", address: null },
  ];

  it("orders streets A to Z with no street last, keeping each row's order", () => {
    const groups = groupByStreet(rows);
    expect(groups.map((group) => group.label)).toEqual(["Cedar Lane", "Maple Street", NO_STREET_LABEL]);
    expect(groups[0].rows.map((row) => row.id)).toEqual(["hughes", "garcia"]);
    expect(groups[2]).toMatchObject({ key: null });
    expect(groups[2].rows.map((row) => row.id)).toEqual(["jensen", "nobody"]);
  });

  it("adds no empty No street group", () => {
    expect(groupByStreet([{ address: "1 Elm Dr" }]).map((group) => group.label)).toEqual([
      "Elm Drive",
    ]);
  });
});
