import { describe, expect, it } from "vitest";
import {
  RECENT_MONTHS,
  TOPIC_STALENESS_LABELS,
  compareTopicsByStaleness,
  topicStaleness,
} from "@/lib/topics/topicRotation";

const TODAY = "2026-08-22";

describe("topicStaleness", () => {
  it("calls a topic with no last_assigned_at unused", () => {
    expect(topicStaleness(null, TODAY)).toBe("unused");
  });

  it("calls a topic used this month recent", () => {
    expect(topicStaleness("2026-08-02T00:00:00.000Z", TODAY)).toBe("recent");
  });

  // The boundary is INCLUSIVE: exactly RECENT_MONTHS ago is still recent. Rounding a borderline
  // topic toward "recent" costs the bishopric one alternative; rounding the other way costs a
  // congregation a repeat.
  it("treats exactly RECENT_MONTHS ago as recent", () => {
    expect(RECENT_MONTHS).toBe(6);
    expect(topicStaleness("2026-02-22T00:00:00.000Z", TODAY)).toBe("recent");
  });

  // Whole months, so the far side of the boundary is a whole month away, not a day. A stamp
  // one day past six months still floors to six and stays `recent` — the bucket only flips once
  // a seventh whole month has passed.
  it("stays recent one day past RECENT_MONTHS, and flips a whole month later", () => {
    expect(topicStaleness("2026-02-21T00:00:00.000Z", TODAY)).toBe("recent");
    expect(topicStaleness("2026-01-22T00:00:00.000Z", TODAY)).toBe("fresh");
  });

  it("does not count a partial month", () => {
    // 2026-02-23 is 5 months and 27 days before 2026-08-22, not 6.
    expect(topicStaleness("2026-02-23T00:00:00.000Z", TODAY)).toBe("recent");
    // And 2026-01-23 is 6 months and 30 days, not 7 — still recent.
    expect(topicStaleness("2026-01-23T00:00:00.000Z", TODAY)).toBe("recent");
  });

  it("calls a topic used years ago fresh", () => {
    expect(topicStaleness("2023-01-15T00:00:00.000Z", TODAY)).toBe("fresh");
  });

  // A stamp in the future is not a state the app can produce, but clock skew between the
  // database and a browser can make it look like one — and a negative month count would flip a
  // recent topic to fresh, which is the wrong direction to be wrong in.
  it("treats a future stamp as recent rather than fresh", () => {
    expect(topicStaleness("2027-01-01T00:00:00.000Z", TODAY)).toBe("recent");
  });

  it("names every bucket", () => {
    expect(TOPIC_STALENESS_LABELS.unused).toBe("Not used yet");
    expect(TOPIC_STALENESS_LABELS.fresh).toBe("Used a while ago");
    expect(TOPIC_STALENESS_LABELS.recent).toBe("Used recently");
  });
});

describe("compareTopicsByStaleness", () => {
  it("sorts unused topics first", () => {
    const sorted = [
      { title: "Recently used", lastAssignedAt: "2026-08-01T00:00:00.000Z" },
      { title: "Never used", lastAssignedAt: null },
      { title: "Long ago", lastAssignedAt: "2024-01-01T00:00:00.000Z" },
    ].sort(compareTopicsByStaleness);

    expect(sorted.map((topic) => topic.title)).toEqual([
      "Never used",
      "Long ago",
      "Recently used",
    ]);
  });

  it("breaks a tie between two unused topics by title", () => {
    const sorted = [
      { title: "Zion", lastAssignedAt: null },
      { title: "Agency", lastAssignedAt: null },
    ].sort(compareTopicsByStaleness);

    expect(sorted.map((topic) => topic.title)).toEqual(["Agency", "Zion"]);
  });

  it("breaks a tie between two identically stamped topics by title", () => {
    const stamp = "2026-05-05T00:00:00.000Z";

    const sorted = [
      { title: "Zion", lastAssignedAt: stamp },
      { title: "Agency", lastAssignedAt: stamp },
    ].sort(compareTopicsByStaleness);

    expect(sorted.map((topic) => topic.title)).toEqual(["Agency", "Zion"]);
  });
});
