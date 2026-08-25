import { describe, expect, it } from "vitest";
import {
  buildHymnSuggestionPrompt,
  hymnSuggestionsSchema,
  validateSuggestions,
  type RawHymnSuggestion,
} from "@/lib/ai/hymnSuggestions";
import type { HymnCandidate } from "@/lib/music/hymnCandidates";

// THE PHASE PLAN'S NAMED TEST.
//
// 06-program-music.md asks for one thing above the rest: a suggested hymn number that is not in
// the table must be rejected. ITER-016 recorded two confirmed-wrong AI citations out of fifteen
// and noted that a mostly-right batch is worse than an all-wrong one, because it teaches people
// to trust the rest. A hymn number is that failure with a congregation singing the result.

const CANDIDATES: HymnCandidate[] = [
  { number: 19, title: "We Thank Thee, O God, for a Prophet", tags: ["prophets", "gratitude"] },
  { number: 85, title: "How Firm a Foundation", tags: ["faith", "trust"] },
  { number: 241, title: "Count Your Blessings", tags: ["gratitude", "hope"] },
];

function suggestion(overrides: Partial<RawHymnSuggestion> = {}): RawHymnSuggestion {
  return {
    number: 19,
    title: "We Thank Thee, O God, for a Prophet",
    reason: "It answers the talk on following living prophets.",
    ...overrides,
  };
}

describe("hymnSuggestionsSchema", () => {
  it("accepts a well-formed suggestion", () => {
    expect(hymnSuggestionsSchema.safeParse({ suggestions: [suggestion()] }).success).toBe(true);
  });

  it("refuses a non-integer hymn number", () => {
    const parsed = hymnSuggestionsSchema.safeParse({
      suggestions: [suggestion({ number: 19.5 })],
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses an empty list", () => {
    expect(hymnSuggestionsSchema.safeParse({ suggestions: [] }).success).toBe(false);
  });

  it("refuses a reason too short to be a reason", () => {
    const parsed = hymnSuggestionsSchema.safeParse({
      suggestions: [suggestion({ reason: "Good." })],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("validateSuggestions — a number not in the table is rejected", () => {
  it("drops a hymn number that was never a candidate", () => {
    const { kept, droppedNumbers } = validateSuggestions(
      [suggestion({ number: 402, title: "A Hymn That Does Not Exist" })],
      CANDIDATES,
    );

    expect(kept).toEqual([]);
    expect(droppedNumbers).toEqual([402]);
  });

  it("keeps the good ones and drops the invented one from the same batch", () => {
    // The exact mixture ITER-016 describes: mostly right, one wrong. The wrong one must not
    // survive because its neighbours were fine.
    const { kept, droppedNumbers } = validateSuggestions(
      [
        suggestion({ number: 19 }),
        suggestion({ number: 999, title: "Invented" }),
        suggestion({ number: 241, title: "Count Your Blessings" }),
      ],
      CANDIDATES,
    );

    expect(kept.map((entry) => entry.number)).toEqual([19, 241]);
    expect(droppedNumbers).toEqual([999]);
  });

  it("drops a repeated number rather than listing the same hymn twice", () => {
    const { kept, droppedNumbers } = validateSuggestions(
      [suggestion({ number: 85 }), suggestion({ number: 85 })],
      CANDIDATES,
    );

    expect(kept).toHaveLength(1);
    expect(droppedNumbers).toEqual([85]);
  });

  it("rejects everything when every number is invented", () => {
    // The route turns an empty `kept` into an AiRequestError with its own sentence rather than
    // an empty list — see the route test. Here we only prove nothing survives.
    const { kept, droppedNumbers } = validateSuggestions(
      [suggestion({ number: 500 }), suggestion({ number: 501 })],
      CANDIDATES,
    );

    expect(kept).toEqual([]);
    expect(droppedNumbers).toEqual([500, 501]);
  });
});

describe("validateSuggestions — the table's title wins", () => {
  it("replaces a mistyped title with the one in the table", () => {
    const { kept } = validateSuggestions(
      [suggestion({ number: 85, title: "How Firm a Foundashun" })],
      CANDIDATES,
    );

    expect(kept[0].title).toBe("How Firm a Foundation");
  });

  // The asymmetry that matters: a right number with a wrong title is recoverable, a right title
  // with a wrong number is not. The number is what gets printed and sung.
  it("does not rescue a wrong number that carries a real title", () => {
    const { kept } = validateSuggestions(
      [suggestion({ number: 86, title: "How Firm a Foundation" })],
      CANDIDATES,
    );

    expect(kept).toEqual([]);
  });

  it("keeps the model's reason, trimmed", () => {
    const { kept } = validateSuggestions(
      [suggestion({ reason: "  It fits the topic on gratitude.  " })],
      CANDIDATES,
    );

    expect(kept[0].reason).toBe("It fits the topic on gratitude.");
  });
});

describe("buildHymnSuggestionPrompt", () => {
  it("puts every candidate number and title in the prompt", () => {
    const prompt = buildHymnSuggestionPrompt({
      sundayLabel: "Sunday, July 4, 2027",
      hymnType: null,
      topicTitles: ["Gratitude in Every Season"],
      candidates: CANDIDATES,
      count: 3,
    });

    for (const candidate of CANDIDATES) {
      expect(prompt).toContain(String(candidate.number));
      expect(prompt).toContain(candidate.title);
    }
  });

  it("tells the model it may choose from nothing else", () => {
    const prompt = buildHymnSuggestionPrompt({
      sundayLabel: "Sunday, July 4, 2027",
      hymnType: null,
      topicTitles: [],
      candidates: CANDIDATES,
      count: 3,
    });

    expect(prompt).toContain("Choose only from these hymns");
  });

  it("names the slot when one was asked for", () => {
    const prompt = buildHymnSuggestionPrompt({
      sundayLabel: "Sunday, July 4, 2027",
      hymnType: "sacrament",
      topicTitles: [],
      candidates: CANDIDATES,
      count: 3,
    });

    expect(prompt).toContain("sacrament hymn");
  });

  it("says plainly when a Sunday has no topics rather than leaving a gap", () => {
    const prompt = buildHymnSuggestionPrompt({
      sundayLabel: "Sunday, July 4, 2027",
      hymnType: null,
      topicTitles: [],
      candidates: CANDIDATES,
      count: 3,
    });

    expect(prompt).toContain("No talk topics have been assigned");
  });

  it("lists the topics when there are some", () => {
    const prompt = buildHymnSuggestionPrompt({
      sundayLabel: "Sunday, July 4, 2027",
      hymnType: null,
      topicTitles: ["Gratitude in Every Season", "Bearing One Another's Burdens"],
      candidates: CANDIDATES,
      count: 3,
    });

    expect(prompt).toContain("Gratitude in Every Season");
    expect(prompt).toContain("Bearing One Another's Burdens");
    // Plural, because there are two (ai-b's plural bug).
    expect(prompt).toContain("talks that Sunday are");
  });

  it("uses the singular for one topic", () => {
    const prompt = buildHymnSuggestionPrompt({
      sundayLabel: "Sunday, July 4, 2027",
      hymnType: null,
      topicTitles: ["Gratitude in Every Season"],
      candidates: CANDIDATES,
      count: 3,
    });

    expect(prompt).toContain("talk that Sunday is");
  });
});
