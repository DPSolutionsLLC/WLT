import { describe, expect, it } from "vitest";
import {
  callingMatchesPosition,
  positionForCalling,
  REMOTE_LINK_POSITION_LABELS,
} from "@/lib/zoom/remoteLinkPositions";
import { REMOTE_LINK_POSITIONS, ROLES, type RemoteLinkPosition, type Role } from "@/types/domain";

// The TypeScript mirror of migration 094's remote_link_position_matches(), over every role and
// every counselor number. Five callings hold a remote; everything else holds none.

const EXPECTED: Array<[Role, 1 | 2 | null, RemoteLinkPosition]> = [
  ["bishop", null, "bishop"],
  ["counselor", 1, "counselor_1"],
  ["counselor", 2, "counselor_2"],
  ["ward_secretary", null, "ward_clerk"],
  ["executive_secretary", null, "executive_secretary"],
];

const ALL_CASES = ROLES.flatMap((role) =>
  ([null, 1, 2] as const).map((counselorPosition) => [role, counselorPosition] as const),
);

describe("positionForCalling", () => {
  it.each(ALL_CASES)("maps %s with counselor position %s", (role, counselorPosition) => {
    const match = EXPECTED.find(
      ([expectedRole, expectedNumber]) =>
        expectedRole === role && (role !== "counselor" || expectedNumber === counselorPosition),
    );
    expect(positionForCalling(role, counselorPosition)).toBe(match ? match[2] : null);
  });

  it("gives a counselor with no number no remote, never a guess", () => {
    expect(positionForCalling("counselor", null)).toBeNull();
  });

  it("matches a calling only to its own position", () => {
    expect(callingMatchesPosition("counselor", 1, "counselor_1")).toBe(true);
    expect(callingMatchesPosition("counselor", 2, "counselor_1")).toBe(false);
    expect(callingMatchesPosition("bishop", null, "counselor_1")).toBe(false);
  });

  it("labels every position in the tab's order", () => {
    expect(REMOTE_LINK_POSITIONS.map((position) => REMOTE_LINK_POSITION_LABELS[position])).toEqual([
      "Bishop",
      "1st Counselor",
      "2nd Counselor",
      "Ward Clerk",
      "Executive Secretary",
    ]);
  });
});
