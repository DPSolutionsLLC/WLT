import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import {
  UNIT_ASSIGNMENT_ROLES,
  UNIT_TYPES,
  type Unit,
  type UnitAssignmentRole,
  type UnitType,
} from "@/types/domain";

export type { Unit };

// Reads over the unit hierarchy (migration 065). Shaped after lib/ward/crossOrgVisibility.ts:
// small named exports, snake_case → camelCase mapped ONCE, here.
//
// EVERY READ IN THIS FILE IS GOVERNED BY RLS AND NOTHING ELSE (CLAUDE.md rule 2). `units_select`
// and `unit_assignments_select` decide what comes back; nothing here filters for security, and
// nothing here should start to.

export type UnitAssignment = {
  id: string;
  userId: string;
  unitId: string | null;
  role: UnitAssignmentRole;
  counselorPosition: 1 | 2 | null;
};

export type SwitchableWard = {
  wardId: string;
  name: string;
  unitId: string | null;
};

const UNIT_COLUMNS = "id, type, parent_id, unit_number, name";
const UNIT_ASSIGNMENT_COLUMNS = "id, user_id, unit_id, role, counselor_position";

// A value the TypeScript union does not know means the CHECK constraint in migration 065 and the
// constant in types/domain.ts have drifted — the same reasoning, and the same refusal to guess,
// as toRole() in lib/auth/session.ts.
function toUnitType(value: string): UnitType {
  if (!(UNIT_TYPES as readonly string[]).includes(value)) {
    throw new Error(
      `units.type holds "${value}", which is not a known unit type. The CHECK constraint in ` +
        "migration 065 and UNIT_TYPES in types/domain.ts have drifted.",
    );
  }
  return value as UnitType;
}

function toUnitAssignmentRole(value: string): UnitAssignmentRole {
  if (!(UNIT_ASSIGNMENT_ROLES as readonly string[]).includes(value)) {
    throw new Error(
      `unit_assignments.role holds "${value}", which is not a known assignment role. The CHECK ` +
        "constraint in migration 065 and UNIT_ASSIGNMENT_ROLES in types/domain.ts have drifted.",
    );
  }
  return value as UnitAssignmentRole;
}

function toCounselorPosition(value: number | null): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

type UnitRow = {
  id: string;
  type: string;
  parent_id: string | null;
  unit_number: string | null;
  name: string;
};

function toUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    type: toUnitType(row.type),
    parentId: row.parent_id,
    unitNumber: row.unit_number,
    name: row.name,
  };
}

// EVERY UNIT THIS SESSION MAY SEE, which `units_select` (migration 065f) already decides: a
// super admin sees all of them, everybody else sees their own ward's unit and any unit they hold
// an assignment over. Nothing here filters for security and nothing here should start to
// (CLAUDE.md rule 2).
//
// Ordered by type then name so a stake sorts above the wards under it without the caller having
// to rebuild the tree to render a list. The nesting itself is `parentId`, which the screen walks.
export async function listUnits(
  client?: SupabaseClient<Database>,
): Promise<Unit[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("units")
    .select(UNIT_COLUMNS)
    .order("type", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error(`Could not list the units — ${error.message}`);
    throw new Error(`Could not load the units: ${error.message}`);
  }

  return (data ?? []).map(toUnit);
}

export async function readUnit(
  unitId: string,
  client?: SupabaseClient<Database>,
): Promise<Unit | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("units")
    .select(UNIT_COLUMNS)
    .eq("id", unitId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the unit — ${error.message}`, { unitId });
    throw new Error(`Could not read the unit: ${error.message}`);
  }

  return data ? toUnit(data) : null;
}

// The unit a ward IS. Null while `wards.unit_id` is still null, which is every ward created
// before proto-d's Stakes & Wards screen — see migration 065c.
export async function readWardUnit(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<Unit | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("wards")
    .select("unit_id")
    .eq("id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the ward's unit — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's unit: ${error.message}`);
  }

  if (!data?.unit_id) return null;

  return readUnit(data.unit_id, supabase);
}

// A person's OWN assignments. `unit_assignments_select` admits `user_id = auth.uid()` (and
// everything, for a super admin), so passing somebody else's id returns an empty list rather
// than an error — an RLS read that matches nothing is a zero-row success.
export async function listUnitAssignments(
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<UnitAssignment[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("unit_assignments")
    .select(UNIT_ASSIGNMENT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`Could not read the unit assignments — ${error.message}`, { userId });
    throw new Error(`Could not read the unit assignments: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    unitId: row.unit_id,
    role: toUnitAssignmentRole(row.role),
    counselorPosition: toCounselorPosition(row.counselor_position),
  }));
}

// THE WARDS THIS SESSION MAY ACT IN — which, from migration 070a on, means THE WARDS THEY HOLD AN
// ACTIVE CALLING IN. A stake assignment is no longer one of them: a stake officer reaches nothing
// (CLAUDE.md §7), and a super admin's reach is proto-d's to decide with its own screen.
//
// ⚠️ RETURNS `[]` FOR SOMEBODY WITH ONE CALLING — never their own ward alone. The ward control
// renders off this list, and "anyone who belongs to exactly one ward never sees the unit layer at
// all" (CLAUDE.md §7) is a stated requirement of the phase, not a nicety. Everybody holds a
// calling in their own ward (migration 068's backfill), so `switchable_wards()` honestly returns
// one row for every ordinary leader in the app and the filter is what keeps a pointless switcher
// off their chrome bar.
//
// The check moved from "do they hold a unit assignment" to "do they hold more than one calling",
// and it is now made on the RPC's own answer rather than by a second query. One question, one
// round trip, and no second definition of "may act in" to drift from can_act_in_ward().
//
// ---------------------------------------------------------------------------
// WHY THIS IS AN RPC AND NOT A QUERY
// ---------------------------------------------------------------------------
// `wards_select` (migration 019) is `id = current_ward_id()` — ONE ward row, the one you are
// standing in. So a list of "wards I may act in" assembled from ordinary reads contains only the
// ward you are already in, and the control could never offer the one you want.
//
// `switchable_wards()` (migration 066f) is the definer function that answers it, and its header
// carries the argument for why widening `wards_select` instead would have been the wrong trade:
// "you may switch into this ward" is a far smaller promise than "you may read this ward's
// settings", which is what a widened `wards_select` would have granted.
export async function listSwitchableWards(
  client?: SupabaseClient<Database>,
): Promise<SwitchableWard[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase.rpc("switchable_wards");

  if (error) {
    console.error(`Could not list the switchable wards — ${error.message}`);
    throw new Error(`Could not list the wards you may act in: ${error.message}`);
  }

  const wards = data ?? [];

  // ONE CALLING IS NOT A CHOICE. See the ⚠️ above — this is the line the whole "invisible to an
  // ordinary ward" requirement rests on, and it is deliberately `<= 1` rather than `=== 1` so a
  // session with no calling at all also gets nothing rather than an empty control.
  if (wards.length <= 1) return [];

  return wards.map((row) => ({
    wardId: row.ward_id,
    name: row.name,
    // `?? null` for the same reason as elsewhere in this phase: the generated type for a
    // RETURNS TABLE function claims non-nullable, and `wards.unit_id` is nullable until proto-d.
    unitId: row.unit_id ?? null,
  }));
}

// ---------------------------------------------------------------------------
// IS THIS SESSION A SUPER ADMIN?
// ---------------------------------------------------------------------------
//
// A MIRROR OF THE SQL `is_super_admin()` (migration 065e), and it must stay one. That function is
// what `units_select` and `unit_assignments_select` read; this is what the routes and screens
// read. If the two ever disagree, a screen offers something the database refuses, or hides
// something it would allow — `youth-a-D1`'s mirror, and 060-D2's lesson that a mirror must copy
// every half of the rule.
//
// THE ANSWER COMES FROM `unit_assignments`, NOT FROM A WARD ROLE, and that distinction is the
// whole guard. `super_admin` also exists as a value in ROLES, and SUPER_ADMIN_PERMISSIONS grants
// everything — but that is authority WITHIN a ward. Creating the stake above a ward is not a ward
// act, and a ward has no standing to perform it, so the question asked here is the structural one.
//
// The deactivated-account check is not repeated here: `unit_assignments_select` already admits
// only `is_super_admin() or user_id = auth.uid()`, lib/auth/session.ts refuses a deactivated
// account before any of this is reached, and the SQL function joins `users.is_active` itself.
export async function isSuperAdmin(
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("unit_assignments")
    .select("id")
    .eq("role", "super_admin")
    .limit(1);

  if (error) {
    // THROWS rather than answering false. A read failure is not "you are not a super admin" — on
    // a screen that grants app-wide authority, guessing in either direction is wrong, and
    // resolveRoleAccess() takes the same line for the same reason.
    console.error(`Could not resolve super-admin status — ${error.message}`);
    throw new Error(`Could not check your administrator access: ${error.message}`);
  }

  return (data ?? []).length > 0;
}
