import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallingReview } from "@/app/(app)/admin/users/CallingReview";
import type { CallingReviewRow } from "@/lib/callings/callingReview";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// Walking scenario 103b found two ways the review misreported an Apply: rows it had just applied
// stayed on screen until the refresh landed (D3), and a refresh that emptied the review would
// have removed its own "Applied …" result with it (D2).

const ACTOR_ID = "00000000-0000-4000-8000-000000000001";

function reviewRow(id: string, name: string, kind: CallingReviewRow["kind"]): CallingReviewRow {
  return {
    id,
    kind,
    userId: `user-${id}`,
    memberId: "member-1",
    accountName: name,
    memberName: name,
    callingId: `calling-${id}`,
    current: null,
    currentLabel: null,
    target: null,
    sentence: `${name}: a change.`,
    details: [],
    defaultSelected: false,
    canApply: true,
    refusal: null,
  };
}

const RELEASE = reviewRow("release:paul", "Paul Grant", "release");
const CHANGE = reviewRow("calling:tom:president", "Tom Reyes", "change");

function respondWith(body: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => body } as Response);
}

function renderReview(rows: CallingReviewRow[]) {
  return render(<CallingReview rows={rows} actorUserId={ACTOR_ID} actorIsSuperAdmin={false} />);
}

describe("CallingReview after Apply", () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders nothing when there is nothing to review", () => {
    const { container } = renderReview([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("hides an applied row at once and keeps the others", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ applied: [{ id: RELEASE.id, summary: "Paul Grant: released" }], refused: [], stale: 0 }),
    );
    renderReview([RELEASE, CHANGE]);

    fireEvent.click(screen.getByRole("checkbox", { name: /Paul Grant/ }));
    fireEvent.click(screen.getByRole("button", { name: /Apply ticked \(1\)/ }));

    expect(await screen.findByText("Applied 1 calling change.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Paul Grant/ })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Tom Reyes/ })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps a refused row on screen with its reason", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ applied: [], refused: [{ id: CHANGE.id, sentence: "It was refused." }], stale: 0 }),
    );
    renderReview([CHANGE]);

    fireEvent.click(screen.getByRole("checkbox", { name: /Tom Reyes/ }));
    fireEvent.click(screen.getByRole("button", { name: /Apply ticked \(1\)/ }));

    expect(await screen.findByText(/Not applied — Tom Reyes: a change\. It was refused\./)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Tom Reyes/ })).toBeInTheDocument();
  });

  it("keeps the result when applying empties the review", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ applied: [{ id: RELEASE.id, summary: "Paul Grant: released" }], refused: [], stale: 0 }),
    );
    const { rerender } = renderReview([RELEASE]);

    fireEvent.click(screen.getByRole("checkbox", { name: /Paul Grant/ }));
    fireEvent.click(screen.getByRole("button", { name: /Apply ticked \(1\)/ }));
    expect(await screen.findByText("Applied 1 calling change.")).toBeInTheDocument();

    rerender(<CallingReview rows={[]} actorUserId={ACTOR_ID} actorIsSuperAdmin={false} />);

    expect(screen.getByText("Applied 1 calling change.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
