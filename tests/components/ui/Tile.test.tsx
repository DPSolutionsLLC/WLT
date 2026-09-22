// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tile } from "@/components/ui/Tile";

// THE HEADLINE ASSERTION IS THAT A TILE IS ALWAYS A LINK.
//
// This file used to be carried by two assertions about `locked` — that a locked tile rendered no
// link, and that it said why in words. Both were correct, and the capability they guarded was
// REMOVED on 2026-09-22 after walking scenario 069: a person sees only what they can open, so a
// module somebody lacks is absent rather than shown locked. Tile.tsx's header carries the
// reasoning. These tests went with the behaviour, not because they became inconvenient.
//
// What replaces them is the inverse guarantee, asserted on SHAPE rather than on text: whatever
// else changes, this component renders an <a>. A future "disabled" tile that rendered a styled
// <div>, or an <a> at reduced opacity, would fail here — and the second of those is the one worth
// catching, because a disabled anchor is not a thing the platform has: an <a href> at 50% opacity
// is still focusable, still activates on Enter, and still navigates.
//
// The accent classes are asserted for the Tailwind reason every badge in this codebase states: an
// interpolated `border-l-${accent}` compiles fine and produces no CSS at all.

describe("Tile", () => {
  it("renders its label and blurb", () => {
    render(<Tile href="/visits" label="Visits" blurb="Who is due a visit" />);

    expect(screen.getByText("Visits")).toBeInTheDocument();
    expect(screen.getByText("Who is due a visit")).toBeInTheDocument();
  });

  it("is a link to its href", () => {
    render(<Tile href="/visits" label="Visits" />);

    expect(screen.getByRole("link", { name: /Visits/ })).toHaveAttribute("href", "/visits");
  });

  // THE SHAPE ASSERTION. See the header: there is no locked state, so the top-level element is an
  // anchor every time.
  it("renders an anchor as its root element, never a div", () => {
    const { container } = render(<Tile href="/visits" label="Visits" />);

    expect(container.firstElementChild?.tagName).toBe("A");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("is reachable by keyboard and carries no opacity dimming", () => {
    const { container } = render(<Tile href="/visits" label="Visits" />);
    const tile = container.firstElementChild;

    expect(tile).not.toHaveAttribute("tabindex", "-1");
    expect(tile?.className).not.toContain("opacity-");
  });

  it.each([
    ["pine", "border-l-pine"],
    ["rust", "border-l-rust"],
    ["gold", "border-l-gold"],
  ] as const)("gives the %s accent its own static class", (accent, expected) => {
    const { container } = render(<Tile href="/x" label="X" accent={accent} />);

    expect(container.firstElementChild).toHaveClass(expected, "border-l-4");
  });

  it("carries no accent class when no accent is given", () => {
    const { container } = render(<Tile href="/x" label="X" />);

    expect(container.firstElementChild?.className).not.toContain("border-l-");
  });

  // The word, not just a glyph — a pin shape alone says nothing in greyscale or to a reader.
  it("says 'Pinned' in words when pinned, and nothing when not", () => {
    const { rerender } = render(<Tile href="/x" label="X" pinned />);

    expect(screen.getByText("Pinned")).toBeInTheDocument();

    rerender(<Tile href="/x" label="X" />);

    expect(screen.queryByText("Pinned")).toBeNull();
  });

  it("hides a decorative icon from assistive technology", () => {
    const { container } = render(<Tile href="/x" label="X" icon={<span>◆</span>} />);

    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe("◆");
  });
});
