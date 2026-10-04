import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

// WHO IS THIS WARD'S MUSIC COORDINATOR? — ITER-038 (plan assumption A1).
//
// Every ACTIVE `music_coordinator` calling in the ward, joined to an ACTIVE account — the question
// emitNotification's resolveRoleRecipients() asks, for its reason: a calling can stay active on a
// deactivated account, and a deactivated person must not be handed work. Distinct people.
//
// Service role: a coordinator's calling is read on behalf of whoever is acting (a bishop sending the
// music back, a conductor finalizing topics), and only ids leave this function. The caller has
// already passed the route's permission check for this ward.
//
// Several is ordinary — each gets the to-do, and one submitting completes them all. NONE is a real
// state, reported by the caller in words rather than treated as an error.
export async function listMusicCoordinatorIds(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<string[]> {
  const supabase = client ?? createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("ward_role_assignments")
    .select("user_id, users!user_id!inner(is_active)")
    .eq("ward_id", wardId)
    .eq("is_active", true)
    .eq("users.is_active", true)
    .eq("role", "music_coordinator");

  if (error) {
    console.error(`Could not read the ward's music coordinators — ${error.message}`, { wardId });
    throw new Error(`Could not find the music coordinator: ${error.message}`);
  }

  return [...new Set((data ?? []).map((row) => row.user_id))];
}
