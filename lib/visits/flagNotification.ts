import type { SupabaseClient } from "@supabase/supabase-js";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

export type NotifyWardCouncilFlagParams = {
  wardId: string;
  // Resolved by the caller and passed in, so this module needs no joins of its own — and so the
  // only strings it can put in a body are the three it was handed.
  orgName: string;
  familyName: string;
};

const VISIT_FLAG_TRIGGER_KEY = "visit_flagged_for_ward_council";

const AGENDA_OWNER_ROLE = "executive_secretary";

// Recipients are resolved EXPLICITLY and passed as recipientUserIds rather than left to the
// trigger's default_roles, for the reason notifyOrgLeadership()'s header gives: a notification
// that concerns one specific thing should reach the person who owns that thing. Here that is the
// executive secretary, who owns the ward council agenda (FEATURES.md §Module 9, 07-visits.md
// §Step 3). Migration 045 corrected the seeded default_roles to match, so Phase 11's settings
// screen does not show a contradiction.
//
// That role holds NO `visits.view` permission (lib/auth/permissions.ts). That is not a gap to
// patch — it is what makes the next rule structurally true rather than a rule to remember.
//
// ---------------------------------------------------------------------------
// THE BODY IS THE ONE-LINER AND NOTHING ELSE. NO NOTE TEXT MAY EVER BE ADDED.
// ---------------------------------------------------------------------------
// Not the shared notes, not a summary of them, and above all not the private note. A
// notification row is read by somebody who cannot open the visit, it is rendered in a bell menu
// with no permission check of its own, and Phase 11 may put it in a digest email. Any of those
// three carries note text out past every boundary this phase built (CLAUDE.md rule 5). The
// one-liner names WHICH visit to bring up; the discussion happens with the people who can
// already see it.
export function wardCouncilFlagBody(orgName: string, familyName: string): string {
  return `${orgName} — ${familyName} — requested for ward council discussion`;
}

// Never throws — the same contract as notifyOrgLeadership() and writeAuditLog(). The flag has
// already been written by the time this runs, and a notification failure must degrade the
// message rather than fail the edit the leader just made.
export async function notifyWardCouncilFlag(
  params: NotifyWardCouncilFlagParams,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const { wardId, orgName, familyName } = params;

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
        error: error.message,
      });
      return;
    }

    const recipientUserIds = (data ?? []).map((row) => row.id);

    // A ward with no executive secretary gets no notification rather than a fallback to the
    // bishopric. Widening the audience is a product decision, and quietly is the wrong way to
    // take it — the flag itself is still on the visit for whoever builds the agenda.
    if (recipientUserIds.length === 0) {
      console.warn("No active executive secretary to notify about a flagged visit", { wardId });
      return;
    }

    await emitNotification(
      {
        wardId,
        triggerKey: VISIT_FLAG_TRIGGER_KEY,
        title: "Visit flagged for ward council",
        body: wardCouncilFlagBody(orgName, familyName),
        recipientUserIds,
      },
      supabase,
    );
  } catch (error) {
    console.error("notifyWardCouncilFlag threw", { wardId, error });
  }
}
