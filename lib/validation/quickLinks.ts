import { z } from "zod";
import { NAVIGATION_ITEMS } from "@/lib/auth/navigation";

// ---------------------------------------------------------------------------
// THIS VALIDATION SECURES NOTHING, AND SAYING SO IS THE POINT
// ---------------------------------------------------------------------------
// `users.settings` is directly writable by the person it belongs to (migration 077's grant), so
// anybody determined to put an arbitrary string in it can. The schema is here to keep the APP's
// own writes coherent — a pin that names a module which has since been renamed or removed would
// render as a tile pointing nowhere, which is the dead-link bug this whole phase closes.
//
// That is also why NOTHING may ever read authorization out of this column. Migration 077 says it
// in capitals: a user writes it, so anything security-relevant stored here would be self-granted.
//
// Validated against NAVIGATION_ITEMS rather than against a list of hrefs kept here. A second copy
// of the module list is how the two come to disagree (plans/retros/notification-trigger-drift.md),
// and this file would be the fifth reader of that list, not a new source of it.

const KNOWN_HREFS = NAVIGATION_ITEMS.map((item) => item.href) as [string, ...string[]];

// A pin PER MODULE, so the cap is the list's own length rather than an invented number, and the
// size CHECK on the column (4 KB) is far above anything this can produce.
export const quickLinksSchema = z.object({
  quickLinks: z
    .array(
      z.enum(
        KNOWN_HREFS,
        "That is not a module in this app. Pin one of the tiles on your dashboard.",
      ),
    )
    .max(NAVIGATION_ITEMS.length, "You cannot pin more modules than there are.")
    // ORDER IS MEANING HERE — the list is reorderable, so this is a sequence rather than a set —
    // but a DUPLICATE is not an order, it is a mistake, and it would render the same tile twice.
    .refine(
      (hrefs) => new Set(hrefs).size === hrefs.length,
      "That list pins the same module twice.",
    ),
});
export type QuickLinksInput = z.infer<typeof quickLinksSchema>;
