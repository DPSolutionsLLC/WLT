import { describe, expect, it } from "vitest";
import { publicNameFor } from "@/lib/program/assembleDraft";

// The function the public page's privacy rests on.
//
// program-c's toPublicProgram() reads only `publicName`, and every publicName that came from a
// record was produced here. If this function is wrong, a ward member's surname reaches the open
// internet — which is why it is tested directly rather than only through the assembler.

describe("publicNameFor", () => {
  it("shortens a first-and-last name to a last initial", () => {
    expect(publicNameFor("Sarah Whitfield")).toBe("Sarah W.");
  });

  it("returns a single-word name unchanged", () => {
    // There is no surname to protect, and "M." would be less useful and no more private.
    expect(publicNameFor("Madison")).toBe("Madison");
  });

  it("gives a hyphenated surname ONE initial, not two", () => {
    // A hyphenated surname is one name however it is spelled. "Whitfield-Jones" must not become
    // "W.-J.", which reads as a typo and leaks slightly more than the rule intends.
    expect(publicNameFor("Sarah Whitfield-Jones")).toBe("Sarah W.");
  });

  it("drops a middle name and initials the SURNAME, not the middle name", () => {
    // The initial comes from the last token. Initialling "Anne" instead would publish the
    // surname in full, which is the exact leak this function exists to prevent.
    expect(publicNameFor("Sarah Anne Whitfield")).toBe("Sarah W.");
  });

  it("returns null for null", () => {
    expect(publicNameFor(null)).toBeNull();
  });

  it("returns null for a blank or whitespace-only name", () => {
    // A member row with an empty last name is possible, and "Sarah ." on a public page would be
    // a visible bug rather than a private one.
    expect(publicNameFor("")).toBeNull();
    expect(publicNameFor("   ")).toBeNull();
  });

  it("collapses extra whitespace rather than treating it as a name part", () => {
    expect(publicNameFor("  Sarah   Whitfield  ")).toBe("Sarah W.");
  });

  it("upper-cases the initial of a lowercase surname", () => {
    expect(publicNameFor("sarah whitfield")).toBe("sarah W.");
  });
});
