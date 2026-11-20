import { z } from "zod";

// Email is required here, not optional. An invite with no email produces an account with no
// way to sign in, and creation is the only place to catch that — discovering it during
// redemption means the invite has already been claimed and the registrant is stuck.
//
// THE BODY NAMES A PERSON ON THE WARD LIST AND NO ROLE (ITER-058 cr4). The calling is derived on
// the server from that person's ward list callings, so there is nothing here a sender could set to
// `super_admin`. `.strict()` refuses a body that still carries `role`, rather than quietly dropping
// it, so an old client finds out.
export const createInviteSchema = z
  .object({
    email: z.email("Enter a valid email address."),
    memberId: z.uuid("Choose the person from the ward list."),
  })
  .strict();
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

// The registration body carries NO role and NO orgId. This omission is the security control,
// not an oversight — Zod strips unknown keys, so a body containing `role: "bishop"` arrives at
// redeemInvite() without it. Do not add them "for completeness".
export const registerSchema = z.object({
  firstName: z.string().min(1, "Enter your first name.").max(100),
  lastName: z.string().min(1, "Enter your last name.").max(100),
  password: z.string().min(12, "Use at least 12 characters."),
  // "Yes, this is me" (cr4). Optional because an invite made before cr4 names no person; an invite
  // that does is refused by redeemInvite() unless this is true. `false` is refused here.
  confirmedIdentity: z
    .literal(true, { error: "Tick \"Yes, this is me\" to continue." })
    .optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// The token travels in the request body because the page read it from the URL. It is extended
// onto registerSchema rather than declared alongside role/orgId so the comment above keeps
// holding: the only thing this adds is the credential itself.
export const registerRequestSchema = registerSchema.extend({
  token: z.string().min(1, "This invite link is not valid."),
});
export type RegisterRequestInput = z.infer<typeof registerRequestSchema>;

// "No, this isn't me" (decided walking scenario 105). The token is the whole authorization, exactly
// as for registering; nothing else is accepted.
export const declineInviteSchema = z
  .object({ token: z.string().min(1, "This invite link is not valid.") })
  .strict();
export type DeclineInviteInput = z.infer<typeof declineInviteSchema>;

// Asking for a person's waiting link on Admin → Users.
export const waitingInviteQuerySchema = z.object({
  memberId: z.uuid("Choose the person from the ward list."),
});

// Confirmation lives on the form only — the server has nothing to compare it against. Same
// split as resetPasswordSchema in lib/validation/auth.ts.
export const registerFormSchema = registerSchema
  .extend({ confirmPassword: z.string().min(1, "Re-enter the password.") })
  .refine((values) => values.password === values.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  });
export type RegisterFormInput = z.infer<typeof registerFormSchema>;
