// @vitest-environment node
//
// Phase 5 test **similarity-floor**.
//
// applySimilarityFloor is exported from lib/ai/retrieve.ts precisely so this needs no database:
// the ranking comes from Postgres, but the DECISION about what is worth handing to Claude is
// ours, and it is a pure function of the scores.
//
// 05-ai-platform.md is explicit that weak chunks are worse than none. A passage at 0.12
// similarity is not "a bit relevant" — it is noise that the model reads as authoritative
// reference material and then cites.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH_COUNT,
  MAX_MATCH_COUNT,
  SIMILARITY_FLOOR,
  applySimilarityFloor,
  clampMatchCount,
} from "@/lib/ai/retrieve";

function chunk(similarity: number, label = `chunk-${similarity}`) {
  return { content: `Passage at ${similarity}`, sourceLabel: label, similarity };
}

describe("applySimilarityFloor", () => {
  it("excludes a chunk just below the floor and keeps one just above it", () => {
    const kept = applySimilarityFloor([chunk(0.31, "above"), chunk(0.29, "below")], 8);

    expect(kept.map((entry) => entry.sourceLabel)).toEqual(["above"]);
  });

  it("keeps a chunk exactly at the floor", () => {
    // >=, not >. A boundary that excludes its own named value is the kind of thing nobody
    // notices until a result set is mysteriously one short.
    const kept = applySimilarityFloor([chunk(SIMILARITY_FLOOR, "exact")], 8);

    expect(kept).toHaveLength(1);
  });

  it("FILTERS BEFORE CLAMPING — 8 results of which 3 are weak return 5, not 8", () => {
    // The bug this test exists for: clamping first takes the top 8 and then drops the weak ones
    // among them, silently starving the prompt of context that was available further down.
    const scored = [
      chunk(0.9),
      chunk(0.8),
      chunk(0.7),
      chunk(0.6),
      chunk(0.5),
      chunk(0.2),
      chunk(0.15),
      chunk(0.1),
    ];

    const kept = applySimilarityFloor(scored, 8);

    expect(kept).toHaveLength(5);
    expect(kept.every((entry) => entry.similarity >= SIMILARITY_FLOOR)).toBe(true);
  });

  it("clamps to the limit after filtering", () => {
    const scored = Array.from({ length: 10 }, (_, index) => chunk(0.9 - index * 0.01));

    expect(applySimilarityFloor(scored, 6)).toHaveLength(6);
  });

  it("returns [] for an all-weak result set rather than the best of a bad lot", () => {
    const kept = applySimilarityFloor([chunk(0.29), chunk(0.2), chunk(0.05)], 6);

    // buildSystemPrompt then omits layer 3 entirely and the model answers from the ward's
    // settings alone — the designed behaviour, not a degraded one.
    expect(kept).toEqual([]);
  });

  it("returns [] for no results at all", () => {
    expect(applySimilarityFloor([], 6)).toEqual([]);
  });

  it("preserves the incoming order", () => {
    const kept = applySimilarityFloor(
      [chunk(0.9, "first"), chunk(0.7, "second"), chunk(0.5, "third")],
      6,
    );

    expect(kept.map((entry) => entry.sourceLabel)).toEqual(["first", "second", "third"]);
  });

  it("honours an explicit floor override", () => {
    const kept = applySimilarityFloor([chunk(0.5), chunk(0.4)], 6, 0.45);

    expect(kept).toHaveLength(1);
  });
});

describe("clampMatchCount", () => {
  it("defaults when no limit is given", () => {
    expect(clampMatchCount()).toBe(DEFAULT_MATCH_COUNT);
  });

  it("never exceeds the maximum", () => {
    expect(clampMatchCount(99)).toBe(MAX_MATCH_COUNT);
  });

  it("never drops below one", () => {
    // Zero would mean "retrieve nothing", which is not a request anybody makes on purpose and
    // would silently disable the knowledge base for that call.
    expect(clampMatchCount(0)).toBe(1);
    expect(clampMatchCount(-5)).toBe(1);
  });

  it("truncates a fractional limit rather than passing it to Postgres", () => {
    expect(clampMatchCount(3.9)).toBe(3);
  });
});
