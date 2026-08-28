import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyWardCouncilFlag as notifyShared } from "@/lib/notifications/notifyWardCouncilFlag";
import type { Database } from "@/types/database";

// The YOUTH vocabulary for a ward-council flag: which trigger key, what the title says, and how
// the one-liner reads.
//
// The sibling of lib/visits/flagNotification.ts, and deliberately the same shape. The recipient
// resolution — who owns the ward council agenda — lives once, in
// lib/notifications/notifyWardCouncilFlag.ts, on notifyOrgLeadership's precedent: a second copy
// would be a second answer to drift from the first, and the opt-out lookup inside
// emitNotification is keyed on the TRIGGER, so a hardcoded key would deliver a youth follow-up to
// somebody who had switched visit flags off.
//
// ---------------------------------------------------------------------------
// THE BODY IS THE ONE-LINER AND NOTHING ELSE. NO NOTE TEXT MAY EVER BE ADDED.
// ---------------------------------------------------------------------------
// Not the shared notes, not a summary of them, and above all not the private note. A notification
// row is read by somebody who cannot open the follow-up, it renders in a bell menu with no
// permission check of its own, and Phase 11 may put it in a digest email (CLAUDE.md rule 5).
//
// The recipient — the executive secretary — holds NO `youth_activities` permission at all
// (lib/auth/permissions.ts), so they cannot open the follow-up even if they wanted to. That is
// what makes this rule structurally true rather than a rule to remember. The one-liner names WHICH
// follow-up to bring up; the discussion happens with the people who can already see it.

export type NotifyYouthFlagParams = {
  wardId: string;
  // Resolved by the caller and passed in, so this module needs no joins of its own — and so the
  // only strings it can put in a body are the two it was handed.
  activityName: string;
  eventTitle: string;
};

export const YOUTH_FLAG_TRIGGER_KEY = "youth_activity_flagged_for_ward_council";

// THE ACTIVITY AND THE EVENT, and no youth's name. An agenda item is "the basketball season, the
// Roosevelt game" — which is enough for the executive secretary to write the line and for the
// bishopric to know what it is about. A young person's name in a notification addressed to
// somebody who cannot open the record is a fact travelling further than the record it came from.
export function youthWardCouncilFlagBody(activityName: string, eventTitle: string): string {
  return `${activityName} — ${eventTitle} — requested for ward council discussion`;
}

// Never throws — the shared helper holds that contract, and this wrapper adds nothing that could.
// The flag has already been written by the time this runs, and a notification failure must
// degrade the message rather than fail the edit the leader just made.
export async function notifyYouthWardCouncilFlag(
  params: NotifyYouthFlagParams,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const { wardId, activityName, eventTitle } = params;

  await notifyShared(
    {
      wardId,
      triggerKey: YOUTH_FLAG_TRIGGER_KEY,
      title: "Youth activity follow-up flagged for ward council",
      body: youthWardCouncilFlagBody(activityName, eventTitle),
    },
    client,
  );
}
