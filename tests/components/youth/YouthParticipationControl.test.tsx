// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { YouthParticipationControl } from "@/components/youth/YouthParticipationControl";
import type { EventParticipation, RosterMember } from "@/lib/youth/roster";

// SUCCESS CRITERION 5, AND THIS IS THE ONLY PLACE A TEST RATHER THAN A WALK CAN CATCH IT.
//
// youth-i rendered a fieldset on EVERY event card reading "Is Ethan taking part?" with an
// unselected Yes and an unselected No. It was optional and it blocked nothing — and the user,
// seeing one screenshot, asked whether every connection between a youth and an event now had to
// be confirmed. It never did. BUT A CONTROL THAT HAS TO BE EXPLAINED IS A CONTROL THAT IS WRONG,
// and on a team of eight it would have read as eight questions per game.
//
// So the assertion this file exists for is a NEGATIVE one: by default there is no question, no
// fieldset and no unselected radio anywhere. A negative like that is invisible to every other
// kind of test — a route test cannot see it, a walk sees it only if somebody looks — so it is
// pinned here, where a regression fails a build.

const ETHAN: RosterMember = {
  rosterId: "r-ethan",
  profileId: "profile-basketball",
  memberId: "m-ethan",
  memberName: "Ethan Brooks",
  startedOn: null,
  endedOn: null,
};

const JOSH: RosterMember = { ...ETHAN, rosterId: "r-josh", memberId: "m-josh", memberName: "Josh Kim" };

function renderControl(options: {
  members?: readonly RosterMember[];
  participation?: readonly EventParticipation[];
  canManage?: boolean;
  onSet?: (memberId: string, takingPart: boolean | null) => void;
}) {
  const onSet = options.onSet ?? vi.fn();

  render(
    <YouthParticipationControl
      eventId="event-1"
      expectedMembers={options.members ?? [ETHAN, JOSH]}
      participation={options.participation ?? []}
      canManage={options.canManage ?? true}
      pending={false}
      onSet={onSet}
    />,
  );

  return onSet;
}

describe("YouthParticipationControl — nothing is asked by default", () => {
  // THE HEADLINE ASSERTION. Everything else in this file is a supporting case.
  it("renders NO question, NO fieldset and NO unselected answer before it is opened", () => {
    renderControl({});

    // No standing question anywhere.
    expect(screen.queryByText(/taking part\?/i)).toBeNull();
    expect(screen.queryByRole("group")).toBeNull();

    // No answer buttons at all — not disabled ones, not unselected ones. ABSENT.
    expect(screen.queryByRole("button", { name: "Not taking part" })).toBeNull();
    expect(screen.queryByRole("button", { name: "They were there" })).toBeNull();

    // And no young person's name is rendered by this control in its resting state: the card
    // already lists who is expected, and repeating it here would be the duplication ITER-022 is
    // about.
    expect(screen.queryByText("Ethan Brooks")).toBeNull();
  });

  it("offers exactly ONE quiet disclosure, worded as an exception", () => {
    renderControl({});

    const disclosure = screen.getByRole("button", { name: "Somebody wasn't there?" });

    // A DISCLOSURE, NOT AN ANSWER. `aria-expanded` is what tells a screen reader this reveals
    // something rather than recording something.
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
  });

  // ABSENT rather than present-and-refusing, which is the mirror of youth-a-D1. A reader without
  // `youth_activities.manage` gets no control at all — but they still see the CHIPS, because a
  // recorded absence is a fact about the game rather than a control (see the next block).
  it("renders no control at all without `youth_activities.manage`", () => {
    renderControl({ canManage: false });

    expect(screen.queryByRole("button")).toBeNull();
  });

  // NOTHING TO ASK ABOUT. A ward-wide event, or a team nobody has been assigned to yet — the
  // state ITER-033's own flow passes through — renders nothing rather than an empty panel.
  it("renders nothing at all when nobody is on the team", () => {
    const { container } = render(
      <YouthParticipationControl
        eventId="event-1"
        expectedMembers={[]}
        participation={[]}
        canManage
        pending={false}
        onSet={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe("YouthParticipationControl — a recorded absence", () => {
  // OUTSIDE THE DISCLOSURE, ALWAYS VISIBLE. A recorded absence is a fact about the game and must
  // not need a click, exactly as a cancelled game is marked on its own card.
  it("shows the chip without the disclosure being opened", () => {
    renderControl({ participation: [{ memberId: "m-ethan", takingPart: false }] });

    expect(screen.getByText("Ethan Brooks is not taking part")).toBeTruthy();
    // Still no question.
    expect(screen.queryByRole("button", { name: "Not taking part" })).toBeNull();
  });

  // ONE CHIP PER ABSENT YOUNG PERSON, which is new with youth-j: an event serves a whole team, so
  // a game can carry several. A single chip naming one of two would be a card that under-reports.
  it("shows one chip per absent young person", () => {
    renderControl({
      participation: [
        { memberId: "m-ethan", takingPart: false },
        { memberId: "m-josh", takingPart: false },
      ],
    });

    expect(screen.getByText("Ethan Brooks is not taking part")).toBeTruthy();
    expect(screen.getByText("Josh Kim is not taking part")).toBeTruthy();
  });

  // `true` AND absence BOTH RENDER NOTHING. Taking part is the ordinary case and a chip on every
  // card saying so is noise — describeYouthAbsence()'s rule, asserted from the outside.
  it("shows no chip for a young person confirmed as taking part", () => {
    renderControl({ participation: [{ memberId: "m-ethan", takingPart: true }] });

    expect(screen.queryByText(/is not taking part/)).toBeNull();
  });

  // THE CHIP IS SHOWN TO EVERYBODY, INCLUDING SOMEBODY WHO CANNOT CHANGE IT. Hiding the fact
  // behind the permission would leave a reader wondering why a game raises no alarm.
  it("shows the chip even without the permission to change it", () => {
    renderControl({
      canManage: false,
      participation: [{ memberId: "m-ethan", takingPart: false }],
    });

    expect(screen.getByText("Ethan Brooks is not taking part")).toBeTruthy();
  });
});

describe("YouthParticipationControl — opening it and answering", () => {
  it("reveals one row per young person once opened", () => {
    renderControl({});

    fireEvent.click(screen.getByRole("button", { name: "Somebody wasn't there?" }));

    expect(screen.getByText("Ethan Brooks")).toBeTruthy();
    expect(screen.getByText("Josh Kim")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Not taking part" })).toHaveLength(2);
  });

  it("writes `false` for the young person whose row was pressed, and nobody else", () => {
    const onSet = renderControl({});

    fireEvent.click(screen.getByRole("button", { name: "Somebody wasn't there?" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Not taking part" })[0]);

    expect(onSet).toHaveBeenCalledTimes(1);
    expect(onSet).toHaveBeenCalledWith("m-ethan", false);
  });

  // ---------------------------------------------------------------------------
  // PRESSING THE ACTIVE ANSWER AGAIN CLEARS TO `null`, NEVER TO THE OPPOSITE CLAIM
  // ---------------------------------------------------------------------------
  // A CONTROL THAT CAN SET A VALUE AND NOT UNSET IT IS A ONE-WAY DOOR ON A METRIC. Marking the
  // wrong game — or the right game for the wrong young person — must be undoable, and undoable to
  // "nobody has said" rather than to "they were there", which is a different claim nobody made.
  // Migration 060a's rule for `closed_at`, kept by youth-i and kept again here.
  it("clears to null when the active answer is pressed again", () => {
    const onSet = renderControl({
      participation: [{ memberId: "m-ethan", takingPart: false }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Somebody wasn't there?" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Not taking part" })[0]);

    expect(onSet).toHaveBeenCalledWith("m-ethan", null);
  });

  it("clears to null when an active `They were there` is pressed again", () => {
    const onSet = renderControl({
      participation: [{ memberId: "m-ethan", takingPart: true }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Somebody wasn't there?" }));
    fireEvent.click(screen.getAllByRole("button", { name: "They were there" })[0]);

    expect(onSet).toHaveBeenCalledWith("m-ethan", null);
  });

  // THE ANSWER MUST BE CONVEYED BY MORE THAN COLOUR (ITER-022), and `aria-pressed` on ONE button
  // and not the other is worse than neither — a screen reader would hear two identically named
  // buttons and be unable to tell which answer is stored.
  it("carries aria-pressed on BOTH answers, in every state", () => {
    renderControl({ participation: [{ memberId: "m-ethan", takingPart: false }] });

    fireEvent.click(screen.getByRole("button", { name: "Somebody wasn't there?" }));

    const notTakingPart = screen.getAllByRole("button", { name: "Not taking part" });
    const wereThere = screen.getAllByRole("button", { name: "They were there" });

    // Ethan is marked absent.
    expect(notTakingPart[0].getAttribute("aria-pressed")).toBe("true");
    expect(wereThere[0].getAttribute("aria-pressed")).toBe("false");

    // Josh has no answer at all — BOTH read false, which is "nobody has said" rather than a third
    // rendering of a third state.
    expect(notTakingPart[1].getAttribute("aria-pressed")).toBe("false");
    expect(wereThere[1].getAttribute("aria-pressed")).toBe("false");
  });

  it("closes again without recording anything", () => {
    const onSet = renderControl({});

    fireEvent.click(screen.getByRole("button", { name: "Somebody wasn't there?" }));
    fireEvent.click(screen.getByRole("button", { name: "Never mind" }));

    expect(screen.queryByRole("button", { name: "Not taking part" })).toBeNull();
    expect(onSet).not.toHaveBeenCalled();
  });
});
