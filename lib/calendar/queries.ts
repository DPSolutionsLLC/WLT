import type { SupabaseClient } from "@supabase/supabase-js";
import { BISHOPRIC_ROLES } from "@/lib/auth/permissions";
import {
  formatDateOnly,
  lastDayOfMonth,
  monthOf,
  monthStart,
  type DateOnly,
} from "@/lib/calendar/dates";
import {
  buildMeetingSeries,
  type MeetingSundayEntry,
} from "@/lib/calendar/meetingSeries";
import { generateSundays } from "@/lib/calendar/generateSundays";
import {
  activeRotation,
  resolveConductingUser,
  type RotationEntry,
} from "@/lib/calendar/resolveConductingUser";
import {
  resolveFastSunday,
  type FastSundayCandidate,
} from "@/lib/calendar/resolveFastSunday";
import { readDefaultSpeakingSlots } from "@/lib/calendar/wardCalendarSettings";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type {
  ConductingRotationInput,
  CreateSundayInput,
  UpdateSundayInput,
} from "@/lib/validation/calendar";
import type { Database, Json } from "@/types/database";
import {
  ASSIGNMENT_TYPES,
  FAST_SUNDAY_DISPLACING_TYPES,
  holdsSacramentMeeting,
  ORGANIZATION_TYPES,
  ROTATION_CADENCES,
  ROTATION_ELIGIBLE_ORG_TYPES,
  ROTATION_POSITIONS,
  SUNDAY_TYPES,
  type AssignmentType,
  type OrganizationType,
  type RotationCadence,
  type RotationPosition,
  type SundayType,
} from "@/types/domain";

// Every calendar read and write goes through this module. Route handlers and pages never touch
// Supabase directly (conventions.md §Data Access), which is what keeps the ward scope, the
// snake↔camel mapping, and — most importantly — the fast-Sunday re-resolution in one place
// instead of re-derived at every call site.
//
// updateSunday() is the reason that matters. Re-resolution lives INSIDE it, not in the route, so
// a future caller cannot patch a Sunday's type and skip the rule (03-calendar.md Step 4).

export type SlotConfigEntry = {
  slotNumber: number;
  lengthMinutes: number;
  type: AssignmentType;
};

export type Sunday = {
  id: string;
  date: DateOnly;
  type: SundayType;
  notes: string | null;
  conductingUserId: string | null;
  speakingSlots: number;
  slotConfig: SlotConfigEntry[] | null;
  presidingOverride: string | null;
  fastSundayPinned: boolean;
  createdAt: string;
};

export type ConductingRotationRow = {
  id: string;
  position: RotationPosition;
  userId: string | null;
  effectiveFrom: DateOnly;
  cadence: RotationCadence;
  // Null is the bishopric's sacrament-meeting rotation (migration 024, Part 2).
  orgId: string | null;
};

export type BishopricUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  role: "bishop" | "counselor";
  counselorPosition: 1 | 2 | null;
};

// All three org leadership roles, not only the president. A secretary rarely conducts, but a
// ward that wants it should not be told no by a schema — and a ward that does not want it
// simply never picks them.
export const ORG_LEADERSHIP_ROLES = [
  "org_president",
  "org_counselor",
  "org_secretary",
] as const;

export type OrgLeadershipRole = (typeof ORG_LEADERSHIP_ROLES)[number];

export type OrgLeadershipUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  role: OrgLeadershipRole;
  orgId: string;
};

// An organization that may hold a conducting rotation of its own.
export type RotationOrganization = {
  id: string;
  name: string;
  type: OrganizationType;
};

// Everything ConductingLabel needs to turn a stored id into a name, and nothing more. Both
// BishopricUser and OrgLeadershipUser satisfy it structurally, so one name map can cover the
// sacrament meeting and every organization on the same page.
export type ConductingCandidate = {
  id: string;
  firstName: string | null;
  lastName: string | null;
};

export type SundayOrgConducting = {
  orgId: string;
  userId: string | null;
};

// Why a calendar change would void work somebody has already done. calendar-b words its dialog
// from `reason`; the `message` is the server's own sentence and must be rendered verbatim rather
// than rebuilt from the counts (the drift roster-c shipped twice).
export type CalendarChangeReason =
  // Fast Sunday re-resolves ONTO a different Sunday that already has speakers.
  | "fast_sunday_moved"
  // The edited Sunday becomes a type that holds no sacrament meeting at all.
  | "meeting_cancelled"
  // The edited Sunday becomes Fast Sunday, so its speaking slots go to zero.
  | "fast_sunday_set"
  // speakingSlots is cut below the number of speakers already in those slots.
  | "slots_reduced"
  // The only consequence is that later Sundays change conductor. Nobody's speaking assignment is
  // at risk, but who conducts is about to move for people who have already been told.
  | "conducting_reshuffled";

export type CalendarChangeWarning = {
  reason: CalendarChangeReason;
  // The Sunday whose work is at risk — NOT always the Sunday being edited. On
  // "fast_sunday_moved" it is the Sunday Fast Sunday is moving onto.
  sundayId: string;
  date: DateOnly;
  monthStart: DateOnly;
  // Where Fast Sunday is moving from. Null for every other reason.
  fromDate: DateOnly | null;
  assignmentCount: number;
  prayerCount: number;
  // How many LATER Sundays change conductor if this is confirmed. Carried on whichever warning is
  // shown rather than queued as a second one: confirming applies the whole patch, so a
  // consequence the user was not told about would break that promise.
  conductingReshiftCount: number;
  orgConductingReshiftCount: number;
  message: string;
};

export type UpdateSundayResult =
  | {
      status: "applied";
      sunday: Sunday;
      assignmentsReverted: number;
      conductingReshiftCount: number;
      orgConductingReshiftCount: number;
    }
  | { status: "needs_confirmation"; warning: CalendarChangeWarning };

export type GenerateRangeResult = {
  created: number;
  monthsResolved: number;
};

export type SundayRange = { from: DateOnly; to: DateOnly };

type SundayRow = {
  id: string;
  date: string;
  type: string;
  notes: string | null;
  conducting_user_id: string | null;
  speaking_slots: number;
  slot_config: Json | null;
  presiding_override: string | null;
  fast_sunday_pinned: boolean;
  created_at: string;
};

type RotationRow = {
  id: string;
  position: number;
  user_id: string | null;
  effective_from: string;
  cadence: string;
  org_id: string | null;
};

// One string literal, never a `+` concatenation. Concatenation widens the type to `string`,
// which defeats supabase-js's literal-type parsing of the select list and silently turns every
// mapped row into GenericStringError. lib/roster/queries.ts keeps its column lists on one line
// for the same reason.
const SUNDAY_COLUMNS =
  "id, date, type, notes, conducting_user_id, speaking_slots, slot_config, presiding_override, fast_sunday_pinned, created_at";

// One string literal on ONE line, however long it gets, and never a `+` concatenation.
// Concatenation widens the type to `string`, which defeats supabase-js's literal-type parsing of
// the select list and silently turns every mapped row into GenericStringError.
const ROTATION_COLUMNS = "id, position, user_id, effective_from, cadence, org_id";

const ORG_CONDUCTING_COLUMNS = "id, sunday_id, org_id, user_id";

// The upper bound of the re-shift horizon. listSundays() takes a range, and "every Sunday after
// this one" needs an end date to express. Far enough out that no ward will ever have generated
// past it, and bounded so the query stays on the (ward_id, date) index.
const RESHIFT_HORIZON_END = "2999-12-31";

// Thrown rather than returned because it is a database constraint refusing a write, not a
// business decision the caller can inspect. The route maps it to 409; nothing else catches it.
//
// It carries the organization because one ward now holds up to seven independent rotations, and
// "A rotation already takes effect on 2026-06-07" is ambiguous across them. The data layer knows
// the id, not the name, so the ROUTE is what names the organization in the sentence a user reads.
export class ConductingRotationConflictError extends Error {
  constructor(
    public readonly effectiveFrom: DateOnly,
    public readonly orgId: string | null = null,
  ) {
    super(`A rotation already takes effect on ${effectiveFrom}.`);
    this.name = "ConductingRotationConflictError";
  }
}

// A CHECK constraint already restricts every column this is used on, so an unrecognised value
// means the constraint and types/domain.ts have drifted. Throwing is the only safe answer — the
// same reasoning as toEnumValue() in lib/roster/queries.ts.
//
// `column` is fully qualified and `migration` names the file that owns the constraint, because
// an error that points at the wrong table sends the next reader to the wrong place.
function toEnumValue<Value extends string>(
  value: string,
  allowed: readonly Value[],
  column: string,
  migration = "004",
): Value {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `${column} holds "${value}", which is not a known value. The CHECK constraint ` +
        `in migration ${migration} and types/domain.ts have drifted.`,
    );
  }
  return value as Value;
}

// slot_config stays SNAKE_CASE inside the jsonb blob — { slot_number, length_minutes, type } —
// because SPEC.md and 03-calendar.md both specify that shape and Phase 6's program builder reads
// it. The camel to snake mapping happens here, once, exactly like every column in this file. It
// is not an inconsistency to be "fixed" in either direction.
function mapSlotConfig(value: Json | null): SlotConfigEntry[] | null {
  if (value === null || value === undefined) return null;

  if (!Array.isArray(value)) {
    throw new Error(
      "sundays.slot_config holds something other than an array. It was written by something " +
        "that did not go through lib/validation/calendar.ts.",
    );
  }

  return value.map((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("A sundays.slot_config entry is not an object.");
    }

    const record = entry as Record<string, unknown>;
    const slotNumber = record.slot_number;
    const lengthMinutes = record.length_minutes;
    const type = record.type;

    if (typeof slotNumber !== "number" || typeof lengthMinutes !== "number") {
      throw new Error(
        "A sundays.slot_config entry is missing slot_number or length_minutes.",
      );
    }

    if (typeof type !== "string") {
      throw new Error("A sundays.slot_config entry is missing type.");
    }

    return {
      slotNumber,
      lengthMinutes,
      type: toEnumValue(type, ASSIGNMENT_TYPES, "sundays.slot_config.type"),
    };
  });
}

export function toSlotConfigJson(entries: SlotConfigEntry[] | null): Json | null {
  if (entries === null) return null;

  return entries.map((entry) => ({
    slot_number: entry.slotNumber,
    length_minutes: entry.lengthMinutes,
    type: entry.type,
  })) as unknown as Json;
}

// Builds an explicit object rather than spreading the row. A column added to `sundays` later
// cannot ride along into a response nobody reviewed.
export function mapSundayRow(row: SundayRow): Sunday {
  return {
    id: row.id,
    date: row.date,
    type: toEnumValue(row.type, SUNDAY_TYPES, "sundays.type"),
    notes: row.notes,
    conductingUserId: row.conducting_user_id,
    speakingSlots: row.speaking_slots,
    slotConfig: mapSlotConfig(row.slot_config),
    presidingOverride: row.presiding_override,
    fastSundayPinned: row.fast_sunday_pinned,
    createdAt: row.created_at,
  };
}

export function mapRotationRow(row: RotationRow): ConductingRotationRow {
  if (!(ROTATION_POSITIONS as readonly number[]).includes(row.position)) {
    throw new Error(
      `conducting_rotation.position holds ${row.position}, which is not 1, 2 or 3. The CHECK ` +
        "constraint in migration 004 and types/domain.ts have drifted.",
    );
  }

  return {
    id: row.id,
    position: row.position as RotationPosition,
    userId: row.user_id,
    effectiveFrom: row.effective_from,
    cadence: toEnumValue(row.cadence, ROTATION_CADENCES, "conducting_rotation.cadence", "024"),
    orgId: row.org_id,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

function toCandidates(sundays: Sunday[]): FastSundayCandidate[] {
  return sundays.map((sunday) => ({
    id: sunday.id,
    date: sunday.date,
    type: sunday.type,
    fastSundayPinned: sunday.fastSundayPinned,
  }));
}

function currentFastSunday(sundays: Sunday[]): Sunday | null {
  return sundays.find((sunday) => sunday.type === "fast_sunday") ?? null;
}

export async function listSundays(
  wardId: string,
  range: SundayRange,
  client?: SupabaseClient<Database>,
): Promise<Sunday[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("sundays")
    .select(SUNDAY_COLUMNS)
    .eq("ward_id", wardId)
    .gte("date", range.from)
    .lte("date", range.to)
    .order("date");

  if (error) {
    console.error(`Could not read the ward's Sundays — ${error.message}`, {
      wardId,
      ...range,
    });
    throw new Error(`Could not read the calendar: ${error.message}`);
  }

  return (data ?? []).map(mapSundayRow);
}

// Returns null when absent — the route turns that into a 404. A row that is not in this ward and
// a row RLS refused are indistinguishable here, and both mean "not yours"
// (plans/retros/foundation-c-services.md).
export async function getSunday(
  wardId: string,
  sundayId: string,
  client?: SupabaseClient<Database>,
): Promise<Sunday | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("sundays")
    .select(SUNDAY_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", sundayId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a Sunday — ${error.message}`, { wardId, sundayId });
    throw new Error(`Could not read that Sunday: ${error.message}`);
  }

  return data ? mapSundayRow(data) : null;
}

// `options.orgId` is a THREE-way choice, and the difference matters:
//   omitted      every rotation in the ward, which is what the calendar page renders from
//   null         the bishopric's sacrament-meeting rotation only
//   a uuid       that organization's rotation only
//
// `.is("org_id", null)` for the null case, never `.eq()`. SQL equality against NULL is NULL, so
// `.eq("org_id", null)` matches nothing and the bishopric rotation would silently vanish.
export async function listConductingRotation(
  wardId: string,
  options: { orgId?: string | null } = {},
  client?: SupabaseClient<Database>,
): Promise<ConductingRotationRow[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("conducting_rotation")
    .select(ROTATION_COLUMNS)
    .eq("ward_id", wardId);

  if (options.orgId === null) {
    query = query.is("org_id", null);
  } else if (options.orgId !== undefined) {
    query = query.eq("org_id", options.orgId);
  }

  const { data, error } = await query.order("effective_from").order("position");

  if (error) {
    console.error(`Could not read the conducting rotation — ${error.message}`, {
      wardId,
      orgId: options.orgId,
    });
    throw new Error(`Could not read the conducting rotation: ${error.message}`);
  }

  return (data ?? []).map(mapRotationRow);
}

// Who conducts one organization's meeting on each Sunday. Stored per (Sunday, organization) and
// read back, never recomputed — the row IS the override (migration 024, Part 4).
export async function listSundayOrgConducting(
  wardId: string,
  sundayId: string,
  client?: SupabaseClient<Database>,
): Promise<SundayOrgConducting[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("sunday_org_conducting")
    .select(ORG_CONDUCTING_COLUMNS)
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId);

  if (error) {
    console.error(`Could not read the organization conductors — ${error.message}`, {
      wardId,
      sundayId,
    });
    throw new Error(`Could not read who conducts for each organization: ${error.message}`);
  }

  return (data ?? []).map((row) => ({ orgId: row.org_id, userId: row.user_id }));
}

// Returns null when the write was refused, which the route turns into a 404. A Sunday in another
// ward, an organization the caller may not manage, and a row RLS hid are indistinguishable here
// and all mean "not yours" (plans/retros/foundation-c-services.md).
//
// An upsert rather than an insert-or-update pair: the row may or may not exist depending on
// whether the month was generated after the organization got a rotation, and the caller does not
// care which.
export async function setSundayOrgConducting(
  wardId: string,
  sundayId: string,
  orgId: string,
  userId: string | null,
  client?: SupabaseClient<Database>,
): Promise<SundayOrgConducting | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("sunday_org_conducting")
    .upsert(
      { ward_id: wardId, sunday_id: sundayId, org_id: orgId, user_id: userId },
      { onConflict: "ward_id,sunday_id,org_id" },
    )
    .select(ORG_CONDUCTING_COLUMNS)
    .maybeSingle();

  if (error) {
    // 42501 is insufficient_privilege — migration 024's policy refusing a write outside the
    // caller's own organization. An UPDATE refused by a USING clause comes back as zero rows
    // instead, so both shapes have to mean the same thing to the caller.
    if (error.code === "42501") {
      console.warn("RLS refused an organization conducting write", {
        wardId,
        sundayId,
        orgId,
      });
      return null;
    }

    console.error(`Could not set the organization conductor — ${error.message}`, {
      wardId,
      sundayId,
      orgId,
    });
    throw new Error(`Could not set who conducts: ${error.message}`);
  }

  if (!data) return null;

  return { orgId: data.org_id, userId: data.user_id };
}

// Two columns, on ONE string literal. Never a `+` concatenation across lines: that widens the
// type to `string`, defeats supabase-js's literal-type parsing of the select list, and silently
// turns every mapped row into GenericStringError (plans/retros/calendar-a-rules-and-api.md).
const SUNDAY_TYPE_COLUMNS = "date, type";

// Deliberately NOT listSundays(). The range a conducting resolution needs can reach back years,
// to whenever a rotation took effect, and counting turns needs the date and the type of every
// Sunday since — not the notes, slot configs and presiding overrides of all of them.
async function readSundayTypes(
  supabase: SupabaseClient<Database>,
  wardId: string,
  range: SundayRange,
): Promise<Map<DateOnly, SundayType>> {
  const { data, error } = await supabase
    .from("sundays")
    .select(SUNDAY_TYPE_COLUMNS)
    .eq("ward_id", wardId)
    .gte("date", range.from)
    .lte("date", range.to);

  if (error) {
    console.error(`Could not read the Sunday types — ${error.message}`, { wardId, range });
    throw new Error(`Could not read the calendar's Sunday types: ${error.message}`);
  }

  const types = new Map<DateOnly, SundayType>();
  for (const row of data ?? []) {
    types.set(
      row.date,
      toEnumValue(row.type, SUNDAY_TYPES, "sundays.type", "004_calendar.sql"),
    );
  }

  return types;
}

// The meeting history a conducting resolution needs, widened to WHOLE MONTHS at both ends
// because the monthly cadence decides whether a month is wholly dead and cannot do that from a
// ragged range.
//
// `overrides` is how a type that is not stored yet reaches the walk: the candidates
// generateSundayRange() is about to insert, and the projected type of a Sunday updateSunday() is
// about to patch. Both must count in the same walk as the rows that already exist.
async function seriesFor(
  supabase: SupabaseClient<Database>,
  wardId: string,
  earliestAnchor: DateOnly,
  latestTarget: DateOnly,
  overrides?: ReadonlyMap<DateOnly, SundayType>,
): Promise<MeetingSundayEntry[]> {
  const from = monthStart(earliestAnchor);
  const to = lastDayOfMonth(latestTarget);

  const storedTypes = await readSundayTypes(supabase, wardId, { from, to });

  if (overrides) {
    for (const [date, type] of overrides) storedTypes.set(date, type);
  }

  return buildMeetingSeries(from, to, storedTypes);
}

// The earliest effectiveFrom among the rotation sets that could govern anything in this range.
// The series has to start at least there, or the walk counts from the wrong place.
function earliestAnchorFor(entries: RotationEntry[], fallback: DateOnly): DateOnly {
  return entries.reduce(
    (earliest, entry) => (entry.effectiveFrom < earliest ? entry.effectiveFrom : earliest),
    fallback,
  );
}

function toRotationEntries(rows: ConductingRotationRow[]): RotationEntry[] {
  return rows.map((row) => ({
    position: row.position,
    userId: row.userId,
    effectiveFrom: row.effectiveFrom,
    cadence: row.cadence,
  }));
}

// The active set's own effectiveFrom is the anchor, which is what makes a rotation change restart
// at position 1 on the date it takes effect rather than continuing the old cycle.
function conductingUserFor(
  entries: RotationEntry[],
  sundayDate: DateOnly,
  series: MeetingSundayEntry[],
): string | null {
  const active = activeRotation(entries, sundayDate);
  if (active.length === 0) return null;

  return resolveConductingUser(sundayDate, entries, active[0].effectiveFrom, series);
}

// One call to apply_fast_sunday() per month. The RULE runs here in TypeScript; the WRITE is the
// SQL function, so clearing the old Fast Sunday and setting the new one cannot be observed
// half-done (migration 023).
async function resolveMonth(
  supabase: SupabaseClient<Database>,
  wardId: string,
  anyDayInMonth: DateOnly,
): Promise<{ assignmentsReverted: number }> {
  const start = monthStart(anyDayInMonth);
  const monthSundays = await listSundays(
    wardId,
    { from: start, to: lastDayOfMonth(start) },
    supabase,
  );

  const fastSundayId = resolveFastSunday(toCandidates(monthSundays));

  const { data, error } = await supabase.rpc("apply_fast_sunday", {
    p_ward_id: wardId,
    p_month_start: start,
    // null is a legitimate argument — it means every Sunday this month is displaced, and the
    // function clears the old Fast Sunday without setting a new one. Supabase's type generator
    // marks every plpgsql argument non-nullable because the catalog does not record nullability,
    // so the cast asserts what migration 023 actually accepts.
    p_fast_sunday_id: fastSundayId as string,
  });

  if (error) {
    console.error(`Could not apply Fast Sunday — ${error.message}`, {
      wardId,
      monthStart: start,
      fastSundayId,
    });
    throw new Error(`Could not set Fast Sunday for ${start}: ${error.message}`);
  }

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(
      "apply_fast_sunday returned something other than an object. Migration 023 and " +
        "lib/calendar/queries.ts have drifted.",
    );
  }

  const reverted = (data as Record<string, unknown>).assignments_reverted;

  return { assignmentsReverted: typeof reverted === "number" ? reverted : 0 };
}

// Only rows whose conducting_user_id is still null. An override a human typed is never
// overwritten by a later generation — that is the whole point of storing the value.
async function populateConducting(
  supabase: SupabaseClient<Database>,
  wardId: string,
  range: SundayRange,
): Promise<void> {
  const entries = toRotationEntries(
    await listConductingRotation(wardId, { orgId: null }, supabase),
  );
  if (entries.length === 0) return;

  const sundays = await listSundays(wardId, range, supabase);

  const series = await seriesFor(
    supabase,
    wardId,
    earliestAnchorFor(entries, range.from),
    range.to,
  );

  const byUser = new Map<string, string[]>();
  for (const sunday of sundays) {
    if (sunday.conductingUserId !== null) continue;

    // A Sunday with no meeting never gets a conductor. resolveConductingUser() returns null for
    // one anyway; skipping here says so at the call site too, and migration 027's CHECK would
    // refuse the write loudly if either were wrong.
    if (!holdsSacramentMeeting(sunday.type)) continue;

    const userId = conductingUserFor(entries, sunday.date, series);
    if (userId === null) continue;

    const existing = byUser.get(userId);
    if (existing) {
      existing.push(sunday.id);
    } else {
      byUser.set(userId, [sunday.id]);
    }
  }

  // One update per distinct conductor rather than one per Sunday: a twelve-month generation is
  // three round trips instead of fifty-two.
  for (const [userId, sundayIds] of byUser) {
    const { error } = await supabase
      .from("sundays")
      .update({ conducting_user_id: userId })
      .eq("ward_id", wardId)
      .in("id", sundayIds);

    if (error) {
      console.error(`Could not set the conducting user — ${error.message}`, {
        wardId,
        userId,
        sundayCount: sundayIds.length,
      });
      throw new Error(`Could not assign who conducts: ${error.message}`);
    }
  }
}

// Removing an organization's conducting rows for Sundays that hold no meeting. Called from both
// generation and the edit path, so the rule lives in one place.
async function deleteOrgConductingFor(
  supabase: SupabaseClient<Database>,
  wardId: string,
  sundayIds: string[],
): Promise<void> {
  if (sundayIds.length === 0) return;

  const { error } = await supabase
    .from("sunday_org_conducting")
    .delete()
    .eq("ward_id", wardId)
    .in("sunday_id", sundayIds);

  if (error) {
    console.error(`Could not clear the organization conductors — ${error.message}`, {
      wardId,
      sundayCount: sundayIds.length,
    });
    throw new Error(`Could not clear who conducts for each organization: ${error.message}`);
  }
}

// The organization counterpart of populateConducting: one sunday_org_conducting row per
// (Sunday, organization) for every organization that has a rotation governing that Sunday.
//
// `ignoreDuplicates: true` is LOAD-BEARING, for exactly the reason it is in generateSundayRange.
// It makes this INSERT ... ON CONFLICT DO NOTHING, so a conductor a human typed is never
// overwritten by a later generation. The row IS the override (migration 024, Part 4); drop this
// option and every regeneration silently reverts every per-Sunday override in the range.
//
// A Sunday the organization's rotation does not yet govern gets NO row at all, rather than a row
// with a null user. "This organization has no rotation in force yet" and "this organization's
// rotation reaches this Sunday but the position is unfilled" are different facts, and the second
// one is what a null user_id means.
async function populateOrgConducting(
  supabase: SupabaseClient<Database>,
  wardId: string,
  range: SundayRange,
): Promise<void> {
  const rows = await listConductingRotation(wardId, {}, supabase);

  const byOrg = new Map<string, ConductingRotationRow[]>();
  for (const row of rows) {
    if (row.orgId === null) continue;
    const existing = byOrg.get(row.orgId);
    if (existing) {
      existing.push(row);
    } else {
      byOrg.set(row.orgId, [row]);
    }
  }

  if (byOrg.size === 0) return;

  const sundays = await listSundays(wardId, range, supabase);
  if (sundays.length === 0) return;

  // A Sunday with no meeting holds no organization meeting either, and the row's ABSENCE is how
  // that is written down — a null user_id already means something else (this organization's
  // rotation reaches this Sunday but the position is unfilled).
  //
  // Deleted as well as skipped: the Sunday may have become a stake conference after its month was
  // generated, in which case the rows are already there. sundays has a CHECK for the equivalent
  // rule; this table deliberately has none (migration 027, Part 3), so this is the enforcement.
  const cancelled = sundays.filter((sunday) => !holdsSacramentMeeting(sunday.type));
  if (cancelled.length > 0) {
    await deleteOrgConductingFor(
      supabase,
      wardId,
      cancelled.map((sunday) => sunday.id),
    );
  }

  const meetingSundays = sundays.filter((sunday) => holdsSacramentMeeting(sunday.type));
  if (meetingSundays.length === 0) return;

  const pending: Array<{
    ward_id: string;
    sunday_id: string;
    org_id: string;
    user_id: string | null;
  }> = [];

  for (const [orgId, orgRows] of byOrg) {
    const entries = toRotationEntries(orgRows);

    // One series per organization: each rotation has its own anchor, so each counts turns from
    // its own starting point over the same meeting history.
    const series = await seriesFor(
      supabase,
      wardId,
      earliestAnchorFor(entries, range.from),
      range.to,
    );

    for (const sunday of meetingSundays) {
      const active = activeRotation(entries, sunday.date);
      if (active.length === 0) continue;

      pending.push({
        ward_id: wardId,
        sunday_id: sunday.id,
        org_id: orgId,
        user_id: resolveConductingUser(sunday.date, entries, active[0].effectiveFrom, series),
      });
    }
  }

  if (pending.length === 0) return;

  const { error } = await supabase
    .from("sunday_org_conducting")
    .upsert(pending, { onConflict: "ward_id,sunday_id,org_id", ignoreDuplicates: true });

  if (error) {
    console.error(`Could not assign the organization conductors — ${error.message}`, {
      wardId,
      organizationCount: byOrg.size,
      rowCount: pending.length,
    });
    throw new Error(`Could not assign who conducts for each organization: ${error.message}`);
  }
}

export async function generateSundayRange(
  wardId: string,
  from: DateOnly,
  to: DateOnly,
  client?: SupabaseClient<Database>,
): Promise<GenerateRangeResult> {
  const supabase = await resolveClient(client);

  // Read ONCE per generation, not per Sunday. The ward's default is a setting the bishopric edits
  // in the app (lib/calendar/wardCalendarSettings.ts); apply_fast_sunday() reads the same value in
  // SQL when it restores a Sunday that stops being fast.
  const defaultSpeakingSlots = await readDefaultSpeakingSlots(wardId, supabase);

  const candidates = generateSundays(from, to, defaultSpeakingSlots);
  if (candidates.length === 0) return { created: 0, monthsResolved: 0 };

  // The conductor is resolved BEFORE the insert and written as part of it, rather than in a
  // second UPDATE afterwards. It can be: resolveConductingUser() needs only the DATE, and dates
  // are what generateSundays() just produced — row ids are not involved.
  //
  // This is what makes a new month arrive COMPLETE in one statement. The three writes that follow
  // are re-resolution and gap-filling for rows that already existed, so a request abandoned after
  // this insert — a browser navigating away mid-render, which is routine — leaves a correct month
  // rather than a blank one. Before this, skipping quickly through months left every skipped
  // month showing "Not set" until it was visited again.
  const rotationEntries = toRotationEntries(
    await listConductingRotation(wardId, { orgId: null }, supabase),
  );

  // The candidates are passed as overrides so the Sundays being inserted RIGHT NOW count in the
  // same walk as the ones already stored. Without that, a range containing general conference
  // would resolve its own conductors against a history that did not yet know it was cancelled.
  const candidateTypes = new Map<DateOnly, SundayType>(
    candidates.map((candidate) => [candidate.date, candidate.type]),
  );

  const series = await seriesFor(
    supabase,
    wardId,
    earliestAnchorFor(rotationEntries, from),
    to,
    candidateTypes,
  );

  const rows = candidates.map((candidate) => ({
    ward_id: wardId,
    date: candidate.date,
    type: candidate.type,
    speaking_slots: candidate.speakingSlots,
    conducting_user_id:
      rotationEntries.length === 0
        ? null
        : conductingUserFor(rotationEntries, candidate.date, series),
  }));

  // `ignoreDuplicates: true` is LOAD-BEARING. It makes this INSERT ... ON CONFLICT DO NOTHING,
  // which is the entire reason generation is idempotent and non-destructive. Drop it and the same
  // call becomes an overwrite that silently discards every bishopric edit in the range — notes,
  // hand-set types, conducting overrides, slot configs. This is the single most dangerous line in
  // the phase; do not "simplify" it.
  const { data, error } = await supabase
    .from("sundays")
    .upsert(rows, { onConflict: "ward_id,date", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error(`Could not generate Sundays — ${error.message}`, { wardId, from, to });
    throw new Error(`Could not generate the calendar: ${error.message}`);
  }

  // The count the DATABASE returned, never candidates.length. With ignoreDuplicates the returned
  // set is exactly the rows that were inserted, so re-generating an existing range reports 0
  // rather than claiming to have created what was already there.
  const created = (data ?? []).length;

  // Re-resolved against the months as they now stand, EXISTING ROWS INCLUDED. That is what lets a
  // range overlapping hand-edited months respect those edits instead of resolving only against
  // what this call happened to insert.
  const months = [...new Set(candidates.map((candidate) => monthOf(candidate.date)))];
  for (const month of months) {
    await resolveMonth(supabase, wardId, `${month}-01`);
  }

  // Still needed, and NOT redundant with the insert above: this range can overlap Sundays that
  // already existed — hand-created ones, or a month generated before the ward had a rotation —
  // and those rows are untouched by an insert that ignores duplicates.
  await populateConducting(supabase, wardId, { from, to });
  await populateOrgConducting(supabase, wardId, { from, to });

  return { created, monthsResolved: months.length };
}

// Generates the whole month when it has no rows, so nobody can view a month whose Sundays do not
// exist. This on-demand path is what makes the scheduled Edge Function 03-calendar.md asks for
// redundancy rather than a requirement (calendar-a Decision 1).
//
// It also REPAIRS a month that was generated but never finished — see the comment below.
export async function ensureMonthGenerated(
  wardId: string,
  anyDayInMonth: DateOnly,
  client?: SupabaseClient<Database>,
): Promise<Sunday[]> {
  const supabase = await resolveClient(client);

  const start = monthStart(anyDayInMonth);
  const end = lastDayOfMonth(start);
  const range = { from: start, to: end };

  const existing = await listSundays(wardId, range, supabase);

  if (existing.length === 0) {
    await generateSundayRange(wardId, start, end, supabase);
    return listSundays(wardId, range, supabase);
  }

  // A month whose rows exist is NOT necessarily a month that finished generating.
  // generateSundayRange() inserts the Sunday rows first and assigns conductors afterwards, and
  // @supabase/supabase-js has no transaction API, so a failure between the two — a dropped
  // connection, a schema that had drifted, a deploy mid-request — leaves the rows behind with no
  // conductor. Returning early on `existing.length > 0` then made that permanent: the month
  // looked generated forever, showed "Not set" on every Sunday, and nothing in the UI could
  // repair it. That is exactly what happened when migration 024 was still unapplied.
  //
  // Repairing is safe to do on a read because both passes only FILL GAPS. populateConducting()
  // touches rows whose conducting_user_id is still null, and populateOrgConducting() inserts with
  // ignoreDuplicates — neither can overwrite a conductor a human set, which is the guarantee
  // 03-calendar.md Step 3 rests on.
  //
  // Fast Sunday is repaired under a DELIBERATELY NARROW condition: the month has no Fast Sunday
  // at all, and at least one of its Sundays could be one. That combination is unreachable by any
  // legitimate edit — generateSundays() always picks one unless every Sunday is displaced, and
  // updateSunday() re-resolves on every type change — so it means the month never finished
  // generating. A month that genuinely has none (a stake conference weekend followed by general
  // conference) fails the second half of the test and is left alone, which is what keeps this
  // from re-running an RPC on every page view.
  //
  // Anything wider would be wrong. Re-resolving unconditionally MOVES a Sunday, and doing that on
  // a read would fight a bishopric who had just set a type.
  const needsFastSunday =
    !existing.some((sunday) => sunday.type === "fast_sunday") &&
    existing.some((sunday) => !FAST_SUNDAY_DISPLACING_TYPES.includes(sunday.type));

  // Narrowed to Sundays that HOLD A MEETING, and that narrowing is load-bearing. A cancelled
  // Sunday's conducting_user_id is now legitimately null forever — migration 027's CHECK refuses
  // any other value. The un-narrowed test would therefore see every month containing general
  // conference as half-generated and re-run two WRITE passes on every single page view of it,
  // twice a year, permanently. That is exactly the class of bug calendar-c's retro is about.
  const needsConducting = existing.some(
    (sunday) => holdsSacramentMeeting(sunday.type) && sunday.conductingUserId === null,
  );

  if (!needsFastSunday && !needsConducting) return existing;

  // Fast Sunday first: it rewrites `type` and `speaking_slots`, and the conducting passes should
  // run against the month as it will finally stand.
  if (needsFastSunday) {
    await resolveMonth(supabase, wardId, start);
  }

  if (needsConducting) {
    await populateConducting(supabase, wardId, range);
    await populateOrgConducting(supabase, wardId, range);
  }

  return listSundays(wardId, range, supabase);
}

// Fast Sunday has no speakers by definition, and a Sunday with no meeting has none because there
// is no meeting. One expression rather than two special cases, so a future no-meeting type gets
// the right answer without anyone remembering this line exists.
async function speakingSlotsForType(
  wardId: string,
  type: SundayType,
  supabase: SupabaseClient<Database>,
): Promise<number> {
  if (type === "fast_sunday" || !holdsSacramentMeeting(type)) return 0;

  return readDefaultSpeakingSlots(wardId, supabase);
}

export async function createSunday(
  wardId: string,
  input: CreateSundayInput,
  client?: SupabaseClient<Database>,
): Promise<Sunday> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("sundays")
    .insert({
      ward_id: wardId,
      date: input.date,
      type: input.type ?? "standard",
      notes: input.notes ?? null,
      speaking_slots: await speakingSlotsForType(
        wardId,
        input.type ?? "standard",
        supabase,
      ),
    })
    .select("id")
    .single();

  if (error) {
    console.error(`Could not create a Sunday — ${error.message}`, {
      wardId,
      date: input.date,
    });
    throw new Error(`Could not add that Sunday: ${error.message}`);
  }

  // A Sunday added by hand changes its month's resolution exactly like a generated one does.
  await resolveMonth(supabase, wardId, input.date);

  const created = await getSunday(wardId, data.id, supabase);
  if (!created) {
    throw new Error("The Sunday was created but could not be read back.");
  }

  return created;
}

// Counted through the SERVICE client, deliberately.
//
// `assignments` is a bishopric-only table under migration 019, but `calendar.manage` — which is
// what the route requires to get here — is also held by ward_secretary. Counting through the
// caller's client would return zero for a secretary, so they would edit a Sunday, see no warning,
// and silently orphan somebody's speakers. A warning only some roles can see is worse than none.
//
// The escalation is narrow on purpose: this reads a COUNT and writes a pipeline_stage. It never
// reads a talk topic, a request note, or a member name. Authorization already happened at
// assertCan() in the route, exactly as it does for notifyOtherBishopric().
//
// `aboveSlot` narrows the set: null means every assignment on the Sunday, a number means only the
// slots past the new count.
async function countWorkAtRisk(
  service: SupabaseClient<Database>,
  wardId: string,
  sundayId: string,
  aboveSlot: number | null,
): Promise<{ assignmentCount: number; prayerCount: number }> {
  let assignments = service
    .from("assignments")
    .select("id", { count: "exact", head: true })
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId);

  if (aboveSlot !== null) {
    assignments = assignments.gt("slot_number", aboveSlot);
  }

  const { count: assignmentCount, error: assignmentError } = await assignments;

  if (assignmentError) {
    console.error(
      `Could not count the Sunday's assignments — ${assignmentError.message}`,
      { wardId, sundayId },
    );
    throw new Error(
      `Could not check that Sunday's assignments: ${assignmentError.message}`,
    );
  }

  const { count: prayerCount, error: prayerError } = await service
    .from("prayer_assignments")
    .select("id", { count: "exact", head: true })
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId);

  if (prayerError) {
    console.error(`Could not count the Sunday's prayers — ${prayerError.message}`, {
      wardId,
      sundayId,
    });
    throw new Error(`Could not check that Sunday's prayers: ${prayerError.message}`);
  }

  return { assignmentCount: assignmentCount ?? 0, prayerCount: prayerCount ?? 0 };
}

function isUserId(value: string | null): value is string {
  return value !== null;
}

// What a planner is told when a calendar change voided their work. Worded from the REASON rather
// than assembled from the counts, exactly as buildWarningMessage is: the two sentences a user
// reads about one event have to agree, and rebuilding either from parts is the drift roster-c
// shipped twice.
function buildRevertMessage(
  reason: CalendarChangeReason,
  date: DateOnly,
  count: number,
): string {
  const speakers = `${count} speaking ${count === 1 ? "assignment" : "assignments"}`;
  const them = count === 1 ? "It is" : "They are";

  const because =
    reason === "meeting_cancelled"
      ? `because ${date} no longer holds a sacrament meeting`
      : reason === "fast_sunday_set" || reason === "fast_sunday_moved"
        ? `because ${date} became Fast Sunday`
        : `because ${date} now has fewer speaking slots`;

  return `${speakers} on ${date} went back to planning ${because}. ${them} not deleted, and ${
    count === 1 ? "it does" : "they do"
  } not count as a talk that was given.`;
}

// calendar-b left this gap open: the revert path voided somebody's planning work and told nobody,
// because no trigger key existed for it. Migration 025 adds `assignment_reverted`.
//
// Addressed to the PLANNERS when the rows record one, falling back to the trigger's own role list
// — bishop and counselor — when planned_by is null, which is the case for every assignment seeded
// before this column was being set.
//
// emitNotification never throws (it is one of exactly two sanctioned exceptions to CLAUDE.md
// rule 7), so a notification failure cannot fail a calendar change that has already committed.
async function notifyAssignmentsReverted(
  wardId: string,
  date: DateOnly,
  count: number,
  reason: CalendarChangeReason,
  plannerUserIds: readonly string[],
  client: SupabaseClient<Database>,
): Promise<void> {
  await emitNotification(
    {
      wardId,
      triggerKey: "assignment_reverted",
      title: "Speaking assignments went back to planning",
      body: buildRevertMessage(reason, date, count),
      // Omitted rather than passed as an empty array: emitNotification resolves the trigger's
      // default roles only when recipientUserIds is undefined, and an empty array would address
      // the notification to nobody at all.
      ...(plannerUserIds.length > 0 ? { recipientUserIds: [...plannerUserIds] } : {}),
    },
    client,
  );
}

// Reverted to 'plan', NEVER deleted. The planning work behind an assignment is somebody's
// (03-calendar.md §Pitfall 5), and a talk that did not happen must not read as one that did.
//
// Phase 4 MUST count speaker history from `pipeline_stage = 'complete'`, never from a row's mere
// existence — that is what makes a voided assignment genuinely not count toward any rotation.
// `counts_toward_rotation` is a different flag entirely: it says whether an assignment TYPE counts
// (a high council speaker does not count toward the ward's member rotation). Reusing it to mean
// "cancelled" would be a bug nobody could see. Recorded in plans/04-talks-pipeline.md.
//
// Runs BEFORE apply_fast_sunday(), so that function's own revert finds nothing left to do and the
// count reported to the user comes from exactly one place.
async function revertAssignmentsToPlan(
  service: SupabaseClient<Database>,
  wardId: string,
  sunday: Sunday,
  aboveSlot: number | null,
  reason: CalendarChangeReason,
): Promise<number> {
  // The planners are read BEFORE the update, because the update is what makes these rows
  // uninteresting: afterwards they are ordinary plan-stage assignments and nothing distinguishes
  // the ones this operation touched. Notifying the PLANNER is what 03-calendar.md asks for — the
  // person whose work was voided, not whoever happens to hold a role.
  let affected = service
    .from("assignments")
    .select("id, planned_by")
    .eq("ward_id", wardId)
    .eq("sunday_id", sunday.id)
    .neq("pipeline_stage", "plan");

  if (aboveSlot !== null) {
    affected = affected.gt("slot_number", aboveSlot);
  }

  const { data: before, error: beforeError } = await affected;

  if (beforeError) {
    console.error(`Could not read the Sunday's assignments — ${beforeError.message}`, {
      wardId,
      sundayId: sunday.id,
    });
    throw new Error(
      `Could not check those speakers before reverting them: ${beforeError.message}`,
    );
  }

  let query = service
    .from("assignments")
    .update({ pipeline_stage: "plan" })
    .eq("ward_id", wardId)
    .eq("sunday_id", sunday.id)
    .neq("pipeline_stage", "plan");

  if (aboveSlot !== null) {
    query = query.gt("slot_number", aboveSlot);
  }

  const { data, error } = await query.select("id");

  if (error) {
    console.error(`Could not revert the Sunday's assignments — ${error.message}`, {
      wardId,
      sundayId: sunday.id,
    });
    throw new Error(`Could not return those speakers to planning: ${error.message}`);
  }

  const reverted = (data ?? []).length;

  if (reverted > 0) {
    await notifyAssignmentsReverted(
      wardId,
      sunday.date,
      reverted,
      reason,
      [...new Set((before ?? []).map((row) => row.planned_by).filter(isUserId))],
      service,
    );
  }

  return reverted;
}

// Prayers are reported for context and NEVER block. A Sunday with no speakers still has an
// invocation and a benediction, so prayers are not orphaned by speaking_slots = 0 — speakers are
// (calendar-a Decision 4). A CANCELLED meeting is the one case where prayers genuinely are
// affected, and the sentence says so rather than claiming they are safe.
function buildWarningMessage(
  reason: CalendarChangeReason,
  date: DateOnly,
  assignmentCount: number,
  prayerCount: number,
  reshift: { sacrament: number; organizations: number },
): string {
  const speakers = `${assignmentCount} speaking ${
    assignmentCount === 1 ? "assignment" : "assignments"
  }`;
  const them = assignmentCount === 1 ? "it" : "them";

  const prayerNoun = `${prayerCount} prayer ${
    prayerCount === 1 ? "assignment" : "assignments"
  }`;

  const prayers =
    prayerCount === 0
      ? ""
      : reason === "meeting_cancelled"
        ? ` Its ${prayerNoun} will need rescheduling too.`
        : ` Its ${prayerNoun} will be left alone.`;

  const ending =
    `Confirming returns ${them} to the planning stage — nothing is deleted, and ` +
    `${assignmentCount === 1 ? "it does" : "they do"} not count as a talk that was ` +
    `given.${prayers}`;

  // APPENDED to whichever warning is shown, never queued as a second one. Confirming applies the
  // whole patch, so a consequence the user was not told about would break that promise — and the
  // existing code shows one warning at a time for exactly that reason.
  const reshuffle = buildReshiftSentence(reshift);

  switch (reason) {
    case "fast_sunday_moved":
      return `Fast Sunday would move to ${date}, which already has ${speakers}. ${ending}${reshuffle}`;
    case "meeting_cancelled":
      return `${date} would no longer hold a sacrament meeting, and it already has ${speakers}. ${ending}${reshuffle}`;
    case "fast_sunday_set":
      return `${date} would become Fast Sunday, which has no speakers, and it already has ${speakers}. ${ending}${reshuffle}`;
    case "slots_reduced":
      return `${date} would have fewer speaking slots than the ${speakers} already in them. ${ending}${reshuffle}`;
    // The re-shift is the ONLY consequence: nobody's speaking assignment is at risk, so there is
    // no `ending` to append to and the sentence stands on its own.
    case "conducting_reshuffled":
      return `Changing ${date} re-shuffles the conducting rotation.${reshuffle}`;
  }
}

// The sentence a re-shift adds. Leading space because it is appended to a finished sentence, and
// empty when nothing moves so no caller has to remember to check first.
function buildReshiftSentence(reshift: {
  sacrament: number;
  organizations: number;
}): string {
  if (reshift.sacrament === 0 && reshift.organizations === 0) return "";

  const sundays = `${reshift.sacrament} later ${
    reshift.sacrament === 1 ? "Sunday" : "Sundays"
  }`;

  const organizations =
    reshift.organizations === 0
      ? ""
      : ` ${reshift.organizations} organization conducting ${
          reshift.organizations === 1 ? "assignment" : "assignments"
        } will move too.`;

  if (reshift.sacrament === 0) {
    return `${organizations} Sundays already past are left alone.`;
  }

  return ` Who conducts will also change on ${sundays}.${organizations} Sundays already past are left alone.`;
}

export type ConductingReshift = {
  sundayId: string;
  date: DateOnly;
  userId: string | null;
};

export type OrgConductingReshift = ConductingReshift & { orgId: string };

// Who conducts on LATER Sundays, recomputed as if this patch had already landed.
//
// Marking a Sunday cancelled after its month was generated has to re-resolve the Sundays after
// it, or the skip would only ever work for general conference — which generateSundays() predicts
// ahead of time — and never for stake conference, which is always hand-set after the fact and is
// the case this exists for.
//
// THE COST, STATED PLAINLY: this can overwrite a per-Sunday conducting override. Migration 024
// records that storage IS the override — there is no is_override flag — so nothing in the data
// model distinguishes a conductor a human typed from one the rotation assigned. The mitigations
// are that the user is warned first with an exact count and nothing is written until they
// confirm, that only rows whose recomputed conductor DIFFERS are returned, and that the past is
// never rewritten. A conducting_source column would let this protect hand-set conductors; that is
// a known gap and deliberately not in this change.
//
// `today` is a PARAMETER, defaulted at the call boundary, never a new Date() in here — the
// convention lib/calendar/dates.ts sets for every month helper, and what makes this testable
// without freezing a clock.
async function planConductingReshift(
  supabase: SupabaseClient<Database>,
  wardId: string,
  editedDate: DateOnly,
  projectedTypes: ReadonlyMap<DateOnly, SundayType>,
  today: DateOnly,
): Promise<{ sacrament: ConductingReshift[]; organizations: OrgConductingReshift[] }> {
  // Strictly after the edited Sunday AND on or after today. The second half is what keeps the
  // past intact: who conducted last March stays what it says, which is the doctrine
  // conducting_user_id is a stored column for at all (03-calendar.md Step 3).
  const horizonFrom = editedDate > today ? editedDate : today;

  const laterSundays = (
    await listSundays(wardId, { from: horizonFrom, to: RESHIFT_HORIZON_END }, supabase)
  ).filter((sunday) => sunday.date > editedDate && sunday.date >= today);

  const meetingSundays = laterSundays.filter((sunday) =>
    holdsSacramentMeeting(sunday.type),
  );

  if (meetingSundays.length === 0) return { sacrament: [], organizations: [] };

  const latestTarget = meetingSundays[meetingSundays.length - 1].date;
  const allRotationRows = await listConductingRotation(wardId, {}, supabase);

  const sacrament: ConductingReshift[] = [];
  const bishopricEntries = toRotationEntries(
    allRotationRows.filter((row) => row.orgId === null),
  );

  if (bishopricEntries.length > 0) {
    const series = await seriesFor(
      supabase,
      wardId,
      earliestAnchorFor(bishopricEntries, editedDate),
      latestTarget,
      projectedTypes,
    );

    for (const sunday of meetingSundays) {
      const userId = conductingUserFor(bishopricEntries, sunday.date, series);
      if (userId === sunday.conductingUserId) continue;

      sacrament.push({ sundayId: sunday.id, date: sunday.date, userId });
    }
  }

  const organizations = await planOrgConductingReshift(
    supabase,
    wardId,
    allRotationRows,
    meetingSundays,
    editedDate,
    latestTarget,
    projectedTypes,
  );

  return { sacrament, organizations };
}

async function planOrgConductingReshift(
  supabase: SupabaseClient<Database>,
  wardId: string,
  allRotationRows: ConductingRotationRow[],
  meetingSundays: Sunday[],
  editedDate: DateOnly,
  latestTarget: DateOnly,
  projectedTypes: ReadonlyMap<DateOnly, SundayType>,
): Promise<OrgConductingReshift[]> {
  const byOrg = new Map<string, ConductingRotationRow[]>();
  for (const row of allRotationRows) {
    if (row.orgId === null) continue;
    const existing = byOrg.get(row.orgId);
    if (existing) {
      existing.push(row);
    } else {
      byOrg.set(row.orgId, [row]);
    }
  }

  if (byOrg.size === 0) return [];

  const sundayIds = meetingSundays.map((sunday) => sunday.id);

  const { data, error } = await supabase
    .from("sunday_org_conducting")
    .select(ORG_CONDUCTING_COLUMNS)
    .eq("ward_id", wardId)
    .in("sunday_id", sundayIds);

  if (error) {
    console.error(`Could not read the organization conductors — ${error.message}`, {
      wardId,
      sundayCount: sundayIds.length,
    });
    throw new Error(`Could not read who conducts for each organization: ${error.message}`);
  }

  // Only rows that EXIST are re-shifted. A (Sunday, organization) pair with no row means that
  // organization's rotation does not reach that Sunday, which this change must not invent.
  const stored = new Map<string, string | null>();
  for (const row of data ?? []) stored.set(orgRowKey(row.sunday_id, row.org_id), row.user_id);

  const reshift: OrgConductingReshift[] = [];

  for (const [orgId, orgRows] of byOrg) {
    const entries = toRotationEntries(orgRows);

    const series = await seriesFor(
      supabase,
      wardId,
      earliestAnchorFor(entries, editedDate),
      latestTarget,
      projectedTypes,
    );

    for (const sunday of meetingSundays) {
      const key = orgRowKey(sunday.id, orgId);
      if (!stored.has(key)) continue;

      const active = activeRotation(entries, sunday.date);
      if (active.length === 0) continue;

      const userId = resolveConductingUser(
        sunday.date,
        entries,
        active[0].effectiveFrom,
        series,
      );
      if (userId === stored.get(key)) continue;

      reshift.push({ sundayId: sunday.id, date: sunday.date, orgId, userId });
    }
  }

  return reshift;
}

function orgRowKey(sundayId: string, orgId: string): string {
  return `${sundayId}:${orgId}`;
}

// Applying the plan the user was warned about, and EXACTLY that plan — the rows written are the
// ones counted, from one computation (the discipline Pitfall 4 records).
async function applyConductingReshift(
  supabase: SupabaseClient<Database>,
  wardId: string,
  plan: { sacrament: ConductingReshift[]; organizations: OrgConductingReshift[] },
): Promise<void> {
  // Batched by user id, the way populateConducting() already does: a year of Sundays is three
  // round trips rather than fifty-two.
  const byUser = new Map<string | null, string[]>();
  for (const row of plan.sacrament) {
    const existing = byUser.get(row.userId);
    if (existing) {
      existing.push(row.sundayId);
    } else {
      byUser.set(row.userId, [row.sundayId]);
    }
  }

  for (const [userId, sundayIds] of byUser) {
    const { error } = await supabase
      .from("sundays")
      .update({ conducting_user_id: userId })
      .eq("ward_id", wardId)
      .in("id", sundayIds);

    if (error) {
      console.error(`Could not re-shift who conducts — ${error.message}`, {
        wardId,
        userId,
        sundayCount: sundayIds.length,
      });
      throw new Error(`Could not update who conducts on the later Sundays: ${error.message}`);
    }
  }

  if (plan.organizations.length === 0) return;

  const { error } = await supabase.from("sunday_org_conducting").upsert(
    plan.organizations.map((row) => ({
      ward_id: wardId,
      sunday_id: row.sundayId,
      org_id: row.orgId,
      user_id: row.userId,
    })),
    { onConflict: "ward_id,sunday_id,org_id" },
  );

  if (error) {
    console.error(`Could not re-shift the organization conductors — ${error.message}`, {
      wardId,
      rowCount: plan.organizations.length,
    });
    throw new Error(`Could not update who conducts for each organization: ${error.message}`);
  }
}

// What this patch would void ON THE SUNDAY BEING EDITED, worked out before anything is written.
function assessEditedSunday(
  before: Sunday,
  input: UpdateSundayInput,
): { reason: CalendarChangeReason; aboveSlot: number | null } | null {
  const nextType = input.type ?? before.type;

  // holdsSacramentMeeting(), NOT FAST_SUNDAY_DISPLACING_TYPES. These two questions used to share
  // one list, and reading the wrong one here is what made marking a Sunday `holiday` warn that
  // its speakers were being orphaned when the ward still meets — and what would have made
  // `ward_conference` cancel a meeting it holds perfectly normally. The locals are named for the
  // question being asked so the next reader cannot mistake which list they wanted.
  const heldMeeting = holdsSacramentMeeting(before.type);
  const willHoldMeeting = holdsSacramentMeeting(nextType);

  // The meeting itself goes away. Everything on it is at risk, prayers included.
  if (heldMeeting && !willHoldMeeting) {
    return { reason: "meeting_cancelled", aboveSlot: null };
  }

  // Fast Sunday has no speakers by definition.
  if (nextType === "fast_sunday" && before.type !== "fast_sunday") {
    return { reason: "fast_sunday_set", aboveSlot: null };
  }

  // A straight cut to the slot count. Only the speakers past the new number are at risk.
  if (input.speakingSlots !== undefined && input.speakingSlots < before.speakingSlots) {
    return { reason: "slots_reduced", aboveSlot: input.speakingSlots };
  }

  return null;
}

// Applies the patch AND re-resolves the month. The resolution lives here rather than in the route
// so a future caller cannot patch a type and skip the rule (03-calendar.md Step 4).
//
// The collision check runs BEFORE the patch, not after. Checking afterwards would mean rolling
// back a write @supabase/supabase-js has no transaction API to roll back — so on
// "needs_confirmation" nothing has been written at all.
//
// Returns null when the Sunday is not this ward's, which the route turns into a 404.
export async function updateSunday(
  wardId: string,
  sundayId: string,
  input: UpdateSundayInput,
  opts?: { confirm?: boolean; today?: DateOnly },
  client?: SupabaseClient<Database>,
): Promise<UpdateSundayResult | null> {
  const supabase = await resolveClient(client);

  const before = await getSunday(wardId, sundayId, supabase);
  if (!before) return null;

  // Defaulted HERE, at the call boundary, so planConductingReshift() stays a pure function of its
  // arguments and a test can hand it a date rather than freezing a clock.
  const today = opts?.today ?? formatDateOnly(new Date());

  const changesResolution =
    input.type !== undefined || input.fastSundayPinned !== undefined;

  const nextType = input.type ?? before.type;
  const heldMeeting = holdsSacramentMeeting(before.type);
  const willHoldMeeting = holdsSacramentMeeting(nextType);

  const start = monthStart(before.date);
  const monthRange = { from: start, to: lastDayOfMonth(start) };

  const service = createServiceSupabaseClient();

  // Everything this patch would void, worked out BEFORE anything is written. There is no
  // transaction API to roll back, so "needs_confirmation" has to mean nothing was written at all.
  //
  // Two independent risks, and a single patch can carry both: the Sunday being edited may lose
  // its meeting or its slots, and Fast Sunday may re-resolve onto a different Sunday that already
  // has speakers. Each is recorded here with the exact set of assignments it puts at risk, so the
  // count that warns and the rows that get reverted come from the same filter (Pitfall 4).
  const atRisk: Array<{
    reason: CalendarChangeReason;
    sunday: Sunday;
    fromDate: DateOnly | null;
    aboveSlot: number | null;
  }> = [];

  const editedImpact = assessEditedSunday(before, input);
  if (editedImpact) {
    atRisk.push({
      reason: editedImpact.reason,
      sunday: before,
      fromDate: null,
      aboveSlot: editedImpact.aboveSlot,
    });
  }

  if (changesResolution) {
    const monthSundays = await listSundays(wardId, monthRange, supabase);

    // The month as it WOULD be, patched in memory.
    const projected = toCandidates(monthSundays).map((candidate) =>
      candidate.id === sundayId
        ? {
            ...candidate,
            type: input.type ?? candidate.type,
            fastSundayPinned: input.fastSundayPinned ?? candidate.fastSundayPinned,
          }
        : candidate,
    );

    const nextFastId = resolveFastSunday(projected);
    const fastBefore = currentFastSunday(monthSundays);

    if (nextFastId !== null && nextFastId !== (fastBefore?.id ?? null)) {
      const target = monthSundays.find((sunday) => sunday.id === nextFastId);

      // Skipped when the target is the Sunday being edited — its impact is already recorded above
      // and one change must never produce two warnings about the same speakers.
      if (target && target.id !== sundayId) {
        atRisk.push({
          reason: "fast_sunday_moved",
          sunday: target,
          fromDate: fastBefore?.date ?? null,
          aboveSlot: null,
        });
      }
    }
  }

  // The re-shift is planned BEFORE any write, alongside the at-risk assessment, and the plan that
  // is stored here is the plan that gets applied. The count that warns and the rows that change
  // therefore come from one computation rather than two that can disagree (Pitfall 4).
  //
  // Only a type change can move who conducts: it is the only patch field that can change whether
  // a Sunday holds a meeting, which is what the rotation now counts.
  const reshiftPlan =
    input.type !== undefined && input.type !== before.type
      ? await planConductingReshift(
          supabase,
          wardId,
          before.date,
          new Map([[before.date, nextType]]),
          today,
        )
      : { sacrament: [], organizations: [] };

  const reshiftCounts = {
    sacrament: reshiftPlan.sacrament.length,
    organizations: reshiftPlan.organizations.length,
  };
  const reshiftTotal = reshiftCounts.sacrament + reshiftCounts.organizations;

  // Counted through the service client so a ward_secretary sees the same warning a bishop does.
  const counted = [];
  for (const risk of atRisk) {
    const counts = await countWorkAtRisk(
      service,
      wardId,
      risk.sunday.id,
      risk.aboveSlot,
    );
    if (counts.assignmentCount > 0) counted.push({ ...risk, ...counts });
  }

  // Only assignments block. Prayers are reported alongside for context and never stop a change
  // (calendar-a Decision 4).
  if ((counted.length > 0 || reshiftTotal > 0) && opts?.confirm !== true) {
    // One warning at a time, the edited Sunday first because it is the change the user actually
    // made. Confirming applies the whole patch, so a second warning is not shown for the same
    // submission — the message names what is being returned to planning, and the re-shift rides
    // inside that same sentence.
    //
    // When nothing is at risk the re-shift stands alone: the user is still told that who conducts
    // is about to move for people who have already been asked.
    const first = counted[0];

    const warned = first
      ? { reason: first.reason, sunday: first.sunday, fromDate: first.fromDate,
          assignmentCount: first.assignmentCount, prayerCount: first.prayerCount }
      : { reason: "conducting_reshuffled" as const, sunday: before, fromDate: null,
          assignmentCount: 0, prayerCount: 0 };

    return {
      status: "needs_confirmation",
      warning: {
        reason: warned.reason,
        sundayId: warned.sunday.id,
        date: warned.sunday.date,
        monthStart: start,
        fromDate: warned.fromDate,
        assignmentCount: warned.assignmentCount,
        prayerCount: warned.prayerCount,
        conductingReshiftCount: reshiftCounts.sacrament,
        orgConductingReshiftCount: reshiftCounts.organizations,
        message: buildWarningMessage(
          warned.reason,
          warned.sunday.date,
          warned.assignmentCount,
          warned.prayerCount,
          reshiftCounts,
        ),
      },
    };
  }

  // Confirmed. Revert BEFORE the patch and before apply_fast_sunday(), so that function's own
  // revert finds nothing left to do and the number reported to the user comes from one place.
  let assignmentsReverted = 0;
  for (const risk of counted) {
    assignmentsReverted += await revertAssignmentsToPlan(
      service,
      wardId,
      risk.sunday,
      risk.aboveSlot,
      risk.reason,
    );
  }

  // What the speaking slots become. An explicit count always wins; otherwise this is the ONE
  // place that decides, so the fast-Sunday case and the no-meeting case cannot drift apart.
  //
  // The restore branch covers two ways a Sunday can arrive at "it holds an ordinary meeting now
  // and it did not before":
  //
  //   general_conference -> ward_conference   it had no meeting at all
  //   fast_sunday        -> ward_conference   it met, but Fast Sunday has no speakers
  //
  // The second one CANNOT be left to apply_fast_sunday(). That function restores the ward default
  // only on rows still typed 'fast_sunday' (migration 023, Step 1), and the UPDATE below changes
  // the type in the same statement — so by the time it runs there is nothing for it to match, and
  // the Sunday would keep 0 slots forever. Before ward_conference existed the same gap was
  // reachable through `special` and simply never came up.
  //
  // The known limitation is inherited deliberately: a HAND-SET slot count does not survive the
  // round trip, exactly as migration 023 documents for the path it owns
  // (plans/retros/calendar-a-rules-and-api.md).
  const willBeFastSunday = nextType === "fast_sunday";
  const stoppedBeingFastSunday = before.type === "fast_sunday" && !willBeFastSunday;

  let speakingSlotsPatch: number | undefined;

  if (input.speakingSlots !== undefined) {
    speakingSlotsPatch = input.speakingSlots;
  } else if (heldMeeting && !willHoldMeeting) {
    speakingSlotsPatch = 0;
  } else if (willHoldMeeting && !willBeFastSunday && (!heldMeeting || stoppedBeingFastSunday)) {
    speakingSlotsPatch = await readDefaultSpeakingSlots(wardId, supabase);
  }

  // Who conducts, decided ONCE — and the no-meeting rule OUTRANKS the submitted value.
  //
  // This has to be one decision rather than two spreads into the same object. SundayEditor sends
  // the whole form on every save, so a patch that changes the type to a conference arrives WITH
  // the conductor still selected in the dropdown; a later spread of input.conductingUserId then
  // silently overwrote the clear and the write hit migration 027's CHECK. A user cannot fix that
  // by choosing "Nobody" first, because the type and the conductor travel together.
  //
  // The precedence is not a convenience: a Sunday that holds no sacrament meeting HAS no
  // conductor, whatever the form happened to be showing when it was submitted.
  //
  // It is cleared IN THE SAME STATEMENT as the type change, or the CHECK raises — which is the
  // intended behaviour, a loud failure rather than a silent wrong answer, and why this cannot be
  // a tidy second UPDATE afterwards.
  const clearsConductor = heldMeeting && !willHoldMeeting;

  const conductingUserIdPatch = clearsConductor
    ? null
    : input.conductingUserId !== undefined
      ? (input.conductingUserId ?? null)
      : undefined;

  const { data, error } = await supabase
    .from("sundays")
    .update({
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(conductingUserIdPatch !== undefined
        ? { conducting_user_id: conductingUserIdPatch }
        : {}),
      ...(speakingSlotsPatch !== undefined ? { speaking_slots: speakingSlotsPatch } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      ...(input.slotConfig !== undefined
        ? { slot_config: toSlotConfigJson(input.slotConfig ?? null) }
        : {}),
      ...(input.presidingOverride !== undefined
        ? { presiding_override: input.presidingOverride ?? null }
        : {}),
      ...(input.fastSundayPinned !== undefined
        ? { fast_sunday_pinned: input.fastSundayPinned }
        : {}),
    })
    .eq("ward_id", wardId)
    .eq("id", sundayId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`Could not update a Sunday — ${error.message}`, { wardId, sundayId });
    throw new Error(`Could not update that Sunday: ${error.message}`);
  }

  // An UPDATE denied by policy comes back as success with zero rows, not an error, so this is the
  // RLS refusal and the wrong-ward case at once. Both mean "not yours".
  if (!data) return null;

  if (changesResolution) {
    await resolveMonth(supabase, wardId, before.date);
  }

  // The organization side of the no-meeting rule, in both directions. sundays has a CHECK for its
  // half; sunday_org_conducting deliberately has none (migration 027, Part 3), so this is where
  // the rule is kept.
  if (heldMeeting && !willHoldMeeting) {
    await deleteOrgConductingFor(supabase, wardId, [sundayId]);
  } else if (!heldMeeting && willHoldMeeting) {
    // Now that it holds a meeting again it needs a conductor and its organization rows. Both
    // passes only fill gaps, so neither can overwrite anything a human set.
    await populateConducting(supabase, wardId, monthRange);
    await populateOrgConducting(supabase, wardId, monthRange);
  }

  // Exactly the plan the user was warned about, applied after the patch and after the Fast Sunday
  // resolution so it writes over the month as it finally stands.
  await applyConductingReshift(supabase, wardId, reshiftPlan);

  // Read back AFTER the resolution: apply_fast_sunday may have changed this row's own type and
  // speaking_slots, and returning the pre-resolution row would show the user a state that lasted
  // for one statement.
  const sunday = await getSunday(wardId, sundayId, supabase);
  if (!sunday) return null;

  return {
    status: "applied",
    sunday,
    assignmentsReverted,
    conductingReshiftCount: reshiftCounts.sacrament,
    orgConductingReshiftCount: reshiftCounts.organizations,
  };
}

// Who may be picked to conduct, and the source of every name the calendar renders. Bishop and
// counselor only — conducting is a bishopric assignment, so a ward_secretary who may EDIT the
// Sunday still cannot put themselves in the conducting slot.
//
// Read through the caller's client: migration 020 makes `users` ward-readable, so no escalation is
// needed and RLS stays the boundary (CLAUDE.md rule 2).
export async function listBishopricUsers(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<BishopricUser[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("users")
    .select("id, first_name, last_name, role, counselor_position")
    .eq("ward_id", wardId)
    .in("role", BISHOPRIC_ROLES as unknown as string[])
    .eq("is_active", true)
    .order("role")
    .order("counselor_position", { nullsFirst: true });

  if (error) {
    console.error(`Could not read the bishopric — ${error.message}`, { wardId });
    throw new Error(`Could not read the bishopric: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role === "bishop" ? "bishop" : "counselor",
    counselorPosition:
      row.counselor_position === 1 || row.counselor_position === 2
        ? row.counselor_position
        : null,
  }));
}

// Who may be picked to conduct an ORGANIZATION's meeting: the president, their counselors and
// the secretary of that organization. `orgId` omitted reads every organization in the ward, which
// is what a page needs to turn a stored id into a name for organizations the viewer cannot manage.
//
// Read through the caller's client, like listBishopricUsers: migration 020 makes `users`
// ward-readable, so no escalation is needed and RLS stays the boundary (CLAUDE.md rule 2).
export async function listOrgLeadershipUsers(
  wardId: string,
  orgId?: string,
  client?: SupabaseClient<Database>,
): Promise<OrgLeadershipUser[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("users")
    .select("id, first_name, last_name, role, org_id")
    .eq("ward_id", wardId)
    .in("role", ORG_LEADERSHIP_ROLES as unknown as string[])
    .eq("is_active", true)
    .not("org_id", "is", null);

  if (orgId !== undefined) {
    query = query.eq("org_id", orgId);
  }

  const { data, error } = await query.order("role").order("last_name");

  if (error) {
    console.error(`Could not read the organization leadership — ${error.message}`, {
      wardId,
      orgId,
    });
    throw new Error(`Could not read the organization's leadership: ${error.message}`);
  }

  return (data ?? [])
    .filter((row) => row.org_id !== null)
    .map((row) => ({
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      role: toEnumValue(row.role, ORG_LEADERSHIP_ROLES, "users.role", "002"),
      orgId: row.org_id as string,
    }));
}

// The organizations that may hold a conducting rotation of their own — the six with a presidency.
// `bishopric` is excluded because its rotation IS the sacrament-meeting one, keyed by a NULL
// org_id, and `other` because it has no presidency to rotate (ROTATION_ELIGIBLE_ORG_TYPES).
export async function listRotationOrganizations(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<RotationOrganization[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, type")
    .eq("ward_id", wardId)
    .eq("is_active", true)
    .order("name");

  if (error) {
    console.error(`Could not read the ward's organizations — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's organizations: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: toEnumValue(row.type, ORGANIZATION_TYPES, "organizations.type", "002"),
    }))
    .filter((organization) => ROTATION_ELIGIBLE_ORG_TYPES.includes(organization.type));
}

// The full name, never an honorific. `users` records no gender, so "Bro." would be a guess this
// module cannot make — and a wrong one on a bishopric member's name is worse than a plain name.
export function conductingDisplayName(user: ConductingCandidate): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || "Unnamed account";
}

export function bishopricDisplayName(user: BishopricUser): string {
  return conductingDisplayName(user);
}

// id → name, which is all any calendar component needs. Passing the map rather than the user list
// keeps ConductingLabel from having to know what a bishopric or an org leadership user is — and
// it lets one map cover the sacrament meeting and every organization on the same page.
export function conductingNameMap(users: ConductingCandidate[]): Record<string, string> {
  return Object.fromEntries(users.map((user) => [user.id, conductingDisplayName(user)]));
}

// For the notification body only, so a failure here degrades the message rather than failing an
// edit that has already committed. It is logged, not swallowed — the same rule
// readHouseholdNames() follows in lib/roster/csv/applyImport.ts.
export async function readConductorName(
  wardId: string,
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<string | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("users")
    .select("first_name, last_name")
    .eq("ward_id", wardId)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the conductor's name — ${error.message}`, {
      wardId,
      userId,
    });
    return null;
  }

  if (!data) return null;

  return [data.first_name, data.last_name].filter(Boolean).join(" ") || null;
}

// Inserts a NEW set of three rows at a new effective_from. It never updates the old set — that is
// what makes "a rotation change applies forward only" true by construction rather than by
// everyone remembering to (migration 023, Part 2).
//
// The cadence is written on all three rows in this ONE insert, which is what guarantees the
// invariant no CHECK constraint can express: the three rows of a set always agree. There is
// deliberately no per-row cadence write anywhere in this module — changing the cadence is
// inserting a new set, so a cadence change is forward-only by the same construction and not by a
// second mechanism somebody has to keep in step (migration 024, Part 1).
export async function replaceConductingRotation(
  wardId: string,
  input: ConductingRotationInput,
  client?: SupabaseClient<Database>,
): Promise<ConductingRotationRow[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("conducting_rotation")
    .insert(
      input.positions.map((entry) => ({
        ward_id: wardId,
        org_id: input.orgId,
        position: entry.position,
        user_id: entry.userId,
        effective_from: input.effectiveFrom,
        cadence: input.cadence,
      })),
    )
    .select(ROTATION_COLUMNS);

  if (error) {
    // 23505 is unique_violation. The constraint from migration 024 is doing its job, so this is
    // the user picking a date that already has a rotation — a 409, never a 500. The organization
    // travels with it because one ward now holds up to seven independent rotations.
    if (error.code === "23505") {
      throw new ConductingRotationConflictError(input.effectiveFrom, input.orgId);
    }

    console.error(`Could not save the conducting rotation — ${error.message}`, {
      wardId,
      orgId: input.orgId,
      effectiveFrom: input.effectiveFrom,
    });
    throw new Error(`Could not save the conducting rotation: ${error.message}`);
  }

  return (data ?? []).map(mapRotationRow);
}
