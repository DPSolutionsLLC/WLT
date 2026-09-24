import { z } from "zod";
import { isValidDateOnly } from "@/lib/calendar/dates";

// NO `userId`, NO `assignedBy` AND NO `wardId` ON ANY SCHEMA HERE. The owner is always the session's
// user and the ward is always the session's ward. A body that could name either would make D3
// — "a leader cannot put a to-do on somebody else's list" — a matter of the route remembering,
// where migration 081's INSERT policy makes it a matter of the table.

export const MAX_TODO_TITLE = 300;
export const MAX_TODO_NOTES = 4000;
export const MAX_TODO_TAG = 40;
export const MAX_STEP_LABEL = 200;
export const MAX_NOTE_BODY = 2000;

const idSchema = z.string().uuid();

// A `date` column — a day with no zone. NO REFINEMENT FORCES do ≤ due: a leader may plan to start
// after a soft deadline, and inventing a rule here would refuse something true.
const dateOnlySchema = z
  .string()
  .refine(isValidDateOnly, "Give the date as YYYY-MM-DD.")
  .nullable();

const titleSchema = z
  .string()
  .trim()
  .min(1, "Give it a title.")
  .max(MAX_TODO_TITLE, `Keep a title to ${MAX_TODO_TITLE} characters.`);

const notesSchema = z
  .string()
  .trim()
  .max(MAX_TODO_NOTES, `Keep the notes to ${MAX_TODO_NOTES} characters.`)
  .nullable()
  .transform((value) => (value === null || value === "" ? null : value));

const tagSchema = z
  .string()
  .trim()
  .max(MAX_TODO_TAG, `Keep a tag to ${MAX_TODO_TAG} characters.`)
  .nullable()
  .transform((value) => (value === null || value === "" ? null : value));

export const createTodoSchema = z.object({
  title: titleSchema,
  notes: notesSchema.optional(),
  tag: tagSchema.optional(),
  doDate: dateOnlySchema.optional(),
  dueDate: dateOnlySchema.optional(),
});

export const updateTodoSchema = z
  .object({
    title: titleSchema.optional(),
    notes: notesSchema.optional(),
    tag: tagSchema.optional(),
    doDate: dateOnlySchema.optional(),
    dueDate: dateOnlySchema.optional(),
    complete: z.boolean().optional(),
    // An instant WITH its offset — "Schedule this" converts the ward's wall clock before sending,
    // so a floating time never reaches the column.
    scheduledFor: z.iso.datetime({ offset: true }).nullable().optional(),
    // A `members` id, ward-scoped by migration 081's composite foreign key.
    scheduledWithMemberId: idSchema.nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Nothing to change.",
  );

export const createStepSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Say what the step is.")
    .max(MAX_STEP_LABEL, `Keep a step to ${MAX_STEP_LABEL} characters.`),
});

export const updateStepSchema = z
  .object({
    label: createStepSchema.shape.label.optional(),
    done: z.boolean().optional(),
  })
  .refine(
    (value) => value.label !== undefined || value.done !== undefined,
    "Nothing to change.",
  );

export const createNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write something first.")
    .max(MAX_NOTE_BODY, `Keep a note to ${MAX_NOTE_BODY} characters.`),
});

export const todoIdSchema = z.object({ id: idSchema });

export const listTodosQuerySchema = z.object({
  status: z.enum(["open", "done"]).default("open"),
});

export type CreateTodoInput = z.infer<typeof createTodoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
export type CreateStepInput = z.infer<typeof createStepSchema>;
export type UpdateStepInput = z.infer<typeof updateStepSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type ListTodosQuery = z.infer<typeof listTodosQuerySchema>;
