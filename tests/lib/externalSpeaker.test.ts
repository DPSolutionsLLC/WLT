import { describe, expect, it } from "vitest";
import { canTransition, type PipelineAssignment } from "@/lib/assignments/pipeline";
import {
  contactStagesApply,
  externalDisplayName,
  isExternalSpeaker,
  speakerFrom,
} from "@/lib/assignments/speaker";

// ITER-004. A speaker may be a ward member or an external person — a visiting stake leader, a
// missionary reporting home. The contact stages for an external speaker are waived EXPLICITLY,
// never silently skipped, and the waiver satisfies exactly four gates.
//
// The half of this suite that matters most is the negative half: proving a waiver does not open
// the gates it must not open. A waiver that quietly satisfied everything would let an assignment
// reach `complete` without a topic, without approvals, and without anybody confirming the meeting
// took place.

const WAIVED_AT = "2026-05-01T18:00:00.000Z";

describe("speakerFrom", () => {
  it("returns a member speaker when member_id is set", () => {
    expect(
      speakerFrom({
        memberId: "member-1",
        externalSpeakerName: null,
        externalSpeakerTitle: null,
      }),
    ).toEqual({ kind: "member", memberId: "member-1" });
  });

  it("returns an external speaker when only a name is set", () => {
    expect(
      speakerFrom({
        memberId: null,
        externalSpeakerName: "Mark Andersen",
        externalSpeakerTitle: "President",
      }),
    ).toEqual({ kind: "external", name: "Mark Andersen", title: "President" });
  });

  it("returns an empty speaker when neither is set", () => {
    expect(
      speakerFrom({
        memberId: null,
        externalSpeakerName: null,
        externalSpeakerTitle: null,
      }),
    ).toEqual({ kind: "empty" });
  });

  it("treats a whitespace-only external name as empty, not as a speaker", () => {
    expect(
      speakerFrom({
        memberId: null,
        externalSpeakerName: "   ",
        externalSpeakerTitle: null,
      }),
    ).toEqual({ kind: "empty" });
  });

  it("trims the name and the title", () => {
    expect(
      speakerFrom({
        memberId: null,
        externalSpeakerName: "  Mark Andersen  ",
        externalSpeakerTitle: "  President  ",
      }),
    ).toEqual({ kind: "external", name: "Mark Andersen", title: "President" });
  });

  it("reads a blank title as no title", () => {
    expect(
      speakerFrom({
        memberId: null,
        externalSpeakerName: "Mark Andersen",
        externalSpeakerTitle: "  ",
      }),
    ).toEqual({ kind: "external", name: "Mark Andersen", title: null });
  });

  // assignments_speaker_exactly_one (migration 025) makes this row unwritable. The discriminator
  // answers rather than throwing anyway: taking a whole page down over one bad row is worse than
  // agreeing with the roster.
  it("prefers the member when a row somehow holds both", () => {
    expect(
      speakerFrom({
        memberId: "member-1",
        externalSpeakerName: "Mark Andersen",
        externalSpeakerTitle: null,
      }),
    ).toEqual({ kind: "member", memberId: "member-1" });
  });
});

describe("externalDisplayName", () => {
  const external = (title: string | null) =>
    ({ kind: "external", name: "Mark Andersen", title }) as const;

  it("prefixes the title when one is set", () => {
    expect(externalDisplayName(external("President"))).toBe("President Mark Andersen");
  });

  it("gives the bare name when no title is set", () => {
    expect(externalDisplayName(external(null))).toBe("Mark Andersen");
  });

  // `users` records no gender, which is why bishopricDisplayName() already refuses to guess an
  // honorific. A title is typed or it is absent; nothing derives one.
  it("returns null for a member speaker rather than reaching for the roster", () => {
    expect(externalDisplayName({ kind: "member", memberId: "member-1" })).toBeNull();
  });

  it("returns null for an empty slot", () => {
    expect(externalDisplayName({ kind: "empty" })).toBeNull();
  });
});

describe("isExternalSpeaker and contactStagesApply", () => {
  it("identifies an external speaker and nobody else", () => {
    expect(isExternalSpeaker({ kind: "external", name: "M", title: null })).toBe(true);
    expect(isExternalSpeaker({ kind: "member", memberId: "member-1" })).toBe(false);
    expect(isExternalSpeaker({ kind: "empty" })).toBe(false);
  });

  it("says the contact stages apply to a ward member", () => {
    expect(contactStagesApply({ kind: "member", memberId: "member-1" })).toBe(true);
  });

  it("says the contact stages do not apply to an external speaker", () => {
    expect(contactStagesApply({ kind: "external", name: "M", title: null })).toBe(false);
  });

  // An unfilled slot answers `true`. Answering `false` would make an open slot read as waived,
  // which is the same "task that looks done but is not" failure ITER-004 exists to prevent, in
  // the opposite direction.
  it("says the contact stages still apply to an empty slot", () => {
    expect(contactStagesApply({ kind: "empty" })).toBe(true);
  });
});

describe("the waiver satisfies exactly four gates", () => {
  const bishopric = ["user-bishop", "user-first", "user-second"];

  function external(overrides: Partial<PipelineAssignment>): PipelineAssignment {
    return {
      stage: "plan",
      memberId: null,
      externalSpeakerName: "Mark Andersen",
      topicId: "topic-1",
      slotNumber: 1,
      requestOutcome: null,
      notifyMessage: null,
      notifySentAt: null,
      sundayConfirmedAt: null,
      thankYouSentAt: null,
      contactWaivedAt: WAIVED_AT,
      ...overrides,
    };
  }

  function move(from: PipelineStageArg, to: PipelineStageArg, assignment: PipelineAssignment) {
    return canTransition(from, to, {
      assignment,
      approvals: bishopric.map((userId) => ({ userId, approved: true })),
      bishopricUserIds: bishopric,
      actorIsBishopric: true,
    });
  }

  type PipelineStageArg = Parameters<typeof canTransition>[0];

  it("opens request → confirm with no logged answer", () => {
    expect(move("request", "confirm", external({ stage: "request" })).ok).toBe(true);
  });

  it("opens confirm → notify with no approved message", () => {
    expect(move("confirm", "notify", external({ stage: "confirm" })).ok).toBe(true);
  });

  it("opens notify → speak with nothing marked sent", () => {
    expect(move("notify", "speak", external({ stage: "notify" })).ok).toBe(true);
  });

  it("opens appreciate → complete with no thank-you sent", () => {
    expect(move("appreciate", "complete", external({ stage: "appreciate" })).ok).toBe(true);
  });
});

describe("the waiver opens nothing else", () => {
  const bishopric = ["user-bishop", "user-first", "user-second"];

  function waived(overrides: Partial<PipelineAssignment> = {}): PipelineAssignment {
    return {
      stage: "plan",
      memberId: null,
      externalSpeakerName: "Mark Andersen",
      topicId: "topic-1",
      slotNumber: 1,
      requestOutcome: null,
      notifyMessage: null,
      notifySentAt: null,
      sundayConfirmedAt: null,
      thankYouSentAt: null,
      contactWaivedAt: WAIVED_AT,
      ...overrides,
    };
  }

  it("does not let plan → review pass without a topic", () => {
    const result = canTransition("plan", "review", {
      assignment: waived({ topicId: null }),
      approvals: [],
      bishopricUserIds: bishopric,
      actorIsBishopric: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/a topic/i);
  });

  it("does not let plan → review pass without a speaker", () => {
    const result = canTransition("plan", "review", {
      assignment: waived({ externalSpeakerName: null }),
      approvals: [],
      bishopricUserIds: bishopric,
      actorIsBishopric: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/a speaker/i);
  });

  it("does not substitute for the bishopric's approvals", () => {
    const result = canTransition("review", "approve", {
      assignment: waived({ stage: "review" }),
      approvals: [],
      bishopricUserIds: bishopric,
      actorIsBishopric: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Waiting on 3 of 3 approvals.");
  });

  // The single most important assertion in this file. Whether the meeting happened is a fact
  // about the meeting, not about who spoke in it — a waiver that satisfied this would let an
  // assignment reach `complete` for a Sunday that never took place.
  it("does not substitute for sundayConfirmedAt on speak → appreciate", () => {
    const result = canTransition("speak", "appreciate", {
      assignment: waived({ stage: "speak", sundayConfirmedAt: null }),
      approvals: [],
      bishopricUserIds: bishopric,
      actorIsBishopric: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Confirm the meeting happened first.");
  });

  it("does not make a stage skippable", () => {
    const result = canTransition("request", "notify", {
      assignment: waived({ stage: "request" }),
      approvals: [],
      bishopricUserIds: bishopric,
      actorIsBishopric: true,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/one stage at a time/i);
  });
});
