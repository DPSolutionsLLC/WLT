import { z } from "zod";
import { appointmentsViewSchema } from "@/lib/appointments/appointmentsView";

// Which pages remember how they were left, and the shape each one stores. A page joins by adding
// one entry here; the route and lib/users/userSettings.ts need no change.
//
// Like lib/validation/quickLinks.ts, this SECURES NOTHING: `users.settings` is directly writable by
// its owner (migration 077). It keeps the app's own writes coherent and bounded, which is what the
// column's 4 KB ceiling needs.

export const pageViewSchema = z.discriminatedUnion("page", [
  z.object({ page: z.literal("appointments"), view: appointmentsViewSchema }),
]);

export type PageViewInput = z.infer<typeof pageViewSchema>;
