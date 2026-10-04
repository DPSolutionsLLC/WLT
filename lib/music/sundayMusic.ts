import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import {
  MUSIC_RETURNED_REASONS,
  MUSIC_REVIEW_STATUSES,
  type MusicPerson,
  type MusicReturnedReason,
  type MusicReviewStatus,
  type SundayMusic,
} from "@/types/domain";

// Every read and write of `sunday_music` (migration 089, ITER-038): a Sunday's chorister and
// organist, and the music submission's status.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers, and the service
// client, which throws in a browser.
//
// READS GO THROUGH THE CALLER'S CLIENT; WRITES THROUGH THE SERVICE ROLE. The table has a SELECT
// policy and no write policy at all (089a), so a write through the caller's client would be
// refused for every role. The route in front of each write is the guard, and it reads the Sunday
// through the caller's own client first, so every id written here is one RLS already admitted.
//
// ABSENT MEANS THE EMPTY DRAFT. A Sunday with no row maps to no chorister, no organist and a
// `draft` status, and nothing here inserts a row on read.
//
// lib/music/musicReview.ts (slice mb) is the only writer of `status`. This file writes the four
// people columns and nothing else.

type Client = SupabaseClient<Database>;

// One string literal on ONE line (plans/retros/calendar-a-rules-and-api.md). The member names
// embed through the composite foreign keys by name, because two keys point at `members`.
export const SUNDAY_MUSIC_COLUMNS =
  "sunday_id, chorister_member_id, chorister_name, organist_member_id, organist_name, status, submitted_at, submitted_by, approved_at, returned_at, returned_reason, return_note, chorister:members!sunday_music_chorister_member_id_ward_id_fkey (first_name, last_name), organist:members!sunday_music_organist_member_id_ward_id_fkey (first_name, last_name)";

type MemberNameRow = { first_name: string; last_name: string } | null;

type SundayMusicRow = {
  sunday_id: string;
  chorister_member_id: string | null;
  chorister_name: string | null;
  organist_member_id: string | null;
  organist_name: string | null;
  status: string;
  submitted_at: string | null;
  submitted_by: string | null;
  approved_at: string | null;
  returned_at: string | null;
  returned_reason: string | null;
  return_note: string | null;
  chorister: MemberNameRow;
  organist: MemberNameRow;
};

// What a caller asks for: a member, a typed name, `null` to clear, or `undefined` to leave alone.
export type MusicPersonInput = { memberId: string } | { name: string } | null | undefined;

export function emptySundayMusic(sundayId: string): SundayMusic {
  return {
    sundayId,
    chorister: null,
    organist: null,
    status: "draft",
    submittedAt: null,
    submittedByUserId: null,
    approvedAt: null,
    returnedAt: null,
    returnedReason: null,
    returnNote: null,
  };
}

function toStatus(value: string): MusicReviewStatus {
  if (!(MUSIC_REVIEW_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `sunday_music.status holds "${value}", which is not a known value. Migration 089 and ` +
        "MUSIC_REVIEW_STATUSES in types/domain.ts have drifted.",
    );
  }
  return value as MusicReviewStatus;
}

function toReturnedReason(value: string | null): MusicReturnedReason | null {
  if (value === null) return null;
  if (!(MUSIC_RETURNED_REASONS as readonly string[]).includes(value)) {
    throw new Error(
      `sunday_music.returned_reason holds "${value}", which is not a known value. Migration 089 ` +
        "and MUSIC_RETURNED_REASONS in types/domain.ts have drifted.",
    );
  }
  return value as MusicReturnedReason;
}

// A member whose name cannot be read still counts as chosen — the id is there — so it is named
// generically rather than dropped, which would read as "nobody chosen".
function toPerson(
  memberId: string | null,
  typedName: string | null,
  member: MemberNameRow,
): MusicPerson | null {
  if (memberId !== null) {
    const name = member === null ? "" : `${member.first_name} ${member.last_name}`.trim();
    return { memberId, name: name === "" ? "A ward member" : name };
  }
  if (typedName !== null) return { memberId: null, name: typedName };
  return null;
}

export function mapSundayMusicRow(row: SundayMusicRow): SundayMusic {
  return {
    sundayId: row.sunday_id,
    chorister: toPerson(row.chorister_member_id, row.chorister_name, row.chorister),
    organist: toPerson(row.organist_member_id, row.organist_name, row.organist),
    status: toStatus(row.status),
    submittedAt: row.submitted_at,
    submittedByUserId: row.submitted_by,
    approvedAt: row.approved_at,
    returnedAt: row.returned_at,
    returnedReason: toReturnedReason(row.returned_reason),
    returnNote: row.return_note,
  };
}

async function resolveClient(client?: Client): Promise<Client> {
  return client ?? (await createServerSupabaseClient());
}

export async function getSundayMusic(
  wardId: string,
  sundayId: string,
  client?: Client,
): Promise<SundayMusic> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("sunday_music")
    .select(SUNDAY_MUSIC_COLUMNS)
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a Sunday's music — ${error.message}`, { wardId, sundayId });
    throw new Error(`Could not read the Sunday's music: ${error.message}`);
  }

  return data ? mapSundayMusicRow(data) : emptySundayMusic(sundayId);
}

// Every requested Sunday is in the map, a Sunday with no row as the empty draft, so a caller never
// has to tell "no row" from "not asked about".
export async function listSundayMusic(
  wardId: string,
  sundayIds: readonly string[],
  client?: Client,
): Promise<Map<string, SundayMusic>> {
  const result = new Map(sundayIds.map((sundayId) => [sundayId, emptySundayMusic(sundayId)]));
  if (sundayIds.length === 0) return result;

  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("sunday_music")
    .select(SUNDAY_MUSIC_COLUMNS)
    .eq("ward_id", wardId)
    .in("sunday_id", sundayIds);

  if (error) {
    console.error(`Could not read the ward's Sunday music — ${error.message}`, { wardId });
    throw new Error(`Could not read the Sunday music: ${error.message}`);
  }

  for (const row of data ?? []) {
    result.set(row.sunday_id, mapSundayMusicRow(row));
  }
  return result;
}

// Setting a member clears the typed name and the other way round, so the two-kinds CHECK holds.
function personColumns(
  prefix: "chorister" | "organist",
  person: MusicPersonInput,
): Record<string, string | null> {
  if (person === undefined) return {};
  if (person === null) {
    return { [`${prefix}_member_id`]: null, [`${prefix}_name`]: null };
  }
  if ("memberId" in person) {
    return { [`${prefix}_member_id`]: person.memberId, [`${prefix}_name`]: null };
  }
  return { [`${prefix}_member_id`]: null, [`${prefix}_name`]: person.name };
}

// Upserts on (ward_id, sunday_id) and writes ONLY the people columns and `updated_at`, so a
// submission's status is never touched from here. A new row takes the table's `draft` default.
export async function upsertSundayMusicPeople(params: {
  wardId: string;
  sundayId: string;
  chorister?: MusicPersonInput;
  organist?: MusicPersonInput;
  client?: Client;
}): Promise<SundayMusic> {
  const supabase = params.client ?? createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("sunday_music")
    .upsert(
      {
        ward_id: params.wardId,
        sunday_id: params.sundayId,
        ...personColumns("chorister", params.chorister),
        ...personColumns("organist", params.organist),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ward_id,sunday_id" },
    )
    .select(SUNDAY_MUSIC_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not save a Sunday's chorister or organist — ${error.message}`, {
      wardId: params.wardId,
      sundayId: params.sundayId,
    });
    throw new Error(`Could not save the chorister or organist: ${error.message}`);
  }

  return mapSundayMusicRow(data);
}
