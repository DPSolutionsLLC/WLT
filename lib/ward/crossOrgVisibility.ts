import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

// Whether one organization's leaders may READ another organization's visit reports.
//
// A WARD SETTING the bishopric edits in the app. Stored in wards.settings, which is jsonb and
// already holds role_access, timezone and default_speaking_slots. No migration and no new column.
//
// ---------------------------------------------------------------------------
// THE RULE IS ENFORCED IN SQL, NOT HERE
// ---------------------------------------------------------------------------
// `ward_allows_cross_org_visibility()` (migration 019) reads this key and visit_logs_select ORs
// it in. This module builds the SWITCH; the policy is the boundary (CLAUDE.md rule 2). Nothing
// above this file should ever branch on the value to decide what a caller may read — the query
// already returns the right rows.
//
// It widens READS ONLY. No insert, update or delete policy mentions the function, and
// tests/rls/visit-cross-org.test.ts proves that in both modes.
//
// Reading follows parseDefaultSpeakingSlots() in lib/calendar/wardCalendarSettings.ts and
// mergeRoleAccess() in lib/auth/permissions.ts: a missing or malformed value warns and falls
// back rather than throwing. FAILING CLOSED IS THE RIGHT DIRECTION HERE — a bad setting must
// narrow what people can see, never widen it — which is why the fallback is `false` and not a
// configurable default.

export const FALLBACK_CROSS_ORG_VISIBILITY = false;

const SETTINGS_KEY = "cross_org_visibility";

// STORES A JSON BOOLEAN. The SQL side compares `(settings ->> 'cross_org_visibility') = 'true'`,
// and `->>` renders a JSON boolean as the text 'true', so a boolean works — and so, by accident,
// does the string "true". Write the boolean.
//
// Do NOT "fix" the SQL function to cast instead: its header explains that comparing against the
// literal string is deliberate, so a malformed value reads as off rather than raising inside a
// policy and breaking every query that touches visit_logs.
export function parseCrossOrgVisibility(settings: unknown): boolean {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    return FALLBACK_CROSS_ORG_VISIBILITY;
  }

  const raw = (settings as Record<string, unknown>)[SETTINGS_KEY];
  if (raw === undefined || raw === null) return FALLBACK_CROSS_ORG_VISIBILITY;

  if (typeof raw === "boolean") return raw;

  // The string form the SQL function also accepts. Read rather than warned about, so a ward
  // configured by hand before this screen existed does not read as "off" in the app while the
  // policy reads it as "on" — two answers to the same question is worse than either answer.
  if (raw === "true") return true;
  if (raw === "false") return false;

  console.warn(
    `wards.settings.${SETTINGS_KEY} holds ${JSON.stringify(raw)}, which is not a boolean; ` +
      `falling back to ${FALLBACK_CROSS_ORG_VISIBILITY}.`,
  );
  return FALLBACK_CROSS_ORG_VISIBILITY;
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

// Falls back rather than throwing, for the same reason readDefaultSpeakingSlots does: a settings
// read that failed must not take the visits pages down. The fallback is the closed direction.
export async function readCrossOrgVisibility(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = client ?? (await createServerSupabaseClient());

  try {
    return parseCrossOrgVisibility(await readWardSettings(supabase, wardId));
  } catch (error) {
    console.error("Falling back to cross-org visibility off", { wardId, error });
    return FALLBACK_CROSS_ORG_VISIBILITY;
  }
}

// MERGES into the existing settings object rather than replacing it. wards.settings also holds
// role_access, timezone and default_speaking_slots, and a wholesale write here would silently
// delete the ward's permission overrides — the worst possible side effect of flipping a
// visibility switch. lib/calendar/wardCalendarSettings.ts carries this warning verbatim for the
// same object; both must keep it.
export async function writeCrossOrgVisibility(
  wardId: string,
  isEnabled: boolean,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = client ?? (await createServerSupabaseClient());

  const existing = await readWardSettings(supabase, wardId);

  const { data, error } = await supabase
    .from("wards")
    .update({
      settings: {
        ...existing,
        [SETTINGS_KEY]: isEnabled,
      } as unknown as Json,
    })
    .eq("id", wardId)
    .select("settings")
    .maybeSingle();

  if (error) {
    console.error(`Could not save the ward's visibility setting — ${error.message}`, {
      wardId,
    });
    throw new Error(`Could not save the visibility setting: ${error.message}`);
  }

  // wards_update (migration 019) is bishopric-only, and an UPDATE denied by policy is a zero-row
  // success rather than an error. RLS genuinely is the boundary on this table, so a silent `null`
  // here means the caller was refused — never that nothing changed.
  if (!data) {
    throw new Error("Could not save the visibility setting: the ward refused the change.");
  }

  return parseCrossOrgVisibility(data.settings);
}
