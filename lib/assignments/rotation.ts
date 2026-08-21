import {
  COMPLETED_STAGE,
  COUNTS_TOWARD_ROTATION,
  type AssignmentType,
  type PipelineStage,
} from "@/types/domain";

// The completed-only filter that keeps a voided assignment out of speaker history.
//
// Nothing outside `@/types/domain` may be imported here: talks-b and talks-d render this in
// client components (plans/retros/roster-b-picker-and-orgs.md).

// Whether an assignment TYPE counts toward the ward's member speaking rotation. A high council
// speaker is assigned by the stake, so their talk says nothing about whose turn it is in this
// ward.
//
// This is NOT a "cancelled" flag (04-talks-pipeline.md §Pitfalls). A cancelled or reverted
// assignment is excluded by countsAsSpokenTalk below, on its STAGE. Setting this false to mean
// "this one got cancelled" would be a bug nobody could see.
export function countsTowardRotation(type: AssignmentType): boolean {
  return COUNTS_TOWARD_ROTATION[type];
}

export type SpokenTalkCandidate = {
  stage: PipelineStage;
  assignmentType: AssignmentType;
  memberId: string | null;
};

// The predicate every "who has spoken recently" calculation runs through
// (04-talks-pipeline.md §Step 2, rule 1). An assignment counts only when it REACHED `complete`,
// AND its type counts, AND it names a ward member.
//
// Each of the three carries its own weight:
//   stage       a reverted assignment sits back at `plan` and is excluded for free. Filtering
//               on a row's mere EXISTENCE instead counts a talk that never happened, quietly
//               suppresses that member from the rotation for months, and produces no symptom
//               until somebody asks why a family has not been asked to speak in a year.
//   type        a high council or organizational slot is not the ward's rotation.
//   memberId    an external speaker has none and is excluded by construction, which is
//               ITER-004's "speaker history is not distorted" requirement.
export function countsAsSpokenTalk(row: SpokenTalkCandidate): boolean {
  return (
    row.stage === COMPLETED_STAGE &&
    countsTowardRotation(row.assignmentType) &&
    row.memberId !== null
  );
}
