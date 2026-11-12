import { describe, expect, it } from "vitest";
import {
  assignmentShares,
  bishopricCallingLabel,
  describeAssignmentShares,
  openAssigneeByHousehold,
  type BishopricMember,
} from "@/lib/visits/assignmentShares";
import type { VisitAssignment, VisitAssignmentEndReason } from "@/types/domain";

// Each bishopric member's share of the goal (ITER-055 bv5, D4).

const bishop: BishopricMember = { id: "u-bishop", role: "bishop", counselorPosition: null, firstName: "A", lastName: "B" };
const first: BishopricMember = { id: "u-first", role: "counselor", counselorPosition: 1, firstName: "C", lastName: "D" };
const second: BishopricMember = { id: "u-second", role: "counselor", counselorPosition: 2, firstName: "E", lastName: "F" };

let sequence = 0;
function assignment(
  assignedTo: string,
  ended: VisitAssignmentEndReason | null = null,
  householdId = `h-${sequence}`,
): VisitAssignment {
  sequence += 1;
  return {
    id: `a-${sequence}`,
    orgId: "org",
    householdId,
    goalId: "goal",
    assignedTo,
    assignedBy: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    endedAt: ended === null ? null : "2026-11-05T00:00:00.000Z",
    endReason: ended,
  };
}

describe("bishopricCallingLabel", () => {
  it("names the calling, never a pronoun", () => {
    expect(bishopricCallingLabel(bishop)).toBe("Bishop");
    expect(bishopricCallingLabel(first)).toBe("1st Counselor");
    expect(bishopricCallingLabel(second)).toBe("2nd Counselor");
    expect(bishopricCallingLabel({ role: "counselor", counselorPosition: null })).toBe("Counselor");
  });
});

describe("assignmentShares", () => {
  it("counts what each member holds plus what they finished, in calling order", () => {
    const shares = assignmentShares(
      [
        assignment(second.id),
        assignment(bishop.id),
        assignment(bishop.id, "visited"),
        assignment(first.id, "visited"),
      ],
      [second, first, bishop],
    );

    expect(shares).toEqual([
      { userId: bishop.id, label: "Bishop", done: 1, total: 2 },
      { userId: first.id, label: "1st Counselor", done: 1, total: 1 },
      { userId: second.id, label: "2nd Counselor", done: 0, total: 1 },
    ]);
  });

  it("drops a household that was reassigned away or released, and counts it for its new holder", () => {
    const shares = assignmentShares(
      [
        assignment(first.id, "reassigned", "h-moved"),
        assignment(second.id, null, "h-moved"),
        assignment(first.id, "unassigned"),
        assignment(first.id, "goal_ended"),
      ],
      [bishop, first, second],
    );

    expect(shares.find((share) => share.userId === first.id)).toMatchObject({ done: 0, total: 0 });
    expect(shares.find((share) => share.userId === second.id)).toMatchObject({ done: 0, total: 1 });
  });

  it("lists every serving member even at none, so the three read side by side", () => {
    expect(describeAssignmentShares(assignmentShares([], [bishop, first, second]))).toBe(
      "Bishop 0 of 0 · 1st Counselor 0 of 0 · 2nd Counselor 0 of 0",
    );
  });

  it("keeps a released member's finished visits, listed after the serving three", () => {
    const shares = assignmentShares([assignment("u-released", "visited")], [bishop]);
    expect(shares.at(-1)).toEqual({ userId: "u-released", label: "Former member", done: 1, total: 1 });
  });
});

describe("openAssigneeByHousehold", () => {
  it("names only who holds each household now", () => {
    const map = openAssigneeByHousehold([
      assignment(first.id, "reassigned", "h-1"),
      assignment(second.id, null, "h-1"),
      assignment(bishop.id, "visited", "h-2"),
    ]);
    expect(map.get("h-1")).toBe(second.id);
    expect(map.has("h-2")).toBe(false);
  });
});
