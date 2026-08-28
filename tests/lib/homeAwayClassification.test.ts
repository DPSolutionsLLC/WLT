// @vitest-environment node
//
// classifyEventLocation — 08-youth-activities.md's named test for slice C.
//
// ---------------------------------------------------------------------------
// THE ASSERTION THIS SUITE EXISTS FOR IS A NEGATIVE ONE
// ---------------------------------------------------------------------------
// IT MUST NEVER RETURN `away`, FROM ANY INPUT. That is not a detail of the current
// implementation; it is the decision, and it is the one a future reader is most likely to
// "improve". Classifying an unmatched location as away would silently remove the event from the
// coverage model — an away event carries no coverage expectation by design — so nobody is asked,
// nobody notices, and no badge anywhere says so.
//
// "Lincoln HS Gymnasium", "Lincoln High — auxiliary gym" and a typo all fail to match a venue
// list containing "lincoln high school", and every one of them is a home game. `tbd` is the loud,
// correct answer to all of them.
//
// The property test at the bottom is deliberately broad rather than clever: it asserts the
// negative over every input the rest of the suite uses, so a future branch that returns `away`
// fails here even if somebody remembers to update the case that would otherwise have caught it.

import { describe, expect, it } from "vitest";
import { classifyEventLocation } from "@/lib/youth/classifyLocation";

// STORED AS A PERSON TYPED THEM, capitals and all — which is what lib/ward/homeVenues.ts keeps
// since 2026-08-28. classifyEventLocation folds case on BOTH sides, so the capitals here are the
// realistic input rather than a special case.
const VENUES = ["Lincoln High School", "Ward building"];

// The same list as a ward that happened to type in lower case. Every assertion below must hold
// for both, which is the whole point of folding at comparison time.
const LOWER_VENUES = ["lincoln high school", "ward building"];

describe("classifyEventLocation", () => {
  it("marks a known home venue as home", () => {
    expect(classifyEventLocation("Lincoln High School", VENUES)).toBe("home");
  });

  it("matches a venue that is a substring of a longer location", () => {
    // The ordinary case for an imported feed: schools publish "Lincoln High School gym", not the
    // bare name a bishopric member typed into the settings panel.
    expect(classifyEventLocation("Lincoln High School gym", VENUES)).toBe("home");
    expect(classifyEventLocation("North entrance, Lincoln High School", VENUES)).toBe("home");
  });

  it("ignores case and surrounding whitespace", () => {
    expect(classifyEventLocation("  LINCOLN HIGH SCHOOL GYM  ", VENUES)).toBe("home");
    expect(classifyEventLocation("lincoln high school", VENUES)).toBe("home");
  });

  it("collapses internal whitespace before matching", () => {
    expect(classifyEventLocation("Lincoln   High\tSchool gym", VENUES)).toBe("home");
  });

  it("leaves an unknown venue for a person to settle", () => {
    expect(classifyEventLocation("Roosevelt High School", VENUES)).toBe("tbd");
  });

  // THE NEAR MISSES, EACH ONE A HOME GAME A CLEVERER MATCHER WOULD HAVE CAUGHT. They are `tbd`
  // deliberately: a near-miss is exactly the case where a person should be asked, and a clever
  // matcher that is wrong is worse than a dumb one that abstains — because the dumb one's failure
  // is visible on the card and the clever one's is not.
  it.each([
    ["an abbreviation", "Lincoln HS Gymnasium"],
    ["a shortened name", "Lincoln High — auxiliary gym"],
    ["a typo", "Lincoln Hgih School"],
  ])("leaves %s as tbd rather than guessing", (_label, location) => {
    expect(classifyEventLocation(location, VENUES)).toBe("tbd");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an empty string", ""],
    ["whitespace only", "   \t  "],
  ])("returns tbd for %s", (_label, location) => {
    expect(classifyEventLocation(location, VENUES)).toBe("tbd");
  });

  // NO SPECIAL CASE — the loop simply does not run. A ward that has configured nothing and a
  // location that matched nothing deserve the same answer, which is to ask a person.
  it("returns tbd for everything when no venues are configured", () => {
    for (const location of ["Lincoln High School", "Roosevelt High School", "The gym"]) {
      expect(classifyEventLocation(location, [])).toBe("tbd");
    }
  });

  // Third layer of the same guard. homeVenues.ts drops empty entries on read and on write, but if
  // one ever reached here `includes("")` would be true for every location in the ward — every
  // away game silently marked Home.
  it("ignores an empty venue rather than matching everything", () => {
    expect(classifyEventLocation("Roosevelt High School", ["", "lincoln high school"])).toBe(
      "tbd",
    );
  });

  // THE CASING OF THE STORED VENUE CANNOT CHANGE THE ANSWER. This is the assertion that lets
  // homeVenues.ts keep the ward's own spelling: if it ever mattered, storing what somebody typed
  // would be a trap rather than a courtesy.
  it("gives the same answer whichever case the venue was stored in", () => {
    for (const location of [
      "Lincoln High School gym",
      "lincoln high school GYM",
      "LINCOLN HIGH SCHOOL",
      "Roosevelt High School",
      "",
    ]) {
      expect(classifyEventLocation(location, VENUES)).toBe(
        classifyEventLocation(location, LOWER_VENUES),
      );
    }
  });

  it("never returns away, from any input", () => {
    const locations = [
      null,
      undefined,
      "",
      "   ",
      "Lincoln High School",
      "Lincoln High School gym",
      "LINCOLN HIGH SCHOOL",
      "Lincoln HS Gymnasium",
      "Lincoln Hgih School",
      "Roosevelt High School",
      "Away at Roosevelt",
      "away",
      "Ward building",
      "somewhere nobody has ever heard of",
    ];

    for (const venues of [VENUES, LOWER_VENUES, [], ["away"]]) {
      for (const location of locations) {
        expect(classifyEventLocation(location, venues)).not.toBe("away");
      }
    }
  });

  // The word "away" in a LOCATION is not the event type. A school that publishes "Away at
  // Roosevelt" is describing the game, and a venue list containing "away" would be a ward that
  // configured something odd — neither may produce an `away` classification, because `away` is
  // always a human's word.
  it("does not read the word away in a location as an away game", () => {
    expect(classifyEventLocation("Away at Roosevelt", VENUES)).toBe("tbd");
    expect(classifyEventLocation("Away game", ["away"])).toBe("home");
  });
});
