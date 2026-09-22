import { z } from "zod";
import { UNIT_TYPES } from "@/types/domain";

// Zod at the boundary, reused by the form (CLAUDE.md §6). Shape only — whether the caller is a
// super admin is a question for the route, and whether the unit number is already taken is a
// question only the database's partial unique index can answer.

const unitName = z
  .string()
  .trim()
  .min(1, "Give the unit a name.")
  .max(120, "That name is too long — keep it under 120 characters.");

// EMPTY IS ALLOWED AND MEANS "NOT KNOWN YET". The real church-assigned number is often not to
// hand when somebody sets the structure up, and migration 065a made the column nullable and its
// unique index partial for exactly that reason. `lib/units/writeUnit.ts` turns "" into null so
// two unknown numbers never collide.
//
// It is NOT validated against a digit pattern. It is a real number issued by the Church, this
// app does not know its format, and guessing one would refuse a number that is genuinely correct
// — the same refusal to invent a restriction nobody specified that decisions.md §1.12 records.
const unitNumber = z
  .string()
  .trim()
  .max(20, "A unit number is shorter than that — check the number.")
  .nullish();

// `area` is accepted because the data shape anticipates it (migration 065a), and refused by no
// screen because BUILD NO AREA OR DISTRICT SCREENS (CLAUDE.md §7). The schema is the shape; the
// screen is what decides what to offer.
export const createUnitSchema = z.object({
  type: z.enum(UNIT_TYPES, "Choose a unit type."),
  name: unitName,
  parentId: z.uuid("Choose a parent unit from the list.").nullish(),
  unitNumber,
});
export type CreateUnitInput = z.infer<typeof createUnitSchema>;

// Every field optional — a rename and a number correction are separate acts on the same screen,
// and PATCHing one must not blank the other. `.partial()` is not used because `parentId` and
// `unitNumber` are nullish already and the distinction between "absent" and "explicitly null"
// carries meaning here: absent leaves it alone, null clears it.
//
// `type` is deliberately NOT updatable. Turning a stake into a ward would leave every wards row
// pointing at it and every policy reading it answering a different question; that is a migration,
// not an edit.
export const updateUnitSchema = z
  .object({
    name: unitName.optional(),
    parentId: z.uuid("Choose a parent unit from the list.").nullish(),
    unitNumber,
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Nothing to change — edit a field first.",
  );
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

// Nesting a ward under a unit, or detaching it. Null detaches, which stays legal because
// `wards.unit_id` is nullable and every ward created before this screen has none.
export const setWardUnitSchema = z.object({
  wardId: z.uuid("Choose a ward from the list."),
  unitId: z.uuid("Choose a unit from the list.").nullable(),
});
export type SetWardUnitInput = z.infer<typeof setWardUnitSchema>;
