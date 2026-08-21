import { describe, expect, it } from "vitest";
import { canTransition, type PipelineAssignment } from "@/lib/assignments/pipeline";
import { countsAsSpokenTalk } from "@/lib/assignments/rotation";
import { speakerFrom } from "@/lib/assignments/speaker";

// A speaker says no. `request` → `plan` is the move, and it is deliberately NOT special-cased in
// canTransition — it is an ordinary backward move, and what makes it a decline is the side
// effects PATCH /api/assignments/[id] performs on top of it.
//
// This suite pins both halves: that the move is legal on the same terms as any backward move, and
// that the STATE it leaves behind reads correctly everywhere downstream.

const REQUESTED: PipelineAssignment = {
  stage: "request",
  memberId: "member-1",
  externalSpeakerName: null,
  topicId: "topic-1",
  slotNumber: 2,
  requestOutcome: "pending",
  notifyMessage: null,
  notifySentAt: null,
  sundayConfirmedAt: null,
  thankYouSentAt: null,
  contactWaivedAt: null,
};

function decline(overrides: Partial<Parameters<typeof canTransition>[2]> = {}) {
  return canTransition("request", "plan", {
    assignment: REQUESTED,
    approvals: [],
    bishopricUserIds: ["user-bishop", "user-first", "user-second"],
    actorIsBishopric: true,
    reason: "Sister Larsen is travelling that week.",
    ...overrides,
  });
}

describe("the decline move itself", () => {
  it("is legal for a bishopric member with a reason", () => {
    expect(decline().ok).toBe(true);
  });

  it("is refused without a reason — the planner needs to know why", () => {
    const result = decline({ reason: undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/say why/i);
  });

  it("is refused for a non-bishopric actor", () => {
    const result = decline({ actorIsBishopric: false });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/only the bishopric/i);
  });

  // A decline that only recorded `request_outcome = 'declined'` and left the stage alone would
  // leave the slot looking requested forever.
  it("is not reachable by moving forward instead", () => {
    expect(
      canTransition("request", "confirm", {
        assignment: { ...REQUESTED, requestOutcome: "declined" },
        approvals: [],
        bishopricUserIds: ["user-bishop"],
        actorIsBishopric: true,
      }).ok,
    ).toBe(false);
  });
});

describe("the state a decline leaves behind", () => {
  // The route clears member_id and both external speaker columns. What that produces is the
  // `empty` speaker — a genuinely open slot, not one whose speaker said no and is still named in
  // it.
  const cleared = {
    memberId: null,
    externalSpeakerName: null,
    externalSpeakerTitle: null,
  };

  it("leaves an empty slot rather than a named one", () => {
    expect(speakerFrom(cleared)).toEqual({ kind: "empty" });
  });

  it("leaves a slot that cannot go back to review until somebody else is chosen", () => {
    const result = canTransition("plan", "review", {
      assignment: {
        ...REQUESTED,
        stage: "plan",
        memberId: null,
        requestOutcome: "declined",
      },
      approvals: [],
      bishopricUserIds: ["user-bishop"],
      actorIsBishopric: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/a speaker/i);
  });

  // The row still exists, and the member is still named on the assignment_history row recording
  // the decline. What must NOT happen is the member being treated as having spoken.
  it("does not count as a talk that was given", () => {
    expect(
      countsAsSpokenTalk({
        stage: "plan",
        assignmentType: "sacrament_talk",
        memberId: "member-1",
      }),
    ).toBe(false);
  });
});
