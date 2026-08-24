// The delete confirm is worded by consequence, so its numbers carry the whole warning: a
// bishopric decides from the passage count whether this is the document they meant. The plural
// branch shipped unconditional and read "all 1 of its passages" for a single-passage document —
// found walking scenario 022, where every uploaded fixture chunked to exactly one passage. The
// seeded six-passage letter that step 8 deletes is the one case that hides it, which is why no
// server test caught it.
//
// window.confirm is stubbed rather than driven: it is the browser's, and what needs locking down
// is the sentence handed to it, not that jsdom can raise a dialog.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentList } from "@/app/(app)/knowledge/DocumentList";
import type { KnowledgeDocument } from "@/types/domain";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function documentWith(chunkCount: number, embeddedCount = chunkCount): KnowledgeDocument {
  return {
    id: "00000000-0000-4000-8000-0000000000d1",
    title: "The Weight of Small Covenants",
    typeTag: "other",
    status: "active",
    fileUrl: null,
    // An "other" document, so all three are null and the "Not filterable" badge must NOT appear —
    // that badge is for conference talks alone. See the conference fixture in this file.
    speaker: null,
    speakerRole: null,
    conferenceDate: null,
    uploadedBy: "00000000-0000-4000-8000-000000000001",
    uploadedByName: "Mark Andersen",
    uploadedAt: "2026-08-23T00:00:00.000Z",
    chunkCount,
    embeddedCount,
  };
}

// Unmounts first: called more than once inside a single test, a second render would leave two
// "Delete" buttons in the document and getByRole would refuse the ambiguity.
function confirmTextWhenDeleting(document: KnowledgeDocument): string {
  cleanup();
  // mockClear, because spyOn returns the SAME spy on a second call and its history would carry
  // the previous iteration's call over.
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  confirmSpy.mockClear();

  render(<DocumentList initialDocuments={[document]} canManage />);
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));

  expect(confirmSpy).toHaveBeenCalledOnce();
  return confirmSpy.mock.calls[0][0] as string;
}

describe("DocumentList delete confirm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("says 'its one passage' for a single-passage document, never 'all 1 of'", () => {
    const text = confirmTextWhenDeleting(documentWith(1));

    expect(text).toContain("removes the document and its one passage.");
    expect(text).not.toContain("all 1 of");
  });

  it("counts the passages when there is more than one", () => {
    const text = confirmTextWhenDeleting(documentWith(6, 5));

    expect(text).toContain("removes the document and all 6 of its passages.");
  });

  it("names the document and keeps the drafts caveat in both cases", () => {
    for (const chunkCount of [1, 6]) {
      const text = confirmTextWhenDeleting(documentWith(chunkCount));

      expect(text).toContain('Deleting "The Weight of Small Covenants"');
      expect(text).toContain("Drafts already written are not affected.");
    }
  });

  it("does not delete when the confirm is dismissed", () => {
    confirmTextWhenDeleting(documentWith(1));

    expect(fetch).not.toHaveBeenCalled();
  });
});

// Walking scenario 022 at 375px settled both of these. Status was a word inside a grey metadata
// run at the same size as the uploader's name; Delete sat beside Deactivate at equal weight, one
// mis-tap from a destructive action.
describe("DocumentList row presentation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("gives status its own badge instead of burying it in the metadata line", () => {
    render(<DocumentList initialDocuments={[documentWith(4)]} canManage />);

    const badge = screen.getByText("Active");

    // A badge, not a run of text: its own element, not a fragment of the metadata sentence.
    expect(badge.tagName).toBe("SPAN");
    expect(badge.className).toContain("rounded-full");
  });

  it("says the status exactly once, so the badge did not simply duplicate the metadata", () => {
    render(<DocumentList initialDocuments={[documentWith(4)]} canManage />);

    expect(screen.getAllByText("Active")).toHaveLength(1);
  });

  it("labels an inactive document by its word, not by colour alone", () => {
    const inactive = { ...documentWith(4), status: "inactive" as const };
    render(<DocumentList initialDocuments={[inactive]} canManage />);

    expect(screen.getByText("Inactive")).toBeInTheDocument();
  });

  // jsdom does not implement <details> hiding, so getByRole would still find the button and an
  // assertion phrased as "not visible" would pass for the wrong reason. Asserting the STRUCTURE
  // is the honest version: Delete is inside a closed disclosure, so reaching it takes a
  // deliberate second action.
  it("keeps Delete inside a closed disclosure while Deactivate stays one tap away", () => {
    const { container } = render(
      <DocumentList initialDocuments={[documentWith(4)]} canManage />,
    );

    const disclosure = container.querySelector("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");

    const deleteButton = screen.getByRole("button", { name: "Delete" });
    expect(disclosure).toContainElement(deleteButton);

    const deactivate = screen.getByRole("button", { name: "Deactivate" });
    expect(disclosure).not.toContainElement(deactivate);
  });

  it("shows no controls at all when the reader cannot manage the corpus", () => {
    const { container } = render(
      <DocumentList initialDocuments={[documentWith(4)]} canManage={false} />,
    );

    expect(container.querySelector("details")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
