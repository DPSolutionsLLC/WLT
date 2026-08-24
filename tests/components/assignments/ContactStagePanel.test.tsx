import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContactStagePanel } from "@/app/(app)/assignments/ContactStagePanel";
import type { Assignment } from "@/lib/assignments/queries";

// THE ITER-004 ASSERTION.
//
// The failure this exists to prevent is a pipeline sitting in a stuck state waiting on a
// confirmation that was never going to arrive — an external speaker whose contact stages nobody
// was ever going to do. The fix has two halves, and only one of them is testable by a unit test:
// the waiver is RECORDED (talks-a proved that), and the waived stages READ as not applicable
// rather than as unfinished work. This is that second half.
//
// A disabled button is the specific thing being ruled out. Disabled reads as "this is coming
// soon"; the whole point is that it is not coming at all.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

// The words that make something look like an outstanding task. If any of these reaches a waived
// panel, the feature has failed even though every stage transition still works.
const OUTSTANDING_TASK_WORDS = [
  /not started/i,
  /pending/i,
  /waiting/i,
  /outstanding/i,
  /to do/i,
  /awaiting/i,
];

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: "assignment-1",
    sundayId: "sunday-1",
    memberId: null,
    externalSpeakerName: "Mark Andersen",
    externalSpeakerTitle: "President",
    assignmentType: "sacrament_talk",
    countsTowardRotation: true,
    topicId: null,
    slotNumber: 2,
    slotLengthMinutes: 12,
    stage: "approve",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPanel(row: Assignment, comments: readonly string[] = []) {
  return render(
    <ContactStagePanel
      assignment={row}
      sundayDate="2026-04-12"
      speakerFirstName="Mark"
      speakerPhone={null}
      topicTitle="Faith in Jesus Christ"
      suggestedScriptures={["Alma 32:21"]}
      assignmentComments={comments}
      waivedByName="Peter Nakamura"
      requestedByName={null}
      canPlan
      canRequest
      canConfirm
    />,
  );
}

const WAIVED = assignment({
  contactWaivedAt: "2026-03-02T17:30:00.000Z",
  contactWaivedBy: "user-1",
});

describe("ContactStagePanel — a waived external speaker", () => {
  it("reads as not applicable, with the reason", () => {
    renderPanel(WAIVED);

    expect(
      screen.getAllByText(/Not applicable — invited outside the ward/).length,
    ).toBeGreaterThan(0);
  });

  it("names who recorded the waiver and when", () => {
    renderPanel(WAIVED);

    expect(screen.getByText(/Peter Nakamura/)).toBeInTheDocument();
    expect(screen.getByText(/March 2, 2026/)).toBeInTheDocument();
  });

  // The four stages a waiver covers. `speak` is deliberately absent — whether the meeting
  // happened is a fact about the meeting, not about who spoke in it (talks-a).
  it("marks all four contact stages, not only the first", () => {
    renderPanel(WAIVED);

    for (const label of ["Requested", "Confirmed", "Notified", "Appreciation"]) {
      expect(
        screen.getByText(
          new RegExp(`${label}: Not applicable — invited outside the ward`),
        ),
      ).toBeInTheDocument();
    }
  });

  // The assertion this whole file exists for.
  it("renders no disabled action anywhere", () => {
    renderPanel(WAIVED);

    for (const button of screen.queryAllByRole("button")) {
      expect(button).not.toBeDisabled();
    }
  });

  it("contains none of the outstanding-task wording", () => {
    const { container } = renderPanel(WAIVED);
    const text = container.textContent ?? "";

    for (const pattern of OUTSTANDING_TASK_WORDS) {
      expect(text, `a waived panel must not say ${pattern}`).not.toMatch(pattern);
    }
  });

  // A waiver is a fact about the assignment, not a transition. Every step after it is still
  // somebody's explicit decision (04-talks-pipeline.md §Step 1).
  it("still offers the explicit next transition", () => {
    renderPanel(WAIVED);

    expect(screen.getByRole("button", { name: /Move to Requested/ })).toBeInTheDocument();
  });

  it("no longer offers the waiver once it is set", () => {
    renderPanel(WAIVED);

    expect(screen.queryByRole("button", { name: /Mark not applicable/ })).toBeNull();
  });
});

describe("ContactStagePanel — an external speaker not yet waived", () => {
  it("offers the waiver with a one-line explanation of what it does", () => {
    renderPanel(assignment());

    expect(
      screen.getByRole("button", { name: /Mark not applicable/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not move the assignment on/)).toBeInTheDocument();
  });

  it("does not yet claim anything is not applicable", () => {
    renderPanel(assignment());

    expect(screen.queryByText(/Not applicable/)).toBeNull();
  });
});

describe("ContactStagePanel — a ward member", () => {
  const MEMBER = assignment({
    memberId: "member-1",
    externalSpeakerName: null,
    externalSpeakerTitle: null,
  });

  // The waiver is external-only at three layers: the assignments_waiver_external_only CHECK,
  // the route's 409, and here. A control the database would refuse must not be on screen.
  it("never offers the waiver control", () => {
    renderPanel(MEMBER);

    expect(screen.queryByRole("button", { name: /Mark not applicable/ })).toBeNull();
  });

  it("shows the real contact stages instead", () => {
    renderPanel(MEMBER);

    expect(screen.queryByText(/Not applicable/)).toBeNull();
    expect(screen.getAllByText(/Not started/).length).toBeGreaterThan(0);
  });
});

// A thank-you built from nothing is a form letter, and by the appreciate stage somebody has
// almost certainly thanked the speaker in person. The product decision (2026-08-24, from the
// scenario 025 walk) is that no message is better than a generic one — so the whole drafting
// surface is absent rather than pre-filled with something nobody would send.
describe("ContactStagePanel — the appreciate stage with nothing recorded", () => {
  const APPRECIATE = assignment({
    memberId: "member-1",
    externalSpeakerName: null,
    externalSpeakerTitle: null,
    stage: "appreciate",
  });

  it("says there is nothing specific to write", () => {
    renderPanel(APPRECIATE, []);

    expect(screen.getByText(/nothing specific to write/i)).toBeInTheDocument();
    expect(screen.getByText(/in-person thank-you is probably enough/i)).toBeInTheDocument();
  });

  it("offers no textarea and no AI button", () => {
    renderPanel(APPRECIATE, []);

    expect(screen.queryByLabelText(/Thank-you message/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Draft the thank-you with AI/ })).toBeNull();
  });

  // The stage still completes. The thanking may well have happened, just not here.
  it("still lets the stage be marked done", () => {
    renderPanel(APPRECIATE, []);

    expect(
      screen.getByRole("button", { name: /Mark the thank-you as sent/ }),
    ).toBeInTheDocument();
  });

  it("says what would make a draft possible", () => {
    renderPanel(APPRECIATE, []);

    expect(screen.getByText(/Add a comment on this assignment/i)).toBeInTheDocument();
  });

  // Nothing here may read as an outstanding task — same rule the waiver follows. "There is
  // nothing to say" is a finished state, not a pending one.
  it("renders no disabled action", () => {
    renderPanel(APPRECIATE, []);

    for (const button of screen.queryAllByRole("button")) {
      expect(button).not.toBeDisabled();
    }
  });

  it("shows the drafting surface as soon as one comment exists", () => {
    renderPanel(APPRECIATE, ["The room went completely quiet."]);

    expect(screen.getByLabelText(/Thank-you message/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Draft the thank-you with AI/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nothing specific to write/i)).toBeNull();
  });

  // An already-approved message was written when there WAS something to say. It must not vanish
  // because the comments were later removed.
  it("keeps an approved message even with no comments left", () => {
    renderPanel(
      assignment({
        memberId: "member-1",
        externalSpeakerName: null,
        externalSpeakerTitle: null,
        stage: "appreciate",
        thankYouMessage: "Thank you for the talk you gave.",
      }),
      [],
    );

    expect(screen.getByLabelText(/Thank-you message/)).toBeInTheDocument();
    expect(screen.queryByText(/nothing specific to write/i)).toBeNull();
  });
});
