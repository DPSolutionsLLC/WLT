import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCallingReview } from "@/lib/callings/applyCallingReview";
import { loadCallingReview } from "@/lib/callings/loadCallingReview";
import type { RosterDiff } from "@/lib/roster/paste/buildRosterDiff";
import {
  NO_CALLING_OUTCOME,
  toPasteCallingReview,
  type PasteCallingOutcome,
  type PasteCallingReview,
} from "@/lib/roster/paste/callingRows";
import type { Database } from "@/types/database";
import type { SessionUser } from "@/types/domain";

// THE TWO SERVER HALVES OF CALLINGS ON A ROSTER PASTE (ITER-058 cr3).
//
// THE SERVICE-ROLE CLIENT, AFTER THE ROUTE'S GATE. Both functions read links and callings that the
// importer's own client may not see, exactly as Admin → Users does. The routes decide `canReview`
// with canManageMemberLinks(), and the apply route refuses calling ids from anybody who fails it.
//
// THE PASTE LANDS FIRST AND STAYS. applyPasteCallings() runs after apply_roster_paste has committed
// and recomputes from the roster it just stored. If it fails the paste is not undone: the same
// changes are still waiting on Admin → Users, because that review computes from the same roster.

export async function loadPasteCallingReview(
  params: { diff: RosterDiff; actor: SessionUser; canReview: boolean },
  service: SupabaseClient<Database>,
): Promise<PasteCallingReview> {
  const { diff, actor, canReview } = params;
  const { rows } = await loadCallingReview(actor.wardId, service, diff.pastedRoster);

  return toPasteCallingReview({
    rows,
    movedOutMemberIds: new Set(diff.movedOut.map((item) => item.memberId)),
    actor,
    canReview,
  });
}

export async function applyPasteCallings(
  params: { actor: SessionUser; selectedIds: readonly string[] },
  service: SupabaseClient<Database>,
): Promise<PasteCallingOutcome> {
  const { actor, selectedIds } = params;
  if (selectedIds.length === 0) return NO_CALLING_OUTCOME;

  try {
    const result = await applyCallingReview({ actor, wardId: actor.wardId, selectedIds }, service);
    return {
      callingsApplied: result.applied.length,
      callingsRefused: result.refused,
      callingsStale: result.stale,
      callingsFailed: false,
    };
  } catch (error) {
    console.error(
      `Could not apply the calling changes from a roster paste — ${
        error instanceof Error ? error.message : String(error)
      }`,
      { wardId: actor.wardId, selectedCount: selectedIds.length },
    );
    return { ...NO_CALLING_OUTCOME, callingsFailed: true };
  }
}
