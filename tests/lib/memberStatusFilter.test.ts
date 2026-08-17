import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_STATUSES,
  resolveMemberStatuses,
  ROSTER_BROWSE_STATUSES,
} from "@/lib/roster/queries";

// The quiet bug 02-roster.md §Pitfalls opens with: a moved-out member reaching a speaker
// rotation, a visit-goal denominator, or a ward count because a caller forgot to filter.
// The rule lives in one pure function so it can be tested without a network round trip.

describe("resolveMemberStatuses", () => {
  it("returns active only when given no options", () => {
    expect(resolveMemberStatuses()).toEqual(["active"]);
  });

  it("returns active only when given an empty options object", () => {
    expect(resolveMemberStatuses({})).toEqual(["active"]);
  });

  it("honours an explicit list, in the order given", () => {
    expect(resolveMemberStatuses({ statuses: ["active", "moved_out"] })).toEqual([
      "active",
      "moved_out",
    ]);
  });

  // `.in("status", [])` matches nothing, so honouring an empty array would silently empty a
  // page. An empty array is almost always a caller bug, and the safe default is a better
  // answer than a blank screen.
  it("falls back to the default for an empty array rather than matching nothing", () => {
    expect(resolveMemberStatuses({ statuses: [] })).toEqual(["active"]);
  });

  it("never returns moved_out by default", () => {
    expect(resolveMemberStatuses()).not.toContain("moved_out");
    expect(DEFAULT_MEMBER_STATUSES).toEqual(["active"]);
  });
});

describe("ROSTER_BROWSE_STATUSES", () => {
  // The browse page is a surface, not a calculation: a do-not-contact member is still in the
  // ward and must be visible with a badge. moved_out stays an explicit opt-in.
  it("includes do_not_contact", () => {
    expect(ROSTER_BROWSE_STATUSES).toContain("do_not_contact");
  });

  it("does not include moved_out", () => {
    expect(ROSTER_BROWSE_STATUSES).not.toContain("moved_out");
  });

  it("is wider than the library default", () => {
    expect(ROSTER_BROWSE_STATUSES.length).toBeGreaterThan(
      DEFAULT_MEMBER_STATUSES.length,
    );
  });
});
