import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SpeakerWindow, type SpeakerWindowProps } from "@/components/sacrament/SpeakerWindow";
import type { SpeakerHistoryRow } from "@/lib/assignments/queries";

// THE SPEAKER WINDOW (Topics rebuild t4): who to ask next, History for the bishopric, and a name the
// roster does not have becoming an outside speaker.

// jsdom has no showModal; the same stub ReferencesEditor.test.tsx uses.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

const MEMBERS = [
  { id: "maria", firstName: "Maria", lastName: "Lopez", category: "adult" as const },
  { id: "tomas", firstName: "Tomas", lastName: "Reyes", category: "adult" as const },
  { id: "ana", firstName: "Ana", lastName: "Silva", category: "adult" as const },
  { id: "eli", firstName: "Eli", lastName: "Young", category: "youth" as const },
];

function row(overrides: Partial<SpeakerHistoryRow>): SpeakerHistoryRow {
  return {
    id: "h",
    memberId: "maria",
    assignmentId: null,
    assignmentType: "sacrament_talk",
    topicTitle: null,
    notes: null,
    declineReason: null,
    createdAt: "2026-01-01T00:00:00Z",
    outcome: "completed",
    cancellationDaysNotice: null,
    sundayDate: "2026-01-04",
    ...overrides,
  };
}

const HISTORY: Record<string, SpeakerHistoryRow[]> = {
  maria: [row({ id: "m1", topicTitle: "Faith in Jesus Christ", sundayDate: "2026-07-05" })],
  tomas: [
    row({ id: "t1", memberId: "tomas", topicTitle: "Gratitude", sundayDate: "2023-06-04" }),
    row({ id: "t2", memberId: "tomas", outcome: "declined", declineReason: "not_available", sundayDate: "2026-03-01" }),
    row({ id: "t3", memberId: "tomas", outcome: "declined", declineReason: "other", notes: "Travelling", sundayDate: "2026-05-03" }),
  ],
};

function renderWindow(overrides: Partial<SpeakerWindowProps> = {}) {
  const props: SpeakerWindowProps = {
    sundayId: "sunday-1",
    slotNumber: 2,
    totalTalks: 3,
    assignment: null,
    speakerName: null,
    approvedNames: [],
    changeWarning: null,
    members: MEMBERS,
    historyByMember: HISTORY,
    today: "2026-09-29",
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  return render(<SpeakerWindow {...props} />);
}

const listNames = () =>
  within(screen.getByRole("list", { name: /longest since speaking/ }))
    .getAllByRole("listitem")
    .map((item) => item.querySelector("button span")?.textContent);

afterEach(() => vi.unstubAllGlobals());

describe("SpeakerWindow", () => {
  it("lists adults who have never spoken first, then the longest since speaking", () => {
    renderWindow();

    expect(listNames()).toEqual(["Ana Silva", "Tomas Reyes", "Maria Lopez"]);
    expect(screen.getByText("Never spoken")).toBeInTheDocument();
    expect(screen.getByText("last spoke 3 years ago")).toBeInTheDocument();
    expect(screen.getByText("last spoke 3 months ago")).toBeInTheDocument();
  });

  it("lists the youth for a youth speaker", () => {
    renderWindow();
    fireEvent.change(screen.getByLabelText("Kind of talk"), { target: { value: "youth_speaker" } });

    expect(listNames()).toEqual(["Eli Young"]);
  });

  it("is alphabetical, with no History and no last-spoke line, without history", () => {
    renderWindow({ historyByMember: null });

    expect(listNames()).toEqual(["Maria Lopez", "Tomas Reyes", "Ana Silva"]);
    expect(screen.queryByRole("button", { name: /^History/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Never spoken")).not.toBeInTheDocument();
  });

  it("offers a typed name as an outside speaker only once something is typed", () => {
    renderWindow();
    expect(screen.queryByRole("button", { name: /as typed/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Speaker"), { target: { value: "President Hale" } });

    expect(
      screen.getByRole("button", { name: "Can't find them? Use “President Hale” as typed" }),
    ).toBeInTheDocument();
  });

  it("saves a typed name as an outside speaker, with its title", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    renderWindow({ onSaved });

    fireEvent.change(screen.getByLabelText("Speaker"), { target: { value: "Mark Hale" } });
    fireEvent.click(screen.getByRole("button", { name: /as typed/ }));
    expect(screen.getByText("Mark Hale")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title (optional)"), { target: { value: "President" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/assignments");
    expect(JSON.parse(String(init.body))).toMatchObject({
      sundayId: "sunday-1",
      slotNumber: 2,
      memberId: null,
      externalSpeaker: { name: "Mark Hale", title: "President" },
    });
  });

  it("chooses a member from the list, and the chip's ✕ puts the list back", () => {
    renderWindow();

    fireEvent.click(screen.getByRole("button", { name: /^Ana Silva/ }));
    expect(screen.getByRole("button", { name: "Remove Ana Silva" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /longest since speaking/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Ana Silva" }));
    expect(screen.getByRole("list", { name: /longest since speaking/ })).toBeInTheDocument();
  });

  // Modal does not stack: History replaces the list inside the same window.
  it("shows History in place of the list, with a way back, and no second window", () => {
    renderWindow();

    fireEvent.click(screen.getByRole("button", { name: "History for Tomas Reyes" }));

    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    expect(screen.getByText("Speaking history — 1 talk")).toBeInTheDocument();
    expect(screen.getByText("Gratitude")).toBeInTheDocument();
    expect(screen.getByText("Declined asks — 2, for pattern-spotting")).toBeInTheDocument();
    expect(screen.getByText("Travelling")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: /longest since speaking/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← Back to the list" }));
    expect(screen.getByRole("list", { name: /longest since speaking/ })).toBeInTheDocument();
  });

  it("says so for somebody with no history", () => {
    renderWindow();
    fireEvent.click(screen.getByRole("button", { name: "History for Ana Silva" }));

    expect(screen.getByText("No talks on record yet.")).toBeInTheDocument();
  });
});
