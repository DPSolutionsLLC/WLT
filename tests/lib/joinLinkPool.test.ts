import { describe, expect, it } from "vitest";
import { describePoolLevel, LOW_POOL_THRESHOLD, summarizePool, type PoolLink } from "@/lib/zoom/joinLinkPool";

describe("describePoolLevel", () => {
  it("is empty at 0, with a sentence pointing at the Link pool tab", () => {
    expect(describePoolLevel(0)).toEqual({
      tone: "empty",
      sentence: "No Zoom links are left. Paste more on the Link pool tab.",
    });
  });

  it("is low and singular at 1", () => {
    expect(describePoolLevel(1)).toEqual({ tone: "low", sentence: "Only 1 Zoom link is left." });
  });

  it("is still low at the threshold", () => {
    expect(LOW_POOL_THRESHOLD).toBe(5);
    expect(describePoolLevel(5)).toEqual({ tone: "low", sentence: "Only 5 Zoom links are left." });
  });

  it("is ok just above the threshold, with no sentence", () => {
    expect(describePoolLevel(6)).toEqual({ tone: "ok", sentence: null });
  });
});

describe("summarizePool", () => {
  const link = (id: string, held: boolean): PoolLink => ({
    id,
    placeholderName: `Guest ${id}`,
    placeholderEmail: `${id}@example.org`,
    createdAt: "2026-10-28T00:00:00Z",
    heldBy: held ? { inviteeId: `i-${id}`, displayName: "Ann" } : null,
  });

  it("counts free and given links", () => {
    const summary = summarizePool([link("1", false), link("2", true), link("3", false)]);
    expect(summary.freeCount).toBe(2);
    expect(summary.givenCount).toBe(1);
  });
});
