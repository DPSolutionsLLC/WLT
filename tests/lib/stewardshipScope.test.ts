import { describe, expect, it } from "vitest";
import {
  compareStewardshipDrift,
  isInScope,
  toStewardshipScope,
} from "@/lib/visits/stewardshipScope";

// PURE, no database. lib/visits/stewardshipScope.ts imports nothing at all, which is the whole
// reason it exists as its own file — lib/visits/stewardship.ts reaches next/headers and would
// make any client component importing this rule unbuildable.
//
// ---------------------------------------------------------------------------------------------
// THE ASSERTION THIS FILE EXISTS FOR
// ---------------------------------------------------------------------------------------------
// ZERO ROWS MEANS THE WHOLE WARD. An organization that has narrowed nothing must answer "yes, in
// scope" for every household there has ever been, or every existing dashboard moves on the day
// ITER-019 ships. That is success criterion 2, and it is one line of production code — so it gets
// tests of its own rather than being assumed.

describe("an organization that has narrowed nothing", () => {
  // THE SHIP-DAY NO-CHANGE GUARANTEE.
  it("reports hasNarrowed false for an empty list", () => {
    const scope = toStewardshipScope([]);

    expect(scope.hasNarrowed).toBe(false);
    expect(scope.subjectIds.size).toBe(0);
  });

  it("has every subject in scope, including ones it has never heard of", () => {
    const scope = toStewardshipScope([]);

    expect(isInScope(scope, "household-1")).toBe(true);
    expect(isInScope(scope, "a-household-created-tomorrow")).toBe(true);
    expect(isInScope(scope, "")).toBe(true);
  });
});

describe("an organization that has narrowed", () => {
  it("reports hasNarrowed true and holds exactly the ids it was given", () => {
    const scope = toStewardshipScope(["a", "b"]);

    expect(scope.hasNarrowed).toBe(true);
    expect([...scope.subjectIds].sort()).toEqual(["a", "b"]);
  });

  it("has a named subject in scope and an unnamed one out of it", () => {
    const scope = toStewardshipScope(["a"]);

    expect(isInScope(scope, "a")).toBe(true);
    expect(isInScope(scope, "b")).toBe(false);
  });

  // A duplicate in the incoming list is not an error — the table's unique constraint means it
  // cannot arise from a read, and collapsing it here costs nothing.
  it("collapses duplicates rather than treating them as two subjects", () => {
    expect(toStewardshipScope(["a", "a", "b"]).subjectIds.size).toBe(2);
  });
});

describe("drift", () => {
  // AN UN-NARROWED ORGANIZATION HAS NO DRIFT, whatever the derivation says. It has made no claim
  // to have drifted from, and offering to "reconcile" something never chosen would invite a
  // president to narrow their organization by pressing a button labelled as a correction.
  it("is empty on both sides for an un-narrowed organization", () => {
    const drift = compareStewardshipDrift(toStewardshipScope([]), ["a", "b", "c"]);

    expect(drift).toEqual({ toAdd: [], toRemove: [] });
  });

  it("reports nothing when the stored set already matches the derivation", () => {
    const drift = compareStewardshipDrift(toStewardshipScope(["a", "b"]), ["b", "a"]);

    expect(drift).toEqual({ toAdd: [], toRemove: [] });
  });

  it("reports additions only", () => {
    const drift = compareStewardshipDrift(toStewardshipScope(["a"]), ["a", "b"]);

    expect(drift).toEqual({ toAdd: ["b"], toRemove: [] });
  });

  it("reports removals only", () => {
    const drift = compareStewardshipDrift(toStewardshipScope(["a", "b"]), ["a"]);

    expect(drift).toEqual({ toAdd: [], toRemove: ["b"] });
  });

  it("reports both at once", () => {
    const drift = compareStewardshipDrift(toStewardshipScope(["a", "b"]), ["b", "c"]);

    expect(drift).toEqual({ toAdd: ["c"], toRemove: ["a"] });
  });

  // SORTED, so the panel and any other caller rendering the same drift cannot disagree on the
  // order the households are named in.
  it("sorts both arrays", () => {
    const drift = compareStewardshipDrift(
      toStewardshipScope(["z", "y", "x"]),
      ["c", "b", "a"],
    );

    expect(drift.toAdd).toEqual(["a", "b", "c"]);
    expect(drift.toRemove).toEqual(["x", "y", "z"]);
  });

  it("treats a derivation that found nothing as removing everything", () => {
    const drift = compareStewardshipDrift(toStewardshipScope(["a", "b"]), []);

    expect(drift).toEqual({ toAdd: [], toRemove: ["a", "b"] });
  });
});

// ---------------------------------------------------------------------------------------------
// SUBJECT-AGNOSTIC, AND THAT IS LOAD-BEARING
// ---------------------------------------------------------------------------------------------
// The module names neither households nor visits in its parameters — `subjectId`, not
// `householdId` — because Phase 8's youth-activity coverage asks the identical question about
// youth: "which of these are ours?".
//
// This test passes YOUTH ids and asserts identical behaviour, so a future edit that "tidies" the
// vocabulary to be visit-specific fails HERE, with a message naming the reason, rather than
// being discovered by Phase 8 writing a second meaning of the word.
describe("the same rule, asked about youth", () => {
  const youthIds = ["youth-mia", "youth-noah"];

  it("answers exactly as it does for households", () => {
    const open = toStewardshipScope([]);
    const narrowed = toStewardshipScope(youthIds);

    expect(isInScope(open, "youth-anyone")).toBe(true);
    expect(isInScope(narrowed, "youth-mia")).toBe(true);
    expect(isInScope(narrowed, "youth-elsewhere")).toBe(false);

    expect(compareStewardshipDrift(narrowed, ["youth-mia", "youth-ivy"])).toEqual({
      toAdd: ["youth-ivy"],
      toRemove: ["youth-noah"],
    });
  });
});
