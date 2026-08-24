import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  conferencePreferencesSchema,
  scripturePreferencesSchema,
  type AiSettingsInput,
} from "@/lib/validation/aiSettings";
import type { Database } from "@/types/database";
import type {
  AiSettings,
  ConferencePreferences,
  ScripturePreferences,
} from "@/types/domain";

// Every `ai_settings` read and write goes through this module. Route handlers and pages never
// touch Supabase directly (conventions.md §Data Access).
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers.
//
// THERE IS NO UPDATE FUNCTION AND NO DELETE FUNCTION, and that absence IS the versioning
// guarantee — not a rule somebody has to remember. `ai_settings` is append-only (migration 014):
// the row with the latest created_at is the active configuration, restoring an old version
// appends a copy of it, and history cannot be destroyed because nothing here can destroy it.

export type AiSettingsVersion = AiSettings & { savedByName: string | null };

type AiSettingsRow = {
  id: string;
  tone_voice: string | null;
  doctrinal_emphasis: string | null;
  scripture_preferences: unknown;
  conference_preferences: unknown;
  topic_preferences: string | null;
  ward_context: string | null;
  thank_you_preferences: string | null;
  saved_by: string | null;
  created_at: string;
};

// One string literal on ONE line, never a `+` concatenation between column names
// (plans/retros/calendar-a-rules-and-api.md).
const AI_SETTINGS_COLUMNS =
  "id, tone_voice, doctrinal_emphasis, scripture_preferences, conference_preferences, topic_preferences, ward_context, thank_you_preferences, saved_by, created_at";

// The jsonb columns are `Json` in types/database.ts, so this is the one place a malformed blob is
// caught. It parses through the SAME Zod schema the write side uses and falls back to null on
// failure rather than casting — a row written before a schema change must not crash the page.
function toScripturePreferences(value: unknown): ScripturePreferences | null {
  if (value === null || value === undefined) return null;
  const parsed = scripturePreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function toConferencePreferences(value: unknown): ConferencePreferences | null {
  if (value === null || value === undefined) return null;
  const parsed = conferencePreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function mapAiSettingsRow(row: AiSettingsRow): AiSettings {
  return {
    id: row.id,
    toneVoice: row.tone_voice,
    doctrinalEmphasis: row.doctrinal_emphasis,
    scripturePreferences: toScripturePreferences(row.scripture_preferences),
    conferencePreferences: toConferencePreferences(row.conference_preferences),
    topicPreferences: row.topic_preferences,
    wardContext: row.ward_context,
    thankYouPreferences: row.thank_you_preferences,
    savedBy: row.saved_by,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// ACTIVE = LATEST. The `id` tie-break is load-bearing, not decoration: on an append-only table
// two saves can share a second, and heap order moves as other suites write rows. Order any query
// you then index into (plans/retros/route-tests-and-realtime.md).
export async function getActiveAiSettings(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<AiSettings | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("ai_settings")
    .select(AI_SETTINGS_COLUMNS)
    .eq("ward_id", wardId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the ward's AI settings — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's AI settings: ${error.message}`);
  }

  return data ? mapAiSettingsRow(data) : null;
}

export async function getAiSettingsVersion(
  wardId: string,
  id: string,
  client?: SupabaseClient<Database>,
): Promise<AiSettings | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("ai_settings")
    .select(AI_SETTINGS_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(`Could not read an AI settings version — ${error.message}`, {
      wardId,
      id,
    });
    throw new Error(`Could not read that AI settings version: ${error.message}`);
  }

  return data ? mapAiSettingsRow(data) : null;
}

// Saver names come from a SECOND query, not a PostgREST embedded join. `ai_settings`' foreign key
// to `users` is composite (saved_by, ward_id), and embedded-join syntax over a composite FK
// depends on a generated constraint name and is fragile. `users` has a ward-scoped SELECT policy
// from migration 020, so reading them separately is allowed.
async function resolveSaverNames(
  supabase: SupabaseClient<Database>,
  wardId: string,
  saverIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (saverIds.length === 0) return names;

  const { data, error } = await supabase
    .from("users")
    .select("id, first_name, last_name")
    .eq("ward_id", wardId)
    .in("id", [...saverIds]);

  if (error) {
    // Degrade to "who saved it is unknown" rather than failing the history page. The versions
    // themselves are the record; a missing name is a smaller loss than an unreadable history.
    console.error(`Could not resolve AI settings saver names — ${error.message}`, {
      wardId,
    });
    return names;
  }

  for (const row of data ?? []) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    if (name !== "") names.set(row.id, name);
  }

  return names;
}

// Newest first. No pagination — a ward saves these a handful of times a year.
export async function listAiSettingsVersions(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<AiSettingsVersion[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("ai_settings")
    .select(AI_SETTINGS_COLUMNS)
    .eq("ward_id", wardId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    console.error(`Could not read the AI settings history — ${error.message}`, { wardId });
    throw new Error(`Could not read the AI settings history: ${error.message}`);
  }

  const versions = (data ?? []).map(mapAiSettingsRow);
  const saverIds = [
    ...new Set(
      versions
        .map((version) => version.savedBy)
        .filter((savedBy): savedBy is string => savedBy !== null),
    ),
  ];

  const names = await resolveSaverNames(supabase, wardId, saverIds);

  return versions.map((version) => ({
    ...version,
    savedByName: version.savedBy ? (names.get(version.savedBy) ?? null) : null,
  }));
}

// The ONLY write in this module, and it only ever INSERTs. See the header comment.
export async function insertAiSettingsVersion(
  wardId: string,
  savedBy: string,
  input: AiSettingsInput,
  client?: SupabaseClient<Database>,
): Promise<AiSettings> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("ai_settings")
    .insert({
      ward_id: wardId,
      tone_voice: input.toneVoice,
      doctrinal_emphasis: input.doctrinalEmphasis,
      scripture_preferences:
        input.scripturePreferences as Database["public"]["Tables"]["ai_settings"]["Insert"]["scripture_preferences"],
      conference_preferences:
        input.conferencePreferences as Database["public"]["Tables"]["ai_settings"]["Insert"]["conference_preferences"],
      topic_preferences: input.topicPreferences,
      ward_context: input.wardContext,
      thank_you_preferences: input.thankYouPreferences,
      saved_by: savedBy,
    })
    .select(AI_SETTINGS_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not save the ward's AI settings — ${error.message}`, {
      wardId,
      savedBy,
    });
    throw new Error(`Could not save the AI settings: ${error.message}`);
  }

  return mapAiSettingsRow(data);
}
