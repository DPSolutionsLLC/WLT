import { z } from "zod";
import { isValidDateOnly } from "@/lib/calendar/dates";
import { ASSIGNMENT_TYPES, ROTATION_CADENCES, SUNDAY_TYPES } from "@/types/domain";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).
// A schema that accepts a wardId is a schema someone will eventually trust.

// The regex checks the SHAPE; the refine checks the date exists. Both are needed: "2026-02-31"
// matches the pattern perfectly and Postgres answers it with `date/time field value out of
// range`, which surfaces as a 500 on a request that was simply wrong. A bad date is the caller's
// mistake and must come back as a 400 (conventions.md §Error Handling).
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine(isValidDateOnly, "That date does not exist.");

// slot_config's shape is validated on WRITE because nothing validates it on read: it is a jsonb
// blob, and Phase 6's program builder reads it directly. A malformed entry stored today breaks a
// program PDF months from now, a long way from the boundary that accepted it — the neighbouring
// failure mode to the silent-drop CLAUDE.md rule 9 exists to prevent.

// 15, not the 3 a normal Sunday has. Speaking slots are set PER SUNDAY by the bishopric — a
// testimony-style meeting or a missionary farewell with the whole family speaking is a real
// Sunday, and the schema should not be the thing that says no. 15 is a sanity bound, not a
// product opinion; the database itself only requires speaking_slots >= 0.
export const MAX_SPEAKING_SLOTS = 15;

export const slotConfigEntrySchema = z.object({
  slotNumber: z.number().int().min(1).max(MAX_SPEAKING_SLOTS),
  lengthMinutes: z.number().int().min(1).max(60),
  type: z.enum(ASSIGNMENT_TYPES),
});
export type SlotConfigEntryInput = z.infer<typeof slotConfigEntrySchema>;

export const slotConfigSchema = z
  .array(slotConfigEntrySchema)
  .max(MAX_SPEAKING_SLOTS, `A meeting has at most ${MAX_SPEAKING_SLOTS} speaking slots.`)
  .superRefine((entries, context) => {
    const seen = new Set<number>();

    for (const [index, entry] of entries.entries()) {
      if (seen.has(entry.slotNumber)) {
        context.addIssue({
          code: "custom",
          path: [index, "slotNumber"],
          message: `Slot ${entry.slotNumber} is listed twice.`,
        });
      }
      seen.add(entry.slotNumber);
    }
  });

export const updateSundaySchema = z.object({
  type: z.enum(SUNDAY_TYPES).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  conductingUserId: z
    .uuid("Choose a bishopric member from the list.")
    .nullable()
    .optional(),
  speakingSlots: z.number().int().min(0).max(MAX_SPEAKING_SLOTS).optional(),
  slotConfig: slotConfigSchema.nullable().optional(),
  presidingOverride: z.string().trim().max(120).nullable().optional(),
  fastSundayPinned: z.boolean().optional(),
});
export type UpdateSundayInput = z.infer<typeof updateSundaySchema>;

export const createSundaySchema = z.object({
  mode: z.literal("single"),
  date: dateOnlySchema,
  type: z.enum(SUNDAY_TYPES).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
export type CreateSundayInput = z.infer<typeof createSundaySchema>;

// The 24-month cap is a denial-of-service guard, not a business rule: a range of a thousand years
// is ~52,000 rows in one upsert and one resolution call per month. The product horizon is twelve
// months (03-calendar.md), so anything past two years is a typo or an attack.
export const generateSundaysSchema = z
  .object({
    mode: z.literal("generate"),
    from: dateOnlySchema,
    to: dateOnlySchema,
  })
  .refine(({ from, to }) => to >= from, {
    message: "The end date must not be before the start date.",
    path: ["to"],
  })
  .refine(
    ({ from, to }) => {
      const months =
        (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
        (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
      return months <= 24;
    },
    {
      message: "Generate 24 months or fewer at a time.",
      path: ["to"],
    },
  );
export type GenerateSundaysInput = z.infer<typeof generateSundaysSchema>;

export const sundayPostSchema = z.discriminatedUnion("mode", [
  createSundaySchema,
  generateSundaysSchema,
]);
export type SundayPostInput = z.infer<typeof sundayPostSchema>;

export const sundayRangeSchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
  })
  .refine(({ from, to }) => to >= from, {
    message: "The end date must not be before the start date.",
    path: ["to"],
  });
export type SundayRangeInput = z.infer<typeof sundayRangeSchema>;

export const conductingRotationSchema = z.object({
  effectiveFrom: dateOnlySchema,
  // Null is the bishopric's sacrament-meeting rotation (migration 024, Part 2). Required rather
  // than optional so the route's two permission gates are chosen by something the caller stated
  // rather than by something that defaulted.
  orgId: z.uuid("Choose an organization.").nullable(),
  cadence: z.enum(ROTATION_CADENCES),
  positions: z
    .array(
      z.object({
        position: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        userId: z.uuid("Choose someone from the list.").nullable(),
      }),
    )
    .length(3, "A rotation has exactly three positions."),
});
export type ConductingRotationInput = z.infer<typeof conductingRotationSchema>;

// One organization per request. There is no bulk form of this: a save over six organizations
// makes a partial failure impossible to report honestly.
export const sundayOrgConductingSchema = z.object({
  orgId: z.uuid("Choose an organization."),
  userId: z.uuid("Choose someone from the list.").nullable(),
});
export type SundayOrgConductingInput = z.infer<typeof sundayOrgConductingSchema>;

// The ward's default speaker count, edited in the app rather than in code. min(1) rather than
// min(0): a Sunday can legitimately have zero speakers, but a ward whose DEFAULT is zero would
// generate a year of empty meetings, which is always a mistake.
export const wardCalendarSettingsSchema = z.object({
  defaultSpeakingSlots: z
    .number()
    .int("Enter a whole number of speakers.")
    .min(1, "A Sunday needs at least one speaker by default.")
    .max(MAX_SPEAKING_SLOTS, `Choose ${MAX_SPEAKING_SLOTS} speakers or fewer.`),
});
export type WardCalendarSettingsInput = z.infer<typeof wardCalendarSettingsSchema>;
