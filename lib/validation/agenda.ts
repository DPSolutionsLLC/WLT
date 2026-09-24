import { z } from "zod";
import { AGENDA_ITEM_SOURCES } from "@/lib/agendas/sections";
import { MEETING_TYPES } from "@/types/domain";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).

export const MAX_SECTION_TITLE = 120;
export const MAX_ITEM_TEXT = 500;
export const MAX_ACTION_DESCRIPTION = 500;
export const MAX_ASSIGNED_TO = 120;
export const MAX_SECTIONS = 30;
export const MAX_ITEMS_PER_SECTION = 60;

// ---------------------------------------------------------------------------
// WHY THE SECTIONS BLOB IS VALIDATED AT ALL, AND WHY HERE
// ---------------------------------------------------------------------------
// 09-meetings-tithing.md §Step A1 asks for this by name: "Validate the `sections` shape with Zod
// on every write. A malformed blob breaks the PDF renderer and is hard to diagnose after the
// fact."
//
// `agendas.sections` is `jsonb` with no shape at all in migration 012 — the database will accept
// a number, a string, or an object with the wrong keys, and none of that surfaces until somebody
// presses Publish weeks later and @react-pdf throws inside a render. This schema is the only thing
// standing between a bad write and that. It runs on POST and on PATCH, never on read: a row
// written before this existed is rendered defensively rather than rejected, because refusing to
// display an agenda somebody already held a meeting from helps nobody.

const idSchema = z.string().uuid();

const agendaItemSchema = z.object({
  id: idSchema,
  text: z
    .string()
    .trim()
    .min(1, "An agenda line needs some text.")
    .max(MAX_ITEM_TEXT, `Keep an agenda line to ${MAX_ITEM_TEXT} characters.`),
  source: z.enum(AGENDA_ITEM_SOURCES),
  // Set only on a `flag` item. Not cross-checked against `source` here: a hand-typed line that
  // happens to carry an id is harmless, and the publish route reads `source === "flag"` to decide
  // what to resolve, so the pair that matters is checked where it is acted on.
  sourceId: idSchema.nullable(),
});

const agendaSectionSchema = z.object({
  id: idSchema,
  title: z
    .string()
    .trim()
    .min(1, "Give the section a heading.")
    .max(MAX_SECTION_TITLE, `Keep a heading to ${MAX_SECTION_TITLE} characters.`),
  items: z
    .array(agendaItemSchema)
    .max(MAX_ITEMS_PER_SECTION, `Keep a section to ${MAX_ITEMS_PER_SECTION} lines.`),
  carryForward: z.boolean(),
});

// AT MOST ONE CARRY-FORWARD SECTION, and zero is allowed.
//
// Two would make `carryForwardSection()` return whichever came first, so carried items would land
// somewhere that depends on array order — an answer nobody can reason about later, which is the
// same objection lib/youth/coverage.ts states about branch order. Zero is a ward that deleted the
// heading, and the builder tells them where their carried items went instead of silently dropping
// them.
export const agendaSectionsSchema = z
  .array(agendaSectionSchema)
  .max(MAX_SECTIONS, `Keep an agenda to ${MAX_SECTIONS} sections.`)
  .refine(
    (sections) => sections.filter((section) => section.carryForward).length <= 1,
    "Only one section can hold the carried action items.",
  );

export const createAgendaSchema = z.object({
  meetingType: z.enum(MEETING_TYPES),
  // A `date` column — the day of the meeting, with no time. Never an instant: a meeting is on a
  // day in the ward's own calendar, and storing 7pm-with-an-offset would put the January meeting
  // on the wrong side of midnight for anybody reading it from another zone.
  meetingDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the meeting date as YYYY-MM-DD."),
  // Absent means "use the template for this meeting type". The route builds it rather than the
  // client, so a new agenda is the same shape however it was created.
  sections: agendaSectionsSchema.optional(),
});

export const updateAgendaSchema = z
  .object({
    meetingDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the meeting date as YYYY-MM-DD.")
      .optional(),
    sections: agendaSectionsSchema.optional(),
  })
  .refine(
    (body) => body.meetingDate !== undefined || body.sections !== undefined,
    "Nothing to change.",
  );

// NO `status` FIELD, DELIBERATELY. Publishing is its own route with its own permission
// (`agendas.publish`) and its own side effects — a PDF, a notification, resolved flags. Letting a
// PATCH set `status: "published"` would be a second way to publish that skipped all of it, which
// is the shape talks-d records as a hole. The same reasoning keeps `publishedAt`, `publishedBy`,
// `pdfUrl` and `emailSentAt` off this schema: they are stamped by the server, never sent by a
// client.

// THE ACCOUNT an item is assigned to, which creates and links that person's to-do (slice p5-b).
// Beside the free-text `assignedTo`, never instead of it (decision D1). Shape only here: whether the
// id holds a calling in this ward is a question for the database, asked by the route with
// findUsersOutsideWard(). Null unassigns.
const assignedUserIdSchema = idSchema.nullable().optional();

export const createActionItemSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Say what needs doing.")
    .max(MAX_ACTION_DESCRIPTION, `Keep an action item to ${MAX_ACTION_DESCRIPTION} characters.`),
  // Free text, not a member id. An action item is assigned to "the Elders Quorum president" or
  // "Brother Diaz" as often as to a member row, and forcing a picker would make the common case
  // harder than typing it. Nothing computes against this field.
  assignedTo: z
    .string()
    .trim()
    .max(MAX_ASSIGNED_TO, `Keep the name to ${MAX_ASSIGNED_TO} characters.`)
    .nullable()
    .optional(),
  assignedUserId: assignedUserIdSchema,
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the due date as YYYY-MM-DD.")
    .nullable()
    .optional(),
});

// Completing and reopening are the same route, because reopening is what makes a mis-tick
// recoverable — migration 060a's rule for `closed_at`, on a field with the same power to remove
// something from a list. `completed_at` is stamped by the server from this boolean, never sent.
export const updateActionItemSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Say what needs doing.")
      .max(MAX_ACTION_DESCRIPTION, `Keep an action item to ${MAX_ACTION_DESCRIPTION} characters.`)
      .optional(),
    assignedTo: z
      .string()
      .trim()
      .max(MAX_ASSIGNED_TO, `Keep the name to ${MAX_ASSIGNED_TO} characters.`)
      .nullable()
      .optional(),
    assignedUserId: assignedUserIdSchema,
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the due date as YYYY-MM-DD.")
      .nullable()
      .optional(),
    complete: z.boolean().optional(),
  })
  .refine(
    (body) => Object.keys(body).length > 0,
    "Nothing to change.",
  );

export const listAgendasQuerySchema = z.object({
  meetingType: z.enum(MEETING_TYPES).optional(),
  // Absent means upcoming and recent only. The list is a working screen, not an archive.
  includePast: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
});

export const agendaIdSchema = z.object({ id: idSchema });

export type CreateAgendaInput = z.infer<typeof createAgendaSchema>;
export type UpdateAgendaInput = z.infer<typeof updateAgendaSchema>;
export type CreateActionItemInput = z.infer<typeof createActionItemSchema>;
export type UpdateActionItemInput = z.infer<typeof updateActionItemSchema>;
export type ListAgendasQuery = z.infer<typeof listAgendasQuerySchema>;
