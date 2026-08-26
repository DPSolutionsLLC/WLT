import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// Youth activity logs.
//
// ONE FUNCTION, AND IT IS HERE BECAUSE visits-c NEEDED IT. Phase 8
// (plans/08-youth-activities.md) owns this module and will fill it in; the read-status route
// built in visits-c is deliberately generic, and "does this report exist and may this caller see
// it?" has to be answerable for `youth_activity` on the day the route ships or the genericity is
// a claim rather than a fact.
//
// THIS MODULE NEVER SELECTS FROM `activity_private_notes`, AND NEVER IMPORTS THE MODULE THAT
// WILL. Migration 009 gives that table the same author-only shape as visit_private_notes, and
// CLAUDE.md rule 5 names both. The rule lib/visits/queries.ts states in its header applies here
// unchanged.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers.

export type ActivityLog = {
  id: string;
  eventId: string | null;
  // WHO TYPED IT IN. `activity_logs` has no participants table and no equivalent of
  // `visit_participants`, so unlike a visit there is no separate record of who was actually
  // there. A feed tile must not present this under the same label a visit's "who went" uses
  // (lib/reports/types.ts).
  loggedBy: string | null;
  sharedNotes: string | null;
  flaggedForWardCouncil: boolean;
  createdAt: string;
};

type ActivityLogRow = {
  id: string;
  event_id: string | null;
  logged_by: string | null;
  shared_notes: string | null;
  flagged_for_ward_council: boolean;
  created_at: string;
};

// One string literal on ONE line, never a `+` concatenation — concatenation widens the type to
// `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md).
const ACTIVITY_LOG_COLUMNS =
  "id, event_id, logged_by, shared_notes, flagged_for_ward_council, created_at";

function mapActivityLogRow(row: ActivityLogRow): ActivityLog {
  return {
    id: row.id,
    eventId: row.event_id,
    loggedBy: row.logged_by,
    sharedNotes: row.shared_notes,
    flaggedForWardCouncil: row.flagged_for_ward_council,
    createdAt: row.created_at,
  };
}

// Null, not an error, for a log this caller cannot see. Migration 019 gives `activity_logs` a
// plain ward-scoped select policy, so today that means "not in your ward" — but the caller's
// session client is still what runs the query, so a narrower policy added by Phase 8 narrows this
// too without anything here changing.
export async function getActivityLog(
  wardId: string,
  activityLogId: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityLog | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("activity_logs")
    .select(ACTIVITY_LOG_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", activityLogId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read an activity log — ${error.message}`, {
      wardId,
      activityLogId,
    });
    throw new Error(`Could not load that activity: ${error.message}`);
  }

  return data === null ? null : mapActivityLogRow(data);
}
