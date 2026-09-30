import { describe, expect, it } from "vitest";
import {
  MAX_TOPIC_IDEAS,
  buildRetrievalQuery,
  buildTalkTopicPrompt,
  filterFreshTopicIdeas,
  talkTopicIdeasSchema,
} from "@/lib/ai/topicSuggestions";

// Pure. No database, no network, no Claude — everything here is a function of its inputs, which
// is the whole reason lib/ai/topicSuggestions.ts holds no client. The library's candidate schema
// and its helpers were retired with the topic library (migration 086); these are the talk-topic
// ideas the topic window asks for (Topics rebuild t5).

const idea = (title: string, why = "Because the ward needs it this season.") => ({ title, why });

describe("talkTopicIdeasSchema", () => {
  it("accepts a title with a reason", () => {
    expect(talkTopicIdeasSchema.safeParse({ topics: [idea("Ministering as Christ did")] }).success).toBe(
      true,
    );
  });

  it("refuses an empty batch", () => {
    expect(talkTopicIdeasSchema.safeParse({ topics: [] }).success).toBe(false);
  });

  it(`refuses more than ${MAX_TOPIC_IDEAS} ideas`, () => {
    const topics = Array.from({ length: MAX_TOPIC_IDEAS + 1 }, (_, index) => idea(`Idea ${index}`));
    expect(talkTopicIdeasSchema.safeParse({ topics }).success).toBe(false);
  });

  // Well under the topic box's 200, so a tapped suggestion always fits.
  it("refuses a title over 120 characters", () => {
    expect(talkTopicIdeasSchema.safeParse({ topics: [idea("x".repeat(121))] }).success).toBe(false);
  });
});

describe("buildTalkTopicPrompt", () => {
  const base = {
    context: null,
    recentTitles: [],
    upcomingTitles: [],
    alreadyOffered: [],
    month: "October 2026",
  };

  it("asks for five topics for the Sunday's month", () => {
    expect(buildTalkTopicPrompt(base)).toContain(
      "Suggest 5 sacrament meeting talk topics for a Sunday in October 2026.",
    );
  });

  it("names the recent and the upcoming topics separately", () => {
    const prompt = buildTalkTopicPrompt({
      ...base,
      recentTitles: ["Faith in Jesus Christ"],
      upcomingTitles: ["Gratitude"],
    });

    expect(prompt).toContain("Given in this ward recently");
    expect(prompt).toContain("Faith in Jesus Christ");
    expect(prompt).toContain("Already planned for coming Sundays:\n\nGratitude");
  });

  it("names what the planner has in mind", () => {
    expect(buildTalkTopicPrompt({ ...base, context: "  something for the youth  " })).toContain(
      "What the planner has in mind: something for the youth",
    );
  });

  it("asks for different ideas from the ones already offered", () => {
    expect(buildTalkTopicPrompt({ ...base, alreadyOffered: ["Hope"] })).toContain(
      "Already suggested to the planner, so offer different ones:\n\nHope",
    );
  });

  it("omits the sections it has no data for", () => {
    const prompt = buildTalkTopicPrompt(base);
    expect(prompt).not.toContain("recently");
    expect(prompt).not.toContain("coming Sundays");
    expect(prompt).not.toContain("in mind");
  });
});

describe("filterFreshTopicIdeas", () => {
  it("drops an idea resembling a topic to avoid, by the topic window's own rule", () => {
    const { kept, filteredCount } = filterFreshTopicIdeas(
      [idea("Faithful stewardship"), idea("The Sabbath as a delight")],
      ["Faith in Jesus Christ"],
    );

    expect(kept.map((entry) => entry.title)).toEqual(["The Sabbath as a delight"]);
    expect(filteredCount).toBe(1);
  });

  it("drops a repeat within one response", () => {
    const { kept } = filterFreshTopicIdeas(
      [idea("Ministering"), idea("Ministering one by one")],
      [],
    );

    expect(kept.map((entry) => entry.title)).toEqual(["Ministering"]);
  });

  it("keeps everything when nothing collides, trimmed", () => {
    const { kept, filteredCount } = filterFreshTopicIdeas(
      [idea("  Covenants  "), idea("Prayer")],
      ["Gratitude"],
    );

    expect(kept.map((entry) => entry.title)).toEqual(["Covenants", "Prayer"]);
    expect(filteredCount).toBe(0);
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
