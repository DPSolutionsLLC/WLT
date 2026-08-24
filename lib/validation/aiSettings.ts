import { z } from "zod";
import { SPEAKER_ROLES, STANDARD_WORKS } from "@/types/domain";

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

// The corpus scope: WHICH conference talks are searchable at all.
//
// NOT the same thing as `maxYearsOld` below it, and the scope panel says so in words. This is a
// SQL filter over the knowledge base — it decides what retrieval can even find. `maxYearsOld` is
// prose in the system prompt asking the model to prefer recent talks among whatever it was
// given. Input versus output. Both are real, they live on two different screens, and a reader
// who confuses them will set one and wonder why the other did not change.
//
// `speakerRoles: []` MEANS NO RESTRICTION, not "no roles". An empty array never reaches the
// database as one — mergeConferenceScope collapses it to null, because `= any ('{}')` matches
// nothing and would narrow the corpus to zero while reading like "everything".
export const conferenceScopeSchema = z.object({
  sinceYears: z
    .number()
    .int("Give the recency limit as a whole number of years.")
    .min(1, "A recency limit is at least one year. Choose no limit instead.")
    .max(MAX_CONFERENCE_YEARS, `Keep the recency limit to ${MAX_CONFERENCE_YEARS} years.`)
    .nullable(),
  speakerRoles: z
    .array(z.enum(SPEAKER_ROLES))
    .refine(
      (roles) => new Set(roles).size === roles.length,
      "Choose each calling only once.",
    ),
  savedFilterIds: z
    .array(z.uuid("A saved filter reference is not valid."))
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Choose each saved filter only once.",
    ),
});
export type ConferenceScopeInput = z.infer<typeof conferenceScopeSchema>;

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
  // `.nullable().default(null)` RATHER THAN a required field, and that is load-bearing.
  //
  // lib/ai/queries.ts parses every STORED row through this schema, and every ai_settings row
  // written before ai-d has no `scope` key at all. A required field would fail that parse,
  // toConferencePreferences() would fall back to null, and every ward's existing conference
  // preferences would silently vanish from the system prompt. The default is what makes an old
  // row keep meaning what it meant.
  scope: conferenceScopeSchema.nullable().default(null),
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
