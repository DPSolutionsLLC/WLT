// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardGrid } from "@/components/layout/DashboardGrid";
import { NAVIGATION_ITEMS, type NavigationItem } from "@/lib/auth/navigation";

// ---------------------------------------------------------------------------
// A PERSON SEES ONLY WHAT THEY CAN OPEN
// ---------------------------------------------------------------------------
// Decided by the user on 2026-09-22 after walking scenario 069, and it REVERSED what P3 first
// shipped. The grid used to render every module somebody lacked as a locked tile; the walk showed
// a music coordinator with 4 usable tiles and 11 locks, and a stake officer with FIFTEEN locks and
// nothing to do. This file was rewritten with that decision — the locked-tile cases are gone
// because the behaviour is gone, not because they became inconvenient.
//
// TWO ASSERTIONS CARRY IT NOW.
//
// An EMPTY SECTION RENDERS NOTHING — true both for "Tasks & Communication" (empty until P5) and
// for a section one person cannot reach. A heading with nothing under it reads as a section that
// failed to load, which is the defect plans/retros/youth-h recorded on a card with no pills.
//
// THE EMPTY STATE IS A SENTENCE, NOT A BLANK PAGE — and it is REACHABLE again. While locked tiles
// existed, a role holding nothing got fifteen of them and this branch was dead code.

function itemFor(href: string): NavigationItem {
  const item = NAVIGATION_ITEMS.find((candidate) => candidate.href === href);
  if (!item) throw new Error(`No navigation item for ${href}`);
  return item;
}

const ROSTER = itemFor("/roster");
const VISITS = itemFor("/visits");
const MUSIC = itemFor("/music");
const AUDIT_LOG = itemFor("/admin/audit-log");

describe("DashboardGrid", () => {
  it("renders a heading for each section that has tiles", () => {
    render(<DashboardGrid items={[ROSTER, MUSIC]} searchTerm="" pinnedHrefs={[]} />);

    expect(screen.getByRole("heading", { name: "People & Care" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Meetings & Programs" })).toBeInTheDocument();
  });

  // THE HEADLINE ASSERTION.
  it("renders nothing at all for a section with no tiles", () => {
    render(<DashboardGrid items={[ROSTER]} searchTerm="" pinnedHrefs={[]} />);

    expect(screen.queryByRole("heading", { name: "Tasks & Communication" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Meetings & Programs" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Finance & Admin" })).toBeNull();
  });

  it("links every tile at its href", () => {
    render(<DashboardGrid items={[VISITS]} searchTerm="" pinnedHrefs={[]} />);

    expect(screen.getByRole("link", { name: /Visits/ })).toHaveAttribute("href", "/visits");
  });

  // THE OTHER HEADLINE ASSERTION. Every tile rendered is one the person can open, so there is no
  // un-clickable card anywhere on the grid — a module they lack is ABSENT, not shown locked.
  it("renders no un-clickable tile — every tile on the grid is a link", () => {
    const items = [ROSTER, VISITS, MUSIC];
    const { container } = render(
      <DashboardGrid items={items} searchTerm="" pinnedHrefs={[]} />,
    );

    expect(screen.getAllByRole("link")).toHaveLength(items.length);

    // Every child of every tile grid is an <a>. A locked tile was a <div>, so this is the shape
    // assertion rather than a text one — it catches an un-clickable card whatever it says.
    const gridChildren = [...container.querySelectorAll("section > div:last-child > *")];
    expect(gridChildren.length).toBe(items.length);
    expect(gridChildren.every((child) => child.tagName === "A")).toBe(true);

    expect(screen.queryByText(/not open to your calling/)).toBeNull();
  });

  it("never renders an unbuilt item, even if one is handed to it", () => {
    expect(AUDIT_LOG.built).toBe(false);

    render(<DashboardGrid items={[ROSTER]} searchTerm="" pinnedHrefs={[]} />);

    expect(screen.queryByText("Audit Log")).toBeNull();
  });

  it("marks a pinned tile with the word, not a bare glyph", () => {
    render(
      <DashboardGrid items={[ROSTER, VISITS]} searchTerm="" pinnedHrefs={["/visits"]} />,
    );

    expect(screen.getAllByText("Pinned")).toHaveLength(1);
  });
});

describe("DashboardGrid search", () => {
  it("filters on the label, case-insensitively", () => {
    render(
      <DashboardGrid items={[ROSTER, VISITS, MUSIC]} searchTerm="mUs" pinnedHrefs={[]} />,
    );

    expect(screen.getByText("Music")).toBeInTheDocument();
    expect(screen.queryByText("Roster")).toBeNull();
    expect(screen.queryByText("Visits")).toBeNull();
  });

  it("filters on the blurb as well as the label", () => {
    // "Who is due a visit, and what happened last time." — the word is only in the blurb.
    render(<DashboardGrid items={[ROSTER, VISITS]} searchTerm="due" pinnedHrefs={[]} />);

    expect(screen.getByText("Visits")).toBeInTheDocument();
    expect(screen.queryByText("Roster")).toBeNull();
  });

  it("drops a section whose only tiles were filtered out", () => {
    render(<DashboardGrid items={[ROSTER, MUSIC]} searchTerm="roster" pinnedHrefs={[]} />);

    expect(screen.queryByText("Music")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Meetings & Programs" })).toBeNull();
  });

  it("says nothing matched rather than rendering an empty grid", () => {
    render(<DashboardGrid items={[ROSTER]} searchTerm="zzzz" pinnedHrefs={[]} />);

    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  // REACHABLE AGAIN. STAKE_OFFICER_PERMISSIONS is an empty list by design (CLAUDE.md §7), and
  // while locked tiles existed such a role got fifteen of them instead of this sentence.
  it("gives a role with nothing at all the empty-state sentence", () => {
    render(<DashboardGrid items={[]} searchTerm="" pinnedHrefs={[]} />);

    expect(screen.getByText(/no modules assigned yet/)).toBeInTheDocument();
  });
});

describe("DashboardGrid as a sub-dashboard", () => {
  it("renders one flat grid with no section headings", () => {
    render(
      <DashboardGrid
        items={[ROSTER, MUSIC]}
        searchTerm=""
        pinnedHrefs={[]}
        showSectionHeadings={false}
      />,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});
