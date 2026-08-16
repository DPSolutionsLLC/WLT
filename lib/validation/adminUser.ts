import { z } from "zod";
import { ROLES } from "@/types/domain";

// No wardId, ever — it comes from the session (conventions.md §Validation). No userId either:
// the target is the route parameter, not something the body may assert.
export const updateUserSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    orgId: z.uuid("Choose an organization from the list.").nullable().optional(),
    counselorPosition: z
      .union([z.literal(1), z.literal(2)])
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (changes) => Object.values(changes).some((value) => value !== undefined),
    { message: "Include at least one field to change." },
  );
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
