import type { SupabaseClient } from "@supabase/supabase-js";
import { InvalidInputError } from "@/lib/auth/errors";
import { findUsersOutsideWard } from "@/lib/callings/queries";
import type { Database } from "@/types/database";

// `action_items.assigned_user_id` is a SUBJECT written from a request body, and its foreign key is
// a plain `references users (id)` (migration 082) — so nothing in the database checks that the
// person belongs to this ward. This does, before either agenda route writes it, and answers 400
// with a sentence rather than creating a to-do in a ward its owner cannot act in (CLAUDE.md §7,
// "an author is not a subject").
//
// It asks about the CALLING, never `users.ward_id`, through findUsersOutsideWard(): a counselor
// whose account lives in another ward holds a real calling here and must stay assignable.
export async function assertAssigneeInWard(
  wardId: string,
  assignedUserId: string | null | undefined,
  client: SupabaseClient<Database>,
): Promise<void> {
  if (assignedUserId === undefined || assignedUserId === null) return;

  const outsiders = await findUsersOutsideWard(wardId, [assignedUserId], client);
  if (outsiders.length > 0) {
    throw new InvalidInputError("That person does not hold a calling in this ward.");
  }
}
