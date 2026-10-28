import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// WRITES THE "GIVE ___ A ZOOM LINK" TO-DO — ITER-053 z2c, migration 095c. The sibling of
// lib/todos/musicLinks.ts. A hand-out with an empty pool saves the person as waiting (D1) and puts
// this to-do on the list of the leader who did the hand-out; giving that person a link closes it.
//
// ---------------------------------------------------------------------------
// THE SERVICE ROLE, AND WHAT STANDS IN FOR RLS HERE
// ---------------------------------------------------------------------------
// `todos` is owner-only and its INSERT is open only to the owner (migration 081), and the close may
// land on ANOTHER bishopric member's list — whoever did the hand-out is not always whoever gives the
// link. So every caller must have:
//   1. passed canManageInvitees(), the write boundary for `zoom_invitees`, and
//   2. just written the invitee row itself, in this ward, so `inviteeId` is one the route created
//      or read with `ward_id` filtered.
// The service role has no RLS behind it, so EVERY write below sets and filters `ward_id` (rule 1).
//
// NO AUDIT ROW IS WRITTEN HERE; the route writes one carrying these ids. The title holds the
// person's name, which is fine — the to-do is its owner's own — and it never enters an audit row.
//
// ---------------------------------------------------------------------------
// BOTH FUNCTIONS ARE IDEMPOTENT
// ---------------------------------------------------------------------------
// Creation meets `todos_one_open_zoom_link_todo_per_owner` (095c) and 23505 counts as "already
// there"; the close is conditional on the to-do still being open.

type Client = SupabaseClient<Database>;

const ZOOM_TAG = "Zoom";
const LINK_GIVEN_LINE = "A Zoom link was given.";

// The invitee change was saved, and bringing its to-do into line was not. The route answers 500
// with this sentence, because the change it made already happened.
export class ZoomLinkWriteError extends Error {
  constructor(cause: unknown) {
    super("The Zoom link was saved, but the to-do that goes with it could not be updated. Please try again.");
    this.name = "ZoomLinkWriteError";
    this.cause = cause;
  }
}

function fail(context: string, error: { message: string }, detail: Record<string, unknown>): never {
  console.error(`${context} — ${error.message}`, detail);
  throw new ZoomLinkWriteError(error);
}

export function waitingLinkTodoTitle(displayName: string): string {
  return `Give ${displayName} a Zoom link`;
}

// `assigned_by` is null: the owner did the hand-out themselves, and null means self (talks-d).
export async function createWaitingLinkTodo(
  params: { wardId: string; ownerUserId: string; inviteeId: string; displayName: string },
  service: Client,
): Promise<string> {
  const detail = { wardId: params.wardId, inviteeId: params.inviteeId };

  const { data, error } = await service
    .from("todos")
    .insert({
      ward_id: params.wardId,
      user_id: params.ownerUserId,
      assigned_by: null,
      title: waitingLinkTodoTitle(params.displayName),
      tag: ZOOM_TAG,
      notes: null,
      zoom_invitee_id: params.inviteeId,
    })
    .select("id")
    .single();

  if (!error) return data.id;
  if (error.code !== "23505") fail("Could not create a Zoom link to-do", error, detail);

  const { data: existing, error: readError } = await service
    .from("todos")
    .select("id")
    .eq("ward_id", params.wardId)
    .eq("zoom_invitee_id", params.inviteeId)
    .eq("user_id", params.ownerUserId)
    .is("completed_at", null)
    .single();
  if (readError) fail("Could not read an open Zoom link to-do", readError, detail);
  return existing.id;
}

// Closes every OPEN to-do for this person, whoever holds it: the job it asked for is done. No
// `closed_reason` — the to-do did its job — and a `source_completed` line says why it closed.
export async function closeWaitingLinkTodos(
  params: { wardId: string; inviteeId: string },
  service: Client,
): Promise<string[]> {
  const detail = { wardId: params.wardId, inviteeId: params.inviteeId };
  const now = new Date().toISOString();

  const { data, error } = await service
    .from("todos")
    .update({ completed_at: now, closed_reason: null, updated_at: now })
    .eq("ward_id", params.wardId)
    .eq("zoom_invitee_id", params.inviteeId)
    .is("completed_at", null)
    .select("id");
  if (error) fail("Could not close a Zoom link to-do", error, detail);

  const closedIds = (data ?? []).map((row) => row.id);
  if (closedIds.length === 0) return closedIds;

  const { error: lineError } = await service.from("todo_log_entries").insert(
    closedIds.map((todoId) => ({
      ward_id: params.wardId,
      todo_id: todoId,
      kind: "source_completed",
      body: LINK_GIVEN_LINE,
    })),
  );
  if (lineError) fail("Could not write the 'link given' line on a Zoom to-do", lineError, detail);

  return closedIds;
}
