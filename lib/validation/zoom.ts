import { z } from "zod";
import { normalizePhone } from "@/lib/assignments/smsLink";
import { MAX_JOIN_LINK_PASTE_CHARACTERS } from "@/lib/zoom/joinLinkPaste";
import { REMOTE_LINK_POSITIONS } from "@/types/domain";

const NOT_A_LINK = "Paste the full link, starting with https://.";

export const remoteLinkPositionSchema = z.enum(REMOTE_LINK_POSITIONS, {
  error: "That is not one of the five remote-link positions.",
});

// The prefix check is not redundant: z.url() accepts "https:/x", which migration 094's CHECK
// (`url ~ '^https://'`) refuses with a 500 rather than a sentence.
export const setRemoteLinkSchema = z.object({
  url: z
    .string({ error: NOT_A_LINK })
    .trim()
    .min(1, NOT_A_LINK)
    .max(2000, "That link is too long. Links can be at most 2000 characters.")
    .pipe(z.url({ protocol: /^https$/, error: NOT_A_LINK }))
    .refine((value) => /^https:\/\/[^\s/?#]+/.test(value), NOT_A_LINK),
});

export type SetRemoteLinkInput = z.infer<typeof setRemoteLinkSchema>;

// ITER-053. The server always re-parses `text` itself (lib/zoom/joinLinkPaste.ts); `apply: false`
// is the preview and writes nothing.
export const joinLinkPasteSchema = z.object({
  text: z
    .string({ error: "Paste the links into the box." })
    .max(MAX_JOIN_LINK_PASTE_CHARACTERS, "That paste is too long. Add the links in smaller batches."),
  apply: z.boolean({ error: "Say whether to add the links or only preview them." }),
});

export const joinLinkIdSchema = z.uuid("That link is not one this page knows about.");

// THE INVITEE HAND-OUT AND EDIT (ITER-053, z2b). An empty optional field becomes NULL, never "" —
// an empty string passes every presence check and reads as a value somebody gave.

const PHONE_TOO_SHORT = "That phone number looks too short.";

function emptyToNull(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

const inviteeDisplayName = z
  .string({ error: "Enter their name." })
  .trim()
  .min(1, "Enter their name.")
  .max(120, "That name is too long. Names can be at most 120 characters.");

const inviteePhone = z.preprocess(
  emptyToNull,
  z
    .string()
    .max(40, "That phone number is too long.")
    .refine((value) => normalizePhone(value) !== null, PHONE_TOO_SHORT)
    .nullable(),
);

const inviteeEmail = z.preprocess(
  (value) => {
    const cleaned = emptyToNull(value);
    return typeof cleaned === "string" ? cleaned.toLowerCase() : cleaned;
  },
  z
    .email("That email address doesn't look right.")
    .max(254, "That email address is too long.")
    .nullable(),
);

const inviteeNotes = z.preprocess(
  emptyToNull,
  z.string().max(1000, "Notes can be at most 1000 characters.").nullable(),
);

const inviteeMemberId = z.uuid("Pick the person again — that roster record isn't available.").nullable();

export const createInviteeSchema = z.object({
  memberId: inviteeMemberId,
  displayName: inviteeDisplayName,
  phone: inviteePhone,
  email: inviteeEmail,
  notes: inviteeNotes,
});

export type CreateInviteeInput = z.infer<typeof createInviteeSchema>;

export const updateInviteeSchema = z
  .object({
    memberId: inviteeMemberId.optional(),
    displayName: inviteeDisplayName.optional(),
    phone: inviteePhone.optional(),
    email: inviteeEmail.optional(),
    notes: inviteeNotes.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: "Change at least one thing before saving.",
  });

export type UpdateInviteeInput = z.infer<typeof updateInviteeSchema>;

export const inviteeIdSchema = z.uuid("That person is not one this page knows about.");
