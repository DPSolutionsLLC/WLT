import { z } from "zod";
import { programDraftSchema } from "@/lib/program/draft";

// The ai-edit request body.
//
// No wardId, ever — it comes from the session (conventions.md §Validation). No model name, no
// token budget, no effort level and no system prompt either: a caller that could name its own
// would be spending the ward's money on terms it chose (lib/validation/aiRequests.ts).
//
// programDraftSchema is REUSED rather than restated, for the same reason lib/validation/program.ts
// reuses it. A second copy of the draft shape is a second thing to keep in step with the stored
// jsonb, and here it would be the shape the AI editor's input and output disagreed about.

// A sentence or two describing a change. Long enough for "add a note that the Primary children
// will sing during the sacrament and change the ward business to mention the new Elders Quorum
// secretary", short enough that nobody pastes a whole program into it.
export const MAX_EDIT_INSTRUCTION = 1000;

// One conversation about one draft. Past twenty turns the history costs more in every prompt
// than it is worth, and a secretary who has taken twenty turns to describe a change is better
// served by editing the field. The panel is component state, so the cap is also the point at
// which a conversation should be started again rather than grown.
export const MAX_HISTORY_TURNS = 20;

// An assistant turn is a SUMMARY of what changed, not a draft — the draft travels in `draft`.
// 2000 characters is generous for a list of changed fields and refuses a pasted program.
export const MAX_TURN_LENGTH = 2000;

export const chatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z
    .string()
    .trim()
    .min(1, "A conversation turn cannot be empty.")
    .max(MAX_TURN_LENGTH, "That conversation turn is too long to send."),
});
export type ChatTurn = z.infer<typeof chatTurnSchema>;

// `draft` is the draft ON SCREEN, not the stored one. A secretary editing a field and then
// asking for a change expects the change applied to what they are looking at, and the route
// writes nothing, so there is no row for a client-supplied draft to corrupt.
export const aiProgramEditSchema = z.object({
  draft: programDraftSchema,
  history: z
    .array(chatTurnSchema)
    .max(MAX_HISTORY_TURNS, "This conversation is too long. Start a new one.")
    .default([]),
  instruction: z
    .string()
    .trim()
    .min(1, "Say what you would like changed.")
    .max(MAX_EDIT_INSTRUCTION, `Keep the request to ${MAX_EDIT_INSTRUCTION} characters.`),
});
export type AiProgramEditInput = z.infer<typeof aiProgramEditSchema>;
