import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// The ward's IANA time zone, read from wards.settings.timezone.
//
// ---------------------------------------------------------------------------
// THIS IS THE FIRST READER OF A KEY THAT HAS BEEN SEEDED SINCE FOUNDATION B
// ---------------------------------------------------------------------------
// `supabase/seed/ward.sql` has written `'timezone', 'America/Denver'` into wards.settings since
// Foundation B, and until this file NOTHING IN THIS REPO HAD EVER READ IT. Two migrations refer
// to it in comments and neither of them reads it either: 011_tithing.sql ("auto_clear_at is
// always midnight of session_date in the ward timezone", describing a cron that does not exist)
// and 046_visit_attempts_appointments_participants.sql ("The ward's timezone already lives in
// wards.settings.timezone", describing a use it did not then make).
//
// Slice B is what makes the key load-bearing: an ICS file may carry a floating time — half past
// seven in no particular place — and the ward's zone is the only defensible thing to read it in.
//
// THERE IS NO EDITING UI FOR THIS SETTING. If a ward ever needs to change it, that is a Phase 11
// admin screen, and lib/ward/crossOrgVisibility.ts plus
// app/api/ward-settings/cross-org-visibility/route.ts are the pattern to follow — including the
// merge-don't-replace rule that keeps role_access from being deleted by a settings write.
//
// Reading follows parseCrossOrgVisibility() and parseDefaultSpeakingSlots() exactly: a missing or
// malformed value WARNS AND FALLS BACK rather than throwing. That is the house rule for every
// wards.settings reader, and here it is also the only sane direction — a ward with a typo in its
// zone should see games an hour out, not a module that will not load.

// Matches supabase/seed/ward.sql, which is the only place this key has ever been written.
export const FALLBACK_WARD_TIMEZONE = "America/Denver";

const SETTINGS_KEY = "timezone";

// Validated by ASKING Intl, which is the same engine resolveInstant.ts will do the arithmetic
// with — so a zone that passes here is a zone the conversion can actually use.
//
// `Intl.supportedValuesOf("timeZone")` exists on Node 22 and would also work, but it allocates a
// ~400-entry array to scan on every call. A constructor in a try/catch asks the one question that
// matters and answers it in one line.
// A BARE OFFSET IS REFUSED EVEN THOUGH Intl ACCEPTS IT.
//
// ECMA-402 lets `Intl.DateTimeFormat` take `-07:00` as a time zone, and the arithmetic in
// resolveInstant.ts would run against it perfectly happily — at a FIXED offset, all year. So a
// ward that had written `-07:00` here would see every summer game an hour out and nothing
// anywhere would say why: exactly the silent-wrong-hour failure this slice exists to prevent.
//
// A ward genuinely in a zone with no daylight saving has an IANA name for it (`America/Phoenix`),
// so refusing the offset form costs nobody anything and the warning names the value.
const OFFSET_SHAPED = /^[+-]/;

function isUsableTimeZone(value: string): boolean {
  if (OFFSET_SHAPED.test(value)) return false;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function parseWardTimezone(settings: unknown): string {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    return FALLBACK_WARD_TIMEZONE;
  }

  const raw = (settings as Record<string, unknown>)[SETTINGS_KEY];
  if (raw === undefined || raw === null) return FALLBACK_WARD_TIMEZONE;

  if (typeof raw !== "string" || raw.trim() === "") {
    console.warn(
      `wards.settings.${SETTINGS_KEY} holds ${JSON.stringify(raw)}, which is not a time zone ` +
        `name; falling back to ${FALLBACK_WARD_TIMEZONE}.`,
    );
    return FALLBACK_WARD_TIMEZONE;
  }

  const trimmed = raw.trim();

  if (!isUsableTimeZone(trimmed)) {
    console.warn(
      `wards.settings.${SETTINGS_KEY} holds ${JSON.stringify(trimmed)}, which is not a time zone ` +
        `this system recognises; falling back to ${FALLBACK_WARD_TIMEZONE}.`,
    );
    return FALLBACK_WARD_TIMEZONE;
  }

  return trimmed;
}

// Falls back rather than throwing, for the reason readCrossOrgVisibility() does: a settings read
// that failed must not take the import wizard down. Unlike that one there is no "closed
// direction" here — a time zone is not a permission — so the fallback is simply the seeded value,
// and the preview screen says out loud which zone it resolved a floating time in.
export async function readWardTimezone(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<string> {
  const supabase = client ?? (await createServerSupabaseClient());

  try {
    const { data, error } = await supabase
      .from("wards")
      .select("settings")
      .eq("id", wardId)
      .maybeSingle();

    if (error) {
      console.error(`Could not read the ward's time zone — ${error.message}`, { wardId });
      return FALLBACK_WARD_TIMEZONE;
    }

    return parseWardTimezone(data?.settings ?? null);
  } catch (error) {
    console.error("Falling back to the default ward time zone", { wardId, error });
    return FALLBACK_WARD_TIMEZONE;
  }
}
