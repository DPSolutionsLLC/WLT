import type { SupabaseClient } from "@supabase/supabase-js";
import type { DateOnly } from "@/lib/calendar/dates";
import { listSundays } from "@/lib/calendar/queries";
import { shapeLastPrayed, type LastPrayed } from "@/lib/prayers/lastPrayed";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { UpsertPrayerInput } from "@/lib/validation/prayer";
import type { Database } from "@/types/database";
import {
  PRAYER_COMPLETED_STAGE,
  PRAYER_STAGES,
  PRAYER_TYPES,
  type PrayerStage,
  type PrayerType,
} from "@/types/domain";

// Every prayer read and write goes through this module. Route handlers and pages never touch
// Supabase directly (conventions.md §Data Access).
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. A client
// component that imports this file fails `npm run build` while passing both `npm run lint` and
// `npm run typecheck` (plans/retros/roster-b-picker-and-orgs.md). The pure rules live in
// prayerPipeline.ts and lastPrayed.ts precisely so PrayerBoard can render them without touching
// this file.
//
// PRAYERS SURVIVE `speaking_slots = 0`. A fast Sunday still has an invocation and a benediction,
// so nothing here is gated on the slot count — that guard belongs to speakers only
// (lib/calendar/queries.ts documents the same rule from the calendar side).

export type Prayer = {
  id: string;
  sundayId: string | null;
  memberId: string | null;
  prayerType: PrayerType | null;
  stage: PrayerStage;
  askedBy: string | null;
  askedAt: string | null;
  confirmedAt: string | null;
  createdAt: string;
};

export type PrayerFilter = { sundayId: string } | { from: DateOnly; to: DateOnly };

export type PrayerTransitionStamps = {
  actorUserId: string;
};

type PrayerRow = {
  id: string;
  sunday_id: string | null;
  member_id: string | null;
  prayer_type: string | null;
  stage: string;
  asked_by: string | null;
  asked_at: string | null;
  confirmed_at: string | null;
  created_at: string;
};

// The generated Update shape, used for every patch this module builds. Typing a patch as
// Record<string, unknown> would compile against any column name at all, which is exactly how a
// typo becomes a write that silently does nothing (talks-a).
type PrayerUpdate = Database["public"]["Tables"]["prayer_assignments"]["Update"];

// One string literal on ONE line, however long it gets, and never a `+` concatenation.
// Concatenation widens the type to `string`, which defeats supabase-js's literal-type parsing of
// the select list (plans/retros/calendar-a-rules-and-api.md).
const PRAYER_COLUMNS =
  "id, sunday_id, member_id, prayer_type, stage, asked_by, asked_at, confirmed_at, created_at";

// The last-prayed read needs the Sunday's date, so it carries its own list rather than appending
// to the one above — a second const, never a concatenation of the first.
const LAST_PRAYED_COLUMNS = "member_id, sundays!inner(date)";

// A CHECK constraint already restricts every column this is used on, so an unrecognised value
// means the constraint and types/domain.ts have drifted. Throwing is the only safe answer.
function toEnumValue<Value extends string>(
  value: string,
  allowed: readonly Value[],
  column: string,
): Value {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `${column} holds "${value}", which is not a known value. The CHECK constraint ` +
        `in migration 005 and types/domain.ts have drifted.`,
    );
  }
  return value as Value;
}

// Builds an explicit object rather than spreading the row: a column added to
// `prayer_assignments` later cannot ride along into a response nobody reviewed.
export function mapPrayerRow(row: PrayerRow): Prayer {
  return {
    id: row.id,
    sundayId: row.sunday_id,
    memberId: row.member_id,
    prayerType:
      row.prayer_type === null
        ? null
        : toEnumValue(row.prayer_type, PRAYER_TYPES, "prayer_assignments.prayer_type"),
    stage: toEnumValue(row.stage, PRAYER_STAGES, "prayer_assignments.stage"),
    askedBy: row.asked_by,
    askedAt: row.asked_at,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

export async function listPrayers(
  wardId: string,
  filter: PrayerFilter,
  client?: SupabaseClient<Database>,
): Promise<Prayer[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("prayer_assignments")
    .select(PRAYER_COLUMNS)
    .eq("ward_id", wardId);

  if ("sundayId" in filter) {
    query = query.eq("sunday_id", filter.sundayId);
  } else {
    // Resolved through lib/calendar/queries.ts rather than an embedded PostgREST join, so the
    // ward scope on `sundays` is applied by the module that owns that table. An empty range
    // yields an empty id list, and `.in(…, [])` correctly matches nothing.
    const sundays = await listSundays(wardId, { from: filter.from, to: filter.to }, supabase);
    query = query.in(
      "sunday_id",
      sundays.map((sunday) => sunday.id),
    );
  }

  const { data, error } = await query.order("sunday_id").order("prayer_type");

  if (error) {
    console.error(`Could not read the ward's prayers — ${error.message}`, { wardId, filter });
    throw new Error(`Could not read the prayer assignments: ${error.message}`);
  }

  return (data ?? []).map(mapPrayerRow);
}

// Returns null when absent — the route turns that into a 404. A row that is not in this ward and
// a row RLS refused are indistinguishable here, and both mean "not yours"
// (plans/retros/foundation-c-services.md).
export async function getPrayer(
  wardId: string,
  prayerId: string,
  client?: SupabaseClient<Database>,
): Promise<Prayer | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("prayer_assignments")
    .select(PRAYER_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", prayerId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a prayer — ${error.message}`, { wardId, prayerId });
    throw new Error(`Could not read that prayer: ${error.message}`);
  }

  return data ? mapPrayerRow(data) : null;
}

export async function findPrayerSlot(
  wardId: string,
  sundayId: string,
  prayerType: PrayerType,
  client?: SupabaseClient<Database>,
): Promise<Prayer | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("prayer_assignments")
    .select(PRAYER_COLUMNS)
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .eq("prayer_type", prayerType)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a prayer slot — ${error.message}`, {
      wardId,
      sundayId,
      prayerType,
    });
    throw new Error(`Could not read that prayer slot: ${error.message}`);
  }

  return data ? mapPrayerRow(data) : null;
}

// One invocation and one benediction per Sunday. A second write to the same slot REPLACES the
// member rather than inserting a second row — which the unique index on
// (ward_id, sunday_id, prayer_type) in migration 028 makes true rather than merely intended.
//
// A new row is always created at stage `assign`. There is no parameter for the stage,
// deliberately: a prayer that starts anywhere else has skipped a gate. An EXISTING row keeps
// whatever stage it has — changing who is praying is not a stage move, and this function has no
// branch that could make it one.
export async function upsertPrayer(
  wardId: string,
  input: UpsertPrayerInput,
  client?: SupabaseClient<Database>,
): Promise<Prayer | null> {
  const supabase = await resolveClient(client);

  const existing = await findPrayerSlot(wardId, input.sundayId, input.prayerType, supabase);

  if (existing) {
    const patch: PrayerUpdate = { member_id: input.memberId };

    const { data, error } = await supabase
      .from("prayer_assignments")
      .update(patch)
      .eq("ward_id", wardId)
      .eq("id", existing.id)
      .select(PRAYER_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error(`Could not change who is praying — ${error.message}`, {
        wardId,
        prayerId: existing.id,
      });
      throw new Error(`Could not change who is praying: ${error.message}`);
    }

    return data ? mapPrayerRow(data) : null;
  }

  const { data, error } = await supabase
    .from("prayer_assignments")
    .insert({
      ward_id: wardId,
      sunday_id: input.sundayId,
      prayer_type: input.prayerType,
      member_id: input.memberId,
      stage: "assign",
    })
    .select(PRAYER_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not assign a prayer — ${error.message}`, {
      wardId,
      sundayId: input.sundayId,
      prayerType: input.prayerType,
    });
    throw new Error(`Could not assign that prayer: ${error.message}`);
  }

  return mapPrayerRow(data);
}

// Changes who is praying on an EXISTING row, by id. The upsert above is keyed by slot and is
// what the board uses; this is what PATCH /api/prayers/[id] uses, so a caller holding an id does
// not have to re-derive the Sunday and the type to change a name.
export async function setPrayerMember(
  wardId: string,
  prayerId: string,
  memberId: string | null,
  client?: SupabaseClient<Database>,
): Promise<Prayer | null> {
  const supabase = await resolveClient(client);

  const patch: PrayerUpdate = { member_id: memberId };

  const { data, error } = await supabase
    .from("prayer_assignments")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", prayerId)
    .select(PRAYER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not change who is praying — ${error.message}`, { wardId, prayerId });
    throw new Error(`Could not change who is praying: ${error.message}`);
  }

  return data ? mapPrayerRow(data) : null;
}

// The stage AND its timestamp move in one update, so no reader can observe a stage that has
// arrived without the moment it arrived. canTransitionPrayer() has already decided this is
// legal; this function does not second-guess it.
//
// Returns null when the write was refused, which the route turns into a 404. An UPDATE denied by
// policy comes back as success with zero rows, not an error
// (plans/retros/foundation-c-services.md).
export async function transitionPrayer(
  wardId: string,
  prayerId: string,
  to: PrayerStage,
  stamps: PrayerTransitionStamps,
  client?: SupabaseClient<Database>,
): Promise<Prayer | null> {
  const supabase = await resolveClient(client);

  const now = new Date().toISOString();

  const patch: PrayerUpdate = { stage: to };

  switch (to) {
    case "ask":
      patch.asked_at = now;
      patch.asked_by = stamps.actorUserId;
      break;
    case "confirm":
      patch.confirmed_at = now;
      break;
    // `assign` and `done` stamp nothing of their own — there is no `done_at` column. A backward
    // move deliberately leaves the earlier stamps in place: they record what actually happened,
    // and clearing them would rewrite it.
    default:
      break;
  }

  const { data, error } = await supabase
    .from("prayer_assignments")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", prayerId)
    .select(PRAYER_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not move a prayer's stage — ${error.message}`, {
      wardId,
      prayerId,
      to,
    });
    throw new Error(`Could not move that prayer to ${to}: ${error.message}`);
  }

  return data ? mapPrayerRow(data) : null;
}

// ONE query for the whole picker, never one per member. A planner annotates a roster of a few
// hundred names, and a per-name lookup is a few hundred round trips to draw one list.
//
// Only prayers that reached `done` count — the same completed-only rule the talk rotation uses.
// A prayer stuck at `ask` is somebody who was asked, not somebody who prayed
// (types/domain.ts PRAYER_COMPLETED_STAGE).
export async function listLastPrayed(
  wardId: string,
  memberIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<LastPrayed[]> {
  if (memberIds.length === 0) return [];

  const supabase = await resolveClient(client);

  // The Sunday's DATE is the fact worth reporting — "Last prayed March 2025" is about the
  // meeting, not about when a row happened to be written — so `sundays` is joined rather than
  // created_at being read as a proxy. The join is inner, so a prayer with no Sunday drops out.
  const { data, error } = await supabase
    .from("prayer_assignments")
    .select(LAST_PRAYED_COLUMNS)
    .eq("ward_id", wardId)
    .eq("stage", PRAYER_COMPLETED_STAGE)
    .in("member_id", memberIds as string[]);

  if (error) {
    console.error(`Could not read last-prayed history — ${error.message}`, { wardId });
    throw new Error(`Could not read who last prayed: ${error.message}`);
  }

  const rows = (data ?? []).flatMap((row) =>
    row.member_id === null || row.sundays === null
      ? []
      : [{ memberId: row.member_id, date: row.sundays.date as DateOnly }],
  );

  return shapeLastPrayed(memberIds, rows);
}
