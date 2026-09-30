import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TalkRow, type TalkRowProps } from "@/components/sacrament/TalkRow";
import type { Assignment } from "@/lib/assignments/queries";
import type { SessionUser } from "@/types/domain";

// ONE TALK ROW ON THE TOPICS SCREEN (Topics rebuild t3). What is asserted is who is offered what:
// the lines are buttons only with `talks.plan`, Clear appears only when there is something to
// clear, Delete only for somebody who may remove a talk on a Sunday with more than one, and a Clear
// on an approved talk says what it will cost BEFORE it does anything.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

// jsdom has no showModal; the same stub ReferencesEditor.test.tsx uses. Focus trapping and the
// backdrop are the platform's job, which the harness walks.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

const BISHOP: SessionUser = {
  id: "00000000-0000-4000-8000-000000000001",
  wardId: "00000000-0000-4000-8000-000000000002",
  homeWardId: "00000000-0000-4000-8000-000000000002",
  activeWardId: null,
  callingId: "00000000-0000-4000-8000-00000000ca11",
  role: "bishop",
  orgId: null,
  orgType: null,
  counselorPosition: null,
  firstName: "Test",
  lastName: "Bishop",
  username: null,
  themePreference: "system",
  isActive: true,
};

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    id: "talk-1",
    sundayId: "sunday-1",
    memberId: "member-1",
    externalSpeakerName: null,
    externalSpeakerTitle: null,
    assignmentType: "sacrament_talk",
    countsTowardRotation: true,
    topicTitle: "Faith in Jesus Christ",
    slotNumber: 2,
    slotLengthMinutes: 10,
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

function renderRow(overrides: Partial<TalkRowProps> = {}) {
  const props: TalkRowProps = {
    user: BISHOP,
    sundayId: "sunday-1",
    slotNumber: 2,
    totalTalks: 3,
    assignment: assignment(),
    speakerName: "Sarah Bennett",
    ask: { hasSpeaker: true, requestOutcome: null, openAskCount: 1, isOff: false },
    approvedNames: [],
    tellerName: "Peter Nakamura",
    canPlan: true,
    canRemove: true,
    details: { approvals: <p>Approvals</p>, contacting: <p>Contacting</p>, comments: <p>Comments</p> },
    ...overrides,
  };
  return render(<TalkRow {...props} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockReset();
});

describe("TalkRow", () => {
  it("shows the speaker and topic with their tags", () => {
    renderRow();

    expect(screen.getByText("Sarah Bennett")).toBeInTheDocument();
    expect(screen.getByText("Ask sent")).toBeInTheDocument();
    expect(screen.getByText("Faith in Jesus Christ")).toBeInTheDocument();
    expect(screen.getByText("Topic selected")).toBeInTheDocument();
  });

  it("makes each line a button that opens its own window, for a planner", () => {
    renderRow();

    fireEvent.click(screen.getByRole("button", { name: /Topic for talk 2/ }));
    expect(screen.getByRole("dialog", { name: "Change topic" })).toBeInTheDocument();
  });

  // Absent, never disabled.
  it("offers no window, Clear or Delete to somebody without talks.plan", () => {
    renderRow({ canPlan: false, canRemove: false });

    expect(screen.queryByRole("button", { name: /Speaker for talk/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByText("Sarah Bennett")).toBeInTheDocument();
  });

  it("offers Clear only for what is set", () => {
    renderRow({
      assignment: assignment({ topicTitle: null }),
    });

    expect(screen.getByRole("button", { name: /Clear the speaker/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear the topic/ })).not.toBeInTheDocument();
    expect(screen.getByText("No topic yet")).toBeInTheDocument();
    expect(screen.getByText("Needs topic")).toBeInTheDocument();
  });

  it("reads an open slot as nobody and no topic, with no Details, Delete or Clear", () => {
    renderRow({
      assignment: null,
      speakerName: null,
      ask: { hasSpeaker: false, requestOutcome: null, openAskCount: 0, isOff: false },
      details: null,
    });

    expect(screen.getByText("Nobody yet")).toBeInTheDocument();
    expect(screen.getByText("Needs speaker")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Details" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear/ })).not.toBeInTheDocument();
  });

  it("offers no Delete on a Sunday's only talk", () => {
    renderRow({ totalTalks: 1, slotNumber: 1 });

    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("offers no Delete without calendar.manage", () => {
    renderRow({ canRemove: false });

    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
  });

  // The warning arrives before the write, never as a report afterwards.
  it("warns who loses their approval before clearing an approved talk", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderRow({ approvedNames: ["Bishop Hale", "Brother Ames"] });

    fireEvent.click(screen.getByRole("button", { name: /Clear the topic/ }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Bishop Hale and Brother Ames have approved this plan. Clearing this resets their approvals and asks them again.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear and reset approvals/ })).toBeInTheDocument();
  });

  it("clears an unapproved topic straight away", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderRow();

    fireEvent.click(screen.getByRole("button", { name: /Clear the topic/ }));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/assignments/talk-1");
    expect(JSON.parse(String(init.body))).toEqual({
      action: "update",
      fields: { topicTitle: null },
    });
  });

  it("confirms Delete in the row, naming who will let the speaker know", () => {
    renderRow();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = screen.getByRole("group");

    expect(
      within(confirm).getByText(
        "Remove talk 2? Peter Nakamura will be asked to let Sarah Bennett know. Later talks move up.",
      ),
    ).toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: "Remove talk" })).toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: "Keep" })).toBeInTheDocument();
    // In the row, not a second window.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not claim anybody will be told when nobody was asked", () => {
    renderRow({
      ask: { hasSpeaker: true, requestOutcome: null, openAskCount: 0, isOff: false },
      tellerName: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByText("Remove talk 2? Later talks move up.")).toBeInTheDocument();
  });

  it("sends the remove action", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ removed: {}, warning: null }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderRow();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove talk" }));

    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ action: "remove" });
  });
});
