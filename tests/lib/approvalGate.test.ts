import { describe, expect, it } from "vitest";
import {
  canTransition,
  type PipelineApproval,
  type PipelineAssignment,
} from "@/lib/assignments/pipeline";

// APPROVE requires an approval from EVERY bishopric member (04-talks-pipeline.md §Step 3,
// CLAUDE.md §7: bishopric admin authority is shared). This suite pins the count.
//
// The database also enforces it — assignment_approvals_one_per_user in migration 025 makes each
// row a distinct person, and tests/db/assignment-approvals.test.ts proves that. The pure function
// is tested here anyway: a caller assembles the approval list, and the gate must not be
// satisfiable by handing it a list somebody built wrong.

const BISHOP = "user-bishop";
const FIRST_COUNSELOR = "user-first";
const SECOND_COUNSELOR = "user-second";
const BISHOPRIC = [BISHOP, FIRST_COUNSELOR, SECOND_COUNSELOR];

const IN_REVIEW: PipelineAssignment = {
  stage: "review",
  memberId: "member-1",
  externalSpeakerName: null,
  topicId: "topic-1",
  slotNumber: 1,
  requestOutcome: null,
  notifyMessage: null,
  notifySentAt: null,
  sundayConfirmedAt: null,
  thankYouSentAt: null,
  contactWaivedAt: null,
};

function gate(
  approvals: PipelineApproval[],
  bishopricUserIds: string[] = BISHOPRIC,
  assignment: PipelineAssignment = IN_REVIEW,
) {
  return canTransition("review", "approve", {
    assignment,
    approvals,
    bishopricUserIds,
    actorIsBishopric: true,
  });
}

describe("the three-approval gate", () => {
  it("refuses with none of the three", () => {
    const result = gate([]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Waiting on 3 of 3 approvals.");
  });

  it("refuses with one of the three", () => {
    const result = gate([{ userId: BISHOP, approved: true }]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Waiting on 2 of 3 approvals.");
  });

  it("refuses with two of the three", () => {
    const result = gate([
      { userId: BISHOP, approved: true },
      { userId: FIRST_COUNSELOR, approved: true },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Waiting on 1 of 3 approvals.");
  });

  it("allows with all three", () => {
    const result = gate(BISHOPRIC.map((userId) => ({ userId, approved: true })));

    expect(result.ok).toBe(true);
  });
});

describe("what does not count toward the three", () => {
  // The database constraint makes this row set unwritable. The pure function refuses it anyway,
  // because the gate must be about PEOPLE rather than about rows — otherwise dropping the
  // constraint would silently open the gate.
  it("refuses three rows from one counselor", () => {
    const result = gate([
      { userId: FIRST_COUNSELOR, approved: true },
      { userId: FIRST_COUNSELOR, approved: true },
      { userId: FIRST_COUNSELOR, approved: true },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Waiting on 2 of 3 approvals.");
  });

  it("does not count an approved: false row — a change request is not an approval", () => {
    const result = gate([
      { userId: BISHOP, approved: true },
      { userId: FIRST_COUNSELOR, approved: true },
      { userId: SECOND_COUNSELOR, approved: false },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Waiting on 1 of 3 approvals.");
  });

  it("does not count an approved: null row — an undecided row is not a yes", () => {
    const result = gate([
      { userId: BISHOP, approved: true },
      { userId: FIRST_COUNSELOR, approved: true },
      { userId: SECOND_COUNSELOR, approved: null },
    ]);

    expect(result.ok).toBe(false);
  });

  // Somebody released from the bishopric last month, whose approval row is still on the table.
  it("does not count an approval from somebody no longer in the bishopric", () => {
    const result = gate([
      { userId: BISHOP, approved: true },
      { userId: FIRST_COUNSELOR, approved: true },
      { userId: "user-released-last-month", approved: true },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Waiting on 1 of 3 approvals.");
  });
});

describe("a bishopric that is not three people", () => {
  // A ward mid-reorganization. The gate is "everyone on the roll", not "three" — a hard-coded
  // three would either deadlock this ward or, worse, be relaxed to a count that lets two of three
  // through in a normal one.
  it("needs both of two, not three", () => {
    const twoPerson = [BISHOP, FIRST_COUNSELOR];

    const oneOfTwo = gate([{ userId: BISHOP, approved: true }], twoPerson);
    expect(oneOfTwo.ok).toBe(false);
    if (!oneOfTwo.ok) expect(oneOfTwo.message).toBe("Waiting on 1 of 2 approvals.");

    const twoOfTwo = gate(
      twoPerson.map((userId) => ({ userId, approved: true })),
      twoPerson,
    );
    expect(twoOfTwo.ok).toBe(true);
  });

  it("needs all four when a ward somehow has four", () => {
    const fourPerson = [...BISHOPRIC, "user-fourth"];

    const threeOfFour = gate(
      BISHOPRIC.map((userId) => ({ userId, approved: true })),
      fourPerson,
    );

    expect(threeOfFour.ok).toBe(false);
    if (!threeOfFour.ok) {
      expect(threeOfFour.message).toBe("Waiting on 1 of 4 approvals.");
    }
  });

  // Refusing beats allowing here. An empty roll with a "0 of 0 outstanding" answer would let any
  // assignment walk straight through the one gate the whole phase is built around.
  it("refuses when the ward has no active bishopric at all", () => {
    const result = gate([], []);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/no active bishopric/i);
  });
});

describe("a waiver cannot open the approval gate", () => {
  // The contact waiver satisfies exactly four gates, and this is emphatically not one of them.
  // An external speaker's plan still needs approving.
  it("refuses 0 of 3 even with the contact stages waived", () => {
    const result = gate([], BISHOPRIC, {
      ...IN_REVIEW,
      memberId: null,
      externalSpeakerName: "Mark Andersen",
      contactWaivedAt: "2026-05-01T18:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("Waiting on 3 of 3 approvals.");
  });
});
