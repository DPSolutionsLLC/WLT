import type {
  ConfirmationMessageInput,
  ThankYouMessageInput,
} from "@/lib/assignments/messageTemplate";
import { formatSundayLabel } from "@/lib/calendar/dates";

// PURE, and the two signatures are DELIBERATELY IDENTICAL to buildConfirmationMessage and
// buildThankYouMessage in lib/assignments/messageTemplate.ts. That file's header already promised
// it: "Phase 5 replaces the BODY of these functions, not their signature."
//
// Taking the same input types means the route builds one object and can hand it to either the AI
// prompt or the template fallback, and a caller swapping one for the other changes nothing but
// the words. The template is what shows when the API key is missing, so the two are alternatives
// for the same textarea rather than a replacement.
//
// formatSundayLabel is reused rather than reimplemented: a `date` column must never be
// round-tripped through local time (lib/calendar/dates.ts).

// Both prompts say the output is a TEXT MESSAGE. SmsHandoff puts it in an `sms:` body, and a
// model told nothing about the medium writes four paragraphs of email.
const TEXT_MESSAGE_INSTRUCTION =
  "This is sent as a text message, so keep it to a few short sentences.";

function speakerLine(firstName: string | null): string {
  const name = firstName?.trim() ?? "";
  return name === ""
    ? "The speaker's first name is not on file, so do not use a name in the greeting."
    : `Their first name is ${name}.`;
}

export function buildConfirmationPrompt(input: ConfirmationMessageInput): string {
  const sections: string[] = [
    "Write a message confirming a speaking assignment.",
    speakerLine(input.speakerFirstName),
    `They are speaking in sacrament meeting on ${formatSundayLabel(input.date)}.`,
  ];

  const topic = input.topicTitle?.trim() ?? "";
  if (topic !== "") {
    sections.push(`Their topic is "${topic}".`);
  }

  if (input.slotLengthMinutes !== null) {
    sections.push(`They have been asked to speak for about ${input.slotLengthMinutes} minutes.`);
  }

  const scriptures = input.suggestedScriptures
    .map((reference) => reference.trim())
    .filter((reference) => reference !== "");

  if (scriptures.length > 0) {
    sections.push(
      `The bishopric suggests these as a starting point: ${scriptures.join(", ")}.`,
    );
  }

  sections.push(TEXT_MESSAGE_INSTRUCTION);

  return sections.join("\n\n");
}

// THE COMMENTS COME FIRST, under their own heading, before the name and the date.
//
// 05-ai-platform.md calls them the most important input — "they are what makes the message not
// generic" — and burying them under the speaker's name and the date is how they get treated as
// trivia. What a bishopric member wrote is the thing the speaker will recognise; everything else
// in this prompt is scaffolding around it.
export function buildThankYouPrompt(input: ThankYouMessageInput): string {
  const comments = input.comments
    .map((comment) => comment.trim())
    .filter((comment) => comment !== "");

  const sections: string[] = [];

  if (comments.length > 0) {
    sections.push(
      "The bishopric wrote these observations about the talk. Build the message around them, " +
        "in their own terms:\n\n" +
        comments.map((comment) => `- ${comment}`).join("\n"),
    );
  }

  sections.push("Write a thank-you message to someone who has spoken in sacrament meeting.");
  sections.push(speakerLine(input.speakerFirstName));
  sections.push(`They spoke on ${formatSundayLabel(input.date)}.`);

  // Said out loud rather than left to the model to infer. With nothing observed, a model asked
  // to refer to what they said will invent something — and a thank-you naming a talk that was
  // never given is worse than a plain one.
  if (comments.length === 0) {
    sections.push(
      "Nobody recorded what the talk was about, so thank them warmly without describing it. " +
        "Do not invent what they said.",
    );
  }

  sections.push(TEXT_MESSAGE_INSTRUCTION);

  return sections.join("\n\n");
}
