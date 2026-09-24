import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionItem } from "@/lib/agendas/carryForward";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isTodoUntouched } from "@/lib/todos/untouched";
import type { Database } from "@/types/database";

// WRITES TO ANOTHER PERSON'S TO-DO, on behalf of the SOURCE that assigned the work — today an agenda
// action item (slice p5-b); a speaker ask and a Zoom referral later, each with its own link column.
//
// ---------------------------------------------------------------------------
// THE SERVICE ROLE, AND WHAT STANDS IN FOR RLS HERE
// ---------------------------------------------------------------------------
// `todos` is owner-only on every verb and its INSERT refuses any `assigned_by` (migration 081, D2
// and D3), so no authenticated client can create, flag or unlink somebody else's to-do — which is
// the point. The source's route is the boundary instead, and every caller must have:
//   1. passed `assertCan(agendas.manage)` for the ward it is acting in, and
//   2. read the action item through its OWN RLS-scoped client first, so the `wardId` and item id
//      handed here are ones RLS already admitted.
// The service role has no RLS behind it, so EVERY write below sets and filters `ward_id`
// explicitly (rule 1).
//
// NOTHING HERE READS A TO-DO'S TEXT back to the caller. The results are ids, for the audit detail;
// the assigner never sees the to-do, its steps or its log (D2).
//
// NO AUDIT ROW IS WRITTEN HERE — the route writes one, carrying these ids (lib/callings/
// writeCalling.ts carries the same note for the same reason).

type Client = SupabaseClient<Database>;

// `todos.title` is capped at 300 by migration 081; an action item's description may be 500. The
// full description stays on the agenda, which is where the assignee is pointed.
const MAX_TODO_TITLE = 300;

// The action item was saved; its assignee's to-do was not brought into line with it. The route
// answers 500 with this sentence rather than "Please try again" alone, because the item change
// already happened — and re-sending the same request is safe, since every function here is
// idempotent.
export class SourceLinkWriteError extends Error {
  constructor(cause: unknown) {
    super(
      "The action item was saved, but the assignee's to-do could not be updated. Please try again.",
    );
    this.name = "SourceLinkWriteError";
    this.cause = cause;
  }
}

function fail(context: string, error: { message: string }, detail: Record<string, unknown>): never {
  console.error(`${context} — ${error.message}`, detail);
  throw new SourceLinkWriteError(error);
}

function toTodoTitle(description: string): string {
  const trimmed = description.trim();
  return trimmed.length <= MAX_TODO_TITLE ? trimmed : `${trimmed.slice(0, MAX_TODO_TITLE - 1)}…`;
}

export type ActionItemTodoSync = {
  created: string | null;
  deleted: string[];
  unlinked: string[];
};

// ---------------------------------------------------------------------------
// ASSIGNING — create the new assignee's to-do; release the previous one's
// ---------------------------------------------------------------------------
// Called whenever a request NAMED the assignee (create with `assignedUserId`, or a PATCH carrying
// it), even when the value did not change: "ensure it exists" rather than "create on change" is
// what makes a retry after a SourceLinkWriteError actually repair the missing to-do.
//
// THE PREVIOUS ASSIGNEE'S TO-DO IS DELETED ONLY IF UNTOUCHED (lib/todos/untouched.ts) and is
// otherwise UNLINKED AND KEPT — never destroy what somebody wrote. Once unlinked it is simply one
// of their own to-dos.
export async function syncActionItemTodo(params: {
  wardId: string;
  actionItem: ActionItem;
  previousAssignedUserId: string | null;
  assignedByUserId: string;
  client?: Client;
}): Promise<ActionItemTodoSync> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const { wardId, actionItem } = params;
  const result: ActionItemTodoSync = { created: null, deleted: [], unlinked: [] };

  if (
    params.previousAssignedUserId !== null &&
    params.previousAssignedUserId !== actionItem.assignedUserId
  ) {
    const released = await releaseLinkedTodos(supabase, wardId, actionItem.id, params.previousAssignedUserId);
    result.deleted.push(...released.deleted);
    result.unlinked.push(...released.unlinked);
  }

  if (actionItem.assignedUserId !== null && actionItem.status === "open") {
    result.created = await ensureLinkedTodo(supabase, {
      wardId,
      actionItem,
      ownerId: actionItem.assignedUserId,
      assignedByUserId: params.assignedByUserId,
    });
  }

  return result;
}

// Before an action item is deleted: remove its untouched to-dos, unlink the rest. The foreign key's
// `on delete set null` would unlink them anyway; doing it here first is what stops an untouched
// auto-created to-do outliving a line typed by mistake.
export async function releaseTodosForDeletedActionItem(params: {
  wardId: string;
  actionItemId: string;
  client?: Client;
}): Promise<Omit<ActionItemTodoSync, "created">> {
  const supabase = params.client ?? createServiceSupabaseClient();
  return releaseLinkedTodos(supabase, params.wardId, params.actionItemId, null);
}

// Returns the id of the linked to-do — the new one, or the one already there — or null when there
// is none to link (never for an open, assigned item).
async function ensureLinkedTodo(
  supabase: Client,
  params: { wardId: string; actionItem: ActionItem; ownerId: string; assignedByUserId: string },
): Promise<string | null> {
  const { wardId, actionItem, ownerId } = params;
  const detail = { wardId, actionItemId: actionItem.id };

  const existing = await findLinkedTodoId(supabase, wardId, actionItem.id, ownerId);
  if (existing !== null) return null;

  const { data, error } = await supabase
    .from("todos")
    .insert({
      ward_id: wardId,
      user_id: ownerId,
      assigned_by: params.assignedByUserId,
      title: toTodoTitle(actionItem.description),
      due_date: actionItem.dueDate,
      action_item_id: actionItem.id,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 is todos_one_per_action_item_owner: a concurrent request created it first (migration
    // 082c). That is the outcome this call wanted, so it is not a failure.
    if (error.code === "23505") return null;
    fail("Could not create an assignee's to-do", error, detail);
  }

  return data.id;
}

async function findLinkedTodoId(
  supabase: Client,
  wardId: string,
  actionItemId: string,
  ownerId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("todos")
    .select("id")
    .eq("ward_id", wardId)
    .eq("action_item_id", actionItemId)
    .eq("user_id", ownerId)
    .maybeSingle();

  if (error) fail("Could not read an assignee's to-do", error, { wardId, actionItemId });
  return data?.id ?? null;
}

type LinkedTodoRow = {
  id: string;
  completed_at: string | null;
  scheduled_for: string | null;
  todo_steps: { count: number }[] | null;
  todo_log_entries: { count: number }[] | null;
};

// `ownerId` null means every owner — the item itself is going away.
async function releaseLinkedTodos(
  supabase: Client,
  wardId: string,
  actionItemId: string,
  ownerId: string | null,
): Promise<Omit<ActionItemTodoSync, "created">> {
  const detail = { wardId, actionItemId };

  let query = supabase
    .from("todos")
    .select("id, completed_at, scheduled_for, todo_steps (count), todo_log_entries (count)")
    .eq("ward_id", wardId)
    .eq("action_item_id", actionItemId);
  if (ownerId !== null) query = query.eq("user_id", ownerId);

  const { data, error } = await query;
  if (error) fail("Could not read the to-dos linked to an action item", error, detail);

  const rows = (data ?? []) as unknown as LinkedTodoRow[];
  const deleted: string[] = [];
  const unlinked: string[] = [];

  for (const row of rows) {
    const untouched = isTodoUntouched(
      { completedAt: row.completed_at, scheduledFor: row.scheduled_for },
      row.todo_steps?.[0]?.count ?? 0,
      row.todo_log_entries?.[0]?.count ?? 0,
    );
    if (untouched) deleted.push(row.id);
    else unlinked.push(row.id);
  }

  if (deleted.length > 0) {
    const { error: deleteError } = await supabase
      .from("todos")
      .delete()
      .eq("ward_id", wardId)
      .in("id", deleted);
    if (deleteError) fail("Could not remove an untouched to-do", deleteError, detail);
  }

  if (unlinked.length > 0) {
    const { error: unlinkError } = await supabase
      .from("todos")
      .update({ action_item_id: null, updated_at: new Date().toISOString() })
      .eq("ward_id", wardId)
      .in("id", unlinked);
    if (unlinkError) fail("Could not unlink a to-do from its action item", unlinkError, detail);
  }

  return { deleted, unlinked };
}

// ---------------------------------------------------------------------------
// COMPLETING ON THE AGENDA — a FLAG on the to-do, never a delete and never a completion
// ---------------------------------------------------------------------------
// The owner's steps and notes are theirs, and whether their own work is finished is theirs to say
// (decisions.md §1, "confirm, don't silently act"). An open to-do gets `source_completed_at` and a
// `source_completed` timeline line; a to-do the owner already completed is left alone.
export async function flagTodosForCompletedActionItem(params: {
  wardId: string;
  actionItemId: string;
  client?: Client;
}): Promise<string[]> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const { wardId, actionItemId } = params;
  const detail = { wardId, actionItemId };

  const { data, error } = await supabase
    .from("todos")
    .update({ source_completed_at: new Date().toISOString() })
    .eq("ward_id", wardId)
    .eq("action_item_id", actionItemId)
    .is("completed_at", null)
    .is("source_completed_at", null)
    .select("id");

  if (error) fail("Could not flag the to-dos of a completed action item", error, detail);

  const flagged = (data ?? []).map((row) => row.id);
  if (flagged.length === 0) return flagged;

  const { error: logError } = await supabase.from("todo_log_entries").insert(
    flagged.map((todoId) => ({
      ward_id: wardId,
      todo_id: todoId,
      kind: "source_completed",
      body: null,
    })),
  );
  if (logError) fail("Could not write a to-do's 'completed on the agenda' line", logError, detail);

  return flagged;
}

// A reopened action item withdraws the flag, so a mis-tick is recoverable (060a's rule). The
// timeline line stays: it records something that did happen.
export async function clearTodoFlagsForReopenedActionItem(params: {
  wardId: string;
  actionItemId: string;
  client?: Client;
}): Promise<string[]> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const { wardId, actionItemId } = params;

  const { data, error } = await supabase
    .from("todos")
    .update({ source_completed_at: null })
    .eq("ward_id", wardId)
    .eq("action_item_id", actionItemId)
    .not("source_completed_at", "is", null)
    .select("id");

  if (error) fail("Could not clear the to-do flags of a reopened action item", error, { wardId, actionItemId });
  return (data ?? []).map((row) => row.id);
}

// ---------------------------------------------------------------------------
// CARRY-FORWARD — the link follows the work to the newest copy
// ---------------------------------------------------------------------------
// Carry-forward COPIES an open item onto the next agenda and leaves the original untouched and
// open, as a record of the earlier meeting (lib/agendas/carryForward.ts). The copy is the LIVE
// item: it is the one the next meeting completes. Left on the original, the link would never see
// that completion, the review flag would land on an agenda nobody opens again, and the owner could
// never delete the to-do, because the original stays open for ever.
export async function relinkCarriedActionItemTodos(params: {
  wardId: string;
  moves: readonly { fromItemId: string; toItemId: string }[];
  client?: Client;
}): Promise<string[]> {
  if (params.moves.length === 0) return [];

  const supabase = params.client ?? createServiceSupabaseClient();
  const moved: string[] = [];

  for (const move of params.moves) {
    const { data, error } = await supabase
      .from("todos")
      .update({ action_item_id: move.toItemId })
      .eq("ward_id", params.wardId)
      .eq("action_item_id", move.fromItemId)
      .select("id");

    if (error) {
      fail("Could not move a to-do's link to its carried action item", error, {
        wardId: params.wardId,
        ...move,
      });
    }
    moved.push(...(data ?? []).map((row) => row.id));
  }

  return moved;
}
