import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { toStewardshipScope, type StewardshipScope } from "@/lib/visits/stewardshipScope";
import type { Database } from "@/types/database";

// Which households an organization has claimed as its own to visit.
//
// ABSENT MEANS THE WHOLE WARD. There is no sentinel row meaning "everything", so an organization
// that has narrowed nothing has no rows here — the same absent-means-default idiom
// lib/visits/householdCadences.ts uses, and the reason every existing dashboard is unchanged on
// the day this ships.
//
// A cadence says HOW OFTEN. A stewardship says WHETHER AT ALL. They are keyed the same way and
// answer different questions, and collapsing them would lose the distinction between "we visit
// this family rarely" and "this family is not ours".
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. Nothing
// client-side may import this module — the pure resolution lives in
// lib/visits/stewardshipScope.ts and imports nothing at all.

export type HouseholdStewardship = {
  id: string;
  householdId: string;
  orgId: string;
  createdBy: string | null;
  createdAt: string;
};

type HouseholdStewardshipRow = {
  id: string;
  household_id: string;
  org_id: string;
  created_by: string | null;
  created_at: string;
};

// One string literal on ONE line, never a `+` concatenation — concatenation widens the type to
// `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md). And never `select("*")`.
const HOUSEHOLD_STEWARDSHIP_COLUMNS = "id, household_id, org_id, created_by, created_at";

// Builds an explicit object rather than spreading the row, so a column added later cannot ride
// along into a response nobody reviewed.
function mapRow(row: HouseholdStewardshipRow): HouseholdStewardship {
  return {
    id: row.id,
    householdId: row.household_id,
    orgId: row.org_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// Returns a SCOPE rather than rows: the caller wants the question answered — "is this household
// ours?" — not the table. `toStewardshipScope([])` is what makes an organization with no rows
// resolve to "everything is in scope".
export async function readStewardshipScope(
  wardId: string,
  orgId: string,
  client?: SupabaseClient<Database>,
): Promise<StewardshipScope> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("household_stewardships")
    .select("household_id")
    .eq("ward_id", wardId)
    .eq("org_id", orgId);

  if (error) {
    console.error(`Could not read a stewardship — ${error.message}`, { wardId, orgId });
    throw new Error(`Could not load the organization's stewardship: ${error.message}`);
  }

  return toStewardshipScope((data ?? []).map((row) => row.household_id));
}

// EVERY organization's rows, ward-wide, for the all-organizations view.
//
// RLS decides which come back and this function adds no org filter of its own: the bishopric
// gets every organization's; an org leader gets their own, plus every organization's when the
// ward has cross-org visibility on. That widening is migration 052's
// `household_stewardships_select` and it is deliberate — coverage is a fact, and a household in
// no organization's stewardship is invisible to everybody unless somebody can read them all at
// once.
//
// A belt-and-braces application-side filter here would MASK a policy regression by hiding rows
// the policy had started letting through, which is why there is not one.
export async function listWardStewardships(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<HouseholdStewardship[]> {
  const supabase = await resolveClient(client);

  // Ordered explicitly. These tables are shared by every suite running against the hosted
  // project, and an order asserted in one place and assumed in another is the bug
  // plans/retros/route-tests-and-realtime.md records.
  const { data, error } = await supabase
    .from("household_stewardships")
    .select(HOUSEHOLD_STEWARDSHIP_COLUMNS)
    .eq("ward_id", wardId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`Could not read the ward's stewardships — ${error.message}`, { wardId });
    throw new Error(`Could not load the ward's stewardships: ${error.message}`);
  }

  return (data ?? []).map(mapRow);
}

// Adds ONE household to this organization's stewardship.
//
// `ignoreDuplicates` so adding a household already present is not an error — membership is
// presence or absence, and asking for a state that already holds is not a failure. An ignored
// duplicate returns NO ROW, which is why the route re-reads the scope rather than reading an
// empty result here as a refusal.
//
// Returns null when nothing came back, which from here is also indistinguishable from a row RLS
// refused: an RLS-denied write is a zero-row success, not an error
// (plans/retros/foundation-c-services.md).
export async function addHouseholdStewardship(
  wardId: string,
  householdId: string,
  orgId: string,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<HouseholdStewardship | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("household_stewardships")
    .upsert(
      {
        ward_id: wardId,
        household_id: householdId,
        org_id: orgId,
        created_by: userId,
      },
      { onConflict: "household_id,org_id", ignoreDuplicates: true },
    )
    .select(HOUSEHOLD_STEWARDSHIP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not add a household stewardship — ${error.message}`, {
      wardId,
      householdId,
      orgId,
    });
    throw new Error(`Could not add that household to the stewardship: ${error.message}`);
  }

  return data === null ? null : mapRow(data);
}

// Returns WHETHER A ROW WENT, so "removed" and "there was nothing to remove" stay
// distinguishable to the caller. A second DELETE reports nothing to remove rather than failing.
export async function removeHouseholdStewardship(
  wardId: string,
  householdId: string,
  orgId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("household_stewardships")
    .delete()
    .eq("ward_id", wardId)
    .eq("household_id", householdId)
    .eq("org_id", orgId)
    .select("id");

  if (error) {
    console.error(`Could not remove a household stewardship — ${error.message}`, {
      wardId,
      householdId,
      orgId,
    });
    throw new Error(`Could not remove that household from the stewardship: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

// Replaces the whole set: delete what is no longer named, insert what is new.
//
// ---------------------------------------------------------------------------
// THIS IS TWO STATEMENTS AND IT IS NOT ATOMIC
// ---------------------------------------------------------------------------
// A failure between the delete and the insert leaves a PARTIAL set. That is accepted rather than
// hidden: one presidency edits one screen, and the drift banner makes a partial result visible on
// the very next load rather than silent. A Postgres function would make it atomic and is
// deliberately NOT being added here — flagged so the next reader knows it was weighed rather
// than missed.
//
// The DELETE runs first and the INSERT second, both scoped to the same organization, so a
// household present in BOTH passes is never briefly absent — its row simply survives the delete
// and is ignored by the insert.
export async function replaceStewardship(
  wardId: string,
  orgId: string,
  householdIds: readonly string[],
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<{ added: number; removed: number }> {
  // GUARDED HERE AS WELL AS AT THE BOUNDARY. PostgREST's `not.in.()` with an empty list is a
  // syntax hazard, and an empty replace is genuinely ambiguous under this table's
  // absent-means-everything rule — the route has already refused it with a sentence
  // (EMPTY_STEWARDSHIP_MESSAGE in lib/validation/visit.ts), and this is the belt to that braces.
  if (householdIds.length === 0) {
    throw new Error(
      "A stewardship cannot be replaced with an empty list. Clearing it is a different " +
        "operation, because zero rows means the whole ward.",
    );
  }

  const supabase = await resolveClient(client);
  const keep = [...new Set(householdIds)];

  const { data: removedRows, error: deleteError } = await supabase
    .from("household_stewardships")
    .delete()
    .eq("ward_id", wardId)
    .eq("org_id", orgId)
    .not("household_id", "in", `(${keep.join(",")})`)
    .select("id");

  if (deleteError) {
    console.error(`Could not prune a stewardship — ${deleteError.message}`, { wardId, orgId });
    throw new Error(`Could not update the stewardship: ${deleteError.message}`);
  }

  const { data: addedRows, error: insertError } = await supabase
    .from("household_stewardships")
    .upsert(
      keep.map((householdId) => ({
        ward_id: wardId,
        household_id: householdId,
        org_id: orgId,
        created_by: userId,
      })),
      { onConflict: "household_id,org_id", ignoreDuplicates: true },
    )
    .select("id");

  if (insertError) {
    console.error(`Could not extend a stewardship — ${insertError.message}`, { wardId, orgId });
    throw new Error(`Could not update the stewardship: ${insertError.message}`);
  }

  return { added: (addedRows ?? []).length, removed: (removedRows ?? []).length };
}

// STOPS NARROWING. Removes every row for the organization, putting it back on the whole ward —
// which is the only way to express "measure us against everybody" under a model where absence is
// the default. Returns HOW MANY rows went, so the route writes an audit row only when something
// genuinely happened.
export async function clearStewardship(
  wardId: string,
  orgId: string,
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("household_stewardships")
    .delete()
    .eq("ward_id", wardId)
    .eq("org_id", orgId)
    .select("id");

  if (error) {
    console.error(`Could not clear a stewardship — ${error.message}`, { wardId, orgId });
    throw new Error(`Could not stop narrowing the stewardship: ${error.message}`);
  }

  return (data ?? []).length;
}
