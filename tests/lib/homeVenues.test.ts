// @vitest-environment node
//
// parseHomeVenues, table-driven, mirroring tests/lib/wardTimezone.test.ts.
//
// The house rule for every wards.settings reader is WARN AND FALL BACK, never throw — a settings
// key somebody hand-edited must not take /youth down.
//
// UNLIKE THE TIMEZONE, THIS ONE HAS A CLOSED DIRECTION AND THE FALLBACK IS IT. An empty list
// means every event lands `tbd`: visible, loud, and waiting for a person. The open direction
// would be guessing, and a wrong `home` guess means nobody is asked to attend a game somebody
// should have attended — with no badge anywhere saying so. Every failure case below asserts `[]`
// for that reason, not merely because it is the tidy answer.
//
// The warning is asserted as well as the value. A silent fallback is how a ward runs a season
// with its venue list quietly ignored.

import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_HOME_VENUES } from "@/lib/validation/visit";
import { FALLBACK_HOME_VENUES, parseHomeVenues } from "@/lib/ward/homeVenues";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseHomeVenues", () => {
  // THE WARD'S OWN WORDS COME BACK UNCHANGED. Case is folded at comparison time by
  // lib/youth/classifyLocation.ts, not on the way in - a bishopric member who types "Lincoln High
  // School" and reads back "lincoln high school" sees the app rewriting them for no reason they
  // can see. Found by walking scenario 054 on 2026-08-28.
  it("returns a configured list trimmed, with the typed casing intact", () => {
    expect(
      parseHomeVenues({ home_venues: ["  Lincoln High School ", "WARD BUILDING"] }),
    ).toEqual(["Lincoln High School", "WARD BUILDING"]);
  });

  // Whitespace IS still tidied, because that is typing rather than the ward's wording.
  it("collapses internal whitespace", () => {
    expect(parseHomeVenues({ home_venues: ["Lincoln   High\tSchool"] })).toEqual([
      "Lincoln High School",
    ]);
  });

  // The KEY is folded even though the value is not, so one venue cannot persist twice under two
  // spellings. The first spelling entered is the one kept.
  it("de-duplicates case-insensitively, keeping the first spelling", () => {
    expect(
      parseHomeVenues({ home_venues: ["Lincoln High School", "lincoln high school"] }),
    ).toEqual(["Lincoln High School"]);
  });

  // ABSENT IS NOT MALFORMED. A ward whose settings predate this key has done nothing wrong, so it
  // falls back WITHOUT a warning — a log line nobody can act on is noise.
  it.each([
    ["settings absent", undefined],
    ["settings null", null],
    ["key absent", {}],
    ["key null", { home_venues: null }],
  ])("falls back silently when %s", (_label, settings) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseHomeVenues(settings)).toEqual([...FALLBACK_HOME_VENUES]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["a string", { home_venues: "Lincoln High School" }],
    ["a number", { home_venues: 12 }],
    ["an object", { home_venues: { first: "Lincoln High School" } }],
    ["settings that are an array", ["Lincoln High School"]],
  ])("falls back to the closed direction on %s", (_label, settings) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseHomeVenues(settings)).toEqual([]);
  });

  it("warns when the value is not a list", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    parseHomeVenues({ home_venues: "Lincoln High School" });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("home_venues");
  });

  // THE ENTRY IS DROPPED, NOT THE LIST. A ward that hand-edited its settings keeps the venues that
  // are readable — the difference between one venue going missing and every game in the ward
  // reverting to "Home or away?".
  it("drops non-string entries individually and keeps the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(
      parseHomeVenues({
        home_venues: ["Lincoln High School", 42, null, "  ", "Ward building"],
      }),
    ).toEqual(["Lincoln High School", "Ward building"]);

    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("names the offending value in the warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    parseHomeVenues({ home_venues: ["Lincoln High School", 42] });

    expect(String(warn.mock.calls[0]?.[0])).toContain("42");
  });

  // A list written before the cap existed, or written by hand, is still read here — so the read
  // side trims too rather than trusting the write side to have done it.
  it("trims an over-long list to the cap", () => {
    const venues = Array.from({ length: MAX_HOME_VENUES + 5 }, (_, index) => `venue ${index}`);

    expect(parseHomeVenues({ home_venues: venues })).toHaveLength(MAX_HOME_VENUES);
  });

  it("leaves the other settings keys alone", () => {
    // Not an assertion about parseHomeVenues so much as a statement that it READS one key and
    // nothing else. writeHomeVenues' merge rule is the other half, and it is what stops a venue
    // save deleting the ward's role_access.
    expect(
      parseHomeVenues({
        role_access: { bishop: { remove: ["calendar.manage"] } },
        timezone: "America/Denver",
        home_venues: ["Lincoln High School"],
      }),
    ).toEqual(["Lincoln High School"]);
  });
});
