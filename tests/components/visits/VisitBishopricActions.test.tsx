import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  discussionStatus,
  VisitBishopricActions,
} from "@/app/(app)/visits/VisitBishopricActions";

// The bishopric's two buttons on a visit (ITER-055 bv7): the words, and what each one sends.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }),
}));

// jsdom has no <dialog>: the same minimal shim as AccountMenu.test.tsx.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  refresh.mockReset();
});

const OWNERS = [
  { id: "user-bishop", label: "Mark Andersen (Bishop)", name: "Mark Andersen" },
  { id: "user-first", label: "Peter Nakamura (1st Counselor)", name: "Peter Nakamura" },
];

function renderActions(overrides: Partial<Parameters<typeof VisitBishopricActions>[0]> = {}) {
  return render(
    <VisitBishopricActions
      visitId="visit-1"
      familyName="Ellis"
      discussInBishopric={false}
      bishopricDiscussedAt={null}
      placedOn={null}
      owners={OWNERS}
      currentUserId="user-first"
      {...overrides}
    />,
  );
}

describe("discussionStatus", () => {
  it("says nothing while nobody asked", () => {
    expect(discussionStatus(false, null, null)).toBeNull();
  });

  it("names the agenda the line is on, as a date with no zone shift", () => {
    expect(discussionStatus(true, null, "2026-12-06")).toBe(
      "On the bishopric agenda for Sunday, December 6, 2026",
    );
  });

  it("says it is waiting when no draft carries it", () => {
    expect(discussionStatus(true, null, null)).toBe("Waiting for the next bishopric agenda");
  });

  it("says it was discussed once a published agenda carried it", () => {
    expect(discussionStatus(true, "2026-12-06T20:00:00Z", null)).toBe(
      "Discussed in bishopric meeting",
    );
  });
});

describe("VisitBishopricActions", () => {
  it("asks to discuss, then offers to withdraw, then to discuss again", () => {
    const { rerender } = renderActions();
    expect(screen.getByRole("button", { name: "Discuss in bishopric meeting" })).toBeTruthy();

    rerender(
      <VisitBishopricActions
        visitId="visit-1"
        familyName="Ellis"
        discussInBishopric
        bishopricDiscussedAt={null}
        placedOn={null}
        owners={OWNERS}
        currentUserId="user-first"
      />,
    );
    expect(screen.getByRole("button", { name: "Don't discuss" })).toBeTruthy();

    rerender(
      <VisitBishopricActions
        visitId="visit-1"
        familyName="Ellis"
        discussInBishopric
        bishopricDiscussedAt="2026-12-06T20:00:00Z"
        placedOn={null}
        owners={OWNERS}
        currentUserId="user-first"
      />,
    );
    expect(screen.getByRole("button", { name: "Discuss again" })).toBeTruthy();
  });

  it("'Don't discuss' sends discuss: false", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ placedOn: null }), { status: 200 }));
    renderActions({ discussInBishopric: true });

    fireEvent.click(screen.getByRole("button", { name: "Don't discuss" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/visits/visit-1/discussion",
      expect.objectContaining({ body: JSON.stringify({ discuss: false }) }),
    );
  });

  it("the follow-up window starts on the reader and sends the owner chosen", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ todoId: "todo-1" }), { status: 201 }));
    renderActions();

    fireEvent.click(screen.getByRole("button", { name: "Add a follow-up" }));
    const owner = screen.getByLabelText("For") as HTMLSelectElement;
    expect(owner.value).toBe("user-first");

    fireEvent.change(screen.getByLabelText("What needs following up?"), {
      target: { value: "Ask about the temple trip" },
    });
    fireEvent.change(owner, { target: { value: "user-bishop" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to To Do" }));

    expect(await screen.findByText("Added to Mark Andersen's To Do.")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/visits/visit-1/follow-ups",
      expect.objectContaining({
        body: JSON.stringify({
          ownerUserId: "user-bishop",
          title: "Ask about the temple trip",
          dueDate: null,
        }),
      }),
    );
  });
});
