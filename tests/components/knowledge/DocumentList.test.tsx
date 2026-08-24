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
