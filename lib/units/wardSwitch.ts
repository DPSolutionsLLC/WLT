import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isPolicyRefusal } from "@/lib/youth/policyRefusal";
import type { Database } from "@/types/database";

// THE WARD SWITCH. Writes `users.active_ward_id` for the CALLER and nobody else.
//
// ---------------------------------------------------------------------------
// RLS IS THE ONLY BOUNDARY HERE (CLAUDE.md rule 2)
// ---------------------------------------------------------------------------
// `users_update_self`'s WITH CHECK arm (migration 066d) is what decides whether the switch is
// allowed, and there is deliberately no permission to check first — see the header of
// app/api/session/active-ward/route.ts for why a `units.*` permission must never exist. This
// module's whole job is to attempt the write and turn a refusal into something a caller can say
// out loud.
//
// ---------------------------------------------------------------------------
// THE REFUSAL IS LOUD, NOT QUIET, AND THAT IS UNUSUAL IN THIS CODEBASE
// ---------------------------------------------------------------------------
// A row the USING clause excludes is simply not seen: the UPDATE matches nothing and returns a
// zero-row SUCCESS, which is what every other write path here was built for. A row that passes
// USING and then fails WITH CHECK is different — PostgreSQL RAISES, SQLSTATE 42501. That is
// exactly the divergent shape defect 060-D2 was, and here it is not an edge case: `using` is
// `id = auth.uid()`, so EVERY unauthorized switch takes the loud path.
//
// Without the mapping below, an unauthorized switch surfaces as a 500 reading "Please try again",
// which is untrue — the answer is "not yours", and it will never become true by trying again.
//
// NARROW ON PURPOSE: 42501 only, reusing lib/youth/policyRefusal.ts rather than re-deriving the
// predicate. "The policy said no" and "the database is broken" must never become one message
// (CLAUDE.md rule 7).

export type WardSwitchResult = {
  activeWardId: string | null;
  // The ward the session is acting in AFTER the write, read back from current_ward_id() rather
  // than assumed to equal activeWardId. They can differ: current_ward_id() re-validates on every
  // read (migration 066b), so a switch authorized at write time and revoked a moment later falls
  // back to the home ward and the caller must be told the truth about where they are.
  wardId: string;
  homeWardId: string;
};

async function readResultingContext(
  supabase: SupabaseClient<Database>,
): Promise<WardSwitchResult> {
  const { data, error } = await supabase.rpc("session_context");

  if (error) {
    console.error(`Could not read the session context after a ward switch — ${error.message}`);
    throw new Error(`Could not confirm which ward you are now in: ${error.message}`);
  }

  const context = data?.[0];
  if (!context) {
    throw new Error("Could not confirm which ward you are now in: no session context returned.");
  }

  // `?? null` is not redundant: `supabase gen types` declares every column of a RETURNS TABLE
  // function as non-nullable, because Postgres records no nullability for that signature.
  // active_ward_id is genuinely null for anybody who has not switched — and after clearActiveWard
  // it is null every time.
  return {
    activeWardId: context.active_ward_id ?? null,
    wardId: context.ward_id,
    homeWardId: context.home_ward_id,
  };
}

// Returns null when the policy refused. The route turns that into a 403 with a sentence.
export async function switchActiveWard(
  activeWardId: string,
  client?: SupabaseClient<Database>,
): Promise<WardSwitchResult | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Could not switch wards: there is no signed-in user.");
  }

  const { error } = await supabase
    .from("users")
    .update({ active_ward_id: activeWardId })
    .eq("id", user.id);

  if (isPolicyRefusal(error)) return null;

  if (error) {
    console.error(`Could not switch the active ward — ${error.message}`, {
      userId: user.id,
      activeWardId,
    });
    throw new Error(`Could not switch wards: ${error.message}`);
  }

  return readResultingContext(supabase);
}

// CLEARING CAN NEVER NEED AUTHORIZATION, and the policy admits a null unconditionally for that
// reason (migration 066d) — an officer who has just been released must still be able to get back
// to their own ward. It therefore returns a result rather than `null`, and a 42501 from here
// would be a genuine fault rather than a refusal, so it is deliberately NOT mapped.
export async function clearActiveWard(
  client?: SupabaseClient<Database>,
): Promise<WardSwitchResult> {
  const supabase = client ?? (await createServerSupabaseClient());

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Could not return to your ward: there is no signed-in user.");
  }

  const { error } = await supabase
    .from("users")
    .update({ active_ward_id: null })
    .eq("id", user.id);

  if (error) {
    console.error(`Could not clear the active ward — ${error.message}`, { userId: user.id });
    throw new Error(`Could not return to your ward: ${error.message}`);
  }

  return readResultingContext(supabase);
}
