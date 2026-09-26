import { describe, expect, it } from "vitest";
import { describeHistoryOutcome } from "@/lib/assignments/historyOutcome";
import {
  NO_CONTACT_LINE,
  TALKS_LOCK_REASON_TEXT,
  VISITOR_CONTACT_LINE,
  askContactLine,
  buildAskNotes,
  buildAskTitle,
  countTalksNeedingAsk,
  talkNeedsAsk,
  talksAskState,
  type TalkAskInput,
} from "@/lib/sacrament/talkAsks";
import { MAX_TODO_NOTES, MAX_TODO_TITLE } from "@/lib/validation/todo";
import { REQUEST_OUTCOMES, type RequestOutcome } from "@/types/domain";

// Sacrament slice f1: the pure rules for asking a Sunday's speakers.

function talk(overrides: Partial<TalkAskInput> = {}): TalkAskInput {
  return { hasSpeaker: true, requestOutcome: null, openAskCount: 0, ...overrides };
}

describe("talkNeedsAsk", () => {
  const outcomes: (RequestOutcome | null)[] = [null, ...REQUEST_OUTCOMES];

  // Every combination, so a later edit to one clause cannot quietly change another row.
  it.each(
    [true, false].flatMap((hasSpeaker) =>
      [0, 1, 2].flatMap((openAskCount) =>
        outcomes.map((requestOutcome) => ({ hasSpeaker, openAskCount, requestOutcome })),
      ),
    ),
  )("$hasSpeaker speaker, $openAskCount open, outcome $requestOutcome", (input) => {
    const expected =
      input.hasSpeaker &&
      input.openAskCount === 0 &&
      (input.requestOutcome === null || input.requestOutcome === "pending");

    expect(talkNeedsAsk(input)).toBe(expected);
  });

  it("does not ask an empty slot", () => {
    expect(talkNeedsAsk(talk({ hasSpeaker: false }))).toBe(false);
  });

  it("does not ask somebody who already holds an open ask — a second Send sends nothing", () => {
    expect(talkNeedsAsk(talk({ openAskCount: 1 }))).toBe(false);
  });

  it("does not ask somebody whose answer is already recorded", () => {
    expect(talkNeedsAsk(talk({ requestOutcome: "accepted" }))).toBe(false);
    expect(talkNeedsAsk(talk({ requestOutcome: "declined" }))).toBe(false);
  });

  it("counts only the talks that need one", () => {
    expect(
      countTalksNeedingAsk([talk(), talk({ openAskCount: 1 }), talk({ hasSpeaker: false }), talk()]),
    ).toBe(2);
  });
});

describe("talksAskState", () => {
  const decided = { referencesDecided: true, hasConductor: true };

  it("is locked until References is finalized or skipped", () => {
    expect(talksAskState({ referencesDecided: false, hasConductor: true, talks: [talk()] })).toEqual(
      { kind: "locked", reason: "references_open" },
    );
  });

  it("is locked with no speaker to ask", () => {
    expect(talksAskState({ ...decided, talks: [talk({ hasSpeaker: false })] })).toEqual({
      kind: "locked",
      reason: "no_speaker",
    });
    expect(talksAskState({ ...decided, talks: [] })).toEqual({
      kind: "locked",
      reason: "no_speaker",
    });
  });

  it("is locked with speakers to ask and nobody conducting", () => {
    expect(talksAskState({ ...decided, hasConductor: false, talks: [talk()] })).toEqual({
      kind: "locked",
      reason: "no_conductor",
    });
  });

  it("keeps an already-sent state when the conductor is cleared", () => {
    expect(
      talksAskState({ ...decided, hasConductor: false, talks: [talk({ openAskCount: 1 })] }),
    ).toEqual({ kind: "pending" });
  });

  it("counts the speakers not yet asked", () => {
    expect(
      talksAskState({ ...decided, talks: [talk(), talk(), talk({ openAskCount: 1 })] }),
    ).toEqual({ kind: "not_asked", count: 2 });
  });

  it("is pending once everyone is asked and not everyone has accepted", () => {
    expect(
      talksAskState({
        ...decided,
        talks: [talk({ openAskCount: 1 }), talk({ requestOutcome: "accepted" })],
      }),
    ).toEqual({ kind: "pending" });
  });

  it("is accepted when every speaker has accepted, ignoring empty slots", () => {
    expect(
      talksAskState({
        ...decided,
        talks: [talk({ requestOutcome: "accepted" }), talk({ hasSpeaker: false })],
      }),
    ).toEqual({ kind: "accepted" });
  });

  describe("precedence: declined > not asked > pending > accepted", () => {
    it("puts a decline above speakers not yet asked", () => {
      expect(
        talksAskState({
          ...decided,
          talks: [talk({ requestOutcome: "declined", hasSpeaker: false }), talk()],
        }),
      ).toEqual({ kind: "declined", count: 1 });
    });

    // A decline clears the speaker, so the only speaker saying no leaves NO speaker. Checking for
    // a speaker first would dim the pill over the one state that needs somebody to act.
    it("shows a decline even when it left the Sunday with no speaker at all", () => {
      expect(
        talksAskState({
          ...decided,
          talks: [talk({ requestOutcome: "declined", hasSpeaker: false })],
        }),
      ).toEqual({ kind: "declined", count: 1 });
    });

    it("puts speakers not yet asked above pending ones", () => {
      expect(
        talksAskState({ ...decided, talks: [talk({ openAskCount: 1 }), talk()] }),
      ).toEqual({ kind: "not_asked", count: 1 });
    });

    it("keeps the References lock above everything, a decline included", () => {
      expect(
        talksAskState({
          referencesDecided: false,
          hasConductor: true,
          talks: [talk({ requestOutcome: "declined" })],
        }),
      ).toEqual({ kind: "locked", reason: "references_open" });
    });
  });

  it("has a sentence for every lock reason", () => {
    for (const text of Object.values(TALKS_LOCK_REASON_TEXT)) {
      expect(text.trim()).not.toBe("");
    }
  });
});

describe("buildAskNotes", () => {
  const base = {
    speakerName: "Maria Lopez",
    onRoster: true,
    phone: "801-555-0101",
    topicTitle: "Faith in Jesus Christ",
    sundayDate: "2027-03-07",
    references: ["Alma 32:21", "Hebrews 11:1"],
  } as const;

  it("carries a member's phone, the Sunday in words, the topic and one reference per line", () => {
    expect(buildAskNotes(base)).toBe(
      [
        "Speaker: Maria Lopez",
        "Phone: 801-555-0101",
        "Sunday: Sunday, March 7, 2027",
        "Topic: Faith in Jesus Christ",
        "References:",
        "- Alma 32:21",
        "- Hebrews 11:1",
      ].join("\n"),
    );
  });

  it("says so when a member has no phone on file", () => {
    const notes = buildAskNotes({ ...base, phone: null });
    expect(notes).toContain(NO_CONTACT_LINE);
    expect(notes).not.toContain("Phone:");

    expect(buildAskNotes({ ...base, phone: "   " })).toContain(NO_CONTACT_LINE);
  });

  it("marks a visitor as not on the roster, never showing a phone", () => {
    const notes = buildAskNotes({ ...base, onRoster: false, phone: "801-555-0101" });
    expect(notes).toContain(VISITOR_CONTACT_LINE);
    expect(notes).not.toContain("801-555-0101");
  });

  it("leaves the references section out when there are none", () => {
    const notes = buildAskNotes({ ...base, references: [], topicTitle: null });
    expect(notes).not.toContain("References");
    expect(notes).toContain("Topic: No topic yet");
  });

  // A `date` column is a day with no zone. In a zone west of Greenwich, a local formatter would
  // print Saturday.
  it("formats the Sunday in UTC, so it never slips to the Saturday", () => {
    expect(buildAskNotes({ ...base, sundayDate: "2027-01-03" })).toContain(
      "Sunday: Sunday, January 3, 2027",
    );
  });

  it("stays within the to-do's notes limit", () => {
    const notes = buildAskNotes({ ...base, references: Array(500).fill("Doctrine and Covenants 121:45") });
    expect(notes.length).toBeLessThanOrEqual(MAX_TODO_NOTES);
  });
});

describe("askContactLine", () => {
  it("gives a member's phone, or says there is none", () => {
    expect(askContactLine({ speakerName: "Maria", onRoster: true, phone: "801-555-0101" })).toBe(
      "Phone: 801-555-0101",
    );
    expect(askContactLine({ speakerName: "Tomas", onRoster: true, phone: null })).toBe(
      NO_CONTACT_LINE,
    );
    expect(askContactLine({ speakerName: "Tomas", onRoster: true, phone: "  " })).toBe(
      NO_CONTACT_LINE,
    );
  });

  it("marks a visitor, whatever phone is passed", () => {
    expect(askContactLine({ speakerName: "Brother Visitor", onRoster: false, phone: "1" })).toBe(
      VISITOR_CONTACT_LINE,
    );
  });

  // A decline clears the speaker. "No contact on file" would then describe nobody.
  it("says nothing once the talk has no speaker", () => {
    expect(askContactLine({ speakerName: null, onRoster: false, phone: null })).toBeNull();
  });
});

describe("buildAskTitle", () => {
  it("names the speaker", () => {
    expect(buildAskTitle("Maria Lopez")).toBe("Ask Maria Lopez to speak");
  });

  it("stays within the to-do's title limit", () => {
    expect(buildAskTitle("x".repeat(400)).length).toBeLessThanOrEqual(MAX_TODO_TITLE);
  });
});

describe("describeHistoryOutcome", () => {
  it("names a decline's reason and the kind of assignment", () => {
    expect(describeHistoryOutcome({ outcome: "declined", declineReason: "not_available" })).toBe(
      "Declined — Not available · Talk",
    );
    expect(describeHistoryOutcome({ outcome: "declined", declineReason: "other" })).toBe(
      "Declined — Other · Talk",
    );
  });

  it("reads a plain Declined for a decline recorded before reasons existed", () => {
    expect(describeHistoryOutcome({ outcome: "declined", declineReason: null })).toBe(
      "Declined · Talk",
    );
  });

  it("labels every other outcome as a talk too", () => {
    expect(describeHistoryOutcome({ outcome: "completed", declineReason: null })).toBe("Spoke · Talk");
    expect(describeHistoryOutcome({ outcome: null, declineReason: null })).toBe("Not recorded");
  });
});
