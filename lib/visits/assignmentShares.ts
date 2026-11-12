import type { VisitAssignment } from "@/types/domain";

// EACH BISHOPRIC MEMBER'S SHARE OF THE GOAL (ITER-055 bv5, D4): "Bishop 3 of 12 · 1st Counselor 2
// of 9". PURE and client-importable, so the banner and its test read one computation.
//
// A share counts the households a member holds now plus the ones they finished under this goal.
// A household reassigned away or released no longer counts for them; one that moved TO them counts
// for them. `done` is an assignment ended `visited`, which only a finished visit does
// (reconcileAssignmentAfterVisit), so it means the same thing as the sweep's done.
//
// LABELLED BY CALLING, never by he or she (the zoom-remote-links D6 rule).

export type BishopricMember = {
  id: string;
  role: "bishop" | "counselor";
  counselorPosition: 1 | 2 | null;
  firstName: string | null;
  lastName: string | null;
};

export type AssignmentShare = {
  userId: string;
  label: string;
  done: number;
  total: number;
};

export function bishopricCallingLabel(member: Pick<BishopricMember, "role" | "counselorPosition">): string {
  if (member.role === "bishop") return "Bishop";
  if (member.counselorPosition === 1) return "1st Counselor";
  if (member.counselorPosition === 2) return "2nd Counselor";
  return "Counselor";
}

export function memberDisplayName(member: Pick<BishopricMember, "firstName" | "lastName">): string {
  return `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || "A member of the bishopric";
}

function countsForHolder(assignment: VisitAssignment): boolean {
  return assignment.endedAt === null || assignment.endReason === "visited";
}

// In calling order (bishop, then 1st, then 2nd), every serving member listed even at 0 of 0 so the
// three always read side by side. Somebody who held households and has since been released is
// listed after them by name, so their finished visits are not lost from the count.
export function assignmentShares(
  assignments: readonly VisitAssignment[],
  members: readonly BishopricMember[],
): AssignmentShare[] {
  const counted = assignments.filter(countsForHolder);

  const shareFor = (userId: string, label: string): AssignmentShare => {
    const held = counted.filter((assignment) => assignment.assignedTo === userId);
    return {
      userId,
      label,
      done: held.filter((assignment) => assignment.endReason === "visited").length,
      total: held.length,
    };
  };

  const serving = [...members]
    .sort((left, right) => callingRank(left) - callingRank(right))
    .map((member) => shareFor(member.id, bishopricCallingLabel(member)));

  const servingIds = new Set(members.map((member) => member.id));
  const formerIds = [...new Set(counted.map((assignment) => assignment.assignedTo))].filter(
    (userId) => !servingIds.has(userId),
  );

  return [...serving, ...formerIds.map((userId) => shareFor(userId, "Former member"))];
}

function callingRank(member: Pick<BishopricMember, "role" | "counselorPosition">): number {
  if (member.role === "bishop") return 0;
  return member.counselorPosition ?? 3;
}

export function describeAssignmentShares(shares: readonly AssignmentShare[]): string {
  return shares.map((share) => `${share.label} ${share.done} of ${share.total}`).join(" · ");
}

// Who holds each household now, for the card line "Assigned to 1st Counselor".
export function openAssigneeByHousehold(
  assignments: readonly VisitAssignment[],
): Map<string, string> {
  return new Map(
    assignments
      .filter((assignment) => assignment.endedAt === null)
      .map((assignment) => [assignment.householdId, assignment.assignedTo]),
  );
}
