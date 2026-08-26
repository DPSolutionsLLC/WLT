import { z } from "zod";
import { formatDateOnly, isValidDateOnly } from "@/lib/calendar/dates";
import {
  APPOINTMENT_STATUSES,
  VISIT_ARRANGEMENTS,
  VISIT_CADENCES,
  VISIT_OUTCOMES,
  VISIT_TYPES,
  type VisitCadence,
} from "@/types/domain";

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

// ---------------------------------------------------------------------------
// Who actually went
// ---------------------------------------------------------------------------

export const MAX_VISIT_COMPANIONS = 5;
export const MAX_PARTICIPANT_LABEL = 120;

// A discriminated union on `kind`, not one object with three optional identity fields. A union
// by SHAPE makes a participant with two identities — or none — UNREPRESENTABLE at the boundary,
// which is the same rule migration 046's `visit_participants_one_identity` CHECK enforces at the
// database. Restating the CHECK as a refinement would leave two ways to express the invariant;
// this leaves one.
//
// `users` and `members` are unlinked in this schema, so no single foreign key can name every
// real companion: a leader is a `users` row, a spouse is a `members` row, and a neighbour who
// came along is neither.
export const visitParticipantSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.uuid("That leader is not valid.") }),
  z.object({ kind: z.literal("member"), memberId: z.uuid("That member is not valid.") }),
  z.object({
    kind: z.literal("label"),
    label: z
      .string()
      .trim()
      .min(1, "Give the person a name, or remove them.")
      .max(MAX_PARTICIPANT_LABEL, `Keep the name to ${MAX_PARTICIPANT_LABEL} characters.`),
  }),
]);
export type VisitParticipantInput = z.infer<typeof visitParticipantSchema>;

// THE CAP IS COMPANIONS PLUS THE RECORDER. MAX_VISIT_COMPANIONS is 5, so the list holds 6: a
// leader who keeps themselves on it may still add five other people. Off-by-one here is the
// obvious bug and tests/lib/visitParticipants.test.ts exists mostly to pin it.
export const MAX_VISIT_PARTICIPANTS = MAX_VISIT_COMPANIONS + 1;

export const TOO_MANY_PARTICIPANTS_MESSAGE =
  `A visit records at most ${MAX_VISIT_COMPANIONS} companions besides the person recording it. ` +
  "Remove somebody before adding another.";

export const participantsSchema = z
  .array(visitParticipantSchema)
  .max(MAX_VISIT_PARTICIPANTS, TOO_MANY_PARTICIPANTS_MESSAGE)
  .superRefine((participants, context) => {
    // The same person twice is refused HERE as well as by migration 046's two partial unique
    // indexes, because a constraint violation surfaces as a 500 reporting the server's own fault
    // for the caller's duplicate. There is deliberately no duplicate check on `label`: two
    // people can genuinely be "a neighbour".
    const seen = new Set<string>();

    participants.forEach((participant, index) => {
      if (participant.kind === "label") return;

      const key =
        participant.kind === "user"
          ? `user:${participant.userId}`
          : `member:${participant.memberId}`;

      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          message: "That person is already on this visit.",
          path: [index],
        });
      }

      seen.add(key);
    });
  });

// `participants` is OPTIONAL and that is load-bearing: absent means "the recorder went", which
// is the default requirement 4 asks for, and an empty array means "nobody is recorded as having
// gone". Those are different answers and the route must not conflate them, so this schema keeps
// `undefined` distinguishable from `[]` rather than defaulting.
//
// There is NO `recordedBy` field, here or anywhere. The route stamps it from the session — a
// request that could name its own recorder could put a visit in somebody else's name.
export const createVisitLogSchema = z.object({
  householdId: z.uuid("That household is not valid."),
  visitDate: pastOrPresentDateSchema,
  visitType: z.enum(VISIT_TYPES),
  outcome: z.enum(VISIT_OUTCOMES).default("completed"),
  arrangement: z.enum(VISIT_ARRANGEMENTS).default("drop_in"),
  sharedNotes: sharedNotesSchema,
  participants: participantsSchema.optional(),
  appointmentId: z.uuid("That appointment is not valid.").optional(),
});
export type CreateVisitLogInput = z.infer<typeof createVisitLogSchema>;

export const updateVisitLogSchema = z
  .object({
    outcome: z.enum(VISIT_OUTCOMES).optional(),
    arrangement: z.enum(VISIT_ARRANGEMENTS).optional(),
    sharedNotes: sharedNotesSchema,
    flaggedForWardCouncil: z.boolean().optional(),
    participants: participantsSchema.optional(),
  })
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: "custom", message: "Nothing was changed." });
    }
  });
export type UpdateVisitLogInput = z.infer<typeof updateVisitLogSchema>;

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

const scheduledForSchema = z
  .string()
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "Give the date and time as an ISO timestamp.",
  );

const appointmentNotesSchema = z
  .string()
  .trim()
  .max(MAX_SHARED_NOTES, `Keep the note to ${MAX_SHARED_NOTES} characters.`)
  .nullable()
  .optional();

// A PAST `scheduledFor` IS ALLOWED, unlike a visit log's date. An appointment recorded after the
// fact is a real thing — a leader writes down on Wednesday the visit they arranged for Tuesday —
// and refusing it would push that record back into a notes field where nothing can count it.
// The past-and-still-scheduled row is also exactly what reads as "missed".
export const createAppointmentSchema = z.object({
  householdId: z.uuid("That household is not valid."),
  scheduledFor: scheduledForSchema,
  notes: appointmentNotesSchema,
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

// Three different EVENTS, so a discriminated union on `action` rather than a patch of optional
// fields — following updateGoalSchema. Each writes its own audit row, and "cancelled" is not
// expressible as a side effect of rescheduling.
export const updateAppointmentSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("keep"),
    visitLogId: z.uuid("That visit is not valid."),
  }),
  z.object({ action: z.literal("cancel") }),
  z.object({
    action: z.literal("reschedule"),
    scheduledFor: scheduledForSchema,
  }),
]);
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

// Parsed with exactly the names the client sends, checked against the fetch in
// app/(app)/visits/AppointmentPanel.tsx rather than assumed — a parameter this schema does not
// carry gets no error, just a filter that is silently ignored
// (plans/retros/roster-b-picker-and-orgs.md).
export const listAppointmentsQuerySchema = z.object({
  householdId: z.uuid("That household is not valid.").optional(),
  from: scheduledForSchema.optional(),
  to: scheduledForSchema.optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

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

// ---------------------------------------------------------------------------
// The ward's cross-org visibility setting
// ---------------------------------------------------------------------------
// One boolean, and it belongs with the visit schemas because visit_logs_select is the only policy
// that reads it (migration 019). It widens READS only — no write policy mentions the function —
// so there is nothing here about management scope: that never changes.
//
// The name is the name app/(app)/admin/CrossOrgVisibilityToggle.tsx sends, checked against that
// file rather than assumed (plans/retros/roster-b-picker-and-orgs.md).
export const crossOrgVisibilitySchema = z.object({
  crossOrgVisibility: z.boolean(),
});
export type CrossOrgVisibilityInput = z.infer<typeof crossOrgVisibilitySchema>;
