import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SundayCell } from "@/components/calendar/SundayCell";
import type { Sunday } from "@/lib/calendar/queries";
import type { SundayType } from "@/types/domain";

// The cell is the one component in this phase that Phase 4 has to build on without changing its
// layout, so the assertions here are mostly about its CONTRACT: what it refuses to render, and
// that the three reserved regions really do accept content.
//
// Colour token values are deliberately not asserted. A hex is not a behaviour — contrast is
// checked by eye in both themes in scenario 010.

const BISHOP_ID = "00000000-0000-4000-8000-000000000001";
const CONDUCTING_NAMES = { [BISHOP_ID]: "Mark Andersen" };

function sunday(overrides: Partial<Sunday> = {}): Sunday {
  return {
    id: "sunday-1",
    date: "2026-03-08",
    type: "standard",
    notes: null,
    conductingUserId: BISHOP_ID,
    speakingSlots: 3,
    slotConfig: null,
    presidingOverride: null,
    fastSundayPinned: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("SundayCell type badge", () => {
  // Badging the default state is noise on the 46 ordinary Sundays a year and drowns out the 6
  // that matter.
  it("renders no badge at all for a standard Sunday", () => {
    render(<SundayCell sunday={sunday()} conductingNames={CONDUCTING_NAMES} />);

    expect(screen.queryByText("Standard")).not.toBeInTheDocument();
  });

  it("names the type for a Sunday that is not standard", () => {
    const cases: Array<[SundayType, string]> = [
      ["fast_sunday", "Fast Sunday"],
      ["stake_conference", "Stake Conference"],
      ["general_conference", "General Conference"],
      ["holiday", "Holiday"],
      ["special", "Special"],
    ];

    for (const [type, label] of cases) {
      const { unmount } = render(
        <SundayCell sunday={sunday({ type })} conductingNames={CONDUCTING_NAMES} />,
      );

      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });
});

describe("SundayCell conducting", () => {
  it("renders the conductor's name", () => {
    render(<SundayCell sunday={sunday()} conductingNames={CONDUCTING_NAMES} />);

    expect(screen.getByText("Mark Andersen")).toBeInTheDocument();
  });

  it("renders 'Not set' when nobody is assigned", () => {
    render(
      <SundayCell
        sunday={sunday({ conductingUserId: null })}
        conductingNames={CONDUCTING_NAMES}
      />,
    );

    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  // A uuid on screen tells a bishop nothing they could act on, so an unknown id falls back the
  // same way a null one does rather than leaking the raw value.
  it("never renders a raw uuid for an id it cannot name", () => {
    const strangerId = "00000000-0000-4000-8000-00000000dead";

    render(
      <SundayCell
        sunday={sunday({ conductingUserId: strangerId })}
        conductingNames={CONDUCTING_NAMES}
      />,
    );

    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.queryByText(strangerId)).not.toBeInTheDocument();
  });
});

describe("SundayCell reserved regions", () => {
  // The assertion that proves Phase 4 can fill the cell without a layout change. If these props
  // stop being real props, this test is what fails.
  it("renders nothing for the three regions when their props are absent", () => {
    render(<SundayCell sunday={sunday()} conductingNames={CONDUCTING_NAMES} />);

    expect(screen.queryByTestId("phase-4-speakers")).not.toBeInTheDocument();
    expect(screen.queryByTestId("phase-4-pipeline")).not.toBeInTheDocument();
    expect(screen.queryByTestId("phase-4-goals")).not.toBeInTheDocument();
  });

  it("renders each region's content when it is passed", () => {
    render(
      <SundayCell
        sunday={sunday()}
        conductingNames={CONDUCTING_NAMES}
        speakers={<span data-testid="phase-4-speakers">Two speakers</span>}
        pipelineStatus={<span data-testid="phase-4-pipeline">Approved</span>}
        goalAlerts={<span data-testid="phase-4-goals">Goal due</span>}
      />,
    );

    expect(screen.getByTestId("phase-4-speakers")).toHaveTextContent("Two speakers");
    expect(screen.getByTestId("phase-4-pipeline")).toHaveTextContent("Approved");
    expect(screen.getByTestId("phase-4-goals")).toHaveTextContent("Goal due");
  });
});

describe("SundayCell notes", () => {
  it("renders no notes element when the Sunday has none", () => {
    render(<SundayCell sunday={sunday()} conductingNames={CONDUCTING_NAMES} />);

    expect(screen.queryByText(/High Council/)).not.toBeInTheDocument();
  });

  // Clamped rather than truncated in the data: the full text is on the detail page, and a cell
  // that grows to fit one long note gives the whole week's row a giant height.
  it("clamps a long note to two lines and keeps the cell's minimum height", () => {
    const longNote =
      "High Council visit, followed by a ward council meeting and the quarterly report " +
      "from the Elders Quorum and Relief Society presidencies.";

    render(
      <SundayCell sunday={sunday({ notes: longNote })} conductingNames={CONDUCTING_NAMES} />,
    );

    expect(screen.getByText(longNote)).toHaveClass("line-clamp-2");
    expect(screen.getByRole("link")).toHaveClass("min-h-40");
  });
});

describe("SundayCell date", () => {
  // Sliced from the YYYY-MM-DD string. new Date("2026-03-08").getDate() is 7 in every US zone.
  it("shows the UTC day of the month", () => {
    render(<SundayCell sunday={sunday()} conductingNames={CONDUCTING_NAMES} />);

    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("links to the Sunday's detail page", () => {
    render(<SundayCell sunday={sunday()} conductingNames={CONDUCTING_NAMES} />);

    expect(screen.getByRole("link")).toHaveAttribute("href", "/calendar/sunday/sunday-1");
  });
});
