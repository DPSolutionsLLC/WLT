import {
  DECLINE_REASON_LABELS,
  type AssignmentHistoryOutcome,
  type DeclineReason,
} from "@/types/domain";

// What one speaker-history row's Outcome cell reads (Sacrament slice f1). Pure, so the words are
// tested rather than found on a walk.
//
// EVERY ROW NAMES ITS KIND — "Talk" today. Slice g adds prayers to this history, and the point of
// build note 351 is that "declines talks but accepts prayers" can be read at a glance. The label
// is on every row, not only on declines, so the two kinds read alike when they sit together.
//
// A decline recorded before migration 083 has no reason and reads a plain "Declined".

export const HISTORY_KIND_LABEL = "Talk";

const OUTCOME_LABELS: Record<AssignmentHistoryOutcome, string> = {
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  completed: "Spoke",
};

export function describeHistoryOutcome(entry: {
  outcome: AssignmentHistoryOutcome | null;
  declineReason: DeclineReason | null;
}): string {
  if (entry.outcome === null) return "Not recorded";

  const outcome =
    entry.outcome === "declined" && entry.declineReason !== null
      ? `Declined — ${DECLINE_REASON_LABELS[entry.declineReason]}`
      : OUTCOME_LABELS[entry.outcome];

  return `${outcome} · ${HISTORY_KIND_LABEL}`;
}
