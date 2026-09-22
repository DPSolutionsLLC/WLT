import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import type { Unit, UnitType } from "@/types/domain";

// WRITING THE UNIT HIERARCHY (migration 065a). Stakes, the wards nested under them, and the
// real church-assigned unit number.
//
// ---------------------------------------------------------------------------
// THE SERVICE-ROLE CLIENT, AND WHY RLS IS NOT THE BOUNDARY HERE
// ---------------------------------------------------------------------------
// `units` has a SELECT policy and NO WRITE POLICIES (migration 065f), exactly as
// `unit_assignments` has none and `ward_role_assignments` has none. That was deliberate: 065's
// own header says assignments and units are written through the service client "in proto-d, the
// same shape lib/auth/adminUsers.ts already uses", and that do not add write policies in that
// slice because "an untested write policy is the most dangerous thing in this phase".
//
// SO assertSuperAdmin() IN THE ROUTE IS THE EFFECTIVE BOUNDARY FOR EVERY WRITE IN THIS FILE, and
// that check can never be skipped. This is the same narrow exception to CLAUDE.md rule 2 that
// lib/callings/writeCalling.ts carries, for the same reason, and the read path in
// lib/units/queries.ts is governed by RLS either way.
//
// A WARD HAS NO STANDING TO CREATE THE STAKE ABOVE ITSELF, which is why the guard is
// `super_admin` held in `unit_assignments` rather than any `admin.*` permission. A ward
// permission is a statement about a ward; this is a statement about the structure above it.
//
// NO AUDIT ROW IS WRITTEN HERE. The route writes it (conventions.md §Route Handler Shape), the
// same as every other mutation in the app.

export type CreateUnitParams = {
  type: UnitType;
  name: string;
  parentId?: string | null;
  // STARTS EMPTY AND IS EDITABLE. It is the real church-assigned number and a human may not know
  // it when the unit is created — migration 065a keeps it nullable and unique only where present.
  unitNumber?: string | null;
};

export type UpdateUnitParams = {
  name?: string;
  unitNumber?: string | null;
  parentId?: string | null;
};

const UNIT_COLUMNS = "id, type, parent_id, unit_number, name";

// Postgres unique violation. `units_unit_number_key` is partial, so this can only mean a real
// number is already recorded against another unit.
const UNIQUE_VIOLATION = "23505";
// Foreign-key violation. On a delete this is `on delete restrict` firing — a stake with wards or
// child units still under it.
const FOREIGN_KEY_VIOLATION = "23503";

// A refusal the caller turns into a 409 with a sentence, distinct from a fault. Every other
// error is rethrown, so "the database is broken" and "that number is taken" never become one
// message (CLAUDE.md rule 7).
export class UnitConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitConflictError";
  }
}

function resolveClient(client?: SupabaseClient<Database>): SupabaseClient<Database> {
  return client ?? createServiceSupabaseClient();
}

type UnitRow = {
  id: string;
  type: string;
  parent_id: string | null;
  unit_number: string | null;
  name: string;
};

// The mapper is duplicated from lib/units/queries.ts rather than imported, and that is a
// deliberate two-line copy: queries.ts imports the SERVER client, which cannot be imported from
// a service-role module without dragging next/headers in behind it.
function toUnit(row: UnitRow): Unit {
  return {
    id: row.id,
    type: row.type as UnitType,
    parentId: row.parent_id,
    unitNumber: row.unit_number,
    name: row.name,
  };
}

// An empty unit number is stored as NULL, never as "". The unique index is partial — unique only
// where present — so a second empty string would collide with the first while two unknown numbers
// must not. Normalising here means the one place that writes the column is the one place that
// decides what "not known yet" looks like.
function normaliseUnitNumber(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function createUnit(
  params: CreateUnitParams,
  client?: SupabaseClient<Database>,
): Promise<Unit> {
  const service = resolveClient(client);

  const { data, error } = await service
    .from("units")
    .insert({
      type: params.type,
      name: params.name.trim(),
      parent_id: params.parentId ?? null,
      unit_number: normaliseUnitNumber(params.unitNumber),
    })
    .select(UNIT_COLUMNS)
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new UnitConflictError(
        "Another unit already has that unit number. Unit numbers are assigned by the Church " +
          "and each one belongs to a single unit — check the number, or leave it empty until " +
          "you know it.",
      );
    }
    console.error(`Could not create the unit — ${error.message}`, {
      type: params.type,
      parentId: params.parentId ?? null,
    });
    throw new Error(`Could not create the unit: ${error.message}`);
  }

  return toUnit(data);
}

// Returns null when no such unit exists — a zero-row UPDATE, which the caller reports as "that
// unit is not there" rather than as a fault. The same shape updateCalling() has.
export async function updateUnit(
  unitId: string,
  changes: UpdateUnitParams,
  client?: SupabaseClient<Database>,
): Promise<Unit | null> {
  const service = resolveClient(client);

  const { data, error } = await service
    .from("units")
    .update({
      ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
      ...(changes.unitNumber !== undefined
        ? { unit_number: normaliseUnitNumber(changes.unitNumber) }
        : {}),
      ...(changes.parentId !== undefined ? { parent_id: changes.parentId } : {}),
    })
    .eq("id", unitId)
    .select(UNIT_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new UnitConflictError(
        "Another unit already has that unit number. Unit numbers are assigned by the Church " +
          "and each one belongs to a single unit.",
      );
    }
    console.error(`Could not update the unit — ${error.message}`, { unitId });
    throw new Error(`Could not update the unit: ${error.message}`);
  }

  return data ? toUnit(data) : null;
}

// DELETING A STAKE WITH WARDS UNDER IT FAILS LOUDLY, and that is migration 065a's stated intent:
// `parent_id` and `wards.unit_id` are both `on delete restrict` "rather than silently orphaning
// or destroying them".
//
// The constraint is what enforces it; this only turns 23503 into a sentence a person can act on,
// because a raw foreign-key violation surfaces as a 500 reading "Please try again", which is
// untrue. The same move `isPolicyRefusal()` makes for 42501 (youth-j, 060-D2).
//
// It deliberately does NOT count what is underneath and report the number. Refuse, and name the
// alternative, without disclosing counts (visits-f) — and the alternative here is real: move the
// wards out first, which is a thing the screen can do.
export async function deleteUnit(
  unitId: string,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const service = resolveClient(client);

  const { error } = await service.from("units").delete().eq("id", unitId);

  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      throw new UnitConflictError(
        "Something is still under this unit, so it cannot be removed. Move the wards and any " +
          "units beneath it somewhere else first, then remove it.",
      );
    }
    console.error(`Could not delete the unit — ${error.message}`, { unitId });
    throw new Error(`Could not delete the unit: ${error.message}`);
  }
}

// NESTING A WARD UNDER A UNIT. `wards.unit_id` stays NULLABLE (migration 065c) and this phase
// does not tighten it: tests/helpers/seed.ts inserts wards directly, so a `not null` would turn
// every RLS suite red on the day it applied, and the plan says so in as many words. A ward with
// no unit is an ordinary, supported state — it is every ward created before this screen existed.
export async function setWardUnit(
  wardId: string,
  unitId: string | null,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const service = resolveClient(client);

  const { error } = await service
    .from("wards")
    .update({ unit_id: unitId })
    .eq("id", wardId);

  if (error) {
    console.error(`Could not set the ward's unit — ${error.message}`, { wardId, unitId });
    throw new Error(`Could not attach the ward to that unit: ${error.message}`);
  }
}
