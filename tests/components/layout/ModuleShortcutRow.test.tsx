// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModuleShortcutRow } from "@/components/layout/ModuleShortcutRow";
import { NAVIGATION_ITEMS, type NavigationItem } from "@/lib/auth/navigation";

// A page's row of links to other modules — the prototype's `.sac-nav`, which build note
// §global-stylesheet-nav-consistency states as a STANDING CONVENTION rather than a one-off
// (module-map.md §6.4).
//
// ---------------------------------------------------------------------------
// WHAT THIS FILE CAN AND CANNOT PROVE
// ---------------------------------------------------------------------------
// The FILTERING is not tested here and must not be. It lives in shortcutNavigationItems() and
// tests/lib/navigation.test.ts is where it is asserted against the real permission matrix; a
// second copy of those assertions over hand-made props would go green while the helper drifted.
//
// What IS provable here is the SHAPE the filtering depends on being safe: a real anchor per item,
// no dimmed or disabled state, and nothing rendered at all when the list is empty. That is P3's
// rule from the other side — Tile.locked was deleted outright and replaced with the inverse
// guarantee asserted on shape, and a row of shortcuts owes the same guarantee.

function itemFor(href: string): NavigationItem {
  const item = NAVIGATION_ITEMS.find((candidate) => candidate.href === href);
  if (!item) throw new Error(`No navigation item for ${href}`);
  return item;
}

const TOPICS = itemFor("/talks/topics");
const MUSIC = itemFor("/music");
const PROGRAM = itemFor("/program");

describe("ModuleShortcutRow", () => {
  it("renders one link per item, at its own href", () => {
    render(<ModuleShortcutRow items={[TOPICS, MUSIC]} label="Related modules" />);

    expect(screen.getByRole("link", { name: "Topics" })).toHaveAttribute(
      "href",
      "/talks/topics",
    );
    expect(screen.getByRole("link", { name: "Music" })).toHaveAttribute("href", "/music");
  });

  // The order is the CALLER'S, because the prototype's row has its own and the page is the only
  // thing that knows it. shortcutNavigationItems() preserves it; this asserts the renderer does
  // not re-sort underneath it.
  it("renders the items in the order it was given", () => {
    render(
      <ModuleShortcutRow items={[PROGRAM, TOPICS, MUSIC]} label="Related modules" />,
    );

    const labels = screen.getAllByRole("link").map((link) => link.textContent);

    expect(labels).toEqual(["Program", "Topics", "Music"]);
  });

  // NAMED, because a page may eventually carry more than one <nav> and "navigation" twice over
  // tells a screen-reader user which is which exactly as well as nothing would.
  it("names the row for a screen reader", () => {
    render(<ModuleShortcutRow items={[TOPICS]} label="Related modules" />);

    expect(screen.getByRole("navigation", { name: "Related modules" })).toBeInTheDocument();
  });

  // The icon is decorative — the label beside it names the module — so it must not reach the
  // accessible name. Without aria-hidden a screen reader reads the mark and then the word.
  it("gives each link an accessible name of exactly its label", () => {
    render(<ModuleShortcutRow items={[TOPICS]} label="Related modules" />);

    expect(screen.getByRole("link", { name: "Topics" })).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  // NOTHING, not an empty bordered strip. An empty container reads as a section that failed to
  // load — plans/retros/youth-h's defect, and DashboardGrid's rule for a section with no tiles.
  it("renders nothing when every item was filtered out", () => {
    const { container } = render(<ModuleShortcutRow items={[]} label="Related modules" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // NO LOCKED, DIMMED OR DISABLED SHORTCUT — EVER
  // ---------------------------------------------------------------------------
  // Asserted on SHAPE rather than on behaviour, which is what P3 replaced Tile.locked's tests
  // with. Everything in this row is reachable by the person looking at it, because
  // shortcutNavigationItems() dropped the rest; a dimmed link here would be one that looks broken
  // while claiming to be a rule.
  it("renders every shortcut as a keyboard-reachable anchor with no dimming", () => {
    render(<ModuleShortcutRow items={[TOPICS, MUSIC, PROGRAM]} label="Related modules" />);

    for (const link of screen.getAllByRole("link")) {
      expect(link.tagName).toBe("A");
      expect(link).not.toHaveAttribute("aria-disabled");
      expect(link.className).not.toMatch(/opacity-/);
      expect(link).toHaveAttribute("href");
    }
  });
});
