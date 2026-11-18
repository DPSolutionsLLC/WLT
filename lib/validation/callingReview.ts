import { z } from "zod";
import { INVITABLE_ROLES, ORG_SCOPED_ROLE_SUFFIXES, type Role } from "@/types/domain";

// THE CALLING REVIEW AND THE SUPER ADMIN'S OVERRIDE (ITER-058 cr2). No wardId in either body: the
// ward comes from the session (conventions.md §Validation).

// Only the ticked IDS come from the browser. The rows are recomputed on the server
// (lib/callings/applyCallingReview.ts), so an id is a string to look up, never a description of
// what to write.
export const applyCallingReviewSchema = z
  .object({
    selectedIds: z
      .array(z.string().min(1).max(300))
      .min(1, "Tick at least one change to apply.")
      .max(500, "That is more changes than one ward can have. Reload the page and try again."),
  })
  .strict();
export type ApplyCallingReviewInput = z.infer<typeof applyCallingReviewSchema>;

// INVITABLE_ROLES and not ROLES: `super_admin` is an assignment in `unit_assignments`, never a
// calling (plan Task 9), and the youth and stake roles are not callings a ward overrides by hand.
const OVERRIDABLE_ROLES = INVITABLE_ROLES as unknown as [Role, ...Role[]];

export const setCallingOverrideSchema = z
  .object({
    userId: z.uuid("Choose an account from the list."),
    role: z.enum(OVERRIDABLE_ROLES, "Choose a calling."),
    orgId: z.uuid("Choose an organization from the list.").nullable(),
    counselorPosition: z.union([z.literal(1), z.literal(2)]).nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.role === "counselor" && input.counselorPosition === null) {
      context.addIssue({
        code: "custom",
        path: ["counselorPosition"],
        message: "Choose 1st or 2nd Counselor.",
      });
    }
    if (input.role !== "counselor" && input.counselorPosition !== null) {
      context.addIssue({
        code: "custom",
        path: ["counselorPosition"],
        message: "Only a bishopric counselor has a counselor number.",
      });
    }
    const needsOrganization = ORG_SCOPED_ROLE_SUFFIXES[input.role] !== null;
    if (needsOrganization && input.orgId === null) {
      context.addIssue({ code: "custom", path: ["orgId"], message: "Choose an organization." });
    }
    if (!needsOrganization && input.orgId !== null) {
      context.addIssue({
        code: "custom",
        path: ["orgId"],
        message: "That calling does not belong to an organization.",
      });
    }
  });
export type SetCallingOverrideInput = z.infer<typeof setCallingOverrideSchema>;

export const clearCallingOverrideSchema = z
  .object({ userId: z.uuid("Choose an account from the list.") })
  .strict();
export type ClearCallingOverrideInput = z.infer<typeof clearCallingOverrideSchema>;
