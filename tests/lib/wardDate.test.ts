import { describe, expect, it } from "vitest";
import { wardDateOnly } from "@/lib/ward/wardDate";

// The zone trap as a test: 7:30pm on a Friday in Denver is already Saturday in UTC. "Today" for a
// ward is the ward's date, and toISOString().slice(0, 10) would have said Saturday.

describe("wardDateOnly", () => {
  it("returns the Denver date for a Denver evening, not the UTC one", () => {
    const fridayEvening = new Date("2027-01-16T02:30:00.000Z");

    expect(fridayEvening.toISOString().slice(0, 10)).toBe("2027-01-16");
    expect(wardDateOnly(fridayEvening, "America/Denver")).toBe("2027-01-15");
  });

  it("agrees with UTC once the ward has passed midnight too", () => {
    expect(wardDateOnly(new Date("2027-01-16T08:00:00.000Z"), "America/Denver")).toBe(
      "2027-01-16",
    );
  });

  it("follows daylight saving", () => {
    // 23:30 MDT on 1 July is 05:30 UTC on 2 July.
    expect(wardDateOnly(new Date("2027-07-02T05:30:00.000Z"), "America/Denver")).toBe(
      "2027-07-01",
    );
  });

  it("refuses an invalid date rather than inventing one", () => {
    expect(() => wardDateOnly(new Date("not a date"), "America/Denver")).toThrow();
  });
});
