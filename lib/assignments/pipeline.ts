import {
  PIPELINE_STAGE_LABELS,
  PIPELINE_STAGES,
  type PipelineStage,
  type RequestOutcome,
} from "@/types/domain";

// The nine-stage talk pipeline as a pure state machine. Every transition is explicit and gated
// here; nothing else in the app decides whether an assignment may move.
//
// Nothing outside `@/types/domain` may be imported into this module. It is rendered by client
// components in talks-b, and a single import of lib/assignments/queries.ts would pull in
// next/headers and break the production build — a violation that `npm run lint` and
// `npm run typecheck` both pass (plans/retros/roster-b-picker-and-orgs.md).
//
// The phase's first pitfall is IMPLICIT stage advancement: a field update that quietly moves the
// stage as a side effect. Nothing in this module writes anything, so a caller has to ask for a
// transition by name to get one.

export type PipelineAssignment = {
  stage: PipelineStage;
  memberId: string | null;
  externalSpeakerName: string | null;
  topicId: string | null;
  slotNumber: number | null;
  requestOutcome: RequestOutcome | null;
  notifyMessage: string | null;
  notifySentAt: string | null;
  sundayConfirmedAt: string | null;
  thankYouSentAt: string | null;
  contactWaivedAt: string | null;
};

export type PipelineApproval = {
  userId: string;
  approved: boolean | null;
};

export type TransitionContext = {
  assignment: PipelineAssignment;
  approvals: readonly PipelineApproval[];
  bishopricUserIds: readonly string[];
  actorIsBishopric: boolean;
  reason?: string;
};

export type TransitionResult = { ok: true } | { ok: false; message: string };

const BACKWARD_WITHOUT_BISHOPRIC =
  "Only the bishopric can move an assignment back a stage.";

const BACKWARD_WITHOUT_REASON =
  "Say why this is going back a stage — the reason is recorded and the planner reads it.";

const SAME_STAGE = "That assignment is already at this stage.";

export function stageIndex(stage: PipelineStage): number {
  return PIPELINE_STAGES.indexOf(stage);
}

export function nextStage(from: PipelineStage): PipelineStage | null {
  return PIPELINE_STAGES[stageIndex(from) + 1] ?? null;
}

export function isBackwardTransition(
  from: PipelineStage,
  to: PipelineStage,
): boolean {
  return stageIndex(to) < stageIndex(from);
}

// What a stage needs before it can be ENTERED, named in the field names a caller can show. The
// gate itself lives in canTransition; this is the same knowledge in a shape a form can read.
export function requiredFieldsFor(stage: PipelineStage): readonly string[] {
  switch (stage) {
    case "review":
      return ["speaker", "topicId", "slotNumber"];
    case "approve":
      return ["approvals"];
    case "confirm":
      return ["requestOutcome"];
    case "notify":
      return ["notifyMessage"];
    case "speak":
      return ["notifySentAt"];
    case "appreciate":
      return ["sundayConfirmedAt"];
    case "complete":
      return ["thankYouSentAt"];
    case "plan":
    case "request":
      return [];
  }
}

function hasSpeaker(assignment: PipelineAssignment): boolean {
  return (
    assignment.memberId !== null ||
    (assignment.externalSpeakerName !== null &&
      assignment.externalSpeakerName.trim() !== "")
  );
}

// A waiver is the ward saying "we are not contacting this person, and that is a decision
// somebody made and signed". It satisfies exactly four gates and no others — never a speaker,
// never a topic, never an approval, and never sundayConfirmedAt. The meeting either happened or
// it did not, regardless of who spoke (ITER-004).
function isWaived(assignment: PipelineAssignment): boolean {
  return assignment.contactWaivedAt !== null;
}

function listMissing(missing: string[]): string {
  if (missing.length === 1) return missing[0];
  if (missing.length === 2) return `${missing[0]} and ${missing[1]}`;
  return `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
}

function planToReview(assignment: PipelineAssignment): TransitionResult {
  const missing: string[] = [];

  if (!hasSpeaker(assignment)) missing.push("a speaker");
  if (assignment.topicId === null) missing.push("a topic");
  if (assignment.slotNumber === null) missing.push("a speaking slot");

  if (missing.length > 0) {
    return {
      ok: false,
      message: `This assignment still needs ${listMissing(missing)} before it can go for review.`,
    };
  }

  return { ok: true };
}

// Counts DISTINCT approving users against the bishopric roll, not approval rows. Three rows from
// one counselor must not satisfy a three-person gate — migration 025's
// assignment_approvals_one_per_user constraint is the real boundary, and this is the same rule
// held in the pure layer so a caller cannot reach APPROVE by handing in a fabricated list.
//
// The roll is whatever the ward actually has. A ward mid-reorganization with two bishopric
// members needs both, not a hard-coded three.
function reviewToApprove(context: TransitionContext): TransitionResult {
  const { approvals, bishopricUserIds } = context;

  if (bishopricUserIds.length === 0) {
    return {
      ok: false,
      message:
        "This ward has no active bishopric members to approve a plan. Add them in Admin first.",
    };
  }

  const approvedBy = new Set(
    approvals
      .filter((approval) => approval.approved === true)
      .map((approval) => approval.userId),
  );

  const outstanding = bishopricUserIds.filter((id) => !approvedBy.has(id));

  if (outstanding.length > 0) {
    return {
      ok: false,
      message: `Waiting on ${outstanding.length} of ${bishopricUserIds.length} approvals.`,
    };
  }

  return { ok: true };
}

function forwardGate(
  to: PipelineStage,
  context: TransitionContext,
): TransitionResult {
  const { assignment } = context;

  switch (to) {
    case "review":
      return planToReview(assignment);

    case "approve":
      return reviewToApprove(context);

    // Nothing further to check. Reaching `request` means the plan is approved, which the
    // one-step-at-a-time rule above has already established.
    case "request":
      return { ok: true };

    case "confirm":
      return assignment.requestOutcome === "accepted" || isWaived(assignment)
        ? { ok: true }
        : { ok: false, message: "Log the speaker's answer first." };

    case "notify":
      return (assignment.notifyMessage !== null &&
        assignment.notifyMessage.trim() !== "") ||
        isWaived(assignment)
        ? { ok: true }
        : { ok: false, message: "Approve the confirmation message first." };

    case "speak":
      return assignment.notifySentAt !== null || isWaived(assignment)
        ? { ok: true }
        : { ok: false, message: "Mark the message as sent first." };

    // Deliberately NOT waivable. Whether the meeting happened is a fact about the meeting, not
    // about who spoke in it.
    case "appreciate":
      return assignment.sundayConfirmedAt !== null
        ? { ok: true }
        : { ok: false, message: "Confirm the meeting happened first." };

    case "complete":
      return assignment.thankYouSentAt !== null || isWaived(assignment)
        ? { ok: true }
        : { ok: false, message: "Send the thank-you first." };

    // `plan` is the first stage; nothing moves forward into it.
    case "plan":
      return { ok: false, message: SAME_STAGE };
  }
}

// The one place this app decides whether an assignment may move. It answers only that question:
// it writes nothing, stamps nothing, and knows nothing about notifications or history rows. The
// route performs the side effects a legal transition earns.
//
// `request` -> `plan` is the expected backward move (a decline) and is deliberately NOT
// special-cased here. It is an ordinary backward move; what makes it a decline is the side
// effects the route runs, not a rule in this function.
export function canTransition(
  from: PipelineStage,
  to: PipelineStage,
  context: TransitionContext,
): TransitionResult {
  if (from === to) {
    return { ok: false, message: SAME_STAGE };
  }

  if (isBackwardTransition(from, to)) {
    if (!context.actorIsBishopric) {
      return { ok: false, message: BACKWARD_WITHOUT_BISHOPRIC };
    }

    if (context.reason === undefined || context.reason.trim() === "") {
      return { ok: false, message: BACKWARD_WITHOUT_REASON };
    }

    return { ok: true };
  }

  // Stages are not skippable. A jump from `plan` straight to `request` would leave the approval
  // gate unevaluated, which is the whole reason the gate exists.
  const expected = nextStage(from);

  if (to !== expected) {
    return {
      ok: false,
      message:
        expected === null
          ? "That assignment is already complete."
          : `An assignment moves one stage at a time. The next stage after ${PIPELINE_STAGE_LABELS[from]} is ${PIPELINE_STAGE_LABELS[expected]}.`,
    };
  }

  return forwardGate(to, context);
}
