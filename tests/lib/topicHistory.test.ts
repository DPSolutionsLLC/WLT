// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DateOnly } from "@/lib/calendar/dates";
import {
  filterAndSortTopicHistory,
  parseTopicHistoryView,
  withinMonths,
  similarTopicUses,
  timeAgoLabel,
  topicSimilarity,
  type TopicHistoryEntry,
} from "@/lib/topics/topicHistory";

const TODAY: DateOnly = "2027-06-15";

function entry(overrides: Partial<TopicHistoryEntry> = {}): TopicHistoryEntry {
  return {
    assignmentId: "talk-1",
    sundayId: "sunday-1",
    date: "2027-03-07",
    topicTitle: "Faith in Jesus Christ",
    speakerName: "Sarah Bennett",
    isUpcoming: false,
    ...overrides,
  };
}

describe("topicSimilarity", () => {
  // THE PREFIX IS THE POINT: the hint has to appear while the word is still being typed.
  it("matches a word being typed against the whole word", () => {
    expect(topicSimilarity("fai", "Faith in Jesus Christ")).toBe(true);
  });

  it("matches in either direction", () => {
    expect(topicSimilarity("Faithfulness", "Faith")).toBe(true);
  });

  it("ignores case and punctuation", () => {
    expect(topicSimilarity("GRATITUDE!", "gratitude, in all things")).toBe(true);
  });

  // "in", "of", "to" must not make every topic resemble every other.
  it("ignores words of two letters or fewer", () => {
    expect(topicSimilarity("in of to", "Faith in Jesus Christ")).toBe(false);
  });

  // "the" is three letters, so length alone lets it through.
  it("ignores common words like the and and", () => {
    expect(topicSimilarity("The Sabbath", "The Atonement")).toBe(false);
    expect(topicSimilarity("the", "The Atonement")).toBe(false);
    expect(topicSimilarity("Faith and hope", "Charity and service")).toBe(false);
  });

  it("does not match unrelated topics", () => {
    expect(topicSimilarity("Service", "Faith in Jesus Christ")).toBe(false);
  });
});

describe("similarTopicUses", () => {
  const history = [
    entry({ assignmentId: "a", date: "2026-10-04", topicTitle: "Faith and works" }),
    entry({ assignmentId: "b", date: "2027-04-04", topicTitle: "Faith in Jesus Christ" }),
    entry({ assignmentId: "c", date: "2025-01-05", topicTitle: "faith in jesus christ " }),
    entry({ assignmentId: "d", date: "2027-02-07", topicTitle: "Gratitude" }),
  ];

  it("returns nothing under two characters", () => {
    expect(similarTopicUses("f", history)).toEqual([]);
    expect(similarTopicUses("  ", history)).toEqual([]);
  });

  // The same topic given twice is ONE line — its most recent use — ignoring case and spacing.
  it("keeps only the most recent use of each topic", () => {
    const ids = similarTopicUses("faith", history).map((use) => use.assignmentId);

    expect(ids).toContain("b");
    expect(ids).not.toContain("c");
  });

  it("lists newest first", () => {
    expect(similarTopicUses("faith", history).map((use) => use.assignmentId)).toEqual(["b", "a"]);
  });

  it("leaves out topics that do not resemble what was typed", () => {
    expect(similarTopicUses("faith", history).map((use) => use.assignmentId)).not.toContain("d");
  });
});

describe("timeAgoLabel", () => {
  it("reads days under 30", () => {
    expect(timeAgoLabel("2027-05-17", TODAY)).toBe("29 days ago");
  });

  it("reads one day in the singular", () => {
    expect(timeAgoLabel("2027-06-14", TODAY)).toBe("1 day ago");
  });

  it("switches to months at 30 days", () => {
    expect(timeAgoLabel("2027-05-16", TODAY)).toBe("1 month ago");
  });

  it("stays in months at 364 days", () => {
    expect(timeAgoLabel("2026-06-16", TODAY)).toBe("12 months ago");
  });

  it("switches to years at 365 days", () => {
    expect(timeAgoLabel("2026-06-15", TODAY)).toBe("1 year ago");
  });

  // Never a negative number.
  it("reads a future date as coming up", () => {
    expect(timeAgoLabel("2027-07-04", TODAY)).toBe("Coming up");
  });

  it("reads no date as never spoken", () => {
    expect(timeAgoLabel(null, TODAY)).toBe("Never spoken");
  });
});

describe("filterAndSortTopicHistory", () => {
  const history = [
    entry({ assignmentId: "a", date: "2027-01-03", topicTitle: "Gratitude", speakerName: "Zoe Hall" }),
    entry({ assignmentId: "b", date: "2027-03-07", topicTitle: "Baptism", speakerName: null }),
    entry({ assignmentId: "c", date: "2026-11-01", topicTitle: "Agency", speakerName: "Adam Cole" }),
  ];

  function ids(result: TopicHistoryEntry[]): string[] {
    return result.map((item) => item.assignmentId);
  }

  it("sorts newest first", () => {
    expect(ids(filterAndSortTopicHistory(history, { query: "", sort: "date_desc" }))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("sorts oldest first", () => {
    expect(ids(filterAndSortTopicHistory(history, { query: "", sort: "date_asc" }))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("sorts by topic A–Z", () => {
    expect(ids(filterAndSortTopicHistory(history, { query: "", sort: "topic" }))).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  // A talk with nobody in it yet has no name to place, so it goes last.
  it("sorts by speaker A–Z with no speaker last", () => {
    expect(ids(filterAndSortTopicHistory(history, { query: "", sort: "speaker" }))).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("breaks a tie newest first", () => {
    const tied = [
      entry({ assignmentId: "old", date: "2026-01-04", topicTitle: "Faith" }),
      entry({ assignmentId: "new", date: "2027-01-03", topicTitle: "Faith" }),
    ];

    expect(ids(filterAndSortTopicHistory(tied, { query: "", sort: "topic" }))).toEqual([
      "new",
      "old",
    ]);
  });

  it("searches the topic, ignoring case", () => {
    expect(ids(filterAndSortTopicHistory(history, { query: "grat", sort: "date_desc" }))).toEqual([
      "a",
    ]);
  });

  it("searches the speaker", () => {
    expect(ids(filterAndSortTopicHistory(history, { query: "cole", sort: "date_desc" }))).toEqual([
      "c",
    ]);
  });

  it("does not change the list it was given", () => {
    const copy = [...history];
    filterAndSortTopicHistory(history, { query: "", sort: "topic" });

    expect(history).toEqual(copy);
  });
});

describe("withinMonths", () => {
  const history = [
    entry({ assignmentId: "ahead", date: "2027-08-01", isUpcoming: true }),
    entry({ assignmentId: "edge", date: "2026-12-15" }),
    entry({ assignmentId: "before", date: "2026-12-14" }),
  ];

  it("keeps the last N months, counting the boundary day", () => {
    expect(withinMonths(history, 6, TODAY).map((item) => item.assignmentId)).toEqual([
      "ahead",
      "edge",
    ]);
  });

  // Something already planned is always worth knowing about.
  it("always keeps upcoming uses", () => {
    expect(withinMonths(history, 1, TODAY).map((item) => item.assignmentId)).toEqual(["ahead"]);
  });

  it("reaches further back when asked", () => {
    expect(withinMonths(history, 12, TODAY)).toHaveLength(3);
  });
});

describe("parseTopicHistoryView", () => {
  it("defaults the window to six months", () => {
    expect(parseTopicHistoryView(undefined)).toEqual({ sort: "date_desc", months: 6 });
  });

  // Saved before the window existed: the sort survives and the window takes its default.
  it("reads a view saved without a window", () => {
    expect(parseTopicHistoryView({ sort: "speaker" })).toEqual({ sort: "speaker", months: 6 });
  });

  it("falls back on a window it cannot read", () => {
    expect(parseTopicHistoryView({ sort: "topic", months: 0 })).toEqual({
      sort: "date_desc",
      months: 6,
    });
  });
});
