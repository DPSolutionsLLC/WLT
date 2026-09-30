// @vitest-environment node
import { describe, expect, it } from "vitest";
import { speakerTag, topicTag, whoLetsThemKnow } from "@/lib/sacrament/talkRowStatus";
import type { TalkAskInput } from "@/lib/sacrament/talkAsks";

function ask(overrides: Partial<TalkAskInput> = {}): TalkAskInput {
  return { hasSpeaker: true, requestOutcome: null, openAskCount: 0, isOff: false, ...overrides };
}

describe("speakerTag", () => {
  it("asks for a speaker when there is none", () => {
    expect(speakerTag(ask({ hasSpeaker: false }))).toEqual({
      label: "Needs speaker",
      tone: "missing",
    });
  });

  it("reads an accepted talk as accepted", () => {
    expect(speakerTag(ask({ requestOutcome: "accepted" }))).toEqual({
      label: "Accepted",
      tone: "ok",
    });
  });

  // A decline clears the speaker, so a declined talk has nobody on it — and must still say so.
  it("reads a declined talk as declined, though its speaker was cleared", () => {
    expect(speakerTag(ask({ hasSpeaker: false, requestOutcome: "declined" }))).toEqual({
      label: "Declined",
      tone: "missing",
    });
  });

  it("reads an open ask as sent", () => {
    expect(speakerTag(ask({ openAskCount: 1 }))).toEqual({ label: "Ask sent", tone: "pending" });
  });

  it("reads a chosen speaker nobody has asked yet as selected", () => {
    expect(speakerTag(ask())).toEqual({ label: "Speaker selected", tone: "pending" });
  });

  // Accepted wins over a lingering open ask: the answer is in.
  it("reads accepted before an open ask", () => {
    expect(speakerTag(ask({ requestOutcome: "accepted", openAskCount: 1 })).label).toBe(
      "Accepted",
    );
  });
});

describe("topicTag", () => {
  it("reads a set topic as selected", () => {
    expect(topicTag("Faith")).toEqual({ label: "Topic selected", tone: "ok" });
  });

  it("asks for a topic when there is none", () => {
    expect(topicTag(null)).toEqual({ label: "Needs topic", tone: "missing" });
  });
});

describe("whoLetsThemKnow — the person Delete's confirm names", () => {
  const ME = "me";
  const CONDUCTOR = "conductor";

  it("names whoever holds the open ask", () => {
    expect(
      whoLetsThemKnow({
        ask: ask({ openAskCount: 1 }),
        openAskOwnerIds: [CONDUCTOR],
        latestAskOwnerId: CONDUCTOR,
        currentUserId: ME,
      }),
    ).toEqual({ kind: "user", userId: CONDUCTOR });
  });

  it("says you when you hold one of the open asks", () => {
    expect(
      whoLetsThemKnow({
        ask: ask({ openAskCount: 2 }),
        openAskOwnerIds: [CONDUCTOR, ME],
        latestAskOwnerId: CONDUCTOR,
        currentUserId: ME,
      }),
    ).toEqual({ kind: "you" });
  });

  it("names the last asker of an accepted talk", () => {
    expect(
      whoLetsThemKnow({
        ask: ask({ requestOutcome: "accepted" }),
        openAskOwnerIds: [],
        latestAskOwnerId: CONDUCTOR,
        currentUserId: ME,
      }),
    ).toEqual({ kind: "user", userId: CONDUCTOR });
  });

  // Accepted from the talk's own panel, so nobody asked through To Do: the person deleting is told.
  it("falls back to you for an accepted talk nobody asked through To Do", () => {
    expect(
      whoLetsThemKnow({
        ask: ask({ requestOutcome: "accepted" }),
        openAskOwnerIds: [],
        latestAskOwnerId: null,
        currentUserId: ME,
      }),
    ).toEqual({ kind: "you" });
  });

  it("names nobody for a speaker who was never asked", () => {
    expect(
      whoLetsThemKnow({ ask: ask(), openAskOwnerIds: [], latestAskOwnerId: null, currentUserId: ME }),
    ).toBeNull();
  });

  it("names nobody when there is no speaker", () => {
    expect(
      whoLetsThemKnow({
        ask: ask({ hasSpeaker: false, requestOutcome: "declined" }),
        openAskOwnerIds: [],
        latestAskOwnerId: CONDUCTOR,
        currentUserId: ME,
      }),
    ).toBeNull();
  });
});
