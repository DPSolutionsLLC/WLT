import {
  VISIT_ATTEMPT_DETAIL_LABELS,
  VISIT_NEEDS_ANOTHER_REASON_LABELS,
  VISIT_OUTCOME_LABELS,
  VISIT_PARTLY_REACHED_LABEL,
  type VisitAttemptDetail,
  type VisitNeedsAnotherReason,
  type VisitOutcome,
  type VisitType,
} from "@/types/domain";

// One sentence-fragment for what a visit reached (ITER-055 bv3), shared by the feed tile and the
// Recent visits list so the two never describe one visit differently. CLIENT-IMPORTABLE: types
// and labels only.
//
//   "Visited"
//   "Visited — still needs a visit · Spouse absent"
//   "Attempted"
//   "Attempted by phone · No answer"
export type VisitOutcomeFacts = {
  outcome: VisitOutcome;
  visitType: VisitType;
  needsAnotherReason: VisitNeedsAnotherReason | null;
  attemptDetail: VisitAttemptDetail | null;
};

export function describeVisitOutcome(visit: VisitOutcomeFacts): string {
  if (visit.outcome === "completed") {
    return visit.needsAnotherReason === null
      ? VISIT_OUTCOME_LABELS.completed
      : `${VISIT_PARTLY_REACHED_LABEL} · ${VISIT_NEEDS_ANOTHER_REASON_LABELS[visit.needsAnotherReason]}`;
  }

  const attempted =
    visit.visitType === "phone"
      ? `${VISIT_OUTCOME_LABELS.attempted} by phone`
      : VISIT_OUTCOME_LABELS.attempted;

  return visit.attemptDetail === null
    ? attempted
    : `${attempted} · ${VISIT_ATTEMPT_DETAIL_LABELS[visit.attemptDetail]}`;
}
