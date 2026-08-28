// @vitest-environment jsdom
//
// CoverageBadge — guarded as a PAIR, deliberately.
//
// ---------------------------------------------------------------------------
// WHY BOTH HALVES HAVE TO BE HERE
// ---------------------------------------------------------------------------
// `not_expected` must render NOTHING: a badge on a cancelled game saying "not expected" is noise
// on the one row that already carries a "Cancelled" chip explaining itself.
//
// But a suite asserting only that would make "delete the badge entirely" a passing fix for an
// over-eager one. That is the youth-b all-day lesson — a marker whose absence is correct in one
// case and a defect in every other needs both directions pinned, or the wrong repair looks green.
// So every other state asserts its label as well.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CoverageBadge } from "@/components/youth/CoverageBadge";
import type { EventCoverage } from "@/lib/youth/coverage";
import { COVERAGE_STATES, COVERAGE_STATE_LABELS, type CoverageState } from "@/types/domain";

function coverage(state: CoverageState, attendeeCount = 0): EventCoverage {
  return { state, daysUntil: state === "not_expected" ? null : 3, attendeeCount };
}

describe("CoverageBadge", () => {
  it("renders nothing at all for not_expected", () => {
    const { container } = render(<CoverageBadge coverage={coverage("not_expected")} />);

    expect(container).toBeEmptyDOMElement();
  });

  it.each(COVERAGE_STATES.filter((state) => state !== "not_expected"))(
    "renders the label for %s",
    (state) => {
      render(<CoverageBadge coverage={coverage(state)} />);

      expect(screen.getByText(new RegExp(COVERAGE_STATE_LABELS[state]))).toBeTruthy();
    },
  );

  // The word is always there beside the colour. Six states in six hues separate them only for
  // somebody who can see all six, which is the rule every badge in this app follows.
  it("renders a non-empty label for every state that renders at all", () => {
    for (const state of COVERAGE_STATES) {
      if (state === "not_expected") continue;
      expect(COVERAGE_STATE_LABELS[state]).not.toBe("");
    }
  });

  it("carries the attendee count on a covered event", () => {
    render(<CoverageBadge coverage={coverage("covered", 3)} />);

    expect(screen.getByText(/Covered · 3/)).toBeTruthy();
  });

  // The count is zero on every other state, so repeating it would say the same thing twice.
  it("does not carry a count on an uncovered event", () => {
    render(<CoverageBadge coverage={coverage("uncovered")} />);

    expect(screen.getByText("Nobody going")).toBeTruthy();
  });
});
