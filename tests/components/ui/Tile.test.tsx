// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tile } from "@/components/ui/Tile";

// TWO ASSERTIONS CARRY THIS FILE AND BOTH ARE ABOUT `locked`.
//
// A locked tile must render NO LINK, because a disabled anchor is not a thing the platform has:
// an <a href> at 50% opacity is still focusable, still activates on Enter and still navigates.
// And it must say WHY IN WORDS, because greying out is a colour-only signal and this app does not
// use those (MemberStatusBadge's rule for do_not_contact; ITER-022). A tile somebody cannot open,
// with nothing on it explaining that, reads as a page that failed to load.
//
// The accent classes are asserted for the Tailwind reason every badge in this codebase states: an
// interpolated `border-l-${accent}` compiles fine and produces no CSS at all.

describe("Tile", () => {
  it("renders its label and blurb", () => {
    render(<Tile href="/visits" label="Visits" blurb="Who is due a visit" />);

    expect(screen.getByText("Visits")).toBeInTheDocument();
    expect(screen.getByText("Who is due a visit")).toBeInTheDocument();
  });

  it("is a link to its href when it is not locked", () => {
    render(<Tile href="/visits" label="Visits" />);

    expect(screen.getByRole("link", { name: /Visits/ })).toHaveAttribute("href", "/visits");
  });

  // THE HEADLINE ASSERTION.
  it("renders NO link at all when locked", () => {
    render(<Tile href="/agendas" label="Agendas" locked />);

    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Agendas")).toBeInTheDocument();
  });

  it("says why it is locked in words, not by opacity alone", () => {
    render(
      <Tile
        href="/agendas"
        label="Agendas"
        locked
        lockedReason="The bishopric has not opened this yet."
      />,
    );

    expect(screen.getByText("The bishopric has not opened this yet.")).toBeInTheDocument();
  });

  it("falls back to a default reason rather than rendering a silently dead tile", () => {
    const { container } = render(<Tile href="/agendas" label="Agendas" locked />);

    expect(container.textContent).toContain("You do not have access to this yet.");
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
