import { describe, expect, it } from "vitest";
import { buildConfirmationPrompt, buildThankYouPrompt } from "@/lib/ai/messageDrafts";
import {
  buildConfirmationMessage,
  buildThankYouMessage,
  type ConfirmationMessageInput,
  type ThankYouMessageInput,
} from "@/lib/assignments/messageTemplate";

// Pure. The two prompt builders take the SAME input types as the two template builders, which is
// the promise messageTemplate.ts's own header made: "Phase 5 replaces the BODY of these
// functions, not their signature."

function confirmationInput(
  overrides: Partial<ConfirmationMessageInput> = {},
): ConfirmationMessageInput {
  return {
    speakerFirstName: "Sarah",
    date: "2026-04-12",
    topicTitle: "Faith in Jesus Christ",
    slotLengthMinutes: 10,
    suggestedScriptures: ["Alma 32:21"],
    ...overrides,
  };
}

function thankYouInput(overrides: Partial<ThankYouMessageInput> = {}): ThankYouMessageInput {
  return {
    speakerFirstName: "Sarah",
    date: "2026-04-12",
    comments: [],
    ...overrides,
  };
}

// The interchangeability is the point, so it is asserted rather than assumed: one object must
// feed either source for the same textarea. If a signature ever drifts, this stops compiling.
describe("the AI prompts and the templates take the same inputs", () => {
  it("builds both a confirmation prompt and a confirmation template from one object", () => {
    const input = confirmationInput();

    expect(buildConfirmationPrompt(input).length).toBeGreaterThan(0);
    expect(buildConfirmationMessage(input).length).toBeGreaterThan(0);
  });

  it("builds both a thank-you prompt and a thank-you template from one object", () => {
    const input = thankYouInput({ comments: ["He spoke about his mission."] });

    expect(buildThankYouPrompt(input).length).toBeGreaterThan(0);
    expect(buildThankYouMessage(input).length).toBeGreaterThan(0);
  });
});

describe("buildConfirmationPrompt", () => {
  it("names the speaker, the date, the topic and the length", () => {
    const prompt = buildConfirmationPrompt(confirmationInput());

    expect(prompt).toContain("Sarah");
    // A `date` column must never be round-tripped through local time, so the label comes from
    // formatSundayLabel rather than from a new Date() anywhere in this module.
    expect(prompt).toContain("Sunday, April 12");
    expect(prompt).toContain("Faith in Jesus Christ");
    expect(prompt).toContain("10 minutes");
  });

  it("passes the topic's suggested scriptures through", () => {
    const prompt = buildConfirmationPrompt(
      confirmationInput({ suggestedScriptures: ["Alma 32:21", "Ether 12:6"] }),
    );

    expect(prompt).toContain("Alma 32:21");
    expect(prompt).toContain("Ether 12:6");
  });

  // Same rule the template follows: an absent sentence is DROPPED, never replaced by a
  // placeholder. A prompt saying 'their topic is "null"' produces a message that says it too.
  it("omits the topic, length and scripture lines when there is no data", () => {
    const prompt = buildConfirmationPrompt(
      confirmationInput({
        topicTitle: null,
        slotLengthMinutes: null,
        suggestedScriptures: [],
      }),
    );

    expect(prompt).not.toContain("null");
    expect(prompt).not.toContain("Their topic");
    expect(prompt).not.toContain("minutes");
    expect(prompt).not.toContain("starting point");
  });

  it("tells the model not to use a name when none is on file", () => {
    const prompt = buildConfirmationPrompt(confirmationInput({ speakerFirstName: null }));

    expect(prompt).toContain("do not use a name in the greeting");
  });

  // SmsHandoff puts this in an `sms:` body. A model told nothing about the medium writes four
  // paragraphs of email.
  it("says the output is a text message", () => {
    expect(buildConfirmationPrompt(confirmationInput())).toContain("text message");
  });
});

describe("buildThankYouPrompt", () => {
  const COMMENTS = [
    "He talked about his mission and the room went completely quiet.",
    "The story about his grandmother landed with the youth.",
    "Ran slightly long but nobody minded.",
  ];

  it("includes every comment the bishopric wrote", () => {
    const prompt = buildThankYouPrompt(thankYouInput({ comments: COMMENTS }));

    for (const comment of COMMENTS) {
      expect(prompt).toContain(comment);
    }
  });

  // THE COMMENTS COME FIRST, before the name and the date. 05-ai-platform.md calls them the most
  // important input — "they are what makes the message not generic" — and burying them under the
  // scaffolding is how they get treated as trivia. This assertion is what keeps them at the top.
  it("puts the comments above the name and the date", () => {
    const prompt = buildThankYouPrompt(thankYouInput({ comments: COMMENTS }));

    const commentIndex = prompt.indexOf(COMMENTS[0]);
    const nameIndex = prompt.indexOf("Sarah");
    const dateIndex = prompt.indexOf("Sunday, April 12");

    expect(commentIndex).toBeGreaterThanOrEqual(0);
    expect(commentIndex).toBeLessThan(nameIndex);
    expect(commentIndex).toBeLessThan(dateIndex);
  });

  it("says whose observations they are, so the model builds the message around them", () => {
    const prompt = buildThankYouPrompt(thankYouInput({ comments: COMMENTS }));

    expect(prompt).toContain("The bishopric wrote these observations");
    expect(prompt).toContain("Build the message around them");
  });

  // With nothing observed, a model asked to refer to what they said will invent something. A
  // thank-you naming a talk that was never given is worse than a plain one.
  it("forbids inventing a subject when nobody commented", () => {
    const prompt = buildThankYouPrompt(thankYouInput({ comments: [] }));

    expect(prompt).toContain("Do not invent what they said");
    expect(prompt).not.toContain("The bishopric wrote these observations");
  });

  it("ignores blank comments rather than sending empty bullets", () => {
    const prompt = buildThankYouPrompt(thankYouInput({ comments: ["   ", ""] }));

    expect(prompt).toContain("Do not invent what they said");
  });

  it("says the output is a text message", () => {
    expect(buildThankYouPrompt(thankYouInput())).toContain("text message");
  });
});
