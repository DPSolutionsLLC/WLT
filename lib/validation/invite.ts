import { z } from "zod";
import { ROLES } from "@/types/domain";

// Email is required here, not optional. An invite with no email produces an account with no
// way to sign in, and creation is the only place to catch that — discovering it during
// redemption means the invite has already been claimed and the registrant is stuck.
export const createInviteSchema = z.object({
  email: z.email("Enter a valid email address."),
  role: z.enum(ROLES),
  orgId: z.uuid("Choose an organization from the list.").nullable().optional(),
  counselorPosition: z
    .union([z.literal(1), z.literal(2)])
    .nullable()
    .optional(),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

// The registration body carries NO role and NO orgId. This omission is the security control,
// not an oversight — Zod strips unknown keys, so a body containing `role: "bishop"` arrives at
// redeemInvite() without it. Do not add them "for completeness".
export const registerSchema = z.object({
  firstName: z.string().min(1, "Enter your first name.").max(100),
  lastName: z.string().min(1, "Enter your last name.").max(100),
  password: z.string().min(12, "Use at least 12 characters."),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// The token travels in the request body because the page read it from the URL. It is extended
// onto registerSchema rather than declared alongside role/orgId so the comment above keeps
// holding: the only thing this adds is the credential itself.
export const registerRequestSchema = registerSchema.extend({
  token: z.string().min(1, "This invite link is not valid."),
});
export type RegisterRequestInput = z.infer<typeof registerRequestSchema>;

// Confirmation lives on the form only — the server has nothing to compare it against. Same
// split as resetPasswordSchema in lib/validation/auth.ts.
export const registerFormSchema = registerSchema
  .extend({ confirmPassword: z.string().min(1, "Re-enter the password.") })
  .refine((values) => values.password === values.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  });
export type RegisterFormInput = z.infer<typeof registerFormSchema>;
