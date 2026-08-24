import { describe, expect, it } from "vitest";
import {
  buildRetrievalQuery,
  buildTopicSuggestionPrompt,
  filterNovelSuggestions,
  formatTalkCitation,
  normalizeTitle,
  topicSuggestionsSchema,
  type TopicSuggestion,
} from "@/lib/ai/topicSuggestions";
import { TOPIC_CATEGORIES } from "@/types/domain";

// Pure. No database, no network, no Claude — everything here is a function of its inputs, which
// is the whole reason lib/ai/topicSuggestions.ts holds no client.

function suggestion(overrides: Partial<TopicSuggestion> = {}): TopicSuggestion {
  return {
    title: "Bearing One Another's Burdens",
    category: "doctrinal",
    description: "What it asks of a congregation to carry each other's difficulties.",
    suggestedScriptures: ["Mosiah 18:8-9"],
    suggestedTalks: [],
    ...overrides,
  };
}

describe("topicSuggestionsSchema", () => {
  it("accepts a well-formed suggestion", () => {
    const parsed = topicSuggestionsSchema.safeParse({ topics: [suggestion()] });
    expect(parsed.success).toBe(true);
  });

  // The category union is shared with topic_candidates' CHECK constraint. A model returning
  // something outside it must fail HERE, at the parse, rather than as a constraint violation on
  // an insert the user has already waited for.
  it("refuses a category the topic_candidates CHECK would reject", () => {
    const parsed = topicSuggestionsSchema.safeParse({
      topics: [suggestion({ category: "sermon" as never })],
    });

    expect(parsed.success).toBe(false);
  });

  it("offers every category the database allows", () => {
    for (const category of TOPIC_CATEGORIES) {
      const parsed = topicSuggestionsSchema.safeParse({
        topics: [suggestion({ category })],
      });
      expect(parsed.success, `category ${category}`).toBe(true);
    }
  });

  it("refuses an empty batch", () => {
    expect(topicSuggestionsSchema.safeParse({ topics: [] }).success).toBe(false);
  });

  it("caps scriptures at five and talks at three", () => {
    expect(
      topicSuggestionsSchema.safeParse({
        topics: [suggestion({ suggestedScriptures: Array(6).fill("Alma 32:21") })],
      }).success,
    ).toBe(false);

    expect(
      topicSuggestionsSchema.safeParse({
        topics: [
          suggestion({
            suggestedTalks: Array(4).fill({
              speaker: "Elder Holland",
              title: "A Talk",
              conference: "April 2024",
            }),
          }),
        ],
      }).success,
    ).toBe(false);
  });
});

describe("formatTalkCitation", () => {
  // The reason this function exists: `suggested_talks` stores STRINGS, and mapCandidateRow's
  // toSuggestionList() drops anything that is not one. An object written through unchanged would
  // read back as null and the citation would vanish between the insert and the screen.
  it("flattens three fields into one checkable citation", () => {
    expect(
      formatTalkCitation({
        speaker: "Elder Jeffrey R. Holland",
        title: "The Greatest Possession",
        conference: "April 2024",
      }),
    ).toBe('Elder Jeffrey R. Holland, "The Greatest Possession", April 2024');
  });

  it("drops a part the model left blank rather than emitting an empty quote", () => {
    expect(
      formatTalkCitation({ speaker: "Elder Holland", title: "", conference: "April 2024" }),
    ).toBe("Elder Holland, April 2024");
  });

  // The field caps exist so a composed citation fits lib/validation/topic.ts's 200-character
  // limit on a stored suggestion. A citation truncated at the boundary is one nobody can check.
  it("stays inside the stored-suggestion limit at the schema's maximum lengths", () => {
    const citation = formatTalkCitation({
      speaker: "S".repeat(60),
      title: "T".repeat(100),
      conference: "C".repeat(30),
    });

    expect(citation.length).toBeLessThanOrEqual(200);
  });
});

describe("filterNovelSuggestions", () => {
  it("drops a title the ward already has, whatever the casing", () => {
    const { kept, filteredCount } = filterNovelSuggestions(
      [suggestion({ title: "faith in JESUS christ" }), suggestion({ title: "Ministering" })],
      ["Faith in Jesus Christ"],
    );

    expect(kept.map((entry) => entry.title)).toEqual(["Ministering"]);
    expect(filteredCount).toBe(1);
  });

  it("drops a title matching a pending candidate", () => {
    const { kept, filteredCount } = filterNovelSuggestions(
      [suggestion({ title: "Temple Worship" })],
      ["Temple Worship"],
    );

    expect(kept).toHaveLength(0);
    expect(filteredCount).toBe(1);
  });

  // A model asked for eight topics occasionally returns the same idea twice. Inserting both puts
  // two identical rows in the queue for a person to reject one at a time.
  it("de-duplicates within one response", () => {
    const { kept, filteredCount } = filterNovelSuggestions(
      [
        suggestion({ title: "Charity Never Faileth" }),
        suggestion({ title: "  charity never faileth  " }),
      ],
      [],
    );

    expect(kept).toHaveLength(1);
    expect(filteredCount).toBe(1);
  });

  it("keeps everything when nothing collides", () => {
    const { kept, filteredCount } = filterNovelSuggestions(
      [suggestion({ title: "One" }), suggestion({ title: "Two" })],
      ["Three"],
    );

    expect(kept).toHaveLength(2);
    expect(filteredCount).toBe(0);
  });

  it("normalizes on the same lower(title) migration 018's unique index uses", () => {
    expect(normalizeTitle("  The Sabbath Day  ")).toBe("the sabbath day");
  });
});

describe("buildTopicSuggestionPrompt", () => {
  it("asks for the number requested, in words that agree with it", () => {
    expect(
      buildTopicSuggestionPrompt({
        count: 1,
        seed: null,
        existingTitles: [],
        recentlyUsedTitles: [],
      }),
    ).toContain("Suggest 1 sacrament meeting talk topic for this ward.");

    expect(
      buildTopicSuggestionPrompt({
        count: 5,
        seed: null,
        existingTitles: [],
        recentlyUsedTitles: [],
      }),
    ).toContain("Suggest 5 sacrament meeting talk topics for this ward.");
  });

  it("names the seed when there is one", () => {
    const prompt = buildTopicSuggestionPrompt({
      count: 3,
      seed: "something for fast Sunday",
      existingTitles: [],
      recentlyUsedTitles: [],
    });

    expect(prompt).toContain("something for fast Sunday");
  });

  // Asking for novelty in the prompt is cheaper than filtering afterwards and produces better
  // suggestions. The route filters anyway — a prompt is a request, a filter is a guarantee.
  it("lists the titles the ward already has as something to avoid", () => {
    const prompt = buildTopicSuggestionPrompt({
      count: 3,
      seed: null,
      existingTitles: ["Faith in Jesus Christ", "Temple Worship"],
      recentlyUsedTitles: [],
    });

    expect(prompt).toContain("Suggest something else");
    expect(prompt).toContain("Faith in Jesus Christ");
    expect(prompt).toContain("Temple Worship");
  });

  it("separates recently-spoken titles from the library as a whole", () => {
    const prompt = buildTopicSuggestionPrompt({
      count: 3,
      seed: null,
      existingTitles: ["Faith in Jesus Christ"],
      recentlyUsedTitles: ["The Sabbath Day"],
    });

    expect(prompt).toContain("heard them lately");
    expect(prompt).toContain("The Sabbath Day");
  });

  // A ward with two hundred topics would otherwise spend most of the prompt reciting them back.
  it("truncates a very long library and says how many it left out", () => {
    const titles = Array.from({ length: 75 }, (_, index) => `Topic ${index}`);

    const prompt = buildTopicSuggestionPrompt({
      count: 3,
      seed: null,
      existingTitles: titles,
      recentlyUsedTitles: [],
    });

    expect(prompt).toContain("(and 15 more)");
    expect(prompt).not.toContain("Topic 70");
  });

  it("omits the sections it has no data for", () => {
    const prompt = buildTopicSuggestionPrompt({
      count: 3,
      seed: null,
      existingTitles: [],
      recentlyUsedTitles: [],
    });

    expect(prompt).not.toContain("Suggest something else");
    expect(prompt).not.toContain("heard them lately");
  });
});

describe("buildRetrievalQuery", () => {
  // With no seed, the ward's own settings ARE the query. That is what makes an unseeded run
  // ward-specific rather than generic.
  it("uses the ward's settings when there is no seed", () => {
    expect(
      buildRetrievalQuery({
        seed: null,
        topicPreferences: "Favour practical discipleship",
        wardContext: "Many young families",
      }),
    ).toBe("Favour practical discipleship Many young families");
  });

  it("puts the seed first when there is one", () => {
    const query = buildRetrievalQuery({
      seed: "fast Sunday",
      topicPreferences: "Favour practical discipleship",
      wardContext: null,
    });

    expect(query?.startsWith("fast Sunday")).toBe(true);
  });

  // Embedding the empty string returns the corpus's arbitrary nearest neighbours dressed up as
  // relevant material — worse than no layer 3, which buildSystemPrompt handles as a real state.
  it("returns null when there is nothing to search for", () => {
    expect(
      buildRetrievalQuery({ seed: null, topicPreferences: null, wardContext: null }),
    ).toBeNull();

    expect(
      buildRetrievalQuery({ seed: "   ", topicPreferences: "  ", wardContext: null }),
    ).toBeNull();
  });
});
