import { z } from "zod";
import { STANDARD_WORKS } from "@/types/domain";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
//
// Every message is a sentence a person could act on, because respondToRouteError surfaces
// error.issues[0].message VERBATIM to the user. The form imports these same schemas, so the
// refusal a bishop reads is written once (CLAUDE.md §6).

export const MAX_WARD_CONTEXT = 2000;
export const MAX_FREE_TEXT = 1000;
export const MAX_RELEVANCE_NOTES = 500;
export const MAX_SCRIPTURE_REFERENCES = 10;
export const MAX_CONFERENCE_TALKS = 10;
export const MAX_CONFERENCE_YEARS = 50;
export const MAX_PREVIEW_PROMPT = 1000;

function freeText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `Keep ${label} to ${max} characters.`)
    .nullable();
}

export const scripturePreferencesSchema = z.object({
  // No duplicates: the list is a PRIORITY ORDER, and a work listed twice has no defined place in
  // it. Rejecting is honest; silently de-duplicating would change what the bishopric asked for.
  canonPriority: z
    .array(z.enum(STANDARD_WORKS))
    .refine(
      (works) => new Set(works).size === works.length,
      "List each book of scripture only once.",
    ),
  maxReferences: z
    .number()
    .int("Give the number of scriptures as a whole number.")
    .min(0, "The number of scriptures cannot be negative.")
    .max(
      MAX_SCRIPTURE_REFERENCES,
      `Ask for at most ${MAX_SCRIPTURE_REFERENCES} scriptures.`,
    ),
  relevanceNotes: freeText(MAX_RELEVANCE_NOTES, "the notes on choosing scriptures"),
});
export type ScripturePreferencesInput = z.infer<typeof scripturePreferencesSchema>;

export const conferencePreferencesSchema = z.object({
  // Nullable means "no recency limit". It is NOT zero — a zero-year limit would forbid every
  // talk, and lib/ai/systemPrompt.ts renders the two differently on purpose.
  maxYearsOld: z
    .number()
    .int("Give the number of years as a whole number.")
    .min(1, "A recency limit is at least one year. Leave it blank for no limit.")
    .max(MAX_CONFERENCE_YEARS, `Keep the recency limit to ${MAX_CONFERENCE_YEARS} years.`)
    .nullable(),
  maxTalks: z
    .number()
    .int("Give the number of talks as a whole number.")
    .min(0, "The number of talks cannot be negative.")
    .max(MAX_CONFERENCE_TALKS, `Ask for at most ${MAX_CONFERENCE_TALKS} talks.`),
  preferKnowledgeBase: z.boolean(),
});
export type ConferencePreferencesInput = z.infer<typeof conferencePreferencesSchema>;

export const aiSettingsInputSchema = z.object({
  toneVoice: freeText(MAX_FREE_TEXT, "the tone and voice"),
  doctrinalEmphasis: freeText(MAX_FREE_TEXT, "the doctrinal emphasis"),
  scripturePreferences: scripturePreferencesSchema.nullable(),
  conferencePreferences: conferencePreferencesSchema.nullable(),
  topicPreferences: freeText(MAX_FREE_TEXT, "the topic preferences"),
  wardContext: freeText(MAX_WARD_CONTEXT, "the ward context"),
  thankYouPreferences: freeText(MAX_FREE_TEXT, "the thank-you preferences"),
});
export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

// The preview carries the DRAFT settings in the body rather than reading them from the database.
// That is the whole feature: a bishopric judges the tone before committing to it.
export const previewRequestSchema = z.object({
  settings: aiSettingsInputSchema,
  prompt: z
    .string()
    .trim()
    .min(1, "Type something for the preview to respond to.")
    .max(MAX_PREVIEW_PROMPT, `Keep the test prompt to ${MAX_PREVIEW_PROMPT} characters.`),
});
export type PreviewRequestInput = z.infer<typeof previewRequestSchema>;
