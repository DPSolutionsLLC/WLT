import { describe, expect, it } from "vitest";
import {
  MAX_CANDIDATES,
  buildCandidates,
  topicKeywords,
  type CandidateHymn,
} from "@/lib/music/hymnCandidates";
import { placeholderTitle } from "@/lib/music/hymnSource";

// Pure. The candidate list is the whole ITER-016 mitigation — it is what the model ranks instead
// of recalling — so it is tested without a network or a model anywhere near it.

const HYMNS: CandidateHymn[] = [
  { number: 2, title: "The Spirit of God", topicTags: ["restoration", "temple", "praise"] },
  { number: 19, title: "We Thank Thee, O God, for a Prophet", topicTags: ["prophets", "gratitude"] },
  { number: 30, title: "Come, Come, Ye Saints", topicTags: ["pioneers", "perseverance", "faith"] },
  { number: 85, title: "How Firm a Foundation", topicTags: ["faith", "trust", "scriptures"] },
  { number: 169, title: "As Now We Take the Sacrament", topicTags: ["sacrament", "covenants"] },
  { number: 173, title: "While of These Emblems We Partake", topicTags: ["sacrament", "atonement"] },
  { number: 201, title: "Joy to the World", topicTags: ["christmas", "second_coming", "joy"] },
  { number: 241, title: "Count Your Blessings", topicTags: ["gratitude", "trials", "hope"] },
  { number: 301, title: "I Am a Child of God", topicTags: ["children", "identity"] },
];

function numbersFrom(candidates: { number: number }[]): number[] {
  return candidates.map((candidate) => candidate.number);
}

describe("topicKeywords", () => {
  it("keeps the words that carry meaning", () => {
    expect(topicKeywords(["Finding Peace in Times of Trial"])).toEqual([
      "finding",
      "peace",
      "times",
      "trial",
    ]);
  });

  it("drops stop words and short words", () => {
    const keywords = topicKeywords(["The Power of Faith and Hope"]);
    expect(keywords).not.toContain("the");
    expect(keywords).not.toContain("and");
    expect(keywords).not.toContain("of");
  });

  it("de-duplicates across topics", () => {
    const keywords = topicKeywords(["Gratitude in Trials", "Gratitude Every Day"]);
    expect(keywords.filter((word) => word === "gratitude")).toHaveLength(1);
  });

  it("returns nothing for no topics", () => {
    expect(topicKeywords([])).toEqual([]);
  });
});

describe("buildCandidates — candidates come from tags", () => {
  it("puts hymns matching a topic's words at the top", () => {
    const candidates = buildCandidates({
      topicTitles: ["Gratitude in Every Season"],
      hymns: HYMNS,
    });

    // 19 and 241 both carry the `gratitude` tag; nothing else does.
    expect(numbersFrom(candidates).slice(0, 2).sort()).toEqual([19, 241]);
  });

  it("matches a compound tag from one of its words", () => {
    const candidates = buildCandidates({
      topicTitles: ["The Second Coming"],
      hymns: HYMNS,
    });

    // Hymn 201 is the only one tagged `second_coming`.
    expect(numbersFrom(candidates)[0]).toBe(201);
  });

  it("scores a title match too, below a tag match", () => {
    const candidates = buildCandidates({
      topicTitles: ["Our Identity as Children of God"],
      hymns: HYMNS,
    });

    expect(numbersFrom(candidates)[0]).toBe(301);
  });
});

describe("buildCandidates — no topics", () => {
  // A coordinator often works ahead of the bishopric. A Sunday with no topics assigned is an
  // ordinary state and must produce a usable list, not an empty one.
  it("yields a sensible default set in number order", () => {
    const candidates = buildCandidates({ topicTitles: [], hymns: HYMNS });

    expect(numbersFrom(candidates)).toEqual([2, 19, 30, 85, 169, 173, 201, 241, 301]);
  });
});

describe("buildCandidates — the sacrament slot narrows the pool", () => {
  it("offers only sacrament hymns for the sacrament slot", () => {
    const candidates = buildCandidates({
      topicTitles: ["Joy and Christmas"],
      hymns: HYMNS,
      hymnType: "sacrament",
    });

    // "Joy to the World" scores highest on the topic and is still absent: a congregation does
    // not sing it while the sacrament is passed.
    expect(numbersFrom(candidates).sort()).toEqual([169, 173]);
  });

  it("does not narrow the pool for an opening or closing hymn", () => {
    const opening = buildCandidates({
      topicTitles: [],
      hymns: HYMNS,
      hymnType: "opening",
    });

    expect(numbersFrom(opening)).toHaveLength(HYMNS.length);
  });

  it("falls back to the whole pool when nothing carries the sacrament tag", () => {
    const untagged = HYMNS.map((hymn) => ({
      ...hymn,
      topicTags: hymn.topicTags.filter((tag) => tag !== "sacrament"),
    }));

    const candidates = buildCandidates({
      topicTitles: [],
      hymns: untagged,
      hymnType: "sacrament",
    });

    // Degrades to "suggests from everything" rather than to "suggests nothing" with no
    // explanation.
    expect(candidates).toHaveLength(untagged.length);
  });
});

describe("buildCandidates — placeholders are never suggestible", () => {
  it("excludes a placeholder even when nothing else matches", () => {
    const withPlaceholders: CandidateHymn[] = [
      ...HYMNS,
      { number: 43, title: placeholderTitle(43), topicTags: [] },
      { number: 44, title: placeholderTitle(44), topicTags: [] },
    ];

    const candidates = buildCandidates({ topicTitles: [], hymns: withPlaceholders });

    expect(numbersFrom(candidates)).not.toContain(43);
    expect(numbersFrom(candidates)).not.toContain(44);
  });

  it("returns nothing at all when every hymn is a placeholder", () => {
    const allPlaceholders: CandidateHymn[] = Array.from({ length: 20 }, (unused, index) => ({
      number: index + 1,
      title: placeholderTitle(index + 1),
      topicTags: [],
    }));

    // The route turns this into its own written sentence rather than calling Claude.
    expect(buildCandidates({ topicTitles: [], hymns: allPlaceholders })).toEqual([]);
  });
});

describe("buildCandidates — the list is bounded", () => {
  it("never exceeds MAX_CANDIDATES", () => {
    const many: CandidateHymn[] = Array.from({ length: 341 }, (unused, index) => ({
      number: index + 1,
      title: `A Real Hymn ${index + 1}`,
      topicTags: ["faith"],
    }));

    expect(buildCandidates({ topicTitles: ["Faith"], hymns: many })).toHaveLength(
      MAX_CANDIDATES,
    );
  });

  it("carries the number, the title and the tags for each candidate", () => {
    const [first] = buildCandidates({ topicTitles: ["Gratitude"], hymns: HYMNS });

    expect(first).toEqual({
      number: 19,
      title: "We Thank Thee, O God, for a Prophet",
      tags: ["prophets", "gratitude"],
    });
  });
});
