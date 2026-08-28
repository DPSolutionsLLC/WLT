import type { EventType } from "@/types/domain";

// A location, and the ward's own venues, to home-or-not-yet-known.
//
// PURE. It imports a TYPE and nothing else, so both a Server Component and a `"use client"` one
// may import it — lib/youth/ics/buildImportPreview.ts calls it and is imported by IcsPreviewStep,
// which is a client component. occurrence.ts's header records what a value import from the wrong
// module costs there (~505KB of ical.js in the browser bundle); keep this file free of them.
//
// ---------------------------------------------------------------------------
// IT RETURNS `home` OR `tbd`. IT NEVER RETURNS `away`.
// ---------------------------------------------------------------------------
// This is the decision a future reader is most likely to reverse, so here is the argument in
// full.
//
// ABSENCE OF A MATCH IS NOT EVIDENCE OF AN AWAY GAME. "Lincoln HS Gymnasium", "Lincoln High —
// auxiliary gym", "Lincoln High School (north entrance)" and a plain typo all fail to match a
// venue list containing "lincoln high school", and every one of them is a home game. Classifying
// an unmatched location as `away` would silently remove it from the coverage model — an away
// event is awareness only, by design (08-youth-activities.md §Step 4), so it carries no coverage
// expectation and raises no badge. That is the one outcome this module exists to prevent: nobody
// is asked, nobody notices, and nothing on any screen says so.
//
// An unmatched location becomes `tbd` instead, which is LOUD: it ranks second overall in
// COVERAGE_STATES, renders "Home or away?" in a warning tone, and asks a person for the one fact
// only a person has. `away` is always a human's word.
//
// ---------------------------------------------------------------------------
// MATCHING IS DELIBERATELY BORING
// ---------------------------------------------------------------------------
// Lower-case BOTH SIDES, collapse the location's internal whitespace, and test `includes()`.
//
// THIS FUNCTION IS THE ONE PLACE CASE IS FOLDED, and that is deliberate. lib/ward/homeVenues.ts
// used to lower-case on the way in, which meant a bishopric member typed "Lincoln High School"
// and the settings panel read it back as "lincoln high school" — the ward's own words rewritten
// in front of them, for an implementation detail. The fold belongs where the comparison happens,
// not where the value is stored. Its header records the change.
//
// No fuzzy matching, no Levenshtein, no tokeniser. A near-miss that a clever matcher would catch
// is EXACTLY the case where a person should be asked, and a clever matcher that is wrong is worse
// than a dumb one that abstains — because the dumb one's failure is visible on the card and the
// clever one's is not.

export function classifyEventLocation(
  location: string | null | undefined,
  homeVenues: readonly string[],
): EventType {
  if (location === null || location === undefined) return "tbd";

  const haystack = location.trim().toLowerCase().replace(/\s+/g, " ");
  if (haystack === "") return "tbd";

  for (const venue of homeVenues) {
    const needle = venue.trim().toLowerCase();

    // An empty venue would make `includes("")` true for every location in the ward. homeVenues.ts
    // drops empty entries on both the read and the write path, so this guard is the third layer
    // rather than the first — and it is here because the cost of it being wrong is every away
    // game in the ward silently marked Home.
    if (needle === "") continue;
    if (haystack.includes(needle)) return "home";
  }

  // AN EMPTY VENUE LIST REACHES HERE WITH NO SPECIAL CASE — the loop simply does not run, and
  // everything is `tbd`. Do not add a guard above that means something different: "this ward has
  // configured nothing" and "this location matched nothing" deserve the same answer, which is to
  // ask a person.
  return "tbd";
}
