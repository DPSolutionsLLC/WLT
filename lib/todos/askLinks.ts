import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import type { TodoClosedReason, TodoLogKind } from "@/types/domain";

// WRITES TO A LEADER'S "ASK ___ TO SPEAK" TO-DOS, on behalf of the Sunday that owns the talk
// (Sacrament slice f, migration 083). The sibling of lib/todos/sourceLinks.ts, not an extension of
// it: that file speaks for an agenda item, this one for a talk.
//
// ---------------------------------------------------------------------------
// THE SERVICE ROLE, AND WHAT STANDS IN FOR RLS HERE
// ---------------------------------------------------------------------------
// `todos` is owner-only on every verb and its INSERT refuses any `assigned_by` (migration 081, D2
// and D3). Even the conductor's OWN asks need the service role, because they carry
// `assigned_by`. It also covers the second owner the assistant brings in f3. The route is the
// boundary instead, and every caller must have:
//   1. passed the talk's own permission check for the ward it is acting in: `talks.request` to
//      send or answer, `talks.plan` for the speaker change that closes an ask, and
//   2. read the Sunday or the talk through its OWN RLS-scoped client first, so the `wardId` and
//      ids handed here are ones RLS already admitted.
// The service role has no RLS behind it, so EVERY write below sets and filters `ward_id`
// explicitly (rule 1).
//
// NOTHING HERE READS A TO-DO'S TEXT back to the caller. The results are ids, for the audit detail.
// Neither holder of an ask can read the other's steps or notes (D2).
//
// NO AUDIT ROW IS WRITTEN HERE. The route writes one, carrying these ids.
//
// ---------------------------------------------------------------------------
// EVERY FUNCTION IS IDEMPOTENT
// ---------------------------------------------------------------------------
// supabase-js has no transaction. A run can stop half-way, so a repeat of the same request must
// repair it rather than double it:
//   - creation meets migration 083b's partial unique index, and 23505 counts as success
//   - every close or resolve is conditional on the ask still being open (`completed_at is null`)

type Client = SupabaseClient<Database>;

// The talk's outcome (or its speaker) was saved, and bringing its asks into line was not. The
// route answers 500 with its own sentence, because the change it made already happened. Re-sending
// is safe, since everything here is idempotent.
//
// `completedIds` are the to-dos this call DID write before it stopped, so the route's audit row
// can still name them (rule 6).
export class AskLinkWriteError extends Error {
  readonly completedIds: readonly string[];

  constructor(cause: unknown, completedIds: readonly string[] = []) {
    super("The talk was saved, but its ask to-dos could not all be updated. Please try again.");
    this.name = "AskLinkWriteError";
    this.cause = cause;
    this.completedIds = completedIds;
  }
}

function fail(
  context: string,
  error: { message: string },
  detail: Record<string, unknown>,
  completedIds: readonly string[] = [],
): never {
  console.error(`${context} — ${error.message}`, detail);
  throw new AskLinkWriteError(error, completedIds);
}

export type AskToCreate = {
  assignmentId: string;
  title: string;
  notes: string;
};

// ---------------------------------------------------------------------------
// SEND ASKS — one open ask per (talk, owner)
// ---------------------------------------------------------------------------
// `ownerUserIds` is the conductor, plus the assistant once f3 builds one. `today` is the WARD's
// date (wardDateOnly), never the server's, so an ask sent on a Saturday evening in Denver is not
// dated Sunday.
//
// Returns the ids it created. An ask that already existed is not returned: it was not created by
// this call.
export async function createAsksForSunday(params: {
  wardId: string;
  sundayId: string;
  ownerUserIds: readonly string[];
  asks: readonly AskToCreate[];
  assignedByUserId: string;
  today: string;
  client?: Client;
}): Promise<string[]> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const created: string[] = [];
  const owners = [...new Set(params.ownerUserIds)];

  for (const ask of params.asks) {
    for (const ownerId of owners) {
      const { data, error } = await supabase
        .from("todos")
        .insert({
          ward_id: params.wardId,
          user_id: ownerId,
          assigned_by: params.assignedByUserId,
          title: ask.title,
          notes: ask.notes,
          tag: "Sacrament",
          do_date: params.today,
          ask_assignment_id: ask.assignmentId,
        })
        .select("id")
        .single();

      if (error) {
        // 23505 is todos_one_open_ask_per_owner (migration 083b): this person already holds an
        // open ask for this talk. That is the outcome this call wanted, so it is not a failure.
        if (error.code === "23505") continue;
        fail(
          "Could not create a talk's ask to-do",
          error,
          { wardId: params.wardId, sundayId: params.sundayId, assignmentId: ask.assignmentId },
          created,
        );
      }

      created.push(data.id);
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// THE ANSWER CLOSES EVERY COPY
// ---------------------------------------------------------------------------
// ⚠️ THE ONE DELIBERATE EXCEPTION TO p5-b's "FLAG, NEVER COMPLETE". An agenda item and its to-do
// are an assigner's decision and an assignee's work, so neither completes the other. An ask is
// different: the conductor and the assistant hold copies of ONE piece of work, and once the speaker
// has answered there is nothing left for either of them to do. Leaving the other copy open would
// ask the speaker twice (U4).
//
// `reasonLabel` is the decline reason's LABEL ("Not available"), written into the timeline line.
// It is never the free-text note, which stays on the talk.
export async function resolveAsksForAssignment(params: {
  wardId: string;
  assignmentId: string;
  outcome: "accepted" | "declined";
  reasonLabel: string | null;
  client?: Client;
}): Promise<string[]> {
  const kind: TodoLogKind = params.outcome === "accepted" ? "ask_accepted" : "ask_declined";
  const body = params.outcome === "declined" ? params.reasonLabel : null;
  return completeOpenAsks(params, { closedReason: null, kind, body });
}

// ---------------------------------------------------------------------------
// CLOSED WITHOUT AN ANSWER — never deleted
// ---------------------------------------------------------------------------
// A speaker change (f1), a handover (f2) or an assistant released (f3). The ask is done for this
// person, and whatever they wrote on it stays with it. `body` is the new owner's name for a
// handover and null otherwise.
export async function closeAsksForAssignment(params: {
  wardId: string;
  assignmentId: string;
  reason: TodoClosedReason;
  body?: string | null;
  client?: Client;
}): Promise<string[]> {
  return completeOpenAsks(params, {
    closedReason: params.reason,
    kind: params.reason,
    body: params.body ?? null,
  });
}

async function completeOpenAsks(
  params: { wardId: string; assignmentId: string; client?: Client },
  line: { closedReason: TodoClosedReason | null; kind: TodoLogKind; body: string | null },
): Promise<string[]> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const detail = { wardId: params.wardId, assignmentId: params.assignmentId, kind: line.kind };
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("todos")
    .update({ completed_at: now, closed_reason: line.closedReason, updated_at: now })
    .eq("ward_id", params.wardId)
    .eq("ask_assignment_id", params.assignmentId)
    .is("completed_at", null)
    .select("id");

  if (error) fail("Could not close a talk's open asks", error, detail);

  const closed = (data ?? []).map((row) => row.id);
  if (closed.length === 0) return closed;

  const { error: logError } = await supabase.from("todo_log_entries").insert(
    closed.map((todoId) => ({
      ward_id: params.wardId,
      todo_id: todoId,
      kind: line.kind,
      body: line.body,
    })),
  );
  if (logError) fail("Could not write the timeline line on a closed ask", logError, detail);

  return closed;
}

// ---------------------------------------------------------------------------
// READS FOR THE HUB AND THE SEND ROUTE
// ---------------------------------------------------------------------------
// How many OPEN asks each talk has, across every owner, in one query. This read uses the SERVICE
// role because the answer must not depend on who is looking: the conductor's asks are invisible to
// the bishop under migration 081, so counted through the bishop's own client, every talk would
// read "not yet asked" and Send asks would ask again. It returns a COUNT per talk id and never a
// row. The caller has already read those talk ids through its own client.
export async function countOpenAsksByAssignment(params: {
  wardId: string;
  assignmentIds: readonly string[];
  client?: Client;
}): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (params.assignmentIds.length === 0) return counts;

  const supabase = params.client ?? createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("todos")
    .select("ask_assignment_id")
    .eq("ward_id", params.wardId)
    .in("ask_assignment_id", [...params.assignmentIds])
    .is("completed_at", null);

  if (error) {
    console.error(`Could not count a Sunday's open asks — ${error.message}`, {
      wardId: params.wardId,
    });
    throw new Error(`Could not check who has been asked: ${error.message}`);
  }

  for (const row of data ?? []) {
    if (row.ask_assignment_id === null) continue;
    counts.set(row.ask_assignment_id, (counts.get(row.ask_assignment_id) ?? 0) + 1);
  }

  return counts;
}
