import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgramPreview } from "@/components/program/ProgramPreview";
import type { ProgramDraft } from "@/lib/program/draft";

// THE JUDGEMENT THAT CAME BACK FROM WALKING SCENARIO 031.
//
// This component first OMITTED every meeting-order line that had nobody on it. Asked whether the
// missing organist read as "nobody yet" or as "something failed to load", the answer was FAILED
// TO LOAD — five lines simply gone made the preview look broken rather than unfinished.
//
// talks-c says a missing organist is A BLANK, not the word "Never" and not "None assigned".
// A blank is a line with nothing in it. Deleting the row was a stronger move than the retro asked
// for, and this suite is what stops it coming back.
//
// The distinction being locked in:
//   the NINE FIXED LINES of a sacrament meeting always render, muted when empty
//   the OPTIONAL BLOCKS are still omitted when empty — no slot is standing open for them

// The nine lines a sacrament meeting always has, whether or not anybody is in them.
const FIXED_LINES = [
  "Presiding",
  "Conducting",
  "Organist",
  "Chorister",
  "Opening hymn",
  "Invocation",
  "Sacrament hymn",
  "Closing hymn",
  "Benediction",
];

// Absent from an ordinary program without anything being missing.
const OPTIONAL_BLOCKS = [
  "Ward business",
  "Special notes",
  "Musical number",
  "Announcements",
  "Missionaries",
];

function emptyDraft(overrides: Partial<ProgramDraft> = {}): ProgramDraft {
  return {
    version: 1,
    heading: null,
    date: "2026-09-20",
    sundayType: "standard",
    presiding: { printedName: null, publicName: null },
    conducting: { printedName: null, publicName: null },
    organist: null,
    chorister: null,
    openingHymn: null,
    invocation: null,
    wardBusiness: null,
    sacramentHymn: null,
    specialNotes: null,
    musicalNumber: null,
    speakers: [
      { slotNumber: 1, kind: "empty", printedName: null, publicName: null, topic: null },
    ],
    closingHymn: null,
    benediction: null,
    announcements: null,
    leadershipContacts: [],
    missionaries: null,
    missing: [],
    ...overrides,
  };
}

function filledDraft(): ProgramDraft {
  return emptyDraft({
    presiding: { printedName: "Mark Andersen", publicName: "Mark A." },
    conducting: { printedName: "Peter Lindqvist", publicName: "Peter L." },
    organist: { printedName: "Ruth Delgado", publicName: "Ruth D." },
    chorister: { printedName: "Anna Brooks", publicName: "Anna B." },
    openingHymn: { number: 19, title: "We Thank Thee, O God, for a Prophet" },
    invocation: { printedName: "David Brooks", publicName: "David B." },
    sacramentHymn: { number: 169, title: "As Now We Take the Sacrament" },
    closingHymn: { number: 152, title: "God Be with You Till We Meet Again" },
    benediction: { printedName: "Sarah Whitfield", publicName: "Sarah W." },
    wardBusiness: "Sustaining a new Elders Quorum secretary.",
    announcements: "Ward temple night on Thursday.",
    speakers: [
      {
        slotNumber: 1,
        kind: "member",
        printedName: "Sarah Whitfield",
        publicName: "Sarah W.",
        topic: "Charity Never Faileth",
      },
    ],
  });
}

function terms(): string[] {
  const preview = screen.getByRole("region", { name: "Program preview" });
  return [...preview.querySelectorAll("dt")].map((node) => node.textContent ?? "");
}

describe("ProgramPreview — the meeting order keeps its skeleton", () => {
  // THE REGRESSION. An entirely empty program still shows the shape of a sacrament meeting.
  it("renders every fixed line even when the whole program is empty", () => {
    render(<ProgramPreview draft={emptyDraft()} />);

    for (const label of FIXED_LINES) {
      expect(terms()).toContain(label);
    }
  });

  it("says what an empty line is waiting for, in its own words", () => {
    render(<ProgramPreview draft={emptyDraft()} />);
    const preview = screen.getByRole("region", { name: "Program preview" });

    // A person for a person's line, a choice for a hymn's line. "Nobody yet" under Sacrament
    // hymn would be wrong, and so would "Not chosen yet" under Organist.
    expect(within(preview).getAllByText("Nobody yet").length).toBeGreaterThan(0);
    expect(within(preview).getAllByText("Not chosen yet").length).toBe(3);
  });

  it("never writes a placeholder the printer would treat as typed text", () => {
    const { container } = render(<ProgramPreview draft={emptyDraft()} />);

    expect(container.textContent).not.toMatch(/TBD/i);
    expect(container.textContent).not.toMatch(/not yet assigned/i);
    expect(container.textContent).not.toMatch(/none assigned/i);
    expect(container.textContent).not.toMatch(/\bN\/A\b/i);
  });

  it("shows the real value once there is one", () => {
    render(<ProgramPreview draft={filledDraft()} />);
    const preview = screen.getByRole("region", { name: "Program preview" });

    expect(within(preview).getByText("Ruth Delgado")).toBeInTheDocument();
    expect(
      within(preview).getByText("169 — As Now We Take the Sacrament"),
    ).toBeInTheDocument();
    expect(within(preview).queryByText("Not chosen yet")).toBeNull();
    expect(within(preview).queryByText("Nobody yet")).toBeNull();
  });
});

describe("ProgramPreview — optional blocks are a different decision", () => {
  // A Sunday with no musical number is not missing one. Rendering a greyed placeholder for each
  // optional block would put five of them on an ordinary program.
  it("omits an empty optional block entirely", () => {
    render(<ProgramPreview draft={emptyDraft()} />);

    for (const label of OPTIONAL_BLOCKS) {
      expect(terms()).not.toContain(label);
    }
  });

  it("renders an optional block once it has content", () => {
    render(<ProgramPreview draft={filledDraft()} />);

    expect(terms()).toContain("Ward business");
    expect(terms()).toContain("Announcements");
    expect(terms()).not.toContain("Musical number");
  });

  // null on an ordinary Sunday, and then NOTHING is rendered — not an empty element.
  it("renders no heading on an ordinary Sunday and one on a ward conference", () => {
    const { unmount } = render(<ProgramPreview draft={emptyDraft()} />);
    expect(screen.queryByText("Ward Conference")).toBeNull();
    unmount();

    render(
      <ProgramPreview
        draft={emptyDraft({ heading: "Ward Conference", sundayType: "ward_conference" })}
      />,
    );
    expect(screen.getByText("Ward Conference")).toBeInTheDocument();
  });
});

describe("ProgramPreview — speakers", () => {
  // Rendered straight from the snapshot, never re-derived from member_id and never through the
  // roster, which is what keeps an external speaker's typed title intact (talks-b, ITER-004).
  it("keeps an external speaker's typed title in full", () => {
    render(
      <ProgramPreview
        draft={emptyDraft({
          speakers: [
            {
              slotNumber: 1,
              kind: "external",
              printedName: "President Mark Andersen",
              publicName: "President Mark Andersen",
              topic: null,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("President Mark Andersen")).toBeInTheDocument();
  });

  it("keeps an open slot's line rather than dropping it", () => {
    render(<ProgramPreview draft={emptyDraft()} />);

    expect(screen.getByText("First speaker")).toBeInTheDocument();
    expect(screen.getAllByText("Nobody yet").length).toBeGreaterThan(0);
  });
});

describe("ProgramPreview — the contacts carry phone numbers", () => {
  // They belong on the paper handed round a chapel. program-c's public projection omits the
  // array entirely rather than redacting inside it.
  it("renders them when present and omits the section when there are none", () => {
    const { unmount } = render(<ProgramPreview draft={emptyDraft()} />);
    expect(screen.queryByText("Ward leadership")).toBeNull();
    unmount();

    render(
      <ProgramPreview
        draft={emptyDraft({
          leadershipContacts: [{ role: "Bishop", name: "Mark Andersen", phone: "555-0100" }],
        })}
      />,
    );

    expect(screen.getByText("Ward leadership")).toBeInTheDocument();
    expect(screen.getByText(/555-0100/)).toBeInTheDocument();
  });
});
