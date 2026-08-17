import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

// Member notes are bishopric-only (FEATURES.md §Module 1). They live in their own file rather
// than in a section of queries.ts so that "did this response include notes?" is answerable by
// reading the import list at the top of a route or a page, without reading its body.
//
// This module is the reminder, not the guard. The real boundary is RLS: member_notes is in the
// bishopric-only policy loop in migration 019, and it holds whether or not a caller remembers
// this file exists (CLAUDE.md rule 2). tests/rls/member-notes.test.ts is what proves it.
//
// Reads and writes go through the CALLER'S session client, never the service client. Going
// through RLS is the entire point — a service-role read here would hand notes to anyone who
// reached the code path.

export type MemberNote = {
  id: string;
  memberId: string;
  body: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type MemberNoteRow = {
  id: string;
  member_id: string;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const NOTE_COLUMNS = "id, member_id, body, created_by, created_at, updated_at";

function mapMemberNoteRow(row: MemberNoteRow): MemberNote {
  return {
    id: row.id,
    memberId: row.member_id,
    body: row.body,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// A non-bishopric caller gets an empty array, not an error: the policy denies the rows rather
// than the query. That is the correct shape for the page too — the panel is not rendered at
// all for anyone who cannot manage the roster.
export async function listMemberNotes(
  wardId: string,
  memberId: string,
  client?: SupabaseClient<Database>,
): Promise<MemberNote[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("member_notes")
    .select(NOTE_COLUMNS)
    .eq("ward_id", wardId)
    .eq("member_id", memberId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Could not read member notes — ${error.message}`, {
      wardId,
      memberId,
    });
    throw new Error(`Could not read the notes for that member: ${error.message}`);
  }

  return (data ?? []).map(mapMemberNoteRow);
}

// The note body is never logged, here or anywhere else (CLAUDE.md rule 8, conventions.md
// §Error Handling). The failure messages below carry ids only.
export async function createMemberNote(
  wardId: string,
  memberId: string,
  userId: string,
  body: string,
  client?: SupabaseClient<Database>,
): Promise<MemberNote> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("member_notes")
    .insert({
      ward_id: wardId,
      member_id: memberId,
      body,
      created_by: userId,
    })
    .select(NOTE_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a member note — ${error.message}`, {
      wardId,
      memberId,
    });
    throw new Error(`Could not save the note: ${error.message}`);
  }

  return mapMemberNoteRow(data);
}
