import { z } from "zod";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
//
// Both routes are thin: they assemble context, call Claude, and return a draft. What arrives in
// the body is correspondingly small, and everything that is NOT here is deliberate. Neither
// schema carries a model name, a token budget, an effort level, or a system prompt — those are
// decided server-side, and a caller that could name its own would be spending the ward's money
// on terms it chose.

// THE TOPIC WINDOW'S "Suggest topics" (Topics rebuild t5). `context` is an optional nudge ("something
// for the youth"); null is the ordinary case and means the ward's standing topic preferences steer
// the ideas. A blank box behaves exactly like one never touched. `alreadyOffered` is what the
// window is showing, so "More suggestions" brings new ideas; it is capped, because it goes into
// the prompt.
export const MAX_TOPIC_CONTEXT_LENGTH = 300;
const MAX_ALREADY_OFFERED = 40;

export const talkTopicSuggestionsSchema = z.object({
  sundayId: z.uuid("Choose a Sunday from the calendar."),
  context: z
    .string()
    .trim()
    .max(MAX_TOPIC_CONTEXT_LENGTH, `Keep it to ${MAX_TOPIC_CONTEXT_LENGTH} characters.`)
    .nullable()
    .default(null)
    .transform((value) => (value === null || value === "" ? null : value)),
  alreadyOffered: z.array(z.string().trim().max(200)).max(MAX_ALREADY_OFFERED).default([]),
});
export type TalkTopicSuggestionsInput = z.infer<typeof talkTopicSuggestionsSchema>;

// The two textareas, named by what they draft rather than by the stage they sit in — a stage can
// be renamed, and `confirmation` is what the message IS.
export const AI_MESSAGE_TYPES = ["confirmation", "thank_you"] as const;
export type AiMessageType = (typeof AI_MESSAGE_TYPES)[number];

export const aiMessageSchema = z.object({
  type: z.enum(AI_MESSAGE_TYPES),
});
export type AiMessageInput = z.infer<typeof aiMessageSchema>;
