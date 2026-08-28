// @vitest-environment node
//
// parseWardTimezone, table-driven.
//
// The house rule for every wards.settings reader is WARN AND FALL BACK, never throw — a settings
// key with a typo in it must not take the import wizard down. Unlike cross-org visibility there
// is no "closed direction" to fail towards here: a time zone is not a permission, so the fallback
// is simply the value supabase/seed/ward.sql has always written.
//
// The warning is asserted as well as the value. A silent fallback is how a ward runs for a year
// on the wrong zone with nothing in the logs saying so.

import { afterEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_WARD_TIMEZONE, parseWardTimezone } from "@/lib/ward/wardTimezone";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseWardTimezone", () => {
  it("returns a valid IANA zone unchanged", () => {
    expect(parseWardTimezone({ timezone: "America/Denver" })).toBe("America/Denver");
    expect(parseWardTimezone({ timezone: "Europe/London" })).toBe("Europe/London");
    expect(parseWardTimezone({ timezone: "Pacific/Kiritimati" })).toBe("Pacific/Kiritimati");
  });

  it("accepts an IANA name for a zone that has no daylight saving", () => {
    // The legitimate way to say "we do not change the clocks", and the reason refusing a bare
    // offset costs nobody anything.
    expect(parseWardTimezone({ timezone: "America/Phoenix" })).toBe("America/Phoenix");
    expect(parseWardTimezone({ timezone: "UTC" })).toBe("UTC");
  });

  it("trims surrounding whitespace rather than refusing the value", () => {
    expect(parseWardTimezone({ timezone: "  America/Denver  " })).toBe("America/Denver");
  });

  // ABSENT IS NOT MALFORMED. A ward whose settings predate this key has done nothing wrong, so
  // it falls back without a warning — a log line nobody can act on is noise.
  it.each([
    ["a missing key", { cross_org_visibility: false }],
    ["a null settings object", null],
    ["an array", ["America/Denver"]],
    ["a string instead of an object", "America/Denver"],
    ["an explicit null", { timezone: null }],
  ])("falls back quietly for %s", (_label, settings) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseWardTimezone(settings)).toBe(FALLBACK_WARD_TIMEZONE);
    expect(warn).not.toHaveBeenCalled();
  });

  // A VALUE SOMEBODY WROTE AND GOT WRONG. This is the case worth a warning, and the warning has
  // to name the bad value or it is unactionable.
  it.each([
    ["a number", 7],
    ["a boolean", true],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a zone that does not exist", "Mars/Olympus"],
    // Intl ACCEPTS these, and that is precisely why they are tested. A fixed offset has no
    // daylight saving, so a ward configured this way would see every summer game an hour out
    // with nothing saying why (lib/ward/wardTimezone.ts, OFFSET_SHAPED).
    ["a bare negative offset", "-07:00"],
    ["a bare positive offset", "+0530"],
    ["an object", { name: "America/Denver" }],
  ])("warns and falls back for %s", (_label, value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseWardTimezone({ timezone: value })).toBe(FALLBACK_WARD_TIMEZONE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(FALLBACK_WARD_TIMEZONE);
  });

  it("keeps the fallback in step with what the seed writes", () => {
    // supabase/seed/ward.sql is the only place this key has ever been written. If the seed
    // changes and this does not, every floating time in every ward moves by an hour.
    expect(FALLBACK_WARD_TIMEZONE).toBe("America/Denver");
  });
});
