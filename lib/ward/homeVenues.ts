import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MAX_HOME_VENUES } from "@/lib/validation/visit";
import type { Database, Json } from "@/types/database";

// The places that count as the ward's own, read from wards.settings.home_venues.
//
// A WARD SETTING the bishopric edits in the app. Stored in wards.settings, which is jsonb and
// already holds role_access, timezone, cross_org_visibility and default_speaking_slots. No
// migration and no new column.
//
// ---------------------------------------------------------------------------
// WHY THIS ONE GOT AN EDITOR IN ITS OWN SLICE AND wardTimezone DID NOT
// ---------------------------------------------------------------------------
// lib/ward/wardTimezone.ts ships with no editing UI, and that is defensible because a timezone
// has a FALLBACK that is right for the ward this app was built for. A venue list has no such
// thing: there is no defensible guess at which gym is the home one. With no editor the fallback
// is empty in every real ward, auto-classification never fires, and `home_venues` is a column
// nobody fills in. So the editor ships here, following the crossOrgVisibility precedent
// (lib/ward/crossOrgVisibility.ts plus app/api/ward-settings/cross-org-visibility/route.ts)
// rather than the wardTimezone one.
//
// ---------------------------------------------------------------------------
// THE BOUNDS LIVE IN lib/validation/visit.ts, NOT HERE, AND THAT IS NOT ARBITRARY
// ---------------------------------------------------------------------------
// THIS MODULE IS SERVER-ONLY — it imports createServerSupabaseClient, which imports
// next/headers. lib/validation/visit.ts is imported by CLIENT components (AppointmentPanel,
// HomeVenuePanel), so a constant living here and imported from there drags next/headers into the
// browser bundle and FAILS THE PRODUCTION BUILD — while lint, typecheck and the whole test suite
// stay green, because none of them bundles for the browser.
//
// The dependency therefore points this way and never back. It matches how every other limit in
// this codebase is placed: MAX_EVENT_TITLE and friends live in lib/validation/youth.ts, which is
// pure.
//
// ---------------------------------------------------------------------------
// THE FALLBACK IS THE EMPTY ARRAY, AND THAT IS THE CLOSED DIRECTION
// ---------------------------------------------------------------------------
// With no venues configured, every event lands `tbd` — visible, loud, and waiting for a person.
// The open direction would be guessing, and a wrong `home` guess means nobody is asked to attend
// a game somebody should have attended, with no badge anywhere saying so. Failing towards "ask a
// person" is the only safe direction for a module whose whole purpose is that somebody turns up.
//
// Reading follows parseCrossOrgVisibility(), parseWardTimezone() and parseDefaultSpeakingSlots()
// exactly: a missing or malformed value WARNS AND FALLS BACK rather than throwing. That is the
// house rule for every wards.settings reader — a bad setting must not take /youth down.

export const FALLBACK_HOME_VENUES: readonly string[] = [];

const SETTINGS_KEY = "home_venues";

// ---------------------------------------------------------------------------
// THE VENUE IS STORED AS THE PERSON TYPED IT. CASE IS FOLDED AT COMPARISON TIME.
// ---------------------------------------------------------------------------
// It used to be lower-cased here, so a bishopric member typed "Lincoln High School" and the panel
// read it back as "lincoln high school". Walking scenario 054 on 2026-08-28, that looked like a
// bug — and it is the ward's own words being quietly rewritten in front of them, which is a poor
// trade for an implementation detail.
//
// So the fold moved one layer down, into lib/youth/classifyLocation.ts, which now lower-cases
// BOTH sides of the comparison. That is still exactly ONE place deciding what "the same venue"
// means — which was the point of doing it here — and it is now the place where the comparison
// actually happens, which is the better of the two.
//
// WHITESPACE IS STILL COLLAPSED AND TRIMMED, because that is not the ward's wording, it is typing.
function tidyVenue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

// The KEY is folded even though the value is not, so "Lincoln High School" and
// "lincoln high school" cannot both persist. The first spelling entered is the one kept — a list
// that silently held the same venue twice would be a list a leader could not correct.
function dedupe(venues: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const venue of venues) {
    const key = venue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(venue);
  }

  return kept;
}

// NON-STRING ENTRIES ARE DROPPED INDIVIDUALLY RATHER THAN FAILING THE WHOLE LIST, with one
// warning naming the value. A ward that hand-edited its settings keeps the venues that are
// readable, which is the difference between one venue going missing and every game in the ward
// reverting to "Home or away?".
export function parseHomeVenues(settings: unknown): string[] {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    return [...FALLBACK_HOME_VENUES];
  }

  const raw = (settings as Record<string, unknown>)[SETTINGS_KEY];
  if (raw === undefined || raw === null) return [...FALLBACK_HOME_VENUES];

  if (!Array.isArray(raw)) {
    console.warn(
      `wards.settings.${SETTINGS_KEY} holds ${JSON.stringify(raw)}, which is not a list of ` +
        "venue names; falling back to no home venues, so every event waits for a person.",
    );
    return [...FALLBACK_HOME_VENUES];
  }

  const venues: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim() === "") {
      console.warn(
        `wards.settings.${SETTINGS_KEY} contains ${JSON.stringify(entry)}, which is not a venue ` +
          "name; that entry is ignored and the rest of the list is kept.",
      );
      continue;
    }

    venues.push(tidyVenue(entry));
  }

  // Trimmed to the cap on the READ side as well as the write side, because a list written before
  // the cap existed — or by hand — is still read here.
  return dedupe(venues).slice(0, MAX_HOME_VENUES);
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

// Falls back rather than throwing, for the reason readCrossOrgVisibility() does: a settings read
// that failed must not take the youth pages down. The fallback is the closed direction.
export async function readHomeVenues(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<string[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  try {
    return parseHomeVenues(await readWardSettings(supabase, wardId));
  } catch (error) {
    console.error("Falling back to no configured home venues", { wardId, error });
    return [...FALLBACK_HOME_VENUES];
  }
}

// MERGES into the existing settings object rather than replacing it. wards.settings also holds
// role_access, timezone, cross_org_visibility and default_speaking_slots, and a wholesale write
// here would silently delete the ward's permission overrides — the worst possible side effect of
// saving a list of gyms. lib/ward/crossOrgVisibility.ts and lib/calendar/wardCalendarSettings.ts
// both carry this warning verbatim for the same object; all three must keep it.
export async function writeHomeVenues(
  wardId: string,
  venues: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<string[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const existing = await readWardSettings(supabase, wardId);

  const normalised = dedupe(
    venues.map(tidyVenue).filter((venue) => venue !== ""),
  ).slice(0, MAX_HOME_VENUES);

  const { data, error } = await supabase
    .from("wards")
    .update({
      settings: {
        ...existing,
        [SETTINGS_KEY]: normalised,
      } as unknown as Json,
    })
    .eq("id", wardId)
    .select("settings")
    .maybeSingle();

  if (error) {
    console.error(`Could not save the ward's home venues — ${error.message}`, { wardId });
    throw new Error(`Could not save the home venues: ${error.message}`);
  }

  // wards_update (migration 019) is bishopric-only, and an UPDATE denied by policy is a zero-row
  // success rather than an error. RLS genuinely is the boundary on this table, so a silent `null`
  // here means the caller was refused — never that nothing changed.
  if (!data) {
    throw new Error("Could not save the home venues: the ward refused the change.");
  }

  return parseHomeVenues(data.settings);
}
