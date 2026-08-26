import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// The caller's OWN private notes, and nothing else.
//
// CLAUDE.md rule 5: a private note is readable by its author and by nobody else. Not by the
// bishop. Not by an admin. Not by a support query. This is the most sensitive rule in the
// codebase and it is protected by four independent mechanisms, of which this file is one:
//
//   1. A separate TABLE. visit_private_notes is not a column on visit_logs, so no `select *`
//      anywhere in the app can leak it.
//   2. This separate MODULE. lib/visits/queries.ts never imports it and never selects from that
//      table, so "did this response include a private note?" is answerable by reading an import
//      list rather than a query body — the same rule lib/roster/memberNotes.ts states.
//   3. RLS. Migration 019 gives this table four author-only policies and no bishopric branch on
//      any operation. Adding one is a bug, not a feature request.
//   4. A test that reads route RESPONSES, not just tables — tests/routes/visits.test.ts asserts
//      on serialized JSON, so a widened select is caught even when the types still compile.
//
// This module is the reminder. RLS is the guard. tests/rls/private-notes.test.ts is the proof.
//
// EVERY READ AND WRITE GOES THROUGH THE CALLER'S SESSION CLIENT. There is no
// createServiceSupabaseClient import in this file and its presence would be the smell — a
// service-role read here would hand private notes to anyone who reached the code path, and the
// policy that is supposed to stop that would never run.
//
// No function here takes a `userId`. The author is always auth.uid(), so "read someone else's
// note" is not expressible in this module's API surface.

export type PrivateNote = {
  id: string;
  visitLogId: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type PrivateNoteRow = {
  id: string;
  visit_log_id: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

// No `user_id`. It is always the caller, so returning it would only invite a comparison
// somewhere that treats it as a value worth branching on.
const PRIVATE_NOTE_COLUMNS = "id, visit_log_id, notes, created_at, updated_at";

function mapPrivateNoteRow(row: PrivateNoteRow): PrivateNote {
  return {
    id: row.id,
    visitLogId: row.visit_log_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// Null, not an error, for a note the caller did not write. The policy denies the ROW rather than
// the query, so "somebody else's note" and "no note yet" are the same answer here — which is the
// correct shape for the caller too: neither one is anything they may act on.
//
// The note body is never logged, here or anywhere else (CLAUDE.md rule 8). The failure messages
// below carry ids only.
export async function getOwnPrivateNote(
  wardId: string,
  visitLogId: string,
  client?: SupabaseClient<Database>,
): Promise<PrivateNote | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_private_notes")
    .select(PRIVATE_NOTE_COLUMNS)
    .eq("ward_id", wardId)
    .eq("visit_log_id", visitLogId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a private note — ${error.message}`, { wardId, visitLogId });
    throw new Error(`Could not load your private note: ${error.message}`);
  }

  return data === null ? null : mapPrivateNoteRow(data);
}

// An upsert onto visit_private_notes_one_per_author, the unique (visit_log_id, user_id)
// constraint migration 044 added. Without that constraint there is nothing to conflict on and a
// second save writes a second row — after which "the caller's note" is no longer a single row
// anybody can name.
//
// `userId` is a parameter here and only here, because an INSERT has to put a value in the
// column. It is the caller's own id from the session; the INSERT policy checks
// `user_id = auth.uid()`, so passing anybody else's is refused by the database rather than
// trusted.
export async function upsertOwnPrivateNote(
  wardId: string,
  visitLogId: string,
  userId: string,
  notes: string,
  client?: SupabaseClient<Database>,
): Promise<PrivateNote> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_private_notes")
    .upsert(
      {
        ward_id: wardId,
        visit_log_id: visitLogId,
        user_id: userId,
        notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "visit_log_id,user_id" },
    )
    .select(PRIVATE_NOTE_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not save a private note — ${error.message}`, { wardId, visitLogId });
    throw new Error(`Could not save your private note: ${error.message}`);
  }

  return mapPrivateNoteRow(data);
}

// Returns whether a row was removed. A delete the policy refused is a zero-row success rather
// than an error (plans/retros/route-tests-and-realtime.md), so `false` covers both "no note" and
// "not yours" — again the same answer, and again the right one.
export async function deleteOwnPrivateNote(
  wardId: string,
  visitLogId: string,
  client?: SupabaseClient<Database>,
): Promise<boolean> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("visit_private_notes")
    .delete()
    .eq("ward_id", wardId)
    .eq("visit_log_id", visitLogId)
    .select("id");

  if (error) {
    console.error(`Could not delete a private note — ${error.message}`, { wardId, visitLogId });
    throw new Error(`Could not delete your private note: ${error.message}`);
  }

  return (data ?? []).length > 0;
}
