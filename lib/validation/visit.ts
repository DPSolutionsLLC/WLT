import { z } from "zod";
import { formatDateOnly, isValidDateOnly } from "@/lib/calendar/dates";
import { VISIT_CADENCES, VISIT_TYPES, type VisitCadence } from "@/types/domain";

// No wardId and no orgId on any schema here, ever. Both come from the session
// (conventions.md §Validation). A request that could name its own organization could write a
// goal onto another organization's board, or a log the org that has to act on it never sees.

export const MAX_VISIT_GOAL_TITLE = 160;
export const MAX_SHARED_NOTES = 4000;
export const MAX_PRIVATE_NOTES = 4000;
export const MAX_CADENCE_MONTHS = 120;

// One map, exported, because visits-b's progress dashboard has to read the SAME numbers to work
// out how many visits a period expects. Two copies drift and the denominator quietly changes.
export const CADENCE_MONTHS: Record<Exclude<VisitCadence, "custom">, number> = {
  annual: 12,
  biannual: 6,
};

// `specific_households` and `custom` are deliberately not creatable, on the precedent
// talks-d set with `target_type: 'group'`: nothing in this schema stores WHICH households such
// a goal covers, so its progress could never be computed and the goal would sit on the board
// as a permanent unanswerable question. Reads are unaffected — a row carrying either value
// still maps back correctly (types/domain.ts §VISIT_TARGET_TYPES).
export const CREATABLE_VISIT_TARGET_TYPES = ["all_households"] as const;

const dateOnlySchema = z
  .string()
  .refine(isValidDateOnly, "Give the date as YYYY-MM-DD.");

const titleSchema = z
  .string()
  .trim()
  .min(1, "Give the goal a title.")
  .max(MAX_VISIT_GOAL_TITLE, `Keep the title to ${MAX_VISIT_GOAL_TITLE} characters.`);

// At least one month for the same reason lib/validation/goal.ts sets that floor: a zero-month
// cadence is overdue the moment it is saved. The ceiling stops a typo producing an interval
// nobody will live to see.
const cadenceMonthsSchema = z
  .number()
  .int("Give the cadence in whole months.")
  .min(1, "A cadence repeats at least once a month.")
  .max(MAX_CADENCE_MONTHS, `Keep the cadence to ${MAX_CADENCE_MONTHS} months.`);

// `cadenceMonths` is the number of months only when the cadence is `custom`. For `annual` and
// `biannual` the number is already known (CADENCE_MONTHS above), so accepting one would let a
// goal claim to be annual while counting every three months — two sources of truth for one
// interval, disagreeing.
function requireCoherentCadence(
  value: { cadence?: VisitCadence; cadenceMonths?: number | null },
  context: z.RefinementCtx,
): void {
  if (value.cadence === undefined) return;

  const hasMonths = value.cadenceMonths !== null && value.cadenceMonths !== undefined;

  if (value.cadence === "custom" && !hasMonths) {
    context.addIssue({
      code: "custom",
      message: "A custom cadence needs a number of months.",
      path: ["cadenceMonths"],
    });
  }

  if (value.cadence !== "custom" && hasMonths) {
    context.addIssue({
      code: "custom",
      message: `A ${value.cadence} cadence already sets its own interval.`,
      path: ["cadenceMonths"],
    });
  }
}

function requireForwardPeriod(
  value: { goalPeriodStart?: string; goalPeriodEnd?: string },
  context: z.RefinementCtx,
): void {
  const { goalPeriodStart, goalPeriodEnd } = value;
  if (goalPeriodStart === undefined || goalPeriodEnd === undefined) return;

  if (goalPeriodEnd <= goalPeriodStart) {
    context.addIssue({
      code: "custom",
      message: "The goal period has to end after it starts.",
      path: ["goalPeriodEnd"],
    });
  }
}

// The ONE place a request may name an organization, and it is honoured only for a bishopric
// author who is configuring somebody else's organization (07-visits.md §Step 1). For anyone else
// the route refuses it outright and stamps `user.orgId` instead — a request that could pick its
// own owner could write a goal onto another organization's board.
//
// It is required rather than optional for the bishopric, because a visit goal with
// `org_id = null` lands in the hole migration 019's `org_id = current_org_id()` creates: null is
// never equal to null in SQL, so no org leader could ever read the goal they are meant to act on.
// A ward-level visit goal is not a thing FEATURES.md §Module 9 describes.
export const createVisitGoalSchema = z
  .object({
    title: titleSchema,
    orgId: z.uuid("That organization is not valid.").optional(),
    targetType: z.literal("all_households"),
    cadence: z.enum(VISIT_CADENCES),
    cadenceMonths: cadenceMonthsSchema.nullable().optional(),
    goalPeriodStart: dateOnlySchema,
    goalPeriodEnd: dateOnlySchema,
  })
  .superRefine((value, context) => {
    requireCoherentCadence(value, context);
    requireForwardPeriod(value, context);
  });
export type CreateVisitGoalInput = z.infer<typeof createVisitGoalSchema>;

export const updateVisitGoalSchema = z
  .object({
    title: titleSchema.optional(),
    cadence: z.enum(VISIT_CADENCES).optional(),
    cadenceMonths: cadenceMonthsSchema.nullable().optional(),
    goalPeriodStart: dateOnlySchema.optional(),
    goalPeriodEnd: dateOnlySchema.optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: "custom", message: "Nothing was changed." });
    }
    requireCoherentCadence(value, context);
    requireForwardPeriod(value, context);
  });
export type UpdateVisitGoalInput = z.infer<typeof updateVisitGoalSchema>;

const sharedNotesSchema = z
  .string()
  .trim()
  .max(MAX_SHARED_NOTES, `Keep the shared notes to ${MAX_SHARED_NOTES} characters.`)
  .nullable()
  .optional();

// A visit is a record of something that HAPPENED. A future date is either a typo or a plan, and
// either way it would count towards a period the visit has not been made in yet — which is a
// progress number that reads better than the ward is doing.
//
// "Today" is UTC, because every date in this app is (lib/calendar/dates.ts). Late on a Sunday
// evening in a US timezone that is already tomorrow, so the bound is at worst one day generous —
// the safe direction. It never refuses a visit somebody actually made today.
const pastOrPresentDateSchema = dateOnlySchema.refine(
  (value) => value <= formatDateOnly(new Date()),
  "A visit cannot be logged for a date in the future.",
);

export const createVisitLogSchema = z.object({
  householdId: z.uuid("That household is not valid."),
  visitDate: pastOrPresentDateSchema,
  visitType: z.enum(VISIT_TYPES),
  sharedNotes: sharedNotesSchema,
});
export type CreateVisitLogInput = z.infer<typeof createVisitLogSchema>;

export const updateVisitLogSchema = z
  .object({
    sharedNotes: sharedNotesSchema,
    flaggedForWardCouncil: z.boolean().optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: "custom", message: "Nothing was changed." });
    }
  });
export type UpdateVisitLogInput = z.infer<typeof updateVisitLogSchema>;

// No `userId`. The author of a private note is always auth.uid(), so "write someone else's
// note" is not expressible in this schema, in lib/visits/privateNotes.ts, or in the route.
export const upsertPrivateNoteSchema = z.object({
  notes: z
    .string()
    .trim()
    .min(1, "Write something, or delete the note instead.")
    .max(MAX_PRIVATE_NOTES, `Keep the note to ${MAX_PRIVATE_NOTES} characters.`),
});
export type UpsertPrivateNoteInput = z.infer<typeof upsertPrivateNoteSchema>;

// The names here are the names the client sends, checked against the fetch in
// app/(app)/visits/VisitLogForm.tsx rather than assumed. A parameter this schema does not carry
// gets no error, just a filter that is silently ignored (plans/retros/roster-b-picker-and-orgs.md).
export const listVisitsQuerySchema = z.object({
  orgId: z.uuid("That organization is not valid.").optional(),
  householdId: z.uuid("That household is not valid.").optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type ListVisitsQuery = z.infer<typeof listVisitsQuerySchema>;
