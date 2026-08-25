import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DraftDiff, NOTHING_CHANGED } from "@/components/program/DraftDiff";
import type { DraftChange } from "@/lib/program/diff";

// One diff component, two callers — the refresh flow and the AI editor. What it must never do is
// put `change.field` on screen: that is the stable machine path the routes audit and React keys
// on, and a secretary reading "speakers.2.printedName" is calendar-b's raw-uuid rule in a
// different costume.

const CHANGES: DraftChange[] = [
  {
    field: "sacramentHymn",
    label: "Sacrament hymn",
    before: null,
    after: "169 — As Now We Take the Sacrament",
  },
  {
    field: "speakers.2.printedName",
    label: "Second speaker",
    before: null,
    after: "Sarah Whitfield",
  },
  {
    field: "announcements",
    label: "Announcements",
    before: "Ward temple night on Thursday.",
    after: "Ward temple night on Thursday. Primary program next month.",
  },
];

describe("DraftDiff", () => {
  it("renders the written label for every change", () => {
    render(<DraftDiff changes={CHANGES} />);

    expect(screen.getByText("Sacrament hymn")).toBeInTheDocument();
    expect(screen.getByText("Second speaker")).toBeInTheDocument();
    expect(screen.getByText("Announcements")).toBeInTheDocument();
  });

  it("never renders the dotted machine path", () => {
    const { container } = render(<DraftDiff changes={CHANGES} />);

    expect(container.textContent).not.toContain("speakers.2.printedName");
    expect(container.textContent).not.toContain("sacramentHymn");
  });

  it("shows both the old value and the new one", () => {
    render(<DraftDiff changes={CHANGES} />);

    expect(screen.getByText("Ward temple night on Thursday.")).toBeInTheDocument();
    expect(
      screen.getByText("Ward temple night on Thursday. Primary program next month."),
    ).toBeInTheDocument();
  });

  // An empty array is "nothing upstream has moved", which is a real answer with words for it.
  // An empty table is a rendering failure that happens to look similar.
  it("renders a sentence rather than an empty table when nothing changed", () => {
    const { container } = render(<DraftDiff changes={[]} />);

    expect(screen.getByText(NOTHING_CHANGED)).toBeInTheDocument();
    expect(container.querySelector("dl")).toBeNull();
    expect(container.querySelector("table")).toBeNull();
  });

  // An absence renders as an absence (plans/retros/talks-c-prayers-and-topics.md). A field that
  // had nothing before is an em dash, never "None" and never "Not set" — those read as text
  // somebody typed.
  it("renders an absent value as a dash, not as a word", () => {
    const { container } = render(<DraftDiff changes={[CHANGES[0]]} />);

    expect(container.textContent).toContain("—");
    expect(container.textContent).not.toMatch(/\bNone\b/);
    expect(container.textContent).not.toMatch(/not set/i);
    expect(container.textContent).not.toMatch(/TBD/i);
  });

  it("gives each change its own row keyed on the machine path", () => {
    const { container } = render(<DraftDiff changes={CHANGES} />);

    expect(container.querySelectorAll("dt")).toHaveLength(CHANGES.length);
  });
});
