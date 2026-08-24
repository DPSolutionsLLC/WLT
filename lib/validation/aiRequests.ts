import { z } from "zod";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
//
// Both routes are thin: they assemble context, call Claude, and return a draft. What arrives in
// the body is correspondingly small, and everything that is NOT here is deliberate. Neither
// schema carries a model name, a token budget, an effort level, or a system prompt — those are
// decided server-side, and a caller that could name its own would be spending the ward's money
// on terms it chose.

// Beyond ten the queue stops being a queue a person reads and becomes a list they skim — which
// is how a bulk accept gets asked for. The cap is a product decision about attention, not a
// guess at what the model can produce.
export const MAX_SUGGESTION_COUNT = 10;
export const DEFAULT_SUGGESTION_COUNT = 5;
export const MAX_SEED_LENGTH = 300;

// `seed` is an optional nudge — "something for the youth", "fast Sunday". Null is the ordinary
// case and means "use the ward's standing topic preferences", which is what makes an unseeded
// run ward-specific rather than generic.
//
// An empty string becomes null rather than an empty nudge: a blank box the user tabbed through
// must behave exactly like a box they never touched.
export const aiSuggestTopicsSchema = z.object({
  seed: z
    .string()
    .trim()
    .max(MAX_SEED_LENGTH, `Keep the nudge to ${MAX_SEED_LENGTH} characters.`)
    .nullable()
    .default(null)
    .transform((value) => (value === null || value === "" ? null : value)),
  count: z
    .number()
    .int("Ask for a whole number of suggestions.")
    .min(1, "Ask for at least one suggestion.")
    .max(MAX_SUGGESTION_COUNT, `Ask for at most ${MAX_SUGGESTION_COUNT} suggestions.`)
    .default(DEFAULT_SUGGESTION_COUNT),
});
export type AiSuggestTopicsInput = z.infer<typeof aiSuggestTopicsSchema>;

// The two textareas, named by what they draft rather than by the stage they sit in — a stage can
// be renamed, and `confirmation` is what the message IS.
export const AI_MESSAGE_TYPES = ["confirmation", "thank_you"] as const;
export type AiMessageType = (typeof AI_MESSAGE_TYPES)[number];

export const aiMessageSchema = z.object({
  type: z.enum(AI_MESSAGE_TYPES),
});
export type AiMessageInput = z.infer<typeof aiMessageSchema>;
