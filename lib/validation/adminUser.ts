import { z } from "zod";

// ADMIN → USERS NO LONGER SETS A CALLING (ITER-058 cr2). The role, organization and counselor
// position used to be fields here; they are gone, because a linked account's calling now follows
// the ward list through the Calling review, and the only hand edit left is the super admin's
// marked override (`/api/callings/override`). `.strict()` makes a body that still sends `role` a
// 400 rather than a silently ignored key — including `role: "super_admin"`, which this path was
// always meant to refuse.
//
// No wardId, ever — it comes from the session (conventions.md §Validation). No userId either:
// the target is the route parameter, not something the body may assert.
export const updateUserSchema = z
  .object({
    isActive: z.boolean("Say whether the account is active."),
  })
  .strict();
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
