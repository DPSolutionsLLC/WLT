import { describe, expect, it } from "vitest";
import { countsAsSpokenTalk, countsTowardRotation } from "@/lib/assignments/rotation";
import {
  ASSIGNMENT_TYPES,
  PIPELINE_STAGES,
  type AssignmentType,
} from "@/types/domain";

// Who counts as having spoken. Getting this wrong has no symptom: a member is quietly suppressed
// from the rotation for months and nobody notices until somebody asks why a family has not been
// asked to speak in a year.

describe("countsTowardRotation", () => {
  // Written out rather than derived from COUNTS_TOWARD_ROTATION, so this suite is not the same
  // expression as the code it checks.
  const EXPECTED: Record<AssignmentType, boolean> = {
    sacrament_talk: true,
    organizational: false,
    returning_missionary: false,
    new_member: false,
    youth_speaker: false,
    high_council: false,
    other: false,
  };

  it("covers all seven assignment types", () => {
    expect(ASSIGNMENT_TYPES.length).toBe(7);
    expect([...ASSIGNMENT_TYPES].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  for (const type of ASSIGNMENT_TYPES) {
    it(`${EXPECTED[type] ? "counts" : "does not count"} ${type}`, () => {
      expect(countsTowardRotation(type)).toBe(EXPECTED[type]);
    });
  }

  // A high council speaker is assigned by the stake. Counting them would suppress a ward member
  // who never spoke at all.
  it("excludes high council, which the stake assigns", () => {
    expect(countsTowardRotation("high_council")).toBe(false);
  });
});

describe("countsAsSpokenTalk", () => {
  const MEMBER_TALK = {
    assignmentType: "sacrament_talk" as const,
    memberId: "member-1",
  };

  it("is true only for a completed sacrament talk naming a ward member", () => {
    expect(countsAsSpokenTalk({ ...MEMBER_TALK, stage: "complete" })).toBe(true);
  });

  it("is false at every stage below complete", () => {
    for (const stage of PIPELINE_STAGES.filter((s) => s !== "complete")) {
      expect(
        countsAsSpokenTalk({ ...MEMBER_TALK, stage }),
        `stage ${stage} counted as a talk that was given`,
      ).toBe(false);
    }
  });

  // A calendar change put this assignment back to `plan`. The row still exists — assignments are
  // reverted, never deleted (03-calendar.md §Pitfall 5) — and it must not count.
  it("is false for a reverted assignment sitting back at plan", () => {
    expect(countsAsSpokenTalk({ ...MEMBER_TALK, stage: "plan" })).toBe(false);
  });

  // ITER-004: speaker history is not distorted by somebody who is not on the roster. An external
  // speaker has no member_id, so this falls out of the schema — assignment_history.member_id is
  // `not null`.
  it("is false for an external speaker even at complete", () => {
    expect(
      countsAsSpokenTalk({
        stage: "complete",
        assignmentType: "sacrament_talk",
        memberId: null,
      }),
    ).toBe(false);
  });

  it("is false for a completed assignment whose type does not count", () => {
    for (const type of ASSIGNMENT_TYPES.filter((t) => t !== "sacrament_talk")) {
      expect(
        countsAsSpokenTalk({ stage: "complete", assignmentType: type, memberId: "member-1" }),
        `${type} counted toward the member rotation`,
      ).toBe(false);
    }
  });

  it("requires all three conditions, not any of them", () => {
    // Stage right, type wrong.
    expect(
      countsAsSpokenTalk({
        stage: "complete",
        assignmentType: "high_council",
        memberId: "member-1",
      }),
    ).toBe(false);

    // Type right, stage wrong.
    expect(countsAsSpokenTalk({ ...MEMBER_TALK, stage: "speak" })).toBe(false);

    // Stage and type right, no member.
    expect(
      countsAsSpokenTalk({
        stage: "complete",
        assignmentType: "sacrament_talk",
        memberId: null,
      }),
    ).toBe(false);
  });
});
