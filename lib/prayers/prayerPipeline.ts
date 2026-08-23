import { PRAYER_STAGE_LABELS, PRAYER_STAGES, type PrayerStage } from "@/types/domain";

// The four-stage prayer pipeline as a pure state machine: assign → ask → confirm → done. Nothing
// else in the app decides whether a prayer may move.
//
// Nothing outside `@/types/domain` may be imported into this module. PrayerBoard is a client
// component, and a single import of lib/prayers/queries.ts would pull in next/headers and break
// the production build — a violation that `npm run lint` and `npm run typecheck` both pass
// (plans/retros/roster-b-picker-and-orgs.md).
//
// DELIBERATELY a separate module from lib/assignments/pipeline.ts. The two machines share a
// shape but not a domain, and merging them behind a generic would mean one set of gates
// answering two different questions. There is no approval gate here at all: a prayer is asked
// and confirmed by one person, not reviewed by three.

export type PrayerTransitionContext = {
  memberId: string | null;
  askedAt: string | null;
  confirmedAt: string | null;
  actorIsBishopric: boolean;
  reason?: string;
};

export type PrayerTransitionResult = { ok: true } | { ok: false; message: string };

const BACKWARD_WITHOUT_BISHOPRIC =
  "Only the bishopric can move a prayer back a stage.";

const BACKWARD_WITHOUT_REASON =
  "Say why this is going back a stage — the reason is recorded and the planner reads it.";

const SAME_STAGE = "That prayer is already at this stage.";

export function prayerStageIndex(stage: PrayerStage): number {
  return PRAYER_STAGES.indexOf(stage);
}

export function nextPrayerStage(from: PrayerStage): PrayerStage | null {
  return PRAYER_STAGES[prayerStageIndex(from) + 1] ?? null;
}

export function isBackwardPrayerTransition(
  from: PrayerStage,
  to: PrayerStage,
): boolean {
  return prayerStageIndex(to) < prayerStageIndex(from);
}

function forwardGate(
  to: PrayerStage,
  context: PrayerTransitionContext,
): PrayerTransitionResult {
  switch (to) {
    case "ask":
      return context.memberId !== null
        ? { ok: true }
        : { ok: false, message: "Choose who is praying before asking them." };

    case "confirm":
      return context.askedAt !== null
        ? { ok: true }
        : { ok: false, message: "Mark this prayer as asked first." };

    case "done":
      return context.confirmedAt !== null
        ? { ok: true }
        : { ok: false, message: "Record that they agreed before marking it done." };

    // `assign` is the first stage; nothing moves forward into it.
    case "assign":
      return { ok: false, message: SAME_STAGE };
  }
}

// The one place this app decides whether a prayer may move. It answers only that question: it
// writes nothing and stamps nothing. The route performs the side effects a legal transition
// earns.
export function canTransitionPrayer(
  from: PrayerStage,
  to: PrayerStage,
  context: PrayerTransitionContext,
): PrayerTransitionResult {
  if (from === to) {
    return { ok: false, message: SAME_STAGE };
  }

  if (isBackwardPrayerTransition(from, to)) {
    if (!context.actorIsBishopric) {
      return { ok: false, message: BACKWARD_WITHOUT_BISHOPRIC };
    }

    if (context.reason === undefined || context.reason.trim() === "") {
      return { ok: false, message: BACKWARD_WITHOUT_REASON };
    }

    return { ok: true };
  }

  // Stages are not skippable. A jump from `assign` straight to `done` would record a prayer as
  // given without anybody ever having been asked.
  const expected = nextPrayerStage(from);

  if (to !== expected) {
    return {
      ok: false,
      message:
        expected === null
          ? "That prayer is already done."
          : `A prayer moves one stage at a time. The next stage after ${PRAYER_STAGE_LABELS[from]} is ${PRAYER_STAGE_LABELS[expected]}.`,
    };
  }

  return forwardGate(to, context);
}
