import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StageBadge } from "@/components/assignments/StageBadge";
import { PIPELINE_STAGES, PIPELINE_STAGE_LABELS } from "@/types/domain";

// Driven off PIPELINE_STAGES rather than a hand-written list of nine, so a tenth stage added to
// the enum fails HERE until somebody decides what it is called and what colour it carries. A
// literal list would quietly keep passing while the new stage rendered as nothing.
//
// Colour token VALUES are not asserted — a hex is not a behaviour, and the contrast numbers live
// in app/globals.css where they were measured. What is asserted is that each stage carries its
// own class, because a template string like `text-stage-${stage}` compiles fine and produces no
// CSS at all.

describe("StageBadge", () => {
  it("renders the label for every stage in the pipeline", () => {
    for (const stage of PIPELINE_STAGES) {
      const { unmount } = render(<StageBadge stage={stage} />);

      expect(screen.getByText(PIPELINE_STAGE_LABELS[stage])).toBeInTheDocument();
      unmount();
    }
  });

  it("gives every stage its own colour token class", () => {
    for (const stage of PIPELINE_STAGES) {
      const { unmount } = render(<StageBadge stage={stage} />);

      expect(screen.getByText(PIPELINE_STAGE_LABELS[stage])).toHaveClass(
        `text-stage-${stage}`,
      );
      unmount();
    }
  });

  // Colour is never the only signal. Somebody who cannot tell request from confirm still reads
  // the same badge, because the words are always there.
  it("never relies on colour alone — the label is always text", () => {
    render(<StageBadge stage="complete" />);

    expect(screen.getByText("Complete")).toBeInTheDocument();
  });

  it("uses distinct labels across the nine stages", () => {
    const labels = PIPELINE_STAGES.map((stage) => PIPELINE_STAGE_LABELS[stage]);

    expect(new Set(labels).size).toBe(PIPELINE_STAGES.length);
  });
});
