// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SundayCard, type SundayCardProps } from "@/components/sacrament/SundayCard";
import {
  sundayPills,
  type SundayPillLinkKey,
  type SundayStatusInput,
} from "@/lib/sacrament/sundayStatus";

// The finalize checkmark is a "use client" component that calls useRouter(), which throws outside
// an App Router tree. Only the ROUTER is mocked — the button, its markup and its gating are the
// real thing, which is what these assertions are about.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

// ---------------------------------------------------------------------------
// ASSERTED ON WHAT A LEADER MUST BE ABLE TO DO, NOT ON WHAT THE CARD CURRENTLY RENDERS
// ---------------------------------------------------------------------------
// P3's ChromeBar.test.tsx asserted `toBeEmptyDOMElement()` and passed happily while the page had
// no sign-out anywhere — the test had pinned the bug as the specification. So every assertion
// below is a capability: a pill can be pressed, a zero is visible, a no-meeting Sunday says so,
// an unfilled conductor reads as open.
//
// The pills come from the real sundayPills() rather than from hand-built literals, so the card
// and the function cannot drift apart in the fixture and agree nowhere else (ITER-022, where a
// summary carried the state and the date but not the COUNT).
//
// jsdom, although SundayCard is a SERVER component — it holds no state and no handlers, so it
// renders in either place, which is the rule Pill, SectionHeader and UnverifiedHymnBadge all
// record in their own headers. Rendering it here is what lets the shape assertions below run at
// all.

const HREFS: Record<SundayPillLinkKey, string> = {
  topics: "/assignments/sunday-1",
  talks: "/assignments/sunday-1",
  prayer: "/prayers?month=2027-03#sunday-sunday-1",
  music: "/music",
};

const PROGRAM_HREF = "/program/sunday-1";
const CONDUCTING_HREF = "/calendar/sunday/sunday-1";

function statusInput(overrides: Partial<SundayStatusInput> = {}): SundayStatusInput {
  return {
    speakingSlots: 3,
    assignments: [],
    prayers: [],
    hymnSelectionCount: 0,
    // The starting state. Every finalize assertion overrides it explicitly, so no test below
    // depends on which way this default points.
    topicsFinalized: false,
    references: { count: 0, decision: null },
    ...overrides,
  };
}

function props(overrides: Partial<SundayCardProps> = {}): SundayCardProps {
  return {
    sundayId: "sunday-1",
    // A Sunday. 2027-03-07 is one, and it is a `date` string — never a Date — because that is
    // what lib/calendar/dates.ts takes (CLAUDE.md rule 12).
    date: "2027-03-07",
    type: "standard",
    conductingName: null,
    pills: sundayPills(statusInput()),
    hrefs: HREFS,
    programHref: PROGRAM_HREF,
    conductingHref: CONDUCTING_HREF,
    // The conservative default: a reader who cannot finalize. The checkmark tests below turn it
    // on explicitly, so the absence assertions cannot pass because somebody forgot to.
    canFinalizeTopics: false,
    canPlanTalks: false,
    ...overrides,
  };
}

describe("SundayCard", () => {
  it("names the Sunday", () => {
    render(<SundayCard {...props()} />);

    // UTC, via formatSundayLabel. A bare toLocaleDateString would render March 6 for any reader
    // west of UTC — the defect rule 12 exists to stop.
    expect(screen.getByText("Sunday, March 7")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // EVERY PILL IS SOMETHING A LEADER CAN PRESS
  // ---------------------------------------------------------------------------
  // P3's inverse guarantee, asserted on shape. A disabled anchor is not a thing the platform
  // has: an <a href> at 50% opacity is still focusable, still activates on Enter and still
  // navigates — so a pill that should not be pressed must not be rendered at all.
  it("renders every pill as a link with an href", () => {
    render(<SundayCard {...props()} />);

    const links = screen.getAllByRole("link");

    // Four LINKED pills, plus the heading (the programme) and the conducting name. References is
    // the fifth pill and is a button — it opens a modal (asserted in its own block below).
    expect(links).toHaveLength(6);
    for (const link of links) {
      expect(link).toHaveAttribute("href");
      expect(link.getAttribute("href")).not.toBe("");
    }
  });

  it("carries no opacity dimming on any pill", () => {
    const { container } = render(<SundayCard {...props()} />);

    for (const element of container.querySelectorAll("a, a *")) {
      expect(element.className).not.toContain("opacity-");
    }
  });

  it("puts no pill out of the keyboard's reach", () => {
    render(<SundayCard {...props()} />);

    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("tabindex", "-1");
    }
  });

  it("sends each pill to the module that owns it for THIS Sunday", () => {
    render(<SundayCard {...props()} />);

    // The prototype's own bug: openProgram(key) ignored its key and always opened the nearest
    // Sunday (build-notes-raw.md §sacrament-to-program-navigation). Every href carries the id.
    expect(screen.getByRole("link", { name: /^Topics/ })).toHaveAttribute(
      "href",
      "/assignments/sunday-1",
    );
    expect(screen.getByRole("link", { name: /^Prayer/ })).toHaveAttribute(
      "href",
      "/prayers?month=2027-03#sunday-sunday-1",
    );
  });

  // ---------------------------------------------------------------------------
  // THE CARD IS THE PROGRAMME LINK, AND THE PILLS STILL WORK
  // ---------------------------------------------------------------------------
  // The failure this pins is NESTING: wrapping the card in an <a> would put the pill anchors
  // inside it, which is invalid HTML and leaves a screen reader unable to reach them. A stretched
  // pseudo-element keeps one anchor per destination, so counting them is what proves the shape.
  it("opens this Sunday's programme from the card heading", () => {
    render(<SundayCard {...props()} />);

    expect(screen.getByRole("link", { name: /programme/i })).toHaveAttribute(
      "href",
      "/program/sunday-1",
    );
  });

  it("nests no link inside another link", () => {
    const { container } = render(<SundayCard {...props()} />);

    expect(container.querySelectorAll("a a")).toHaveLength(0);
  });

  it("emits no programme pill and no conducting pill", () => {
    render(<SundayCard {...props()} />);

    expect(screen.queryByText(/^Program \d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Conducting \d/)).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // THE CONDUCTOR CAN BE CHANGED FOR THIS SUNDAY
  // ---------------------------------------------------------------------------
  // Asserted as a CAPABILITY, not as a rendering: with the conducting pill gone, the name is the
  // only route to the Sunday editor where the override lives, so a leader who cannot press it
  // cannot switch who conducts.
  it("links the conductor's name to the Sunday editor", () => {
    render(<SundayCard {...props({ conductingName: "Bishop Alvarez" })} />);

    expect(screen.getByRole("link", { name: "Bishop Alvarez" })).toHaveAttribute(
      "href",
      "/calendar/sunday/sunday-1",
    );
  });

  it("links an unassigned conductor too, so somebody can be chosen", () => {
    render(<SundayCard {...props()} />);

    expect(screen.getByRole("link", { name: "open" })).toHaveAttribute(
      "href",
      "/calendar/sunday/sunday-1",
    );
  });

  // The mirror of youth-a-D1: the UI declining what the API would allow is quiet and
  // recoverable; offering a link that refuses on arrival is not. The hub gates on `talks.view`
  // and the Sunday editor on `calendar.view`, which are genuinely separate grants.
  it("renders the conductor as plain text when the editor is out of reach", () => {
    render(<SundayCard {...props({ conductingName: "Bishop Alvarez", conductingHref: null })} />);

    expect(screen.getByText("Bishop Alvarez")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bishop Alvarez" })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // A SUNDAY WITH NO SPEAKING SLOTS CARRIES NO TALK PILLS
  // ---------------------------------------------------------------------------
  // `Topics 0/0` read as a card that had failed to load (scenario 072 walk). Prayer and music
  // survive, because a fast Sunday still has both prayers and three hymns.
  it("shows prayer and music but no talk pills on a fast Sunday", () => {
    render(
      <SundayCard
        {...props({
          type: "fast_sunday",
          pills: sundayPills(statusInput({ speakingSlots: 0 })),
        })}
      />,
    );

    expect(screen.queryByText(/^Topics/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Talks/)).not.toBeInTheDocument();
    expect(screen.getByText("Prayer 0/2")).toBeInTheDocument();
    expect(screen.getByText("Music 0/3")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // A ZERO IS RENDERED, NOT OMITTED
  // ---------------------------------------------------------------------------
  // program-c made this reversal once already and the reason holds: a slot that disappears looks
  // correct, so nobody fixes it, where `Topics 0/3` is a Sunday asking to be worked on.
  it("renders a 0/3 pill rather than leaving it out", () => {
    render(<SundayCard {...props()} />);

    expect(screen.getByText("Topics 0/3")).toBeInTheDocument();
    expect(screen.getByText("Talks 0/3")).toBeInTheDocument();
  });

  it("shows topics and talks disagreeing when a topic has no speaker yet", () => {
    render(
      <SundayCard
        {...props({
          pills: sundayPills(
            statusInput({
              assignments: [
                { topicId: "t1", memberId: "m1", externalSpeakerName: null, stage: "plan" },
                { topicId: "t2", memberId: null, externalSpeakerName: null, stage: "plan" },
              ],
            }),
          ),
        })}
      />,
    );

    expect(screen.getByText("Topics 2/3")).toBeInTheDocument();
    expect(screen.getByText("Talks 1/3")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // THE CONDUCTOR IS NEVER FABRICATED AND NEVER BLANK
  // ---------------------------------------------------------------------------
  it("reads an unassigned conductor as open", () => {
    render(<SundayCard {...props()} />);

    const line = screen.getByText(/^Conducting:/);

    expect(within(line).getByText("open")).toBeInTheDocument();
  });

  it("names the conductor when there is one", () => {
    render(<SundayCard {...props({ conductingName: "Bishop Alvarez" })} />);

    const line = screen.getByText(/^Conducting:/);

    expect(within(line).getByText("Bishop Alvarez")).toBeInTheDocument();
    expect(within(line).queryByText("open")).not.toBeInTheDocument();
  });

  // The complete tone is the one state rendered as a FILL rather than an outline (StatusPill's
  // header records the contrast measurement). `text-background` is what makes one static class
  // pair correct in both themes; a literal would pass in light and fail in dark.
  it("fills a completed pill rather than outlining it", () => {
    render(
      <SundayCard {...props({ pills: sundayPills(statusInput({ hymnSelectionCount: 3 })) })} />,
    );

    // The tone lands on `Pill`'s own span, which is the PARENT of the aria-hidden span holding
    // the text — StageBadge.test.tsx asserts on the same element for the same reason.
    const music = screen.getByText("Music 3/3").parentElement;

    expect(music).toHaveClass("bg-stage-complete");
    expect(music).toHaveClass("text-background");
  });

  // ---------------------------------------------------------------------------
  // A SUNDAY WITH NO MEETING SAYS SO, AND OFFERS NOTHING TO PLAN
  // ---------------------------------------------------------------------------
  it("renders a sentence and no pill row on a no-meeting Sunday", () => {
    render(<SundayCard {...props({ type: "stake_conference" })} />);

    expect(screen.getByText(/No sacrament meeting/)).toBeInTheDocument();
    expect(screen.queryByText(/^Conducting:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Topics/)).not.toBeInTheDocument();
    // The heading is still the programme link — a stake-conference Sunday has no meeting to plan
    // but the page behind it is what says so.
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("keeps the pill row on a holiday, which still holds a meeting", () => {
    render(<SundayCard {...props({ type: "holiday" })} />);

    expect(screen.queryByText(/No sacrament meeting/)).not.toBeInTheDocument();
    expect(screen.getByText("Topics 0/3")).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // THE ANCHOR TARGET
  // ---------------------------------------------------------------------------
  it("carries an id so a deep link can land on one Sunday", () => {
    const { container } = render(<SundayCard {...props()} />);

    expect(container.querySelector("#sunday-sunday-1")).not.toBeNull();
  });

  // The visible text repeats six labels per card and up to thirty per month, so a screen reader
  // moving link to link needs the date on each one.
  it("names the Sunday in every pill's accessible name", () => {
    const { container } = render(<SundayCard {...props()} />);

    // Scoped to the pill row. The conducting link is deliberately NOT given an aria-label — its
    // text is a person's name, which is what a screen reader should read.
    const pillLinks = [...container.querySelectorAll("li a")];

    expect(pillLinks).toHaveLength(4);
    for (const link of pillLinks) {
      expect(link.getAttribute("aria-label")).toContain("Sunday, March 7");
    }
  });
});

// ---------------------------------------------------------------------------
// THE FINALIZE CHECKMARK — p4-sacrament-b2
// ---------------------------------------------------------------------------
// The prototype's `FinalizablePill`: "handy to be able to just do it from the pill". It writes the
// same column as the page's own button, so there is nothing here about a second system — what
// these assertions pin is the SHAPE, which is where this kind of control goes wrong.
describe("SundayCard — the topics finalize checkmark", () => {
  const FINALIZE_NAME = /^Topics are decided/;

  it("offers it on the Topics pill to somebody who may finalize", () => {
    render(<SundayCard {...props({ canFinalizeTopics: true })} />);

    expect(screen.getByRole("button", { name: FINALIZE_NAME })).toBeInTheDocument();
  });

  // ABSENT, NEVER DISABLED. `topics.manage` is bishopric-only while this page gates on
  // `talks.view`, which a music coordinator holds — so a rendered-and-refused control is exactly
  // the youth-a-D1 failure, and a DISABLED one would look broken while claiming to be a rule.
  it("withholds it entirely from somebody who may not", () => {
    render(<SundayCard {...props({ canFinalizeTopics: false })} />);

    expect(screen.queryByRole("button", { name: FINALIZE_NAME })).toBeNull();
    // The pill itself is untouched — this withholds a control, not information.
    expect(screen.getByText("Topics 0/3")).toBeInTheDocument();
  });

  // ONE CONTROL, ON THE TOPICS PILL ALONE. The other three pills carry `finalized: null` and must
  // not grow a checkmark when a later slice adds one to References or Talks.
  it("offers exactly one, and it is beside Topics", () => {
    const { container } = render(<SundayCard {...props({ canFinalizeTopics: true })} />);

    expect(screen.getAllByRole("button", { name: FINALIZE_NAME })).toHaveLength(1);

    const topicsItem = screen.getByText("Topics 0/3").closest("li");
    expect(topicsItem).not.toBeNull();
    expect(within(topicsItem!).getByRole("button", { name: FINALIZE_NAME })).toBeInTheDocument();
    // Toggle buttons only: the References pill is itself a button, and carries no checkmark here
    // because this reader holds `topics.manage` but not `talks.plan` in the fixture.
    expect(container.querySelectorAll("li button[aria-pressed]")).toHaveLength(1);
  });

  // ⚠️ A <button> INSIDE AN <a> IS INVALID HTML and leaves a screen reader able to reach neither.
  // SundayCard already avoids exactly this for the card link with a stretched pseudo-element;
  // this is the same trap one level down, and it is the single most likely way to build this
  // control wrong.
  it("renders the checkmark as a SIBLING of the pill link, never inside it", () => {
    render(<SundayCard {...props({ canFinalizeTopics: true })} />);

    const button = screen.getByRole("button", { name: FINALIZE_NAME });

    expect(button.closest("a")).toBeNull();
  });

  // aria-pressed, so the state is announced rather than only coloured — and the accessible NAME
  // is the same in both states, so the control does not read as a different one after a press.
  it("reports its state with aria-pressed and keeps one name", () => {
    const { unmount } = render(<SundayCard {...props({ canFinalizeTopics: true })} />);

    expect(screen.getByRole("button", { name: FINALIZE_NAME })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    unmount();

    render(
      <SundayCard
        {...props({
          canFinalizeTopics: true,
          pills: sundayPills(statusInput({ topicsFinalized: true })),
        })}
      />,
    );

    expect(screen.getByRole("button", { name: FINALIZE_NAME })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  // The count and the finalize state are INDEPENDENT, and that is the decision rather than an
  // accident: decisions.md §1.15 forbids deriving one from the other, so a Sunday with every slot
  // filled is still un-finalized until somebody says so.
  it("leaves a full Topics pill un-finalized until somebody says otherwise", () => {
    render(
      <SundayCard
        {...props({
          canFinalizeTopics: true,
          pills: sundayPills(
            statusInput({
              assignments: [
                { topicId: "t1", memberId: "m1", externalSpeakerName: null, stage: "plan" },
                { topicId: "t2", memberId: "m2", externalSpeakerName: null, stage: "plan" },
                { topicId: "t3", memberId: "m3", externalSpeakerName: null, stage: "plan" },
              ],
            }),
          ),
        })}
      />,
    );

    expect(screen.getByText("Topics 3/3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: FINALIZE_NAME })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

// ---------------------------------------------------------------------------
// THE REFERENCES PILL — p4-sacrament-c
// ---------------------------------------------------------------------------
// The one pill that is a BUTTON: it opens a modal on the hub, and there is no page for it to link
// to. Every other pill stays an <a> to its href.
describe("SundayCard — the References pill", () => {
  const PILL_NAME = /^References,/;
  const CHECK_NAME = /^References are ready/;

  // The bishopric reads references; the pill is theirs (migration 080).
  const bishopric = (overrides: Partial<SundayCardProps> = {}) =>
    props({ canPlanTalks: true, ...overrides });

  it("renders as a button, never a link, and sits directly after Topics", () => {
    const { container } = render(<SundayCard {...bishopric()} />);

    const pill = screen.getByRole("button", { name: PILL_NAME });
    expect(pill.closest("a")).toBeNull();
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");

    const items = [...container.querySelectorAll("ul > li")].map((item) => item.textContent);
    expect(items[0]).toContain("Topics");
    expect(items[1]).toContain("Refs 0");
  });

  it("keeps every other pill a link to its href", () => {
    render(<SundayCard {...bishopric()} />);

    expect(screen.getByRole("link", { name: /^Topics/ })).toHaveAttribute("href", HREFS.topics);
    expect(screen.getByRole("link", { name: /^Talks/ })).toHaveAttribute("href", HREFS.talks);
    expect(screen.getByRole("link", { name: /^Prayer/ })).toHaveAttribute("href", HREFS.prayer);
    expect(screen.getByRole("link", { name: /^Music/ })).toHaveAttribute("href", HREFS.music);
  });

  it("reads `Refs: skipped` on a skipped Sunday", () => {
    render(
      <SundayCard
        {...bishopric({
          pills: sundayPills(statusInput({ references: { count: 0, decision: "skipped" } })),
        })}
      />,
    );

    expect(screen.getByText("Refs: skipped")).toBeInTheDocument();
  });

  // Defect 074-D2: "there should be no reason a music coordinator sees the references". Absent —
  // not a read-only pill, not a disabled one.
  it("is not rendered at all without talks.plan", () => {
    const { container } = render(<SundayCard {...props({ canPlanTalks: false })} />);

    expect(screen.queryByRole("button", { name: PILL_NAME })).toBeNull();
    expect(screen.queryByRole("button", { name: CHECK_NAME })).toBeNull();
    expect(container.textContent).not.toContain("Refs");
    // Every other pill is untouched.
    expect(screen.getByRole("link", { name: /^Topics/ })).toBeInTheDocument();
  });

  it("carries its checkmark for the bishopric", () => {
    render(<SundayCard {...bishopric()} />);

    expect(screen.getByRole("button", { name: CHECK_NAME })).toBeInTheDocument();
  });

  // Nothing to finalize yet: disabled WITH its reason, which is present as text, not only a title.
  it("disables the checkmark at zero references and says why", () => {
    render(<SundayCard {...bishopric()} />);

    const check = screen.getByRole("button", { name: CHECK_NAME });
    expect(check).toBeDisabled();
    expect(screen.getByText("Add a reference or skip first")).toBeInTheDocument();
  });

  it("presses the checkmark on a finalized or skipped Sunday", () => {
    render(
      <SundayCard
        {...bishopric({
          pills: sundayPills(statusInput({ references: { count: 2, decision: "finalized" } })),
        })}
      />,
    );

    const check = screen.getByRole("button", { name: CHECK_NAME });
    expect(check).toHaveAttribute("aria-pressed", "true");
    expect(check).not.toBeDisabled();
  });

  it("does not offer a References pill on a Sunday with no speaking slots", () => {
    render(
      <SundayCard
        {...bishopric({
          type: "fast_sunday",
          pills: sundayPills(statusInput({ speakingSlots: 0 })),
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: PILL_NAME })).toBeNull();
  });
});
