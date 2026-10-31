import type { SupabaseClient } from "@supabase/supabase-js";
import { closeMatchTodos, DECLINED_LINE } from "@/lib/todos/zoomLinks";
import type { Database } from "@/types/database";

// THE BISHOPRIC'S ANSWERS TO A PUBLIC ZOOM SIGN-UP (ITER-052 z3b, plan P2/P3/D1/D2).
//
// Approval is UNANIMOUS among whoever serves in the bishopric at the moment of each answer, and it
// is decided inside respond_to_zoom_registration() (migration 096), which locks the row, records
// the answer and — once nobody serving is left to approve — approves and gives a link in the same
// transaction. Any ONE member may decline, because approval needs everybody anyway.
//
// Every function here uses the SERVICE ROLE: the tables have no write policy, and the caller has
// already passed canManageInvitees(). Every query filters `ward_id` (rule 1).
//
// The decline note is the bishopric's alone (migration 098): no signed-in client can select it, so
// readDeclineNotes() is the only reader and must only ever run after canManageInvitees().

type Client = SupabaseClient<Database>;

export type RespondAction = "approve" | "talk_first" | "finish";

export type RespondResult =
  | { status: "not_pending" }
  | { status: "pending"; waitingOn: string[] }
  | { status: "approved"; inviteeId: string; joinLinkId: string | null };

export async function respondToRegistration(
  params: { wardId: string; registrationId: string; userId: string; response: RespondAction },
  service: Client,
): Promise<RespondResult> {
  const { data, error } = await service.rpc("respond_to_zoom_registration", {
    p_ward_id: params.wardId,
    p_registration_id: params.registrationId,
    p_user_id: params.userId,
    p_response: params.response,
  });

  if (error) {
    console.error(`Could not record an answer on a Zoom sign-up — ${error.message}`, {
      wardId: params.wardId,
      registrationId: params.registrationId,
    });
    throw new Error(`Could not record your answer: ${error.message}`);
  }

  const row = (data ?? [])[0];
  if (!row) return { status: "not_pending" };
  if (row.status === "approved" && row.invitee_id) {
    return { status: "approved", inviteeId: row.invitee_id, joinLinkId: row.join_link_id ?? null };
  }
  return { status: "pending", waitingOn: row.waiting_on ?? [] };
}

export type DeclineResult =
  | { status: "not_pending" }
  | { status: "declined"; closedTodoIds: string[] };

// Conditional on `status = 'pending'`, so a request decided a moment ago by somebody else is not
// overwritten: zero rows means not pending. The match to-dos close with their own line — there is
// nobody to match any more.
export async function declineRegistration(
  params: { wardId: string; registrationId: string; userId: string; note: string | null },
  service: Client,
): Promise<DeclineResult> {
  const now = new Date().toISOString();
  const { data, error } = await service
    .from("zoom_registrations")
    .update({
      status: "declined",
      decided_by: params.userId,
      decided_at: now,
      decline_note: params.note,
      held_reason: null,
      updated_at: now,
    })
    .eq("ward_id", params.wardId)
    .eq("id", params.registrationId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error(`Could not decline a Zoom sign-up — ${error.message}`, {
      wardId: params.wardId,
      registrationId: params.registrationId,
    });
    throw new Error(`Could not decline the sign-up: ${error.message}`);
  }
  if ((data ?? []).length === 0) return { status: "not_pending" };

  const closedTodoIds = await closeMatchTodos(
    { wardId: params.wardId, registrationId: params.registrationId, line: DECLINED_LINE },
    service,
  );
  return { status: "declined", closedTodoIds };
}

// The private notes on the declined sign-ups a page is about to show, keyed by registration id.
// SERVICE ROLE, and only after canManageInvitees(): the clerk and the executive secretary read the
// same Sign-ups tab and must never receive these (addendum A1).
export async function readDeclineNotes(
  wardId: string,
  registrationIds: readonly string[],
  service: Client,
): Promise<Record<string, string>> {
  if (registrationIds.length === 0) return {};

  const { data, error } = await service
    .from("zoom_registrations")
    .select("id, decline_note")
    .eq("ward_id", wardId)
    .eq("status", "declined")
    .in("id", [...registrationIds])
    .not("decline_note", "is", null);

  if (error) {
    console.error(`Could not read the Zoom sign-up decline notes — ${error.message}`, { wardId });
    throw new Error(`Could not read the decline notes: ${error.message}`);
  }

  const notes: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.decline_note) notes[row.id] = row.decline_note;
  }
  return notes;
}
