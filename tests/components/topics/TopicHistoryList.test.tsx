import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TopicHistoryList } from "@/app/(app)/talks/topics/TopicHistoryList";
import type { TopicHistoryEntry } from "@/lib/topics/topicHistory";

// THE TOPIC HISTORY'S "Show the last N months" (the user's decision walking scenario 084): six by
// default, wider or narrower on request, anything already planned always shown, and remembered with
// the sort.

const TODAY = "2026-09-29";

function entry(assignmentId: string, date: string, topicTitle: string, isUpcoming = false): TopicHistoryEntry {
  return { assignmentId, sundayId: `s-${assignmentId}`, date, topicTitle, speakerName: null, isUpcoming };
}

const ENTRIES = [
  entry("ahead", "2026-11-08", "Faith in Jesus Christ", true),
  entry("recent", "2026-07-26", "Service"),
  entry("older", "2026-01-25", "Faith and works"),
  entry("oldest", "2023-09-24", "Hope in Christ"),
];

const topics = () =>
  screen.getAllByRole("listitem").map((item) => item.querySelector("span.font-medium")?.firstChild?.textContent);

afterEach(() => vi.unstubAllGlobals());

describe("TopicHistoryList — how far back", () => {
  it("shows the last six months and anything planned, by default", () => {
    render(<TopicHistoryList entries={ENTRIES} initialView={{ sort: "date_desc", months: 6 }} today={TODAY} />);

    expect(topics()).toEqual(["Faith in Jesus Christ", "Service"]);
    expect(screen.getByLabelText("Show the last")).toHaveValue(6);
  });

  it("reaches further back when asked, and remembers it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<TopicHistoryList entries={ENTRIES} initialView={{ sort: "date_desc", months: 6 }} today={TODAY} />);

    fireEvent.change(screen.getByLabelText("Show the last"), { target: { value: "48" } });
    fireEvent.click(screen.getByRole("button", { name: "Show" }));

    expect(topics()).toEqual(["Faith in Jesus Christ", "Service", "Faith and works", "Hope in Christ"]);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      page: "topic_history",
      view: { sort: "date_desc", months: 48 },
    });
  });

  it("refuses a number it cannot use, and keeps the list as it was", () => {
    render(<TopicHistoryList entries={ENTRIES} initialView={{ sort: "date_desc", months: 6 }} today={TODAY} />);

    // Submitted directly: a browser's own min/max check would stop the button first, and this is
    // the handler's answer for whatever gets past it.
    fireEvent.change(screen.getByLabelText("Show the last"), { target: { value: "0" } });
    fireEvent.submit(screen.getByLabelText("Show the last").closest("form")!);

    expect(screen.getByText("Enter a whole number of months, from 1 to 600.")).toBeInTheDocument();
    expect(topics()).toEqual(["Faith in Jesus Christ", "Service"]);
  });

  it("says when the window holds nothing yet", () => {
    render(
      <TopicHistoryList
        entries={[entry("oldest", "2023-09-24", "Hope in Christ")]}
        initialView={{ sort: "date_desc", months: 6 }}
        today={TODAY}
      />,
    );

    expect(
      screen.getByText("No topics in the last 6 months. Show more months to look further back."),
    ).toBeInTheDocument();
  });
});
