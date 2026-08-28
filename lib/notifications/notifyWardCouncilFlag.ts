import type { SupabaseClient } from "@supabase/supabase-js";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

// "Somebody has asked for this to go on the ward council agenda."
//
// ---------------------------------------------------------------------------
// SHARED RATHER THAN COPIED, ON notifyOrgLeadership's PRECEDENT
// ---------------------------------------------------------------------------
// This was lib/visits/flagNotification.ts alone until youth-d. Phase 8 flags a youth activity
// follow-up for exactly the same person for exactly the same reason, and notifyOrgLeadership's
// header already argued the case for taking a `triggerKey` parameter rather than spawning a
// second copy: "a second module-specific copy of 'who is this organization's leadership' would be
// a second answer to drift from the first, and the opt-out lookup inside emitNotification is
// keyed on the trigger, so a hardcoded key would have delivered a youth activity to somebody who
// had switched rotation notices off."
//
// The same sentence with "the ward council agenda" substituted is this file.
//
// Each module keeps its OWN VOCABULARY: lib/visits/flagNotification.ts still owns
// wardCouncilFlagBody(orgName, familyName) and its trigger key, lib/youth/flagNotification.ts
// owns its own pair, and neither string appears here. This module puts NO string of its own into
// a body — the caller composes it.
//
// ---------------------------------------------------------------------------
// WHO RECEIVES IT, AND WHY IT IS RESOLVED HERE RATHER THAN LEFT TO default_roles
// ---------------------------------------------------------------------------
// The executive secretary, who owns the ward council agenda (FEATURES.md §Module 9, 07-visits.md
// §Step 3). Migrations 045 and 057d seed the trigger's default_roles to match, so Phase 11's
// settings screen does not show a contradiction — but the address list is this query, and the
// seeded roles are the OPT-OUT surface.
//
// That role holds NO `visits.view` and NO `youth_activities.view` permission
// (lib/auth/permissions.ts). That is not a gap to patch — it is what makes the next rule
// structurally true rather than a rule to remember.
//
// ---------------------------------------------------------------------------
// THE BODY IS A ONE-LINER AND NOTHING ELSE. NO NOTE TEXT MAY EVER BE ADDED.
// ---------------------------------------------------------------------------
// Not the shared notes, not a summary of them, and above all not the private note. A notification
// row is read by somebody who cannot open the record, it renders in a bell menu with no
// permission check of its own, and Phase 11 may put it in a digest email. Any of those three
// carries note text out past every boundary Phases 7 and 8 built (CLAUDE.md rule 5). The
// one-liner names WHICH record to bring up; the discussion happens with the people who can
// already see it.
//
// This is the most important comment in the file, and it applies to every caller — which is
// precisely why it lives here now rather than in one module's copy.

export type NotifyWardCouncilFlagParams = {
  wardId: string;
  // WHICH notification this is. Required rather than defaulted: the two callers are two different
  // keys with two different opt-out rows, and a default would let a third caller inherit somebody
  // else's silently.
  triggerKey: string;
  title: string;
  // Composed by the CALLER, from labels the caller resolved. This module puts no string of its
  // own into a body, which is what keeps the rule above checkable by reading one function.
  body: string;
};

const AGENDA_OWNER_ROLE = "executive_secretary";

// Never throws — the same contract as notifyOrgLeadership() and writeAuditLog(). The flag has
// already been written by the time this runs, and a notification failure must degrade the message
// rather than fail the edit the leader just made.
export async function notifyWardCouncilFlag(
  params: NotifyWardCouncilFlagParams,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const { wardId, triggerKey, title, body } = params;

  try {
    const supabase = client ?? createServiceSupabaseClient();

    const { data, error } = await supabase
      .from("users")
      .select("id")
      .eq("ward_id", wardId)
      .eq("is_active", true)
      .eq("role", AGENDA_OWNER_ROLE);

    if (error) {
      console.error("Could not resolve the executive secretary", {
        wardId,
        triggerKey,
        error: error.message,
      });
      return;
    }

    const recipientUserIds = (data ?? []).map((row) => row.id);

    // A ward with no executive secretary gets no notification rather than a fallback to the
    // bishopric. Widening the audience is a product decision, and quietly is the wrong way to
    // take it — the flag itself is still on the record for whoever builds the agenda.
    if (recipientUserIds.length === 0) {
      console.warn("No active executive secretary to notify about a flagged record", {
        wardId,
        triggerKey,
      });
      return;
    }

    await emitNotification({ wardId, triggerKey, title, body, recipientUserIds }, supabase);
  } catch (error) {
    console.error("notifyWardCouncilFlag threw", { wardId, triggerKey, error });
  }
}
