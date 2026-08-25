import { describe, expect, it } from "vitest";
import { publicNameFor } from "@/lib/program/assembleDraft";

// The DEFAULT public form of a name read from a record.
//
// ---------------------------------------------------------------------------------------------
// THIS FUNCTION USED TO SHORTEN TO "Sarah W." AND DELIBERATELY NO LONGER DOES
// ---------------------------------------------------------------------------------------------
// Reversed by a product decision on 2026-08-24, walking scenario 032: a public program that
// shortened only the ward members, while naming a visiting speaker in full one line below, read as
// a bug rather than as a rule. Everybody is named in full now.
//
// The tests that asserted the shortening were not deleted — they are inverted below and kept
// together in one block, so the reversal is visible in the suite rather than being a set of cases
// that quietly stopped existing. A future session wondering "did anybody think about hyphenated
// surnames?" can see that somebody did, and see what was decided instead.
//
// What did NOT change is the whitespace and blank handling, which is why those cases are unchanged
// below. Nor did the boundary move: toPublicProgram() still reads ONLY `publicName`, and the two
// name fields are still separate so a ward can override either one per program.

describe("publicNameFor", () => {
  describe("names are published in full", () => {
    it("keeps a first-and-last name whole", () => {
      expect(publicNameFor("Sarah Whitfield")).toBe("Sarah Whitfield");
    });

    it("keeps a hyphenated surname whole", () => {
      // Previously "Sarah W.". The hyphen was the interesting case for a shortening rule; with no
      // shortening there is nothing to get wrong, and this asserts exactly that.
      expect(publicNameFor("Sarah Whitfield-Jones")).toBe("Sarah Whitfield-Jones");
    });

    it("keeps a middle name", () => {
      // Previously "Sarah W." — the middle name was dropped. It is printed now, because the name
      // on the web is the name on the handout.
      expect(publicNameFor("Sarah Anne Whitfield")).toBe("Sarah Anne Whitfield");
    });

    it("changes no letter case", () => {
      // Previously "sarah W." — the old rule upper-cased the initial it produced. Nothing is
      // produced now, so a name is passed through exactly as the record spells it.
      expect(publicNameFor("sarah whitfield")).toBe("sarah whitfield");
    });

    it("returns a single-word name unchanged", () => {
      expect(publicNameFor("Madison")).toBe("Madison");
    });
  });

  // Unchanged by the reversal, and still load-bearing: publicProjection.ts turns a blank into
  // nothing at all, and a name of "" would render as something somebody typed.
  describe("blank handling", () => {
    it("returns null for null", () => {
      expect(publicNameFor(null)).toBeNull();
    });

    it("returns null for a blank or whitespace-only name", () => {
      expect(publicNameFor("")).toBeNull();
      expect(publicNameFor("   ")).toBeNull();
    });

    it("collapses extra whitespace rather than keeping it", () => {
      expect(publicNameFor("  Sarah   Whitfield  ")).toBe("Sarah Whitfield");
    });
  });
});
