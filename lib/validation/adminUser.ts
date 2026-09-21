import { z } from "zod";
import { ROLES, type Role } from "@/types/domain";

// `super_admin` IS NOT REACHABLE THROUGH THE ORDINARY ROLE-CHANGE PATH, AND THAT IS THE POINT.
// It bypasses the access matrix entirely (CLAUDE.md §7), so it must not be a value in a ward's
// role dropdown — a ward has no standing to create an app-wide administrator, and the authority
// it carries does not come from a ward at all. INVITABLE_ROLES excludes it for the same reason.
//
// THE FRICTION UI IS proto-d's. What this slice guarantees is that the ORDINARY path cannot reach
// it: the schema refuses the value, so a hand-rolled PATCH is a 400 rather than a promotion.
// lib/auth/adminUsers.ts guards the LAST one from being removed.
const ASSIGNABLE_ROLES = ROLES.filter((role) => role !== "super_admin") as [Role, ...Role[]];

// No wardId, ever — it comes from the session (conventions.md §Validation). No userId either:
// the target is the route parameter, not something the body may assert.
export const updateUserSchema = z
  .object({
    role: z.enum(ASSIGNABLE_ROLES).optional(),
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
