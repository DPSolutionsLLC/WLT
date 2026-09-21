import { z } from "zod";

// No userId — the target is the SESSION, never something the body may assert
// (conventions.md §Validation). No wardId either beyond the one being switched TO.
//
// `null` clears the switch and returns the caller to their own ward, which is ALWAYS permitted:
// an officer who has just been released must still be able to get home, and
// `users_update_self`'s WITH CHECK (migration 066d) admits a null unconditionally for that
// reason.
export const wardSwitchSchema = z.object({
  activeWardId: z.uuid("Choose a ward from the list.").nullable(),
});
export type WardSwitchInput = z.infer<typeof wardSwitchSchema>;
