import type { AskTimeElsewhere } from "@/types/domain";

// WHEN SOMEBODY ELSE HAS A TIME SET WITH THIS SPEAKER — Sacrament slice f3a, decision A1.
//
// Nobody inherits another leader's appointment. A copy made for a new conductor (handover) or for
// an assistant (mirror) carries no time, and its card says instead who has one set, so the new
// holder can fit it in or reach out to reschedule. Pure: the rows come from listAskCopies() in
// lib/todos/askLinks.ts.
//
// Which other copy counts:
//   - one on the SAME talk, held by SOMEBODY ELSE, with a time set;
//   - still open (the conductor an assistant is helping), or closed as HANDED OVER (the conductor
//     who passed the Sunday on — their closed copy keeps its time as the record). A copy closed any
//     other way was answered, released or told, and its time means nothing now;
//   - an open one outranks a handed-over one, and then the most recent wins.

export type AskCopy = {
  todoId: string;
  assignmentId: string;
  ownerUserId: string;
  ownerName: string | null;
  scheduledFor: string | null;
  withName: string | null;
  completedAt: string | null;
  closedReason: string | null;
  createdAt: string;
};

export function pickTimeElsewhere(
  mine: { todoId: string; assignmentId: string },
  copies: readonly AskCopy[],
): AskTimeElsewhere | null {
  const own = copies.find((copy) => copy.todoId === mine.todoId);
  if (own === undefined) return null;

  const candidates = copies.filter(
    (copy) =>
      copy.assignmentId === mine.assignmentId &&
      copy.ownerUserId !== own.ownerUserId &&
      copy.scheduledFor !== null &&
      (copy.completedAt === null || copy.closedReason === "handed_over"),
  );
  if (candidates.length === 0) return null;

  const [best] = [...candidates].sort((a, b) => {
    const aOpen = a.completedAt === null ? 0 : 1;
    const bOpen = b.completedAt === null ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return b.createdAt.localeCompare(a.createdAt);
  });
  if (best.scheduledFor === null) return null;

  return {
    holderName: best.ownerName ?? "Another leader",
    scheduledFor: best.scheduledFor,
    withName: best.withName,
    stillHeld: best.completedAt === null,
  };
}
