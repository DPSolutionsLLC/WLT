import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TopicWindow, type TopicWindowProps } from "@/components/sacrament/TopicWindow";
import type { TopicHistoryEntry } from "@/lib/topics/topicHistory";

// THE TOPIC WINDOW (Topics rebuild t5): the "Used before" hint while typing, Check topic, and AI
// suggestions that fill the box and are never saved until Save.

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

const TODAY = "2026-09-29";

function entry(overrides: Partial<TopicHistoryEntry>): TopicHistoryEntry {
  return {
    assignmentId: "a",
    sundayId: "s",
    date: "2026-07-26",
    topicTitle: "Faith in Jesus Christ",
    speakerName: "Maria Lopez",
    isUpcoming: false,
    ...overrides,
  };
}

const HISTORY = [
  entry({ assignmentId: "recent", date: "2026-07-26", topicTitle: "Faith in Jesus Christ" }),
  entry({ assignmentId: "older", date: "2025-01-26", topicTitle: "faith in jesus christ" }),
  entry({ assignmentId: "works", date: "2026-01-25", topicTitle: "Faith and works" }),
  entry({ assignmentId: "ahead", date: "2026-11-08", topicTitle: "Faith in every footstep", isUpcoming: true }),
  entry({ assignmentId: "grat", date: "2025-07-27", topicTitle: "Gratitude" }),
];

function renderWindow(overrides: Partial<TopicWindowProps> = {}) {
  const props: TopicWindowProps = {
    sundayId: "sunday-1",
    slotNumber: 1,
    totalTalks: 3,
    assignment: null,
    approvedNames: [],
    history: HISTORY,
    today: TODAY,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  return render(<TopicWindow {...props} />);
}

const topicBox = () => screen.getByLabelText("Topic");

afterEach(() => vi.unstubAllGlobals());

describe("TopicWindow — Used before", () => {
  it("shows nothing under two characters", () => {
    renderWindow();
    fireEvent.change(topicBox(), { target: { value: "f" } });

    expect(screen.queryByText("Used before, most recent first")).not.toBeInTheDocument();
  });

  it("lists similar topics once each, newest first, with coming up marked", () => {
    renderWindow();
    fireEvent.change(topicBox(), { target: { value: "fai" } });

    const hint = screen.getByText("Used before, most recent first").closest("div")!;
    const lines = within(hint).getAllByRole("listitem").map((item) => item.textContent);
    expect(lines).toEqual([
      "“Faith in every footstep” — coming up Sunday, November 8, 2026",
      "“Faith in Jesus Christ” — 2 months ago",
      "“Faith and works” — 8 months ago",
    ]);
  });

  it("offers no hint and no Check topic without the history", () => {
    renderWindow({ history: null });
    fireEvent.change(topicBox(), { target: { value: "faith" } });

    expect(screen.queryByText("Used before, most recent first")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check topic" })).not.toBeInTheDocument();
  });
});

describe("TopicWindow — Check topic", () => {
  it("is disabled while the box is blank", () => {
    renderWindow();
    expect(screen.getByRole("button", { name: "Check topic" })).toBeDisabled();
  });

  it("says when nothing similar has been used", () => {
    renderWindow();
    fireEvent.change(topicBox(), { target: { value: "Service" } });
    fireEvent.click(screen.getByRole("button", { name: "Check topic" }));

    expect(screen.getByText("No similar topic found in the ward's history.")).toBeInTheDocument();
  });

  it("names the most recent similar topic", () => {
    renderWindow();
    fireEvent.change(topicBox(), { target: { value: "works" } });
    fireEvent.click(screen.getByRole("button", { name: "Check topic" }));

    expect(
      screen.getByText("Similar topic “Faith and works” was used 8 months ago."),
    ).toBeInTheDocument();
  });

  // The user's decision walking scenario 084: look back one year. Gratitude was 14 months ago.
  it("looks back one year and no further", () => {
    renderWindow();
    fireEvent.change(topicBox(), { target: { value: "gratitude" } });

    expect(screen.queryByText("Used before, most recent first")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check topic" }));
    expect(screen.getByText("No similar topic found in the ward's history.")).toBeInTheDocument();
  });

  it("says when a similar topic is already planned", () => {
    renderWindow();
    fireEvent.change(topicBox(), { target: { value: "Faith" } });
    fireEvent.click(screen.getByRole("button", { name: "Check topic" }));

    expect(
      screen.getByText(
        "Similar topic “Faith in every footstep” is already planned for Sunday, November 8, 2026.",
      ),
    ).toBeInTheDocument();
  });
});

describe("TopicWindow — Suggest topics", () => {
  function stubIdeas(...batches: string[][]) {
    const fetchMock = vi.fn();
    for (const titles of batches) {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ suggestions: titles.map((title) => ({ title, why: `Why ${title}.` })) }),
          { status: 200 },
        ),
      );
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("fills the box with a tapped idea and saves nothing", async () => {
    const fetchMock = stubIdeas(["Ministering one by one", "Covenant belonging"]);
    const onSaved = vi.fn();
    renderWindow({ onSaved });

    fireEvent.click(screen.getByRole("button", { name: "Suggest topics" }));
    expect(
      screen.getByText("Suggestions are drafts. Nothing is saved until you press Save."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Add context to steer the suggestions (optional)"), {
      target: { value: "young families" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Get suggestions" }));
    fireEvent.click(await screen.findByRole("button", { name: /Covenant belonging/ }));

    expect(topicBox()).toHaveValue("Covenant belonging");
    expect(onSaved).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/assignments/topic-suggestions");
    expect(JSON.parse(String(init.body))).toEqual({
      sundayId: "sunday-1",
      context: "young families",
      alreadyOffered: [],
    });
  });

  it("adds more ideas, telling the route what it already offered", async () => {
    const fetchMock = stubIdeas(["Ministering"], ["Covenants"]);
    renderWindow();

    fireEvent.click(screen.getByRole("button", { name: "Suggest topics" }));
    fireEvent.click(screen.getByRole("button", { name: "Get suggestions" }));
    fireEvent.click(await screen.findByRole("button", { name: "More suggestions" }));
    await screen.findByRole("button", { name: /Covenants/ });

    expect(screen.getByRole("button", { name: /Ministering/ })).toBeInTheDocument();
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).alreadyOffered).toEqual(["Ministering"]);
  });

  it("shows the route's sentence when suggesting fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "The AI service is busy. Wait a moment and try again — nothing was lost." }), {
          status: 429,
        }),
      ),
    );
    renderWindow();

    fireEvent.click(screen.getByRole("button", { name: "Suggest topics" }));
    fireEvent.click(screen.getByRole("button", { name: "Get suggestions" }));

    expect(await screen.findByText(/The AI service is busy/)).toBeInTheDocument();
  });
});
