import { describe, expect, it } from "vitest";
import { describeTimeElsewhere } from "@/app/(app)/todos/AskDetails";
import { type AskCopy, pickTimeElsewhere } from "@/lib/todos/timeElsewhere";

// Sacrament slice f3a, decision A1: nobody inherits another leader's appointment; their card says
// who has one set instead.

const TALK = "talk-1";
const MINE = { todoId: "mine", assignmentId: TALK };

function copy(overrides: Partial<AskCopy>): AskCopy {
  return {
    todoId: "other",
    assignmentId: TALK,
    ownerUserId: "peter",
    ownerName: "Peter Nakamura",
    scheduledFor: "2026-09-27T01:00:00+00:00",
    withName: "Maria Lopez",
    completedAt: null,
    closedReason: null,
    createdAt: "2026-09-20T10:00:00+00:00",
    ...overrides,
  };
}

const own = copy({ todoId: "mine", ownerUserId: "david", ownerName: "David Okafor", scheduledFor: null });

describe("pickTimeElsewhere", () => {
  it("names another holder's open copy as still held", () => {
    expect(pickTimeElsewhere(MINE, [own, copy({})])).toEqual({
      holderName: "Peter Nakamura",
      scheduledFor: "2026-09-27T01:00:00+00:00",
      withName: "Maria Lopez",
      stillHeld: true,
    });
  });

  it("names a handed-over copy as no longer held", () => {
    const handedOver = copy({ completedAt: "2026-09-21T10:00:00+00:00", closedReason: "handed_over" });
    expect(pickTimeElsewhere(MINE, [own, handedOver])?.stillHeld).toBe(false);
  });

  // Each refusal below differs from the valid copy above in exactly ONE field, so it is refused
  // for the reason its name gives.
  it("ignores a copy with no time set", () => {
    expect(pickTimeElsewhere(MINE, [own, copy({ scheduledFor: null })])).toBeNull();
  });

  it("ignores a copy on another talk", () => {
    expect(pickTimeElsewhere(MINE, [own, copy({ assignmentId: "talk-2" })])).toBeNull();
  });

  it("ignores the owner's own earlier copies", () => {
    expect(pickTimeElsewhere(MINE, [own, copy({ ownerUserId: "david" })])).toBeNull();
  });

  it("ignores a copy closed any way but a handover", () => {
    for (const closedReason of [null, "assistant_released", "speaker_changed", "told_not_needed"]) {
      const closed = copy({ completedAt: "2026-09-21T10:00:00+00:00", closedReason });
      expect(pickTimeElsewhere(MINE, [own, closed])).toBeNull();
    }
  });

  it("says nothing when the owner's own copy is not among the rows", () => {
    expect(pickTimeElsewhere(MINE, [copy({})])).toBeNull();
  });

  it("prefers an open copy over a more recent handed-over one", () => {
    const open = copy({ todoId: "open", createdAt: "2026-09-20T10:00:00+00:00" });
    const handedOver = copy({
      todoId: "handed",
      ownerUserId: "bishop",
      ownerName: "Mark Andersen",
      completedAt: "2026-09-22T10:00:00+00:00",
      closedReason: "handed_over",
      createdAt: "2026-09-21T10:00:00+00:00",
    });
    expect(pickTimeElsewhere(MINE, [own, handedOver, open])?.holderName).toBe("Peter Nakamura");
  });

  it("prefers the most recent of two handed-over copies", () => {
    const older = copy({
      todoId: "older",
      completedAt: "2026-09-21T10:00:00+00:00",
      closedReason: "handed_over",
      createdAt: "2026-09-19T10:00:00+00:00",
    });
    const newer = copy({
      todoId: "newer",
      ownerUserId: "bishop",
      ownerName: "Mark Andersen",
      completedAt: "2026-09-22T10:00:00+00:00",
      closedReason: "handed_over",
      createdAt: "2026-09-21T10:00:00+00:00",
    });
    expect(pickTimeElsewhere(MINE, [own, older, newer])?.holderName).toBe("Mark Andersen");
  });

  it("falls back to a neutral name when the holder's name is unreadable", () => {
    expect(pickTimeElsewhere(MINE, [own, copy({ ownerName: null })])?.holderName).toBe(
      "Another leader",
    );
  });
});

describe("describeTimeElsewhere", () => {
  const time = {
    holderName: "Peter Nakamura",
    scheduledFor: "2026-09-27T01:00:00+00:00",
    withName: "Maria Lopez",
    stillHeld: true,
  };

  // 01:00 UTC on the 27th is 7:00 PM on the 26th in Denver — the rule-12 trap, asserted.
  it("reads in the ward's zone, not UTC", () => {
    const line = describeTimeElsewhere(time, "America/Denver");
    expect(line).toContain("Sep 26");
    expect(line).toContain("7:00");
    expect(line.startsWith("Peter Nakamura has this set for ")).toBe(true);
    expect(line).toMatch(/ with Maria Lopez\.$/);
  });

  it("says 'had' once the other copy was handed over, and omits a missing 'with'", () => {
    const line = describeTimeElsewhere({ ...time, stillHeld: false, withName: null }, "America/Denver");
    expect(line.startsWith("Peter Nakamura had this set for ")).toBe(true);
    expect(line).not.toContain(" with ");
  });
});
