import { z } from "zod";
import { MAX_PASTE_CHARACTERS } from "@/lib/roster/paste/parsePastedReport";

// The two request bodies of the roster paste import. No wardId, ever: it comes from the session.

const pasteTextSchema = z
  .string({ error: "Paste the ward list report first." })
  .min(1, "Paste the ward list report first.")
  .max(
    MAX_PASTE_CHARACTERS,
    "That paste is longer than a ward list report should be. Check that only the report was copied.",
  );

export const pastePreviewSchema = z
  .object({ text: pasteTextSchema })
  .strict();
export type PastePreviewInput = z.infer<typeof pastePreviewSchema>;

export const pasteApplySchema = z
  .object({
    text: pasteTextSchema,
    pasteHash: z
      .string({ error: "Review the paste before applying it." })
      .regex(/^[0-9a-f]{64}$/, "Review the paste before applying it."),
    selectedIds: z
      .array(z.string().max(500, "That checklist item is not valid."), {
        error: "The checklist selection is missing. Review the paste again.",
      })
      .max(5000, "That is more checklist items than a ward list can produce."),
  })
  .strict();
export type PasteApplyInput = z.infer<typeof pasteApplySchema>;
