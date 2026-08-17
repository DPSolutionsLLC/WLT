import { z } from "zod";

// Every message below is a fixed string, and that is a security rule rather than a style
// choice. Zod's default message for a failing string can echo the input, and a validation
// error is the easiest way for a PIN to reach a log line (CLAUDE.md rule 8). Nothing in this
// file interpolates the value it rejected.

// Six digits exactly, not the 4-6 the plan and FEATURES.md originally specified. Supabase Auth
// is asymmetric about password length: admin.createUser accepts anything, but
// admin.updateUserById enforces the project's six-character minimum. A shorter PIN could
// therefore be created and never reset — and a reset is the bishopric's only way to unblock a
// locked-out youth, so that path cannot be allowed to be unreachable. Six digits is also the
// default iPhone passcode length, and it takes the guess space from 10,000 to 1,000,000.
export const PIN_LENGTH = 6;

// Listed rather than derived because "predictable" is a human judgement, not a pattern. The
// all-same-digit case is the one genuine pattern and is handled by the refinement below, which
// covers 000000 through 999999 without enumerating them.
const TRIVIAL_PINS = new Set(["123456", "654321", "123123", "121212", "112233"]);

const PIN_FORMAT_MESSAGE = "Use 6 digits, numbers only.";
const PIN_PREDICTABLE_MESSAGE = "Choose a less predictable PIN.";

// \d without the `u` flag is ASCII 0-9 only, so non-ASCII digits such as "१२३४५६" are refused.
export const pinSchema = z
  .string({ error: PIN_FORMAT_MESSAGE })
  .regex(/^\d{6}$/, PIN_FORMAT_MESSAGE)
  .refine((pin) => !TRIVIAL_PINS.has(pin), PIN_PREDICTABLE_MESSAGE)
  .refine((pin) => new Set(pin).size > 1, PIN_PREDICTABLE_MESSAGE);

// Lower-cased here so it matches users_username_key, the case-insensitive unique index from
// migration 002, and so the synthetic email address is stable for one account.
export const usernameSchema = z
  .string({ error: "Enter a username." })
  .min(3, "Use at least 3 characters.")
  .max(30, "Use 30 characters or fewer.")
  .regex(
    /^[a-z0-9._-]+$/i,
    "Use letters, numbers, dots, dashes, or underscores.",
  )
  .transform((value) => value.toLowerCase());

// No `role` field. These accounts are always sacrament_manager and the server sets it — the
// same control as the invite flow in auth-b, where the omission is what makes escalation
// impossible rather than merely unlikely.
//
// No `memberId` field either, which is a deliberate departure from the plan's sketch.
// `public.users` has no member column; the link between a youth account and a member row lives
// in `sacrament_assignment_managers`, which Phase 10 owns (plans/10-sacrament-admin.md). A
// field the server would accept and then discard is exactly the silent drop CLAUDE.md rule 9
// exists to prevent, so it is left out until there is somewhere to put it.
export const createYouthAccountSchema = z.object({
  username: usernameSchema,
  pin: pinSchema,
  firstName: z.string().min(1, "Enter a first name.").max(100),
  lastName: z.string().min(1, "Enter a last name.").max(100),
});
export type CreateYouthAccountInput = z.infer<typeof createYouthAccountSchema>;

export const resetPinSchema = z.object({ pin: pinSchema });
export type ResetPinInput = z.infer<typeof resetPinSchema>;

// The login schema deliberately does NOT apply the PIN format rules. Two reasons: an account
// whose PIN predates a rule change must still be able to sign in, and a format rejection at
// login is an oracle telling an attacker which shapes are worth guessing.
export const pinLoginSchema = z.object({
  username: usernameSchema,
  pin: z.string({ error: "Enter your PIN." }).min(1, "Enter your PIN."),
});
export type PinLoginInput = z.infer<typeof pinLoginSchema>;

// Confirmation lives on the form only — the server has nothing to compare it against. Same
// split as registerFormSchema in lib/validation/invite.ts.
export const createYouthAccountFormSchema = createYouthAccountSchema
  .extend({ confirmPin: z.string().min(1, "Re-enter the PIN.") })
  .refine((values) => values.pin === values.confirmPin, {
    message: "The two PINs do not match.",
    path: ["confirmPin"],
  });
export type CreateYouthAccountFormInput = z.infer<
  typeof createYouthAccountFormSchema
>;

export const resetPinFormSchema = resetPinSchema
  .extend({ confirmPin: z.string().min(1, "Re-enter the PIN.") })
  .refine((values) => values.pin === values.confirmPin, {
    message: "The two PINs do not match.",
    path: ["confirmPin"],
  });
export type ResetPinFormInput = z.infer<typeof resetPinFormSchema>;
