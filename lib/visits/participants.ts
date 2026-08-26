import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { VisitParticipantInput } from "@/lib/validation/visit";
import type { Database } from "@/types/database";

// Who actually went on a visit.
//
// THIS MODULE NEVER SELECTS FROM `visit_private_notes`, AND NEVER IMPORTS THE MODULE THAT DOES.
// A participant is not entitled to another participant's private note, and neither is the
// recorder — being on a visit together changes nothing about CLAUDE.md rule 5.
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers.
//
// ---------------------------------------------------------------------------
// THREE KINDS, EXACTLY ONE PER ROW
// ---------------------------------------------------------------------------
// `users` and `members` are NOT linked in this schema — there is no users.member_id, and a
// leader and their own member record are two unrelated rows. So a participant is a USER (a
// leader with an account), a MEMBER (a spouse, a ministering companion on the roster), or a
// LABEL (a neighbour, a visiting missionary — somebody this ward has no row for at all).
//
// Migration 046's `visit_participants_one_identity` CHECK enforces "exactly one" at the
// database; the discriminated union in lib/validation/visit.ts makes anything else
// unrepresentable at the boundary. This module is the layer between them and adds no third
// version of the rule.

export type VisitParticipant =
  | { id: string; kind: "user"; userId: string; displayName: string }
  | { id: string; kind: "member"; memberId: string; displayName: string }
  | { id: string; kind: "label"; label: string; displayName: string };

type VisitParticipantRow = {
  id: string;
  visit_log_id: string;
  user_id: string | null;
  member_id: string | null;
  label: string | null;
};

// One string literal on ONE line, never a `+` concatenation — concatenation widens the type to
// `string` and defeats supabase-js's literal parsing of the select list
// (plans/retros/calendar-a-rules-and-api.md).
const PARTICIPANT_COLUMNS = "id, visit_log_id, user_id, member_id, label";

// ONLY the id and the name, from both tables. Not a phone, not an address, not an email, not a
// status. A participant list is a display of who went; every other column on `members` is
// roster data that has its own read path and its own permission behind it.
const PARTICIPANT_JOINED_COLUMNS = `${PARTICIPANT_COLUMNS}, users (id, first_name, last_name), members (id, first_name, last_name)` as const;

type VisitParticipantJoinedRow = VisitParticipantRow & {
  users: { id: string; first_name: string | null; last_name: string | null } | null;
  members: { id: string; first_name: string; last_name: string } | null;
};

function fullName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  return `${first ?? ""} ${last ?? ""}`.trim();
}

// A row whose join came back empty is a person whose `users` or `members` row was deleted since
// the visit. "Someone" beats a blank: the visit still records that a person other than the
// recorder was there, and losing that would quietly change what the record says.
const UNKNOWN_PARTICIPANT = "Someone";

function mapParticipantRow(row: VisitParticipantJoinedRow): VisitParticipant {
  if (row.user_id !== null) {
    return {
      id: row.id,
      kind: "user",
      userId: row.user_id,
      displayName: fullName(row.users?.first_name, row.users?.last_name) || UNKNOWN_PARTICIPANT,
    };
  }

  if (row.member_id !== null) {
    return {
      id: row.id,
      kind: "member",
      memberId: row.member_id,
      displayName:
        fullName(row.members?.first_name, row.members?.last_name) || UNKNOWN_PARTICIPANT,
    };
  }

  // The CHECK constraint guarantees the third branch has a label, so a null here means the
  // constraint and this module have drifted — worth a crash rather than a silent blank, the same
  // reading toEnum() takes in lib/visits/queries.ts.
  if (row.label === null) {
    throw new Error(
      "A visit_participants row has no user, no member and no label. " +
        "visit_participants_one_identity has drifted from this module.",
    );
  }

  return { id: row.id, kind: "label", label: row.label, displayName: row.label };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// ONE query for MANY visits, keyed back by visit. Not one query per visit: the visits page
// renders every recent log, and an N+1 here is the whole page rather than one row of it.
//
// An empty `visitLogIds` returns an empty Map without a round trip — `in()` with an empty array
// is a query that can only return nothing.
export async function listParticipantsForVisits(
  wardId: string,
  visitLogIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<Map<string, VisitParticipant[]>> {
  const byVisit = new Map<string, VisitParticipant[]>();
  if (visitLogIds.length === 0) return byVisit;

  const supabase = await resolveClient(client);

  // Ordered explicitly, because these tables are shared by every suite running against the
  // hosted project and heap order shifts under them (plans/retros/route-tests-and-realtime.md).
  const { data, error } = await supabase
    .from("visit_participants")
    .select(PARTICIPANT_JOINED_COLUMNS)
    .eq("ward_id", wardId)
    .in("visit_log_id", visitLogIds as string[])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`Could not read visit participants — ${error.message}`, { wardId });
    throw new Error(`Could not load who went on these visits: ${error.message}`);
  }

  for (const row of (data ?? []) as unknown as VisitParticipantJoinedRow[]) {
    const existing = byVisit.get(row.visit_log_id);
    const participant = mapParticipantRow(row);

    if (existing) existing.push(participant);
    else byVisit.set(row.visit_log_id, [participant]);
  }

  return byVisit;
}

export async function listParticipants(
  wardId: string,
  visitLogId: string,
  client?: SupabaseClient<Database>,
): Promise<VisitParticipant[]> {
  const byVisit = await listParticipantsForVisits(wardId, [visitLogId], client);
  return byVisit.get(visitLogId) ?? [];
}

// Delete-then-insert, in one call, mirroring replaceConductingRotation in
// lib/calendar/queries.ts — the caller says who was there and this module makes the table agree,
// rather than the caller working out which rows to add and which to remove.
//
// NOT A TRANSACTION, because PostgREST gives us none and this repo deliberately has no RPC for
// it. The failure window is real and its worst case is a visit whose participants were cleared
// and not rewritten — recoverable by editing the visit, and visible rather than silent. A
// participant list is not money.
//
// An EMPTY `participants` list is a legitimate answer, not a no-op: the recorder removed
// themselves and added nobody, and the visit reads as "Nobody recorded as visiting". Delete
// still runs.
export async function replaceParticipants(
  wardId: string,
  orgId: string | null,
  visitLogId: string,
  participants: readonly VisitParticipantInput[],
  client?: SupabaseClient<Database>,
): Promise<VisitParticipant[]> {
  const supabase = await resolveClient(client);

  const { error: deleteError } = await supabase
    .from("visit_participants")
    .delete()
    .eq("ward_id", wardId)
    .eq("visit_log_id", visitLogId);

  if (deleteError) {
    console.error(`Could not clear visit participants — ${deleteError.message}`, {
      wardId,
      visitLogId,
    });
    throw new Error(`Could not save who went on that visit: ${deleteError.message}`);
  }

  if (participants.length === 0) return [];

  // `org_id` is denormalized from the parent visit log so migration 046's policy can be the same
  // shape as visit_logs' rather than an EXISTS subquery per row. It is stamped by the caller
  // from the visit, never from a request body.
  const rows = participants.map((participant) => ({
    ward_id: wardId,
    org_id: orgId,
    visit_log_id: visitLogId,
    user_id: participant.kind === "user" ? participant.userId : null,
    member_id: participant.kind === "member" ? participant.memberId : null,
    label: participant.kind === "label" ? participant.label : null,
  }));

  const { error: insertError } = await supabase.from("visit_participants").insert(rows);

  if (insertError) {
    console.error(`Could not save visit participants — ${insertError.message}`, {
      wardId,
      visitLogId,
    });
    throw new Error(`Could not save who went on that visit: ${insertError.message}`);
  }

  // Re-read rather than mapping the inserted rows, because the display name comes from the join
  // and the insert carries only ids.
  return listParticipants(wardId, visitLogId, supabase);
}

// The sentence a visit row shows for "conducted by".
//
// NULL when there are no participants, and the page renders "Nobody recorded as visiting" rather
// than falling back to the recorder. A fallback would re-create the exact ambiguity this slice
// exists to remove: the person who typed a visit in is frequently not the person who went.
export function conductedByLabel(participants: readonly VisitParticipant[]): string | null {
  if (participants.length === 0) return null;

  const names = participants.map((participant) => participant.displayName);

  if (names.length === 1) return names[0]!;

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
