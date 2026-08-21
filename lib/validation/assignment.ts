import { z } from "zod";
import { MAX_SPEAKING_SLOTS, dateOnlySchema } from "@/lib/validation/calendar";
import {
  ASSIGNMENT_TYPES,
  MAX_EXTERNAL_SPEAKER_NAME,
  MAX_EXTERNAL_SPEAKER_TITLE,
  PIPELINE_STAGES,
  REQUEST_OUTCOMES,
} from "@/types/domain";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
// A schema that accepts a wardId is a schema someone will eventually trust.

// ITER-004. The title is optional and typed; nothing derives it.
export const externalSpeakerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Type the speaker's name.")
    .max(MAX_EXTERNAL_SPEAKER_NAME, `Keep the name to ${MAX_EXTERNAL_SPEAKER_NAME} characters.`),
  title: z
    .string()
    .trim()
    .max(MAX_EXTERNAL_SPEAKER_TITLE, `Keep the title to ${MAX_EXTERNAL_SPEAKER_TITLE} characters.`)
    .nullable()
    .optional(),
});
export type ExternalSpeakerInput = z.infer<typeof externalSpeakerSchema>;

const SPEAKER_BOTH =
  "Choose a ward member or type an outside speaker's name, not both.";

// Mirrors the assignments_speaker_exactly_one CHECK in migration 025. The database is the real
// boundary; this makes the refusal a 400 the planner can read rather than a 500 carrying a
// constraint name.
function refuseBothSpeakers(
  value: { memberId?: string | null; externalSpeaker?: ExternalSpeakerInput | null },
  context: z.RefinementCtx,
): void {
  if (value.memberId != null && value.externalSpeaker != null) {
    context.addIssue({
      code: "custom",
      path: ["externalSpeaker"],
      message: SPEAKER_BOTH,
    });
  }
}

export const createAssignmentSchema = z
  .object({
    sundayId: z.uuid("Choose a Sunday from the calendar."),
    assignmentType: z.enum(ASSIGNMENT_TYPES),
    slotNumber: z.number().int().min(1).max(MAX_SPEAKING_SLOTS),
    slotLengthMinutes: z.number().int().min(1).max(60).nullable().optional(),
    memberId: z.uuid("Choose someone from the roster.").nullable().optional(),
    externalSpeaker: externalSpeakerSchema.nullable().optional(),
    topicId: z.uuid("Choose a topic from the library.").nullable().optional(),
  })
  .superRefine(refuseBothSpeakers);
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;

// Every field a planner may edit, and deliberately NOT pipeline_stage. The stage moves through
// `action: "transition"` and nowhere else — that separation is what makes implicit stage
// advancement, the phase's first pitfall, unrepresentable rather than merely discouraged.
export const assignmentFieldsSchema = z
  .object({
    assignmentType: z.enum(ASSIGNMENT_TYPES).optional(),
    slotNumber: z.number().int().min(1).max(MAX_SPEAKING_SLOTS).optional(),
    slotLengthMinutes: z.number().int().min(1).max(60).nullable().optional(),
    memberId: z.uuid("Choose someone from the roster.").nullable().optional(),
    externalSpeaker: externalSpeakerSchema.nullable().optional(),
    topicId: z.uuid("Choose a topic from the library.").nullable().optional(),
    requestOutcome: z.enum(REQUEST_OUTCOMES).nullable().optional(),
    requestNotes: z.string().trim().max(2000).nullable().optional(),
    notifyMessage: z.string().trim().max(4000).nullable().optional(),
    notifySentAt: z.iso.datetime().nullable().optional(),
    sundayConfirmedAt: z.iso.datetime().nullable().optional(),
    thankYouMessage: z.string().trim().max(4000).nullable().optional(),
    thankYouSentAt: z.iso.datetime().nullable().optional(),
  })
  .superRefine((value, context) => {
    refuseBothSpeakers(value, context);

    if (Object.keys(value).length === 0) {
      context.addIssue({
        code: "custom",
        message: "Nothing was changed.",
      });
    }
  });
export type AssignmentFieldsInput = z.infer<typeof assignmentFieldsSchema>;

// A discriminated union rather than one object with an optional `to`. The phase's first pitfall
// is a field update that moves the stage as a side effect; making the two mutually exclusive BY
// SHAPE means the schema rejects it, rather than a reviewer having to catch it.
export const updateAssignmentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), fields: assignmentFieldsSchema }),
  z.object({
    action: z.literal("transition"),
    to: z.enum(PIPELINE_STAGES),
    // Required by canTransition() for a BACKWARD move only, which is a rule about the pair of
    // stages rather than about the request shape — so it is enforced there, not here.
    reason: z.string().trim().max(300).optional(),
  }),
  z.object({
    action: z.literal("waive_contact"),
    note: z.string().trim().max(300).optional(),
  }),
]);
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;

export const approveAssignmentSchema = z
  .object({
    approved: z.boolean(),
    comment: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((value, context) => {
    // A change request with no reason is a dead end for the planner: the assignment goes back to
    // planning and nobody can say what to change.
    if (value.approved === false && (value.comment == null || value.comment === "")) {
      context.addIssue({
        code: "custom",
        path: ["comment"],
        message: "Say what needs changing — the planner only sees this comment.",
      });
    }
  });
export type ApproveAssignmentInput = z.infer<typeof approveAssignmentSchema>;

const commentBodySchema = z
  .string()
  .trim()
  .min(1, "Type a comment first.")
  .max(2000, "Keep a comment to 2000 characters.");

// One table serves both comment levels, so one route serves both. `level` is the discriminant
// rather than a free field: the server sets the column from it and never takes the client's word
// for which id to trust.
export const createCommentSchema = z.discriminatedUnion("level", [
  z.object({
    level: z.literal("assignment"),
    assignmentId: z.uuid("That assignment id is not valid."),
    comment: commentBodySchema,
  }),
  z.object({
    level: z.literal("month"),
    sundayId: z.uuid("That Sunday id is not valid."),
    comment: commentBodySchema,
  }),
]);
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

// Exactly one filter, never both and never neither. A GET with no filter would read every
// assignment the ward has ever planned.
//
// The union carries its own message. A union's default issue is the bare string "Invalid input",
// and respondToRouteError renders issues[0].message verbatim — so without this the caller is told
// nothing about what the route actually wanted.
export const listAssignmentsQuerySchema = z.union(
  [
    z.object({ sundayId: z.uuid("That Sunday id is not valid.") }),
    z
      .object({ from: dateOnlySchema, to: dateOnlySchema })
      .refine(({ from, to }) => to >= from, {
        message: "The end date must not be before the start date.",
        path: ["to"],
      }),
  ],
  { error: "Ask for one Sunday with ?sundayId=, or a range with ?from= and ?to=." },
);
export type ListAssignmentsQuery = z.infer<typeof listAssignmentsQuerySchema>;

export const listCommentsQuerySchema = z.union(
  [
    z.object({ assignmentId: z.uuid("That assignment id is not valid.") }),
    z.object({ sundayId: z.uuid("That Sunday id is not valid.") }),
  ],
  { error: "Ask for one assignment with ?assignmentId=, or one Sunday with ?sundayId=." },
);
export type ListCommentsQuery = z.infer<typeof listCommentsQuerySchema>;
