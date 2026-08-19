import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MAX_SPEAKING_SLOTS } from "@/lib/validation/calendar";
import type { Database, Json } from "@/types/database";

// How many speakers a newly generated Sunday gets. A WARD SETTING the bishopric edits in the app,
// not a constant somebody has to change in code — a ward that runs 5 speakers, or 2, sets it once
// and every Sunday generated afterwards follows.
//
// Stored in wards.settings, which is jsonb and already holds cross_org_visibility, timezone and
// role_access. No migration and no new column.
//
// Reading follows mergeRoleAccess() in lib/auth/permissions.ts exactly: a missing, malformed or
// out-of-range value warns and falls back rather than throwing. A bad setting must not be able to
// take the calendar down. apply_fast_sunday() (migration 023) applies the same rule in SQL, and
// the two fallbacks must stay in step.

export const FALLBACK_SPEAKING_SLOTS = 3;

const SETTINGS_KEY = "default_speaking_slots";

export function parseDefaultSpeakingSlots(settings: unknown): number {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    return FALLBACK_SPEAKING_SLOTS;
  }

  const raw = (settings as Record<string, unknown>)[SETTINGS_KEY];
  if (raw === undefined || raw === null) return FALLBACK_SPEAKING_SLOTS;

  if (
    typeof raw !== "number" ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > MAX_SPEAKING_SLOTS
  ) {
    console.warn(
      `wards.settings.${SETTINGS_KEY} holds ${JSON.stringify(raw)}, which is not a whole ` +
        `number between 1 and ${MAX_SPEAKING_SLOTS}; falling back to ${FALLBACK_SPEAKING_SLOTS}.`,
    );
    return FALLBACK_SPEAKING_SLOTS;
  }

  return raw;
}

async function readWardSettings(
  supabase: SupabaseClient<Database>,
  wardId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("wards")
    .select("settings")
    .eq("id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the ward's settings — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's settings: ${error.message}`);
  }

  const settings = data?.settings;
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }

  return settings as Record<string, unknown>;
}

// Falls back rather than throwing, unlike resolveRoleAccess(): this value decides how many
// speaking slots a new Sunday gets, so failing open is a wrong number on a calendar, not a
// widened permission.
export async function readDefaultSpeakingSlots(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = client ?? (await createServerSupabaseClient());

  try {
    return parseDefaultSpeakingSlots(await readWardSettings(supabase, wardId));
  } catch (error) {
    console.error("Falling back to the default speaking slot count", { wardId, error });
    return FALLBACK_SPEAKING_SLOTS;
  }
}

// MERGES into the existing settings object rather than replacing it. wards.settings also holds
// role_access, cross_org_visibility and timezone, and a wholesale write here would silently
// delete a ward's permission overrides — the worst possible side effect of changing a speaker
// count.
export async function writeDefaultSpeakingSlots(
  wardId: string,
  defaultSpeakingSlots: number,
  client?: SupabaseClient<Database>,
): Promise<number> {
  const supabase = client ?? (await createServerSupabaseClient());

  const existing = await readWardSettings(supabase, wardId);

  const { data, error } = await supabase
    .from("wards")
    .update({
      settings: {
        ...existing,
        [SETTINGS_KEY]: defaultSpeakingSlots,
      } as unknown as Json,
    })
    .eq("id", wardId)
    .select("settings")
    .maybeSingle();

  if (error) {
    console.error(`Could not save the ward's calendar settings — ${error.message}`, {
      wardId,
    });
    throw new Error(`Could not save the calendar settings: ${error.message}`);
  }

  // wards_update (migration 019) is bishopric-only, and an UPDATE denied by policy is a zero-row
  // success rather than an error. Unlike `sundays`, RLS genuinely is a boundary on this table.
  if (!data) {
    throw new Error("Could not save the calendar settings: the ward refused the change.");
  }

  return parseDefaultSpeakingSlots(data.settings);
}
