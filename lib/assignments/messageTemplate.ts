import { formatSundayLabel, type DateOnly } from "@/lib/calendar/dates";

// The two manual message drafts: the confirmation a speaker is sent once they have accepted,
// and the thank-you afterwards. Both are DRAFTS the user reads, edits, and sends themselves.
// Nothing here writes anything, and nothing here auto-populates `notify_message` — only an
// explicit approval on the detail page does that (CLAUDE.md rule 3).
//
// Phase 5 replaces the BODY of these functions, not their signature. The AI drafting route
// delivers its text into the same textarea these fill, so a caller that swaps one for the other
// changes nothing but the words.
//
// Imports lib/calendar/dates only, which is pure. Nothing here may reach
// lib/assignments/queries.ts — talks-b renders these in client components
// (plans/retros/roster-b-picker-and-orgs.md).

export type ConfirmationMessageInput = {
  speakerFirstName: string | null;
  date: DateOnly;
  topicTitle: string | null;
  slotLengthMinutes: number | null;
  suggestedScriptures: readonly string[];
};

export type ThankYouMessageInput = {
  speakerFirstName: string | null;
  date: DateOnly;
  comments: readonly string[];
};

// "Hello Sarah," or "Hello," — never "Hello null," and never a bracketed placeholder somebody
// forgets to fill in. A greeting with no name is a slightly plain message; a greeting with
// "[NAME]" in it is a message that goes out wrong.
function greeting(firstName: string | null): string {
  const name = firstName?.trim() ?? "";
  return name === "" ? "Hello," : `Hello ${name},`;
}

// One list, spelled the way somebody would say it out loud.
function listPhrase(items: readonly string[]): string {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// Absent sentences are DROPPED, never replaced by a placeholder. A missing topic means the
// message simply does not mention a topic — which is honest — where "your topic is undefined"
// or "your topic is [TOPIC]" is a message that reads as broken or as unfinished homework.
function assemble(lines: readonly (string | null)[]): string {
  return lines.filter((line): line is string => line !== null).join("\n\n");
}

export function buildConfirmationMessage(input: ConfirmationMessageInput): string {
  const scriptures = input.suggestedScriptures.filter(
    (reference) => reference.trim() !== "",
  );

  return assemble([
    greeting(input.speakerFirstName),

    `Thank you for agreeing to speak in sacrament meeting on ${formatSundayLabel(input.date)}.`,

    input.topicTitle === null || input.topicTitle.trim() === ""
      ? null
      : `Your topic is "${input.topicTitle.trim()}".`,

    input.slotLengthMinutes === null
      ? null
      : `Please plan for about ${input.slotLengthMinutes} minutes.`,

    scriptures.length === 0
      ? null
      : `You may find these helpful as you prepare: ${listPhrase(scriptures)}.`,

    "Please let us know if you have any questions.",
  ]);
}

export function buildThankYouMessage(input: ThankYouMessageInput): string {
  const comments = input.comments
    .map((comment) => comment.trim())
    .filter((comment) => comment !== "");

  return assemble([
    greeting(input.speakerFirstName),

    `Thank you for the talk you gave on ${formatSundayLabel(input.date)}.`,

    comments.length === 0 ? null : listPhrase(comments),

    "We appreciate the time you gave to prepare it.",
  ]);
}
