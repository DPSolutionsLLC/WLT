import type { CallingReviewRow } from "@/lib/callings/callingReview";

// THE CALLING CHANGES ON A ROSTER PASTE'S CHECKLIST (ITER-058 cr3). Pure and safe in the browser.
//
// The rows themselves come from buildCallingReview(), the one comparison of the ward list with the
// app. This file only narrows them to what the checklist shows: labels and ids, never a user id,
// a role or a target, because the apply recomputes all of that from the database.

export const OWN_CALLING_ROW_MESSAGE =
  "This is your own calling. Another member of the bishopric applies it.";

export type PasteCallingRow = {
  id: string;
  sentence: string;
  details: string[];
  isRelease: boolean;
  canApply: boolean;
  refusal: string | null;
  // Set when this person is only gone because this paste leaves them off. The release can only
  // apply once they are marked moved out, so the checklist shows it inside their No longer listed
  // row and one checkbox decides both (decided walking scenario 104).
  moveOutId: string | null;
  releasedCallingLabel: string | null;
};

export type PasteCallingReview = {
  rows: PasteCallingRow[];
  // True for somebody who may import but not decide callings: they are told changes exist, and
  // are shown neither the changes nor a checkbox.
  reviewedByBishopric: boolean;
};

export type PasteCallingOutcome = {
  callingsApplied: number;
  callingsRefused: { id: string; sentence: string }[];
  callingsStale: number;
  callingsFailed: boolean;
};

export const NO_CALLING_OUTCOME: PasteCallingOutcome = {
  callingsApplied: 0,
  callingsRefused: [],
  callingsStale: 0,
  callingsFailed: false,
};

const CALLING_ID_PREFIXES = ["calling:", "call:", "release:", "override:", "unresolvable:"];

export function isCallingReviewId(id: string): boolean {
  return CALLING_ID_PREFIXES.some((prefix) => id.startsWith(prefix));
}

export function toPasteCallingReview(params: {
  rows: readonly CallingReviewRow[];
  movedOutMemberIds: ReadonlySet<string>;
  actor: { id: string; isSuperAdmin: boolean };
  canReview: boolean;
}): PasteCallingReview {
  const { rows, movedOutMemberIds, actor, canReview } = params;

  if (!canReview) return { rows: [], reviewedByBishopric: rows.length > 0 };

  return {
    reviewedByBishopric: false,
    rows: rows.map((row) => {
      const isOwn = row.userId === actor.id && !actor.isSuperAdmin;
      const canApply = row.canApply && !isOwn;
      const isRelease = canApply && row.target === null;
      return {
        id: row.id,
        sentence: row.sentence,
        details: row.details,
        isRelease,
        canApply,
        refusal: isOwn ? OWN_CALLING_ROW_MESSAGE : row.refusal,
        moveOutId:
          isRelease && movedOutMemberIds.has(row.memberId) ? `moveout:${row.memberId}` : null,
        releasedCallingLabel: isRelease ? row.currentLabel : null,
      };
    }),
  };
}

// A release for somebody this paste leaves off has no checkbox of its own: it is ticked exactly
// when their move-out is. Applied alone it would find the person still active, the recompute would
// find nothing to release, and the tick would be lost.
export function reconcileMoveOutTicks(
  next: ReadonlySet<string>,
  rows: readonly PasteCallingRow[],
): Set<string> {
  const reconciled = new Set(next);

  for (const row of rows) {
    if (row.moveOutId === null) continue;
    if (next.has(row.moveOutId)) reconciled.add(row.id);
    else reconciled.delete(row.id);
  }

  return reconciled;
}

// A move-out and the release inside it are one decision on the checklist, so they count as one.
export function countTickedChanges(
  selectedIds: ReadonlySet<string>,
  rows: readonly PasteCallingRow[],
): number {
  const carried = rows.filter(
    (row) => row.moveOutId !== null && selectedIds.has(row.id) && selectedIds.has(row.moveOutId),
  ).length;
  return selectedIds.size - carried;
}
