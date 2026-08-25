import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { HYMN_SOURCES, type HymnSource } from "@/lib/music/hymnSource";
import { matchHymns } from "@/lib/music/hymnSearch";
import { HYMN_TYPES, type HymnType } from "@/types/domain";

// Every read and write of `hymns`, `hymn_selections` and `musical_numbers`. Route handlers and
// pages never touch Supabase directly (conventions.md §Data Access).
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. The pure rules
// live in hymnSearch.ts and hymnSource.ts precisely so a client component can use them without
// reaching this file (plans/retros/roster-b-picker-and-orgs.md).
//
// This module is what lib/program/gather.ts switches to. gather.ts held temporary inline readers
// for the two selection tables because nothing owned them yet, and its own header named this as
// the moment they are deleted (program-a §Integration Notes).

// ---------------------------------------------------------------------------------------------
// `hymns` HAS NO ward_id AND MUST NOT GAIN A WARD FILTER
// ---------------------------------------------------------------------------------------------
// It is the sole documented exception to CLAUDE.md rule 1 (migration 006): the hymnbook is the
// same for every ward, so scoping it per ward would duplicate 341 rows per ward for no benefit.
// The ward-isolation test's skip list has exactly one entry and must stay at one — a future table
// that forgets ward_id has to fail that test rather than quietly join the list.
//
// Everything else in this file is ward-scoped as normal.

export type Hymn = {
  number: number;
  title: string;
  topicTags: string[];
  source: HymnSource;
};

export type HymnSelection = {
  id: string;
  sundayId: string;
  hymnType: HymnType;
  hymnNumber: number | null;
  hymnTitle: string | null;
  aiSuggested: boolean;
  selectedBy: string | null;
};

export type MusicalNumber = {
  id: string;
  sundayId: string;
  performer: string | null;
  pieceTitle: string | null;
  notes: string | null;
};

// One string literal on ONE line per table, and never a `+` concatenation between them
// (plans/retros/calendar-a-rules-and-api.md).
const HYMN_COLUMNS = "number, title, topic_tags, source";

const SELECTION_COLUMNS =
  "id, sunday_id, hymn_type, hymn_number, hymn_title, ai_suggested, selected_by";

const MUSICAL_NUMBER_COLUMNS = "id, sunday_id, performer, piece_title, notes";

type HymnRow = {
  number: number;
  title: string;
  topic_tags: string[];
  source: string;
};

type SelectionRow = {
  id: string;
  sunday_id: string | null;
  hymn_type: string | null;
  hymn_number: number | null;
  hymn_title: string | null;
  ai_suggested: boolean;
  selected_by: string | null;
};

type MusicalNumberRow = {
  id: string;
  sunday_id: string | null;
  performer: string | null;
  piece_title: string | null;
  notes: string | null;
};

function toHymnSource(value: string): HymnSource {
  if (!(HYMN_SOURCES as readonly string[]).includes(value)) {
    throw new Error(
      `hymns.source holds "${value}", which is not a known value. The CHECK constraint in ` +
        "migration 042 and lib/music/hymnSource.ts have drifted.",
    );
  }
  return value as HymnSource;
}

export function mapHymnRow(row: HymnRow): Hymn {
  return {
    number: row.number,
    title: row.title,
    topicTags: row.topic_tags,
    source: toHymnSource(row.source),
  };
}

// A row whose `hymn_type` is null or unrecognised is DROPPED rather than throwing. Migration 006
// leaves both `sunday_id` and `hymn_type` nullable, so the shape is representable; a selection
// that names no slot cannot be rendered into one, and one bad row must not take down a whole
// Sunday's music.
function mapSelectionRow(row: SelectionRow): HymnSelection | null {
  if (row.sunday_id === null) return null;
  if (row.hymn_type === null) return null;
  if (!(HYMN_TYPES as readonly string[]).includes(row.hymn_type)) return null;

  return {
    id: row.id,
    sundayId: row.sunday_id,
    hymnType: row.hymn_type as HymnType,
    hymnNumber: row.hymn_number,
    hymnTitle: row.hymn_title,
    aiSuggested: row.ai_suggested,
    selectedBy: row.selected_by,
  };
}

function mapMusicalNumberRow(row: MusicalNumberRow): MusicalNumber | null {
  if (row.sunday_id === null) return null;

  return {
    id: row.id,
    sundayId: row.sunday_id,
    performer: row.performer,
    pieceTitle: row.piece_title,
    notes: row.notes,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// ---------------------------------------------------------------------------------------------
// The hymnbook
// ---------------------------------------------------------------------------------------------

// The WHOLE table, ordered by number. 341 rows is small enough to hold in memory, and every
// caller that matters wants all of them: hymnSearch.ts matches over the list, and
// hymnCandidates.ts ranks over it. Filtering in SQL per keystroke would be a network round trip
// for work that is a few hundred string comparisons.
export async function listHymns(client?: SupabaseClient<Database>): Promise<Hymn[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase.from("hymns").select(HYMN_COLUMNS).order("number");

  if (error) {
    console.error(`Could not read the hymnbook — ${error.message}`);
    throw new Error(`Could not read the hymnbook: ${error.message}`);
  }

  return (data ?? []).map(mapHymnRow);
}

// Matching happens in lib/music/hymnSearch.ts, not here. The rules are pure so they can be tested
// without a network and reused by a client component; this function's only job is to hand them
// the rows.
export async function searchHymns(
  query: string,
  options: { limit?: number } = {},
  client?: SupabaseClient<Database>,
): Promise<Hymn[]> {
  const hymns = await listHymns(client);
  return matchHymns(hymns, query, options);
}

// RETURNS NULL FOR AN UNSEEDED NUMBER, AND A CALLER MUST RENDER THAT AS "UNKNOWN".
//
// Never as "no such hymn". supabase/seed/hymns.sql is explicit: until an authoritative hymnbook
// is loaded, an empty lookup means "not seeded yet". Telling a coordinator that hymn 55 does not
// exist, when the truth is that this app has not been told about it, is the kind of wrong answer
// somebody acts on.
export async function getHymnByNumber(
  hymnNumber: number,
  client?: SupabaseClient<Database>,
): Promise<Hymn | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("hymns")
    .select(HYMN_COLUMNS)
    .eq("number", hymnNumber)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a hymn — ${error.message}`, { hymnNumber });
    throw new Error(`Could not read that hymn: ${error.message}`);
  }

  return data ? mapHymnRow(data) : null;
}

// ---------------------------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------------------------

export async function listSelections(
  wardId: string,
  filter: { sundayId?: string; sundayIds?: readonly string[] } = {},
  client?: SupabaseClient<Database>,
): Promise<HymnSelection[]> {
  const supabase = await resolveClient(client);

  let query = supabase
    .from("hymn_selections")
    .select(SELECTION_COLUMNS)
    .eq("ward_id", wardId);

  if (filter.sundayId !== undefined) {
    query = query.eq("sunday_id", filter.sundayId);
  }

  if (filter.sundayIds !== undefined) {
    // An empty list means "no Sundays", which must return nothing rather than everything. `.in()`
    // with an empty array is a valid no-match, but short-circuiting says so plainly.
    if (filter.sundayIds.length === 0) return [];
    query = query.in("sunday_id", filter.sundayIds);
  }

  const { data, error } = await query.order("created_at");

  if (error) {
    console.error(`Could not read the ward's hymn selections — ${error.message}`, {
      wardId,
      filter,
    });
    throw new Error(`Could not read the hymn selections: ${error.message}`);
  }

  return (data ?? []).flatMap((row) => {
    const selection = mapSelectionRow(row);
    return selection === null ? [] : [selection];
  });
}

export type UpsertSelectionInput = {
  sundayId: string;
  hymnType: HymnType;
  hymnNumber: number;
  // DENORMALISED ON PURPOSE. See upsertSelection's comment.
  hymnTitle: string;
  aiSuggested: boolean;
};

// One selection per (Sunday, slot), replaced rather than accumulated. Migration 006 puts no
// unique constraint on the pair, so this reads the existing row and updates it — a second
// "opening hymn" row for the same Sunday would make gather.ts's snapshot depend on insertion
// order, which is not a thing anybody chose.
//
// THE TITLE IS STORED ALONGSIDE THE NUMBER, DELIBERATELY. The program draft is a snapshot and
// must survive the hymns table changing under it: when a real hymnbook replaces the placeholders,
// a program approved last month has to keep printing the title it was approved with. A join at
// render time would silently rewrite history.
export async function upsertSelection(
  wardId: string,
  input: UpsertSelectionInput,
  selectedBy: string,
  client?: SupabaseClient<Database>,
): Promise<HymnSelection | null> {
  const supabase = await resolveClient(client);

  const existing = await listSelections(wardId, { sundayId: input.sundayId }, supabase);
  const current = existing.find((selection) => selection.hymnType === input.hymnType) ?? null;

  const values = {
    hymn_number: input.hymnNumber,
    hymn_title: input.hymnTitle,
    ai_suggested: input.aiSuggested,
    selected_by: selectedBy,
  };

  const { data, error } =
    current === null
      ? await supabase
          .from("hymn_selections")
          .insert({
            ward_id: wardId,
            sunday_id: input.sundayId,
            hymn_type: input.hymnType,
            ...values,
          })
          .select(SELECTION_COLUMNS)
          .maybeSingle()
      : await supabase
          .from("hymn_selections")
          .update(values)
          .eq("ward_id", wardId)
          .eq("id", current.id)
          .select(SELECTION_COLUMNS)
          .maybeSingle();

  if (error) {
    console.error(`Could not save a hymn selection — ${error.message}`, {
      wardId,
      sundayId: input.sundayId,
      hymnType: input.hymnType,
    });
    throw new Error(`Could not save that hymn: ${error.message}`);
  }

  // Null means the write was refused by RLS, which for an UPDATE is a zero-row success rather
  // than an error (plans/retros/foundation-c-services.md). The caller turns it into a 403.
  return data ? mapSelectionRow(data) : null;
}

// Returns false when nothing was deleted — either there was no such selection or the policy
// refused it. Both mean "the slot is empty now", which is what the caller reports.
export async function deleteSelection(
  wardId: string,
  sundayId: string,
  hymnType: HymnType,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("hymn_selections")
    .delete()
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .eq("hymn_type", hymnType)
    .select("id");

  if (error) {
    console.error(`Could not clear a hymn selection — ${error.message}`, {
      wardId,
      sundayId,
      hymnType,
    });
    throw new Error(`Could not clear that hymn: ${error.message}`);
  }

  return (data ?? []).length > 0;
}

// ---------------------------------------------------------------------------------------------
// Musical numbers
// ---------------------------------------------------------------------------------------------

export async function getMusicalNumber(
  wardId: string,
  sundayId: string,
  client?: SupabaseClient<Database>,
): Promise<MusicalNumber | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("musical_numbers")
    .select(MUSICAL_NUMBER_COLUMNS)
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the Sunday's musical number — ${error.message}`, {
      wardId,
      sundayId,
    });
    throw new Error(`Could not read the musical number: ${error.message}`);
  }

  return data ? mapMusicalNumberRow(data) : null;
}

export async function listMusicalNumbers(
  wardId: string,
  sundayIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<MusicalNumber[]> {
  if (sundayIds.length === 0) return [];

  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("musical_numbers")
    .select(MUSICAL_NUMBER_COLUMNS)
    .eq("ward_id", wardId)
    .in("sunday_id", sundayIds)
    .order("created_at");

  if (error) {
    console.error(`Could not read the ward's musical numbers — ${error.message}`, { wardId });
    throw new Error(`Could not read the musical numbers: ${error.message}`);
  }

  return (data ?? []).flatMap((row) => {
    const musicalNumber = mapMusicalNumberRow(row);
    return musicalNumber === null ? [] : [musicalNumber];
  });
}

export type UpsertMusicalNumberInput = {
  sundayId: string;
  performer: string | null;
  pieceTitle: string | null;
  notes: string | null;
};

// ONE musical number per Sunday, replaced rather than appended, matching getMusicalNumber's
// "first by created_at" read. A second row would be invisible to gather.ts and to the PDF, so
// allowing one to be created would be a write nobody could ever see.
//
// The performer is FREE TEXT and never a member id. A visiting quartet, "the Primary children"
// and a ward member are all the same shape here, and roster-b's MemberPicker is deliberately not
// reached for.
export async function upsertMusicalNumber(
  wardId: string,
  input: UpsertMusicalNumberInput,
  client?: SupabaseClient<Database>,
): Promise<MusicalNumber | null> {
  const supabase = await resolveClient(client);

  const current = await getMusicalNumber(wardId, input.sundayId, supabase);

  const values = {
    performer: input.performer,
    piece_title: input.pieceTitle,
    notes: input.notes,
  };

  const { data, error } =
    current === null
      ? await supabase
          .from("musical_numbers")
          .insert({ ward_id: wardId, sunday_id: input.sundayId, ...values })
          .select(MUSICAL_NUMBER_COLUMNS)
          .maybeSingle()
      : await supabase
          .from("musical_numbers")
          .update(values)
          .eq("ward_id", wardId)
          .eq("id", current.id)
          .select(MUSICAL_NUMBER_COLUMNS)
          .maybeSingle();

  if (error) {
    console.error(`Could not save the musical number — ${error.message}`, {
      wardId,
      sundayId: input.sundayId,
    });
    throw new Error(`Could not save the musical number: ${error.message}`);
  }

  return data ? mapMusicalNumberRow(data) : null;
}

export async function deleteMusicalNumber(
  wardId: string,
  sundayId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("musical_numbers")
    .delete()
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .select("id");

  if (error) {
    console.error(`Could not clear the musical number — ${error.message}`, {
      wardId,
      sundayId,
    });
    throw new Error(`Could not clear the musical number: ${error.message}`);
  }

  return (data ?? []).length > 0;
}
