import { describe, expect, it } from "vitest";
import { sundaySlotEntries } from "@/app/(app)/assignments/SundaySlotList";
import type { Assignment } from "@/lib/assignments/queries";

// The page's dead end was "nothing planned → no way to plan". What is asserted here is that every
// slot the Sunday has is on the page, open ones with a Plan control for a planner and without one
// for anybody else, and that a talk whose slot no longer lines up is still listed rather than lost.

function assignment(overrides: Partial<Assignment> & { id: string }): Assignment {
  return {
    sundayId: "sunday-1",
    memberId: null,
    externalSpeakerName: null,
    externalSpeakerTitle: null,
    assignmentType: null,
    countsTowardRotation: true,
    topicTitle: null,
    slotNumber: null,
    slotLengthMinutes: null,
    stage: "plan",
    plannedBy: null,
    planSubmittedAt: null,
    approvedAt: null,
    requestedAt: null,
    requestedBy: null,
    requestOutcome: null,
    requestNotes: null,
    confirmedAt: null,
    notifyMessage: null,
    notifySentAt: null,
    notifySentBy: null,
    sundayConfirmedAt: null,
    thankYouMessage: null,
    thankYouSentAt: null,
    thankYouSentBy: null,
    completedAt: null,
    contactWaivedAt: null,
    contactWaivedBy: null,
    cancelledAt: null,
    cancelledReason: null,
    createdAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("sundaySlotEntries", () => {
  it("lists every slot as open when nothing is planned", () => {
    expect(sundaySlotEntries(3, [])).toEqual([
      { kind: "open", slotNumber: 1 },
      { kind: "open", slotNumber: 2 },
      { kind: "open", slotNumber: 3 },
    ]);
  });

  it("puts a planned talk in its own slot and leaves the others open", () => {
    const second = assignment({ id: "talk-2", slotNumber: 2 });

    expect(sundaySlotEntries(3, [second])).toEqual([
      { kind: "open", slotNumber: 1 },
      { kind: "planned", assignment: second },
      { kind: "open", slotNumber: 3 },
    ]);
  });

  it("lists a talk outside the slots after them instead of dropping it", () => {
    const beyond = assignment({ id: "talk-4", slotNumber: 4 });
    const unslotted = assignment({ id: "talk-none", slotNumber: null });

    expect(sundaySlotEntries(1, [unslotted, beyond])).toEqual([
      { kind: "open", slotNumber: 1 },
      { kind: "planned", assignment: beyond },
      { kind: "planned", assignment: unslotted },
    ]);
  });

  it("still lists a talk on a Sunday with no speaking slots", () => {
    const leftover = assignment({ id: "talk-1", slotNumber: 1 });

    expect(sundaySlotEntries(0, [leftover])).toEqual([
      { kind: "planned", assignment: leftover },
    ]);
  });
});
