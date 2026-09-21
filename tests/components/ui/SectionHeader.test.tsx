// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionHeader } from "@/components/ui/SectionHeader";

// `font-display` is asserted because it is the one place P1's type pairing is load-bearing: the
// title is Fraunces, everything else is Inter. An interpolated or forgotten class here is
// invisible — the heading simply renders in the body face and nobody notices for a phase.
//
// The heading LEVEL is asserted too. Hardcoding <h2> would leave every page that uses this as its
// page title with no <h1>, which is a document-outline fault a screen-reader user hits first.

describe("SectionHeader", () => {
  it("renders the title in the display face", () => {
    render(<SectionHeader title="Ward Council" />);

    expect(screen.getByRole("heading", { name: "Ward Council" })).toHaveClass("font-display");
  });

  it("defaults to a level-2 heading and honours headingLevel", () => {
    const { rerender } = render(<SectionHeader title="Ward Council" />);

    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();

    rerender(<SectionHeader title="Ward Council" headingLevel={1} />);

    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  // The eyebrow is NOT a heading — a document outline that alternates levels for what is visually
  // one block reads worse than one heading with a line of context above it.
  it("renders the eyebrow as text rather than as a second heading", () => {
    render(<SectionHeader eyebrow="Sunday 18 January" title="Ward Council" />);

    expect(screen.getByText("Sunday 18 January")).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("renders nothing for the eyebrow, description or actions when none are given", () => {
    const { container } = render(<SectionHeader title="Ward Council" />);

    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders actions when they are given", () => {
    render(
      <SectionHeader
        title="Ward Council"
        actions={<button type="button">Add an item</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Add an item" })).toBeInTheDocument();
  });

  it("renders a description when one is given", () => {
    render(<SectionHeader title="Ward Council" description="Six items waiting." />);

    expect(screen.getByText("Six items waiting.")).toBeInTheDocument();
  });

  // THE 375px TRAP. A long title and an actions row on one line push the page wider than the
  // viewport unless both sides may shrink and the row may wrap.
  it("lets both sides of the row shrink and wrap", () => {
    const { container } = render(
      <SectionHeader title="Ward Council" actions={<button type="button">Add</button>} />,
    );

    const row = container.firstElementChild as HTMLElement;

    expect(row).toHaveClass("flex-wrap");
    expect(row.firstElementChild).toHaveClass("min-w-0");
  });

  it("wraps a long title rather than cutting it off", () => {
    render(<SectionHeader title="Relief Society Presidency Coordination" />);

    expect(screen.getByRole("heading")).toHaveClass("break-words");
  });
});
