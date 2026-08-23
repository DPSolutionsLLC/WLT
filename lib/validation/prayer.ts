import { z } from "zod";
import { dateOnlySchema } from "@/lib/validation/calendar";
import { PRAYER_STAGES, PRAYER_TYPES } from "@/types/domain";

// No wardId on any schema here, ever — it comes from the session (conventions.md §Validation).

export const upsertPrayerSchema = z.object({
  sundayId: z.uuid("Choose a Sunday from the calendar."),
  prayerType: z.enum(PRAYER_TYPES),
  // Nullable so a slot can be CLEARED. A prayer with nobody assigned is a real state — it is
  // what every Sunday starts as — not a missing value.
  memberId: z.uuid("Choose someone from the roster.").nullable(),
});
export type UpsertPrayerInput = z.infer<typeof upsertPrayerSchema>;

// A discriminated union rather than one object with an optional `to`, copying
// updateAssignmentSchema: a field update that moves the stage as a side effect is the pitfall
// this whole phase is built to make unrepresentable rather than merely discouraged.
export const updatePrayerSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("assign"),
    memberId: z.uuid("Choose someone from the roster.").nullable(),
  }),
  z.object({
    action: z.literal("transition"),
    to: z.enum(PRAYER_STAGES),
    // Required by canTransitionPrayer() for a BACKWARD move only, which is a rule about the pair
    // of stages rather than about the request shape — so it is enforced there, not here.
    reason: z.string().trim().max(300).optional(),
  }),
]);
export type UpdatePrayerInput = z.infer<typeof updatePrayerSchema>;

// Exactly one filter, never both and never neither. A GET with no filter would read every prayer
// the ward has ever assigned.
//
// The union carries its own message: a union's default issue is the bare string "Invalid input",
// and respondToRouteError renders issues[0].message verbatim (talks-a).
export const listPrayersQuerySchema = z.union(
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
export type ListPrayersQuery = z.infer<typeof listPrayersQuerySchema>;
