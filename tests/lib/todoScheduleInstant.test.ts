import { describe, expect, it } from "vitest";
import { instantToWardInputs, wardInputsToInstant } from "@/lib/todos/scheduleInstant";

// Exact UTC instants, so no zone the test process could be in makes one pass and another fail —
// the proof of server-zone independence tests/lib/icsTimezone.test.ts relies on.

const DENVER = "America/Denver";

describe("wardInputsToInstant", () => {
  it("reads a Friday-evening time as the ward's wall clock, not UTC", () => {
    expect(wardInputsToInstant("2026-09-25", "19:30", DENVER)).toBe("2026-09-26T01:30:00.000Z");
  });

  it("applies the winter offset in winter", () => {
    expect(wardInputsToInstant("2027-01-15", "19:30", DENVER)).toBe("2027-01-16T02:30:00.000Z");
  });

  it("refuses an empty or malformed field rather than guessing", () => {
    expect(wardInputsToInstant("", "19:30", DENVER)).toBeNull();
    expect(wardInputsToInstant("2026-09-25", "", DENVER)).toBeNull();
    expect(wardInputsToInstant("25/09/2026", "19:30", DENVER)).toBeNull();
    expect(wardInputsToInstant("2026-09-25", "24:00", DENVER)).toBeNull();
  });

  it("refuses a day that does not exist", () => {
    expect(wardInputsToInstant("2027-02-31", "10:00", DENVER)).toBeNull();
  });
});

describe("instantToWardInputs", () => {
  it("gives back the ward's day and time, not the UTC ones", () => {
    expect(instantToWardInputs("2026-09-26T01:30:00.000Z", DENVER)).toEqual({
      date: "2026-09-25",
      time: "19:30",
    });
  });

  it("round-trips, so saving an unchanged schedule does not shift it", () => {
    const instant = wardInputsToInstant("2026-11-01", "08:15", DENVER);
    expect(instant).not.toBeNull();
    expect(instantToWardInputs(instant as string, DENVER)).toEqual({
      date: "2026-11-01",
      time: "08:15",
    });
  });

  it("writes midnight as 00, never 24", () => {
    expect(instantToWardInputs("2026-09-26T06:00:00.000Z", DENVER)).toEqual({
      date: "2026-09-26",
      time: "00:00",
    });
  });

  it("returns null for something that is not an instant", () => {
    expect(instantToWardInputs("not a date", DENVER)).toBeNull();
  });
});
