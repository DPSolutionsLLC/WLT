import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyWardCouncilFlag as notifyShared } from "@/lib/notifications/notifyWardCouncilFlag";
import type { Database } from "@/types/database";

// The VISITS vocabulary for a ward-council flag: which trigger key, what the title says, and how
// the one-liner reads.
//
// ---------------------------------------------------------------------------
// THE RECIPIENT RESOLUTION MOVED TO lib/notifications/notifyWardCouncilFlag.ts IN youth-d
// ---------------------------------------------------------------------------
// Phase 8 flags a youth activity follow-up for the same person for the same reason, and a second
// copy of "who owns the ward council agenda" would be a second answer to drift from the first.
// That module's header carries the argument, notifyOrgLeadership's precedent, and — most
// importantly — the rule about what may go in a body.
//
// THIS FILE'S EXPORTED SIGNATURE DID NOT CHANGE. app/api/visits/[id]/route.ts has no diff at all
// after that move, which is how the extraction is shown to have preserved behaviour rather than
// merely claimed to.
//
// ---------------------------------------------------------------------------
// THE BODY IS THE ONE-LINER AND NOTHING ELSE. NO NOTE TEXT MAY EVER BE ADDED.
// ---------------------------------------------------------------------------
// Not the shared notes, not a summary of them, and above all not the private note. A notification
// row is read by somebody who cannot open the visit, it is rendered in a bell menu with no
// permission check of its own, and Phase 11 may put it in a digest email. Any of those three
// carries note text out past every boundary this phase built (CLAUDE.md rule 5). The one-liner
// names WHICH visit to bring up; the discussion happens with the people who can already see it.
//
// The recipient — the executive secretary — holds no `visits.view` permission, which is what
// makes that rule structurally true rather than a rule to remember.

export type NotifyWardCouncilFlagParams = {
  wardId: string;
  // Resolved by the caller and passed in, so this module needs no joins of its own — and so the
  // only strings it can put in a body are the two it was handed.
  orgName: string;
  familyName: string;
};

const VISIT_FLAG_TRIGGER_KEY = "visit_flagged_for_ward_council";

export function wardCouncilFlagBody(orgName: string, familyName: string): string {
  return `${orgName} — ${familyName} — requested for ward council discussion`;
}

// Never throws — the shared helper holds that contract, and this wrapper adds nothing that could.
// The flag has already been written by the time this runs, and a notification failure must
// degrade the message rather than fail the edit the leader just made.
export async function notifyWardCouncilFlag(
  params: NotifyWardCouncilFlagParams,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const { wardId, orgName, familyName } = params;

  await notifyShared(
    {
      wardId,
      triggerKey: VISIT_FLAG_TRIGGER_KEY,
      title: "Visit flagged for ward council",
      body: wardCouncilFlagBody(orgName, familyName),
    },
    client,
  );
}
