import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Cadence } from "@/lib/visits/cadence";
import type { Database } from "@/types/database";
import { CADENCE_UNITS, type CadenceUnit } from "@/types/domain";

// One organization's cadence for one household, overriding that organization's goal.
//
// ABSENT MEANS "USE THE GOAL". There is no sentinel row meaning "default", so clearing an
// override is a DELETE and resolution is a map lookup with a fallback
// (resolveHouseholdCadence in lib/visits/progress.ts).
//
// A JOIN TABLE, NOT A households COLUMN. The same family can be on a 3-month cadence for the
// Elders Quorum and a 12-month one for the Relief Society at the same time, with both dashboards
// correct — which a column on `households` could not have expressed at all (ITER-018 Decision 2,
// reversed mid-planning for exactly this reason).
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. Nothing
// client-side may import this module; the table renders from lib/visits/progress.ts's already
// -computed rows, and the type below reaches the client through a `import type` only.

export type HouseholdVisitCadence = {
  id: string;
  householdId: string;
  orgId: string;
  cadence: Cadence;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type HouseholdVisitCadenceRow = {
  id: string;
  household_id: string;
  org_id: string;
  cadence_amount: number;
  cadence_unit: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// One string literal on ONE line, never a `+` concatenation — concatenation widens the type to
// `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md). And never `select("*")`: an explicit list is what
// stops a column added later riding into a response nobody reviewed.
const HOUSEHOLD_VISIT_CADENCE_COLUMNS =
  "id, household_id, org_id, cadence_amount, cadence_unit, created_by, created_at, updated_at";

// A value migration 050's CHECK should have made impossible means the constraint and
// types/domain.ts have drifted, and that is worth a crash rather than a silent cast — the same
// reasoning toEnum() uses in lib/visits/queries.ts.
function toCadenceUnit(value: string): CadenceUnit {
  if (!(CADENCE_UNITS as readonly string[]).includes(value)) {
    throw new Error(
      `household_visit_cadences.cadence_unit holds "${value}", which is not a known unit. ` +
        "The CHECK constraint and types/domain.ts have drifted.",
    );
  }
  return value as CadenceUnit;
}

// Builds an explicit object rather than spreading the row, for the same reason mapVisitGoalRow
// does: a column added later cannot ride along into a response nobody reviewed.
//
// `cadence` is assembled as ONE object rather than left as two loose fields, so half a cadence
// cannot be passed to addCadence().
function mapRow(row: HouseholdVisitCadenceRow): HouseholdVisitCadence {
  return {
    id: row.id,
    householdId: row.household_id,
    orgId: row.org_id,
    cadence: { amount: row.cadence_amount, unit: toCadenceUnit(row.cadence_unit) },
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// Every function below takes the CALLER'S session client. RLS does the org scoping, and the
// `org_id` filter here is the caller's own question — "what has THIS organization overridden" —
// not a belt-and-braces re-check of the policy.
export async function listHouseholdVisitCadences(
  wardId: string,
  orgId: string,
  client?: SupabaseClient<Database>,
): Promise<HouseholdVisitCadence[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("household_visit_cadences")
    .select(HOUSEHOLD_VISIT_CADENCE_COLUMNS)
    .eq("ward_id", wardId)
    .eq("org_id", orgId);

  if (error) {
    console.error(`Could not read household visit cadences — ${error.message}`, {
      wardId,
      orgId,
    });
    throw new Error(`Could not load the household cadences: ${error.message}`);
  }

  return (data ?? []).map(mapRow);
}

// EVERY organization's overrides, ward-wide, for the all-organizations view
// (lib/visits/allOrgProgress.ts). The same select list, with no `org_id` filter.
//
// RLS TIERS THIS IDENTICALLY TO THE FUNCTION ABOVE, and that is the whole point of there being
// no filter here: `household_visit_cadences_select` is `is_bishopric() or org_id =
// current_org_id()` with NO cross-org branch, so the bishopric reads every organization's and an
// org leader reads only their own — whatever the ward's cross-org visibility setting says.
//
// That is ITER-018's decision, left standing by ITER-019: migration 052 widens
// `household_stewardships_select` for the ward setting and pointedly does NOT widen this one.
// Whose stewardship a family is in is a fact about coverage; what interval an organization holds
// them to is that presidency's judgement.
//
// DO NOT ADD A REDUNDANT APPLICATION-SIDE FILTER HERE. It would mask a policy regression by
// hiding rows the policy had started letting through.
export async function listWardVisitCadences(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<HouseholdVisitCadence[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("household_visit_cadences")
    .select(HOUSEHOLD_VISIT_CADENCE_COLUMNS)
    .eq("ward_id", wardId);

  if (error) {
    console.error(`Could not read the ward's household cadences — ${error.message}`, { wardId });
    throw new Error(`Could not load the ward's household cadences: ${error.message}`);
  }

  return (data ?? []).map(mapRow);
}

// Sets or replaces this organization's cadence for this household.
//
// Targets the `unique (household_id, org_id)` pair rather than reading-then-writing, so two
// leaders saving at once cannot leave two overrides that disagree. `updated_at` is set
// explicitly because the column's default only applies on INSERT.
//
// Returns null when nothing came back, which from here is indistinguishable from a row RLS
// refused: an RLS-denied write is a zero-row success, not an error
// (plans/retros/foundation-c-services.md). The route turns that into a 404.
export async function upsertHouseholdVisitCadence(
  wardId: string,
  householdId: string,
  orgId: string,
  cadence: Cadence,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<HouseholdVisitCadence | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("household_visit_cadences")
    .upsert(
      {
        ward_id: wardId,
        household_id: householdId,
        org_id: orgId,
        cadence_amount: cadence.amount,
        cadence_unit: cadence.unit,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "household_id,org_id" },
    )
    .select(HOUSEHOLD_VISIT_CADENCE_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not save a household visit cadence — ${error.message}`, {
      wardId,
      householdId,
      orgId,
    });
    throw new Error(`Could not save that household cadence: ${error.message}`);
  }

  return data === null ? null : mapRow(data);
}

// Clears the override, putting the household back on its organization's goal.
//
// Returns WHETHER A ROW WAS REMOVED, so "cleared" and "there was nothing to clear" are
// distinguishable to the caller. A second DELETE therefore reports nothing to clear rather than
// failing — clearing something already clear is not an error, and the route says so.
export async function deleteHouseholdVisitCadence(
  wardId: string,
  householdId: string,
  orgId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("household_visit_cadences")
    .delete()
    .eq("ward_id", wardId)
    .eq("household_id", householdId)
    .eq("org_id", orgId)
    .select("id");

  if (error) {
    console.error(`Could not clear a household visit cadence — ${error.message}`, {
      wardId,
      householdId,
      orgId,
    });
    throw new Error(`Could not clear that household cadence: ${error.message}`);
  }

  return (data ?? []).length > 0;
}
