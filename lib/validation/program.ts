import { z } from "zod";
import { programDraftSchema } from "@/lib/program/draft";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
// A schema that accepts a wardId is a schema someone will eventually trust.
//
// programDraftSchema is REUSED rather than restated. One schema, three consumers: this file,
// program-b's manual editor and program-b's AI editor. A second copy of the draft shape is a
// second thing to keep in step with the stored jsonb.

// `draft` omitted means "assemble one from current data"; `draft` present means "store exactly
// this", which is the manual-edit save path program-b uses when it is creating the row.
export const createProgramSchema = z.object({
  sundayId: z.uuid("Choose a Sunday from the calendar."),
  draft: programDraftSchema.optional(),
});
export type CreateProgramInput = z.infer<typeof createProgramSchema>;

// The WHOLE draft, never a partial patch.
//
// A snapshot is ambiguous about what a partial write means for the fields it omits: unchanged, or
// deliberately cleared? Both readings are defensible, which is exactly why the shape should not
// permit the question. program-b holds the draft in state and sends all of it.
export const updateProgramSchema = z.object({
  programId: z.uuid("That program id is not valid."),
  draft: programDraftSchema,
});
export type UpdateProgramInput = z.infer<typeof updateProgramSchema>;

// The statuses a BUILDER may move a program to. Deliberately not `approved` — that is the
// bishopric's decision and lives behind program.approve on its own route — and not `distributed`,
// which is program-d's and irreversible.
//
//   draft            -> pending_approval   the secretary sends it for approval
//   pending_approval -> draft              the secretary withdraws it
//   approved         -> draft              reopening an approved program to edit it
//
// The third is what makes POST /api/programs' 409 sentence actionable: an edit after approval is
// legitimate, but it is a decision rather than a save, so the caller reopens the program first.
// Which pairs are actually legal is decided once, in LEGAL_TRANSITIONS in lib/program/queries.ts;
// this enum only bounds what a builder may ask for.
export const BUILDER_PROGRAM_STATUSES = ["draft", "pending_approval"] as const;

export const setProgramStatusSchema = z.object({
  programId: z.uuid("That program id is not valid."),
  to: z.enum(BUILDER_PROGRAM_STATUSES),
});
export type SetProgramStatusInput = z.infer<typeof setProgramStatusSchema>;

// A discriminated union rather than one object with optional fields, following
// updateAssignmentSchema exactly.
//
// The talk pipeline's first pitfall was a field update that moved the stage as a side effect, and
// the fix there was to make the two mutually exclusive BY SHAPE so the schema rejects it rather
// than a reviewer having to catch it. A program has the same hazard: saving an edit must never be
// able to submit it for approval, and submitting must never be able to rewrite what is being
// submitted.
export const programRequestSchema = z.discriminatedUnion("action", [
  createProgramSchema.extend({ action: z.literal("build") }),
  updateProgramSchema.extend({ action: z.literal("save") }),
  setProgramStatusSchema.extend({ action: z.literal("status") }),
]);
export type ProgramRequestInput = z.infer<typeof programRequestSchema>;

export const approveProgramSchema = z
  .object({
    approved: z.boolean(),
    comment: z.string().trim().max(1000).nullable().optional(),
  })
  .superRefine((value, context) => {
    // A change request with no reason is a dead end for the secretary: the program goes back to
    // draft and nobody can say what to change. The same rule as approveAssignmentSchema, for the
    // same reason.
    if (value.approved === false && (value.comment == null || value.comment === "")) {
      context.addIssue({
        code: "custom",
        path: ["comment"],
        message: "Say what needs changing — the secretary only sees this comment.",
      });
    }
  });
export type ApproveProgramInput = z.infer<typeof approveProgramSchema>;

// `apply: false` is a question — "what has moved?" — and writes nothing. `apply: true` is the
// answer. Two calls rather than one, because a refresh that applied as it reported would make the
// diff a receipt for something already done rather than a choice.
export const refreshProgramSchema = z.object({
  apply: z.boolean(),
});
export type RefreshProgramInput = z.infer<typeof refreshProgramSchema>;

export const programSundayIdSchema = z.uuid("That Sunday id is not valid.");
export const programIdSchema = z.uuid("That program id is not valid.");

// ---------------------------------------------------------------------------------------------
// program-d: the two irreversible-ish routes
// ---------------------------------------------------------------------------------------------

// GENERATING A PDF TAKES NO INPUT. Everything it needs — the draft, the template, the slug — is
// already stored, and a body would be a second source of truth for a document the bishopric has
// already approved. `{}` is accepted so a client that sends an empty object is not refused, and
// nothing else is.
//
// `.strict()` matters here: a field silently ignored is a field somebody will one day believe is
// doing something.
export const generateProgramPdfSchema = z.object({}).strict();
export type GenerateProgramPdfInput = z.infer<typeof generateProgramPdfSchema>;

// DISTRIBUTION CANNOT BE UNDONE. There is no path out of `distributed` in LEGAL_TRANSITIONS,
// because an email cannot be recalled.
//
// `expectedRecipientCount` is the number the confirm dialog SHOWED the person before they clicked
// ("Email this programme to 12 people?" — calendar-b: a confirm is worded by consequence). The
// route compares it against the list it actually resolved and refuses when they differ, so a
// distribution list edited in another tab between the dialog opening and the button being pressed
// cannot quietly send to a different set of people.
//
// Optional, so a caller that has not shown a dialog is not blocked — but the UI always sends it.
export const distributeProgramSchema = z
  .object({
    expectedRecipientCount: z.number().int().nonnegative().optional(),
  })
  .strict();
export type DistributeProgramInput = z.infer<typeof distributeProgramSchema>;
