import { describe, expect, it } from "vitest";
import {
  buildConfirmationMessage,
  buildThankYouMessage,
} from "@/lib/assignments/messageTemplate";

// Both templates produce a DRAFT somebody reads before it goes anywhere, so the risk is not a
// clumsy sentence — it is a message that goes out with "undefined" or "[TOPIC]" in it because a
// field was empty and the template filled the hole anyway.
//
// Phase 5 replaces the body of these functions, not their signature, so these assertions are
// about what the output must never contain as much as what it must.

const NEVER_IN_A_DRAFT = ["undefined", "null", "NaN", "[", "]"];

function assertNoPlaceholders(message: string): void {
  for (const fragment of NEVER_IN_A_DRAFT) {
    expect(message, `a draft must never contain "${fragment}"`).not.toContain(fragment);
  }
}

describe("buildConfirmationMessage", () => {
  it("fills every sentence when everything is known", () => {
    const message = buildConfirmationMessage({
      speakerFirstName: "Sarah",
      date: "2026-03-08",
      topicTitle: "Faith in Jesus Christ",
      slotLengthMinutes: 10,
      suggestedScriptures: ["Alma 32:21", "Ether 12:6"],
    });

    expect(message).toContain("Hello Sarah,");
    expect(message).toContain("Sunday, March 8");
    expect(message).toContain('Your topic is "Faith in Jesus Christ".');
    expect(message).toContain("about 10 minutes");
    expect(message).toContain("Alma 32:21 and Ether 12:6");
    assertNoPlaceholders(message);
  });

  // Degrading HONESTLY: the sentence is dropped, not filled with a placeholder somebody forgets
  // to replace.
  it("omits the topic sentence entirely when there is no topic", () => {
    const message = buildConfirmationMessage({
      speakerFirstName: "Sarah",
      date: "2026-03-08",
      topicTitle: null,
      slotLengthMinutes: 10,
      suggestedScriptures: [],
    });

    expect(message).not.toContain("Your topic");
    expect(message).toContain("about 10 minutes");
    assertNoPlaceholders(message);
  });

  it("omits the scripture sentence for an empty list", () => {
    const message = buildConfirmationMessage({
      speakerFirstName: "Sarah",
      date: "2026-03-08",
      topicTitle: "Faith",
      slotLengthMinutes: 10,
      suggestedScriptures: [],
    });

    expect(message).not.toContain("helpful as you prepare");
    assertNoPlaceholders(message);
  });

  it("omits the scripture sentence when every reference is blank", () => {
    const message = buildConfirmationMessage({
      speakerFirstName: "Sarah",
      date: "2026-03-08",
      topicTitle: "Faith",
      slotLengthMinutes: 10,
      suggestedScriptures: ["", "   "],
    });

    expect(message).not.toContain("helpful as you prepare");
  });

  it("omits the length sentence when no slot length is set", () => {
    const message = buildConfirmationMessage({
      speakerFirstName: "Sarah",
      date: "2026-03-08",
      topicTitle: "Faith",
      slotLengthMinutes: null,
      suggestedScriptures: [],
    });

    expect(message).not.toContain("minutes");
    assertNoPlaceholders(message);
  });

  // A greeting with no name is a slightly plain message. A greeting with "[NAME]" in it is a
  // message that goes out wrong.
  it("greets without a name rather than with a placeholder", () => {
    const message = buildConfirmationMessage({
      speakerFirstName: null,
      date: "2026-03-08",
      topicTitle: null,
      slotLengthMinutes: null,
      suggestedScriptures: [],
    });

    expect(message.startsWith("Hello,")).toBe(true);
    assertNoPlaceholders(message);
  });

  it("keeps a single scripture on its own, without an 'and'", () => {
    const message = buildConfirmationMessage({
      speakerFirstName: "Sarah",
      date: "2026-03-08",
      topicTitle: null,
      slotLengthMinutes: null,
      suggestedScriptures: ["Moroni 10:4"],
    });

    expect(message).toContain("prepare: Moroni 10:4.");
  });

  // The date is a date-only string read in UTC. new Date("2026-03-08").getDate() is 7 in every
  // US zone, which would put a talk on the wrong day in a message somebody sends (dates.ts).
  it("reads the date in UTC", () => {
    const message = buildConfirmationMessage({
      speakerFirstName: null,
      date: "2026-03-01",
      topicTitle: null,
      slotLengthMinutes: null,
      suggestedScriptures: [],
    });

    expect(message).toContain("Sunday, March 1");
  });
});

describe("buildThankYouMessage", () => {
  it("fills every sentence when everything is known", () => {
    const message = buildThankYouMessage({
      speakerFirstName: "Sarah",
      date: "2026-03-08",
      comments: ["Your thoughts on service stayed with us."],
    });

    expect(message).toContain("Hello Sarah,");
    expect(message).toContain("Sunday, March 8");
    expect(message).toContain("Your thoughts on service stayed with us.");
    assertNoPlaceholders(message);
  });

  it("omits the comments sentence when there are none", () => {
    const message = buildThankYouMessage({
      speakerFirstName: "Sarah",
      date: "2026-03-08",
      comments: [],
    });

    expect(message).toContain("Thank you for the talk");
    expect(message).toContain("appreciate the time");
    assertNoPlaceholders(message);
  });

  it("drops blank comments rather than emitting empty lines", () => {
    const message = buildThankYouMessage({
      speakerFirstName: null,
      date: "2026-03-08",
      comments: ["", "  "],
    });

    expect(message).not.toContain("\n\n\n");
    assertNoPlaceholders(message);
  });
});
