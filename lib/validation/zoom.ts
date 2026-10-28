import { z } from "zod";
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
