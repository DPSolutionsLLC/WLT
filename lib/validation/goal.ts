import { z } from "zod";
import { GOAL_TARGET_TYPES } from "@/types/domain";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).

export const MAX_GOAL_TITLE = 160;
export const MAX_GOAL_NOTES = 2000;
export const MAX_FREQUENCY_MONTHS = 120;

// `group` is a valid target_type in migration 010 and it is deliberately NOT creatable.
//
// The route's contract is that a target resolves to a live row in the right table before insert —
// the database cannot check it, because a polymorphic target_id carries no foreign key. There is
// no `groups` table in this schema, so a `group` target could never be verified, and an
// unverifiable target is exactly the permanent mystery that rule exists to prevent.
//
// Reads are unaffected: a `group` row written before this schema, or by a future slice that
// builds ad-hoc groups, still renders on the board — as a target whose record cannot be found,
// which is the honest answer rather than a crash. Recorded as a deviation in
// plans/04-talks-pipeline.md.
export const CREATABLE_GOAL_TARGET_TYPES = GOAL_TARGET_TYPES.filter(
  (targetType) => targetType !== "group",
) as ["member", "household", "org"];

export type CreatableGoalTargetType = (typeof CREATABLE_GOAL_TARGET_TYPES)[number];

const titleSchema = z
  .string()
  .trim()
  .min(1, "Give the goal a title.")
  .max(MAX_GOAL_TITLE, `Keep the title to ${MAX_GOAL_TITLE} characters.`);

// At least one month, because lib/goals/goalStatus.ts divides by the interval and a zero-month
// goal is overdue the moment it is created — a permanent alarm, not a goal. The ceiling is ten
// years, which is well past "no member goes two years without being asked" and stops a typo from
// producing an interval nobody will live to see.
const frequencySchema = z
  .number()
  .int("Give the frequency in whole months.")
  .min(1, "A goal repeats at least once a month.")
  .max(MAX_FREQUENCY_MONTHS, `Keep the frequency to ${MAX_FREQUENCY_MONTHS} months.`);

const notesSchema = z
  .string()
  .trim()
  .max(MAX_GOAL_NOTES, `Keep the notes to ${MAX_GOAL_NOTES} characters.`)
  .nullable()
  .optional();

// Migration 010's CHECK says both the type and the id are set, or neither is. The schema says the
// same thing at the boundary so the refusal is a sentence rather than a constraint violation.
function requireCoherentTarget(
  value: { targetType?: string | null; targetId?: string | null },
  context: z.RefinementCtx,
): void {
  const hasType = value.targetType !== null && value.targetType !== undefined;
  const hasId = value.targetId !== null && value.targetId !== undefined;

  if (hasType !== hasId) {
    context.addIssue({
      code: "custom",
      message: "A goal needs both a target kind and a target, or neither.",
    });
  }
}

export const createGoalSchema = z
  .object({
    title: titleSchema,
    targetType: z.enum(CREATABLE_GOAL_TARGET_TYPES).nullable().optional(),
    targetId: z.uuid("That target is not valid.").nullable().optional(),
    desiredFrequencyMonths: frequencySchema,
    notes: notesSchema,
  })
  .superRefine(requireCoherentTarget);
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

// A discriminated union, following talks-a Decision 4: an edit and a fulfilment are different
// events with different audit rows, and making them mutually exclusive BY SHAPE means the schema
// rejects a request that tries both rather than a reviewer catching it.
export const updateGoalSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("update"),
      title: titleSchema.optional(),
      targetType: z.enum(CREATABLE_GOAL_TARGET_TYPES).nullable().optional(),
      targetId: z.uuid("That target is not valid.").nullable().optional(),
      desiredFrequencyMonths: frequencySchema.optional(),
      notes: notesSchema,
    })
    .superRefine((value, context) => {
      if (Object.keys(value).length === 1) {
        context.addIssue({ code: "custom", message: "Nothing was changed." });
      }
      requireCoherentTarget(value, context);
    }),
  // No date parameter. Marking a goal fulfilled records that it happened NOW; a backdated
  // fulfilment is a different feature, and accepting an arbitrary timestamp here would let a
  // goal be pushed back on track by typing a date nobody checked.
  z.object({ action: z.literal("fulfill") }),
]);
export type UpdateGoalInput = z.infer<typeof updateGoalSchema>;

// No `status` filter. Status is COMPUTED on read (04-talks-pipeline.md §Step 9), so it is not a
// column the database can filter on — the board groups by it after the fact. A query parameter
// here would have to filter against the stale cached column, which is the exact bug the
// compute-on-read rule exists to prevent.
export const listGoalsQuerySchema = z.object({
  targetType: z.enum(GOAL_TARGET_TYPES).optional(),
});
export type ListGoalsQuery = z.infer<typeof listGoalsQuerySchema>;
