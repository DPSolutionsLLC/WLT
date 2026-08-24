import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { SPEAKER_ROLES, type SavedFilter, type SpeakerRole } from "@/types/domain";

// Every `retrieval_filters` read and write goes through this module. Route handlers and pages
// never touch Supabase directly (conventions.md §Data Access).
//
// SERVER-ONLY, and unlike its neighbour lib/knowledge/queries.ts the server client is imported
// STATICALLY. That module's dynamic import exists solely so supabase/scripts/ingestStandardWorks.ts
// can load it under plain Node, where `next/headers` cannot be imported at all. Nothing outside
// Next reaches saved filters — the ingest scripts write documents, not scopes — so the ordinary
// static import is correct here and the indirection would be cargo-culted.
//
// THERE IS NO UPDATE FUNCTION, on purpose. A filter is created and deleted, never edited: editing
// one silently changes what every past retrieval meant, and `source_phrase` would then describe a
// filter that no longer does what it says.

export const DUPLICATE_LABEL_CODE = "23505";

type RetrievalFilterRow = {
  id: string;
  label: string;
  source_phrase: string;
  speaker_roles: string[] | null;
  speakers: string[] | null;
  since: string | null;
  created_by: string | null;
  created_at: string;
};

// One string literal on ONE line, never a `+` concatenation between column names
// (plans/retros/calendar-a-rules-and-api.md).
const FILTER_COLUMNS =
  "id, label, source_phrase, speaker_roles, speakers, since, created_by, created_at";

// A role the CHECK constraint permits but this build does not know is a schema that moved without
// this mapper. Dropping the unknown value keeps the rest of the filter usable rather than
// crashing the panel, and an empty result collapses to null — which is "no restriction on this
// axis", the same meaning the column's own null carries.
function toSpeakerRoles(values: string[] | null): readonly SpeakerRole[] | null {
  if (values === null) return null;
  const known = values.filter((value): value is SpeakerRole =>
    (SPEAKER_ROLES as readonly string[]).includes(value),
  );
  return known.length === 0 ? null : known;
}

function mapFilterRow(
  row: RetrievalFilterRow,
  creatorNames: Map<string, string>,
): SavedFilter {
  return {
    id: row.id,
    label: row.label,
    sourcePhrase: row.source_phrase,
    speakerRoles: toSpeakerRoles(row.speaker_roles),
    speakers: row.speakers === null || row.speakers.length === 0 ? null : row.speakers,
    since: row.since,
    createdBy: row.created_by,
    createdByName: row.created_by ? (creatorNames.get(row.created_by) ?? null) : null,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// Creator names come from a SECOND query, not a PostgREST embedded join. The foreign key to
// `users` is composite (created_by, ward_id), and embedded-join syntax over a composite FK
// depends on a generated constraint name and is fragile (lib/ai/queries.ts records the same).
async function resolveCreatorNames(
  supabase: SupabaseClient<Database>,
  wardId: string,
  creatorIds: readonly string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (creatorIds.length === 0) return names;

  const { data, error } = await supabase
    .from("users")
    .select("id, first_name, last_name")
    .eq("ward_id", wardId)
    .in("id", [...creatorIds]);

  if (error) {
    // Degrade to "who saved it is unknown" rather than failing the panel. The filter itself is
    // the thing that matters; a missing name is a smaller loss than an unusable scope control.
    console.error(`Could not resolve saved filter creator names — ${error.message}`, { wardId });
    return names;
  }

  for (const row of data ?? []) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    if (name !== "") names.set(row.id, name);
  }

  return names;
}

// Ordered by label so the checkbox list is stable between renders. Order any list you then index
// into (plans/retros/route-tests-and-realtime.md).
export async function listSavedFilters(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<SavedFilter[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("retrieval_filters")
    .select(FILTER_COLUMNS)
    .eq("ward_id", wardId)
    .order("label", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`Could not read the ward's saved filters — ${error.message}`, { wardId });
    throw new Error(`Could not read the saved filters: ${error.message}`);
  }

  const rows = data ?? [];
  const creatorIds = [
    ...new Set(
      rows
        .map((row) => row.created_by)
        .filter((createdBy): createdBy is string => createdBy !== null),
    ),
  ];

  const names = await resolveCreatorNames(supabase, wardId, creatorIds);

  return rows.map((row) => mapFilterRow(row, names));
}

export type CreateFilterInput = {
  label: string;
  sourcePhrase: string;
  speakerRoles: readonly SpeakerRole[] | null;
  speakers: readonly string[] | null;
  since: string | null;
};

// A DUPLICATE LABEL IS A SENTENCE, NOT A 500. Two filters called the same thing in one checkbox
// list is a bug report waiting to happen, so migration 034 refuses it — and the refusal has to
// arrive as something the person who typed the name can act on.
export class DuplicateFilterLabelError extends Error {
  constructor(public readonly label: string) {
    super(`A saved filter called "${label}" already exists. Choose a different name.`);
    this.name = "DuplicateFilterLabelError";
  }
}

export function isDuplicateFilterLabelError(
  error: unknown,
): error is DuplicateFilterLabelError {
  return error instanceof DuplicateFilterLabelError;
}

export async function createSavedFilter(
  wardId: string,
  input: CreateFilterInput,
  createdBy: string,
  client?: SupabaseClient<Database>,
): Promise<SavedFilter> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("retrieval_filters")
    .insert({
      ward_id: wardId,
      label: input.label,
      source_phrase: input.sourcePhrase,
      // NULL, NEVER AN EMPTY ARRAY. `= any ('{}')` matches nothing, so an empty array would save
      // a filter that silently matches zero documents while reading as "no restriction on this
      // axis". Migration 034's CHECK refuses it too; this is the near end of the same rule.
      speaker_roles: input.speakerRoles === null ? null : [...input.speakerRoles],
      speakers: input.speakers === null ? null : [...input.speakers],
      since: input.since,
      created_by: createdBy,
    })
    .select(FILTER_COLUMNS)
    .single();

  if (error) {
    if ((error as PostgrestError).code === DUPLICATE_LABEL_CODE) {
      throw new DuplicateFilterLabelError(input.label);
    }

    console.error(`Could not save a retrieval filter — ${error.message}`, {
      wardId,
      createdBy,
    });
    throw new Error(`Could not save the filter: ${error.message}`);
  }

  const names = await resolveCreatorNames(supabase, wardId, [createdBy]);
  return mapFilterRow(data, names);
}

// Returns false when no row matched, which for a ward-scoped query means "not this ward's
// filter" — the route turns that into a 404 rather than a 403, because confirming that another
// ward's id exists is itself a leak.
//
// An RLS-denied DELETE is a ZERO-ROW SUCCESS, not an error
// (plans/retros/foundation-c-services.md). Selecting the deleted ids is what tells the two apart,
// and it is why this returns a boolean rather than void.
export async function deleteSavedFilter(
  wardId: string,
  id: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("retrieval_filters")
    .delete()
    .eq("ward_id", wardId)
    .eq("id", id)
    .select("id");

  if (error) {
    console.error(`Could not delete a retrieval filter — ${error.message}`, { wardId, id });
    throw new Error(`Could not delete the filter: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

// DELETING A FILTER DOES NOT TOUCH THE DOCUMENTS, and it does not rewrite any saved scope
// either. `ai_settings` is append-only, so a stored scope naming this filter keeps naming it —
// mergeConferenceScope ignores an id that no longer resolves, which widens the corpus rather
// than narrowing it. Widening is the safe direction to be wrong in: the ward sees more of its
// own material, never less and never another ward's.

// The distinct speakers already in this ward's corpus, for the upload form's datalist.
//
// A datalist rather than a strict dropdown: a misspelling that creates a filter matching nothing
// is the failure mode this whole plan is otherwise careful about, and suggesting the names
// already present removes almost all of it — while still letting a conference introduce a
// speaker nobody has ingested before, which a controlled list could not.
export async function listSpeakers(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<string[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("knowledge_documents")
    .select("speaker")
    .eq("ward_id", wardId)
    .not("speaker", "is", null)
    .order("speaker", { ascending: true });

  if (error) {
    // Degrade to an empty datalist rather than failing the page. The field is free text; losing
    // the suggestions costs convenience, not the ability to upload.
    console.error(`Could not read the ward's document speakers — ${error.message}`, { wardId });
    return [];
  }

  return [
    ...new Set(
      (data ?? [])
        .map((row) => row.speaker)
        .filter((speaker): speaker is string => speaker !== null && speaker.trim() !== ""),
    ),
  ];
}
