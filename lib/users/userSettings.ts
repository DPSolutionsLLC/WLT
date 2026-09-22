import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";

// `users.settings` — one person's own display preferences. Shaped after
// lib/ward/crossOrgVisibility.ts, which does the identical job for `wards.settings`.
//
// ---------------------------------------------------------------------------
// ⚠️ NOTHING MAY EVER READ AUTHORIZATION OUT OF THIS COLUMN
// ---------------------------------------------------------------------------
// Migration 077 grants the user UPDATE on it directly, so anything security-relevant stored here
// would be SELF-GRANTED — a role, a ward id, a permission, any flag a policy consults. The ward's
// `role_access` lives in `wards.settings` behind a bishopric-only `wards_update` for exactly this
// reason, and the two columns must not be thought of as the same kind of thing because they share
// a name and a type.
//
// ---------------------------------------------------------------------------
// EVERY WRITE MERGES. A WHOLESALE WRITE WOULD DELETE EVERY OTHER KEY.
// ---------------------------------------------------------------------------
// There is one key today, which is exactly when this is easiest to get wrong and hardest to
// notice. writeCrossOrgVisibility() carries the identical warning for the ward's column, where it
// has already cost a real near-miss: a list of gyms quietly deleting a ward's permission
// overrides. tests/routes/quick-links.test.ts seeds a second key and asserts it survives.
//
// A malformed value WARNS AND FALLS BACK rather than throwing (parseCrossOrgVisibility's rule):
// a preference nobody can parse must not take somebody's dashboard down.

const QUICK_LINKS_KEY = "quick_links";

export function parseQuickLinks(settings: unknown): string[] {
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return [];

  const raw = (settings as Record<string, unknown>)[QUICK_LINKS_KEY];
  if (raw === undefined || raw === null) return [];

  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== "string")) {
    console.warn(
      `users.settings.${QUICK_LINKS_KEY} holds ${JSON.stringify(raw)}, which is not a list of ` +
        "strings; falling back to no pinned links.",
    );
    return [];
  }

  return raw as string[];
}

async function readUserSettings(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("users")
    .select("settings")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the user's settings — ${error.message}`, { userId });
    throw new Error(`Could not read your settings: ${error.message}`);
  }

  const settings = data?.settings;
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return {};

  return settings as Record<string, unknown>;
}

// Falls back rather than throwing, for the same reason readCrossOrgVisibility does: a settings
// read that failed must not take the dashboard down. An empty list of pins is the harmless
// direction — the tiles are all still there, none of them is marked.
export async function readQuickLinks(
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<string[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  try {
    return parseQuickLinks(await readUserSettings(supabase, userId));
  } catch (error) {
    console.error("Falling back to no pinned quick links", { userId, error });
    return [];
  }
}

export async function writeQuickLinks(
  userId: string,
  quickLinks: string[],
  client?: SupabaseClient<Database>,
): Promise<string[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const existing = await readUserSettings(supabase, userId);

  const { data, error } = await supabase
    .from("users")
    // MERGE. See the header.
    .update({
      settings: { ...existing, [QUICK_LINKS_KEY]: quickLinks } as unknown as Json,
    })
    .eq("id", userId)
    .select("settings")
    .maybeSingle();

  if (error) {
    // A COLUMN-PRIVILEGE refusal arrives HERE, as a hard error reading "permission denied for
    // table users" — column privileges are checked BEFORE policies. If migration 077's
    // `grant update (settings)` were ever dropped, this is the line that would fire, and it looks
    // nothing like the zero-row refusal below (`unit-hierarchy-and-ward-switch` lost real time to
    // exactly that distinction on `active_ward_id`).
    console.error(`Could not save the user's quick links — ${error.message}`, { userId });
    throw new Error(`Could not save your pinned links: ${error.message}`);
  }

  // `users_update_self` is `id = auth.uid()` on both halves, and an UPDATE denied by policy is a
  // zero-row success rather than an error. So a silent `null` here means the caller was refused —
  // never that nothing changed.
  if (!data) {
    throw new Error("Could not save your pinned links: the change was refused.");
  }

  return parseQuickLinks(data.settings);
}
