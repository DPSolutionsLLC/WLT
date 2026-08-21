import { describe, expect, it } from "vitest";
import {
  canTransition,
  isBackwardTransition,
  nextStage,
  requiredFieldsFor,
  stageIndex,
  type PipelineAssignment,
  type TransitionContext,
} from "@/lib/assignments/pipeline";
import { PIPELINE_STAGES, type PipelineStage } from "@/types/domain";

// The highest-priority suite in Phase 4. The nine-stage pipeline is nine times nine = 81 ordered
// pairs, and exactly eight of them are legal forward moves. Anything that is not asserted here is
// a transition somebody can make by accident.
//
// The table below is driven off PIPELINE_STAGES rather than a hand-written list, so a tenth stage
// added to types/domain.ts makes this suite cover it without anybody remembering to.

const BISHOP = "user-bishop";
const FIRST_COUNSELOR = "user-first";
const SECOND_COUNSELOR = "user-second";
const BISHOPRIC = [BISHOP, FIRST_COUNSELOR, SECOND_COUNSELOR];

// Every gate satisfied at once. Each test then removes exactly the field it is about, so a
// failure names one missing gate rather than a pile of them.
function readyAssignment(
  stage: PipelineStage,
  overrides: Partial<PipelineAssignment> = {},
): PipelineAssignment {
  return {
    stage,
    memberId: "member-1",
    externalSpeakerName: null,
    topicId: "topic-1",
    slotNumber: 1,
    requestOutcome: "accepted",
    notifyMessage: "Brother Andersen, you are speaking on the third.",
    notifySentAt: "2026-05-01T18:00:00.000Z",
    sundayConfirmedAt: "2026-05-03T18:00:00.000Z",
    thankYouSentAt: "2026-05-04T18:00:00.000Z",
    contactWaivedAt: null,
    ...overrides,
  };
}

function context(
  assignment: PipelineAssignment,
  overrides: Partial<TransitionContext> = {},
): TransitionContext {
  return {
    assignment,
    approvals: BISHOPRIC.map((userId) => ({ userId, approved: true })),
    bishopricUserIds: BISHOPRIC,
    actorIsBishopric: true,
    ...overrides,
  };
}

// The eight legal forward moves, written out rather than derived, so the table this suite checks
// is not the same expression as the code it is checking.
const LEGAL_FORWARD: ReadonlyArray<[PipelineStage, PipelineStage]> = [
  ["plan", "review"],
  ["review", "approve"],
  ["approve", "request"],
  ["request", "confirm"],
  ["confirm", "notify"],
  ["notify", "speak"],
  ["speak", "appreciate"],
  ["appreciate", "complete"],
];

describe("stage ordering", () => {
  it("orders the nine stages as 04-talks-pipeline.md lists them", () => {
    expect([...PIPELINE_STAGES]).toEqual([
      "plan",
      "review",
      "approve",
      "request",
      "confirm",
      "notify",
      "speak",
      "appreciate",
      "complete",
    ]);
  });

  it("gives every stage a distinct index in order", () => {
    const indexes = PIPELINE_STAGES.map(stageIndex);
    expect(indexes).toEqual([...PIPELINE_STAGES.keys()]);
  });

  it("has no stage after complete", () => {
    expect(nextStage("complete")).toBeNull();
    expect(nextStage("plan")).toBe("review");
  });

  it("calls a move backward only when the target sits earlier", () => {
    expect(isBackwardTransition("request", "plan")).toBe(true);
    expect(isBackwardTransition("plan", "request")).toBe(false);
    expect(isBackwardTransition("plan", "plan")).toBe(false);
  });
});

describe("requiredFieldsFor", () => {
  it("names a field for every stage that has a gate", () => {
    expect(requiredFieldsFor("review")).toEqual(["speaker", "topicId", "slotNumber"]);
    expect(requiredFieldsFor("approve")).toEqual(["approvals"]);
    expect(requiredFieldsFor("confirm")).toEqual(["requestOutcome"]);
    expect(requiredFieldsFor("notify")).toEqual(["notifyMessage"]);
    expect(requiredFieldsFor("speak")).toEqual(["notifySentAt"]);
    expect(requiredFieldsFor("appreciate")).toEqual(["sundayConfirmedAt"]);
    expect(requiredFieldsFor("complete")).toEqual(["thankYouSentAt"]);
  });

  it("names nothing for the two stages with no gate of their own", () => {
    expect(requiredFieldsFor("plan")).toEqual([]);
    expect(requiredFieldsFor("request")).toEqual([]);
  });
});

describe("canTransition over all 81 stage pairs", () => {
  const isLegalForward = (from: PipelineStage, to: PipelineStage) =>
    LEGAL_FORWARD.some(([a, b]) => a === from && b === to);

  it("covers exactly 81 pairs", () => {
    expect(PIPELINE_STAGES.length * PIPELINE_STAGES.length).toBe(81);
  });

  for (const from of PIPELINE_STAGES) {
    for (const to of PIPELINE_STAGES) {
      const expected = isLegalForward(from, to) || isBackwardTransition(from, to);

      it(`${expected ? "allows" : "refuses"} ${from} → ${to}`, () => {
        const result = canTransition(
          from,
          to,
          context(readyAssignment(from), { reason: "The speaker asked to move." }),
        );

        expect(result.ok, JSON.stringify(result)).toBe(expected);
      });
    }
  }

  it("refuses every same-stage move — almost always a double-submitted form", () => {
    for (const stage of PIPELINE_STAGES) {
      const result = canTransition(stage, stage, context(readyAssignment(stage)));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toMatch(/already at this stage/i);
      }
    }
  });

  it("refuses a forward skip even when every later gate is satisfied", () => {
    const result = canTransition("plan", "request", context(readyAssignment("plan")));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/one stage at a time/i);
    }
  });
});

describe("backward moves", () => {
  it("allows a bishopric member with a reason", () => {
    const result = canTransition(
      "request",
      "plan",
      context(readyAssignment("request"), {
        actorIsBishopric: true,
        reason: "Brother Andersen is out of town that week.",
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("refuses a non-bishopric actor even with a reason", () => {
    const result = canTransition(
      "request",
      "plan",
      context(readyAssignment("request"), {
        actorIsBishopric: false,
        reason: "Brother Andersen is out of town that week.",
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/only the bishopric/i);
  });

  it("refuses a missing reason", () => {
    const result = canTransition(
      "request",
      "plan",
      context(readyAssignment("request"), { reason: undefined }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/say why/i);
  });

  it("refuses a blank reason — whitespace is not an explanation", () => {
    const result = canTransition(
      "request",
      "plan",
      context(readyAssignment("request"), { reason: "   " }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/say why/i);
  });

  it("allows a jump backward across several stages, not only one", () => {
    const result = canTransition(
      "complete",
      "plan",
      context(readyAssignment("complete"), { reason: "Recorded against the wrong Sunday." }),
    );

    expect(result.ok).toBe(true);
  });
});

describe("each forward gate names what is missing", () => {
  it("plan → review needs a speaker", () => {
    const result = canTransition(
      "plan",
      "review",
      context(readyAssignment("plan", { memberId: null, externalSpeakerName: null })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/a speaker/i);
  });

  it("plan → review needs a topic", () => {
    const result = canTransition(
      "plan",
      "review",
      context(readyAssignment("plan", { topicId: null })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/a topic/i);
  });

  it("plan → review needs a slot", () => {
    const result = canTransition(
      "plan",
      "review",
      context(readyAssignment("plan", { slotNumber: null })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/a speaking slot/i);
  });

  it("plan → review names all three when all three are missing", () => {
    const result = canTransition(
      "plan",
      "review",
      context(
        readyAssignment("plan", {
          memberId: null,
          externalSpeakerName: null,
          topicId: null,
          slotNumber: null,
        }),
      ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/a speaker/i);
      expect(result.message).toMatch(/a topic/i);
      expect(result.message).toMatch(/a speaking slot/i);
    }
  });

  it("plan → review accepts an external speaker in place of a member", () => {
    const result = canTransition(
      "plan",
      "review",
      context(
        readyAssignment("plan", {
          memberId: null,
          externalSpeakerName: "Mark Andersen",
        }),
      ),
    );

    expect(result.ok).toBe(true);
  });

  it("plan → review refuses an external name that is only whitespace", () => {
    const result = canTransition(
      "plan",
      "review",
      context(
        readyAssignment("plan", { memberId: null, externalSpeakerName: "   " }),
      ),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/a speaker/i);
  });

  it("request → confirm needs the speaker's answer", () => {
    const result = canTransition(
      "request",
      "confirm",
      context(readyAssignment("request", { requestOutcome: null })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Log the speaker's answer first.");
  });

  it("request → confirm refuses a pending answer — pending is not yes", () => {
    const result = canTransition(
      "request",
      "confirm",
      context(readyAssignment("request", { requestOutcome: "pending" })),
    );

    expect(result.ok).toBe(false);
  });

  it("confirm → notify needs an approved message", () => {
    const result = canTransition(
      "confirm",
      "notify",
      context(readyAssignment("confirm", { notifyMessage: null })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe("Approve the confirmation message first.");
    }
  });

  it("confirm → notify refuses a message that is only whitespace", () => {
    const result = canTransition(
      "confirm",
      "notify",
      context(readyAssignment("confirm", { notifyMessage: "  \n " })),
    );

    expect(result.ok).toBe(false);
  });

  it("notify → speak needs the message marked sent", () => {
    const result = canTransition(
      "notify",
      "speak",
      context(readyAssignment("notify", { notifySentAt: null })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Mark the message as sent first.");
  });

  it("speak → appreciate needs the meeting confirmed", () => {
    const result = canTransition(
      "speak",
      "appreciate",
      context(readyAssignment("speak", { sundayConfirmedAt: null })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Confirm the meeting happened first.");
  });

  it("appreciate → complete needs the thank-you sent", () => {
    const result = canTransition(
      "appreciate",
      "complete",
      context(readyAssignment("appreciate", { thankYouSentAt: null })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Send the thank-you first.");
  });
});
