import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSunday,
  referencesDecisionOf,
  setReferencesDecision,
  type Sunday,
} from "@/lib/calendar/queries";
import type { Database } from "@/types/database";

// ---------------------------------------------------------------------------
// ADDING OR REMOVING A REFERENCE RETURNS A FINALIZED SUNDAY TO OPEN
// ---------------------------------------------------------------------------
// "These references are ready" was said about a list that has just changed, so it is no longer
// true. unfinalizeTopicsIfNeeded()'s reasoning, applied to the list itself.
//
// A SKIP IS CLEARED BY AN ADD AND SURVIVES A REMOVE:
//
//   add     { clearSkip: true }   A reference contradicts "not giving references this round".
//   remove  { clearSkip: false }  Tidying leftovers off a skipped Sunday must not quietly undo
//                                 the skip.
//
// ⚠️ THE ADD RULE DEPARTS FROM THE PROTOTYPE, deliberately. There a skip stands after an add and
// the pill renders `Refs: skipped` over references that exist — two claims on one pill that
// cannot both be true.
//
// ---------------------------------------------------------------------------
// NEVER THROWS
// ---------------------------------------------------------------------------
// The same contract as unfinalizeTopicsIfNeeded(): the reference genuinely was added or removed,
// and failing that edit because a flag could not be cleared would be the tail wagging the dog. It
// logs with context and returns null, which a caller treats as "nothing to report".
export async function unfinalizeReferencesIfNeeded(
  wardId: string,
  sundayId: string,
  options: { clearSkip: boolean },
  client?: SupabaseClient<Database>,
): Promise<Sunday | null> {
  try {
    const sunday = await getSunday(wardId, sundayId, client);
    if (!sunday) return null;

    const decision = referencesDecisionOf(sunday);
    const shouldReopen =
      decision === "finalized" || (decision === "skipped" && options.clearSkip);

    if (!shouldReopen) return sunday;

    return await setReferencesDecision(wardId, sundayId, null, client);
  } catch (error) {
    console.error("Could not reopen a Sunday's references", { wardId, sundayId, error });
    return null;
  }
}
