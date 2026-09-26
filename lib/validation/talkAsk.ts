import { z } from "zod";
import { DECLINE_REASONS, REQUEST_OUTCOMES } from "@/types/domain";

// Sacrament slice f: recording a speaker's answer, from the talk's own panel or from an ask on the
// conductor's To Do. Both carry the same fields and reach the same function
// (lib/assignments/requestOutcome.ts).
//
// No wardId, no userId and no assignmentId in a body. The ward comes from the session, and the
// talk comes from the URL, or from the to-do the caller's own client could read.

export const MAX_ANSWER_NOTE = 2000;

const DECLINE_NEEDS_REASON = "Choose why they declined.";

const answerFields = {
  declineReason: z.enum(DECLINE_REASONS).optional(),
  note: z.string().trim().max(MAX_ANSWER_NOTE, `Keep the note to ${MAX_ANSWER_NOTE} characters.`).optional(),
};

function requireReasonOnDecline(
  value: { outcome: string; declineReason?: string },
  context: z.RefinementCtx,
): void {
  if (value.outcome === "declined" && value.declineReason === undefined) {
    context.addIssue({ code: "custom", path: ["declineReason"], message: DECLINE_NEEDS_REASON });
  }
}

// The assignment route's `action: "record_outcome"`. `pending` is accepted here because the
// talk's panel can still record "still waiting"; an ask on a to-do cannot.
export const recordOutcomeSchema = z
  .object({
    action: z.literal("record_outcome"),
    outcome: z.enum(REQUEST_OUTCOMES),
    ...answerFields,
  })
  .superRefine(requireReasonOnDecline);
export type RecordOutcomeInput = z.infer<typeof recordOutcomeSchema>;

// POST /api/todos/[id]/answer.
export const answerAskSchema = z
  .object({
    outcome: z.enum(["accepted", "declined"]),
    ...answerFields,
  })
  .superRefine(requireReasonOnDecline);
export type AnswerAskInput = z.infer<typeof answerAskSchema>;
