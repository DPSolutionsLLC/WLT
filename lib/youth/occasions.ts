import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// The occasion: the stored fact that two young people's rows are the same evening.
//
// ---------------------------------------------------------------------------
// AN OCCASION IS IDENTITY AND NOTHING ELSE
// ---------------------------------------------------------------------------
// Migration 059a gives it `id`, `ward_id`, `created_by` and `created_at` — no title, no date, no
// place. Those already live on the EVENT ROWS it links, and a second copy could disagree with the
// first. Reading an occasion's rows is therefore
// `listActivityEvents(wardId, { occasionId, includePast: true })` and NOT a function here: one
// place resolves an event list, and a second would be a second answer to the same question
// (plans/retros/visits-f-*).
//
// ---------------------------------------------------------------------------
// EVERY FUNCTION RUNS UNDER THE CALLER'S OWN CLIENT
// ---------------------------------------------------------------------------
// So migration 059c's policies decide, and nothing here branches on a role: a bishopric member
// and an org president run the same statement and the database answers (CLAUDE.md rule 2). Those
// policies are ward-wide on all four verbs, matching `activity_events`, because a
// cross-organization occasion is the point rather than an edge case and because the read must be
// uniformly evaluable — 059c argues both in full.
//
// THIS MODULE NEVER SELECTS FROM `activity_private_notes`, AND NEVER IMPORTS THE MODULE THAT
// DOES. The sentence lib/youth/queries.ts and lib/youth/attendees.ts both carry applies here
// unchanged (CLAUDE.md rule 5).
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. The coverage
// arithmetic that reduces an occasion's rows to one badge is in lib/youth/coverage.ts, which is
// client-importable on purpose — do not merge the two files.

export type ActivityOccasion = {
  id: string;
  createdBy: string | null;
  createdAt: string;
};

const OCCASION_COLUMNS = "id, created_by, created_at";

type ActivityOccasionRow = {
  id: string;
  created_by: string | null;
  created_at: string;
};

function mapOccasionRow(row: ActivityOccasionRow): ActivityOccasion {
  return {
    id: row.id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

export async function createOccasion(
  wardId: string,
  createdBy: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityOccasion> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_occasions")
    .insert({ ward_id: wardId, created_by: createdBy })
    .select(OCCASION_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create an activity occasion — ${error.message}`, { wardId });
    throw new Error(`Could not record that as one game: ${error.message}`);
  }

  return mapOccasionRow(data);
}

export async function getOccasion(
  wardId: string,
  occasionId: string,
  client?: SupabaseClient<Database>,
): Promise<ActivityOccasion | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_occasions")
    .select(OCCASION_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", occasionId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read an activity occasion — ${error.message}`, {
      wardId,
      occasionId,
    });
    throw new Error(`Could not load that game: ${error.message}`);
  }

  return data === null ? null : mapOccasionRow(data);
}

// FALSE MEANS REFUSED, NOT "NOTHING TO DO". An RLS-denied UPDATE is a zero-row success rather than
// an error — only INSERT raises (CLAUDE.md §8) — so the route must say so plainly instead of
// reporting a success that did not happen. A caller naming an event that is not there gets the
// same false, which is also the right answer to show them: the screen they were looking at was
// stale.
//
// `occasionId: null` takes an event OUT of its occasion. The composite foreign key does the rest.
export async function setEventOccasion(
  wardId: string,
  eventId: string,
  occasionId: string | null,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("activity_events")
    .update({ occasion_id: occasionId })
    .eq("ward_id", wardId)
    .eq("id", eventId)
    .select("id");

  if (error) {
    console.error(`Could not link an activity event to an occasion — ${error.message}`, {
      wardId,
      eventId,
      occasionId,
    });
    throw new Error(`Could not save which game that is: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

// RUN AFTER AN UNLINK, AND ONLY WHEN FEWER THAN TWO ROWS ARE LEFT.
//
// A one-row occasion is not WRONG — it breaks nothing and reads as an ordinary event everywhere —
// but it is a link to nothing, and leaving them behind means a ward slowly accumulates identities
// that describe no shared evening. Nobody can see them to tidy them up, because an occasion has
// no screen of its own.
//
// DELETING IT IS SAFE because migration 059b's foreign key is `on delete set null (occasion_id)`:
// the last row simply becomes unlinked rather than being deleted with the occasion. That column
// list is the whole reason this is a one-line cleanup rather than a cascade that would take a
// leader's fixtures with it (migrations 046/047).
//
// Returns whether an occasion was actually removed, so the audit row can say.
export async function deleteOccasionIfEmpty(
  wardId: string,
  occasionId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { count, error: countError } = await supabase
    .from("activity_events")
    .select("id", { count: "exact", head: true })
    .eq("ward_id", wardId)
    .eq("occasion_id", occasionId);

  if (countError) {
    console.error(`Could not count an occasion's events — ${countError.message}`, {
      wardId,
      occasionId,
    });
    throw new Error(`Could not tidy up that game: ${countError.message}`);
  }

  if ((count ?? 0) >= 2) return false;

  const { data, error } = await supabase
    .from("activity_occasions")
    .delete()
    .eq("ward_id", wardId)
    .eq("id", occasionId)
    .select("id");

  if (error) {
    console.error(`Could not delete an activity occasion — ${error.message}`, {
      wardId,
      occasionId,
    });
    throw new Error(`Could not tidy up that game: ${error.message}`);
  }

  return (data ?? []).length > 0;
}
