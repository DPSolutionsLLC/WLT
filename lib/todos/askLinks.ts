import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { AskCopy } from "@/lib/todos/timeElsewhere";
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
  // Only the asks whose owner was told the talk is off (f2b's back-on close). An ask sent after the
  // talk came back on is a fresh one and must not be closed with them.
  onlyTalkOff?: boolean;
  client?: Client;
}): Promise<string[]> {
  return completeOpenAsks(params, {
    closedReason: params.reason,
    kind: params.reason,
    body: params.body ?? null,
  });
}

async function completeOpenAsks(
  params: { wardId: string; assignmentId: string; onlyTalkOff?: boolean; client?: Client },
  line: { closedReason: TodoClosedReason | null; kind: TodoLogKind; body: string | null },
): Promise<string[]> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const detail = { wardId: params.wardId, assignmentId: params.assignmentId, kind: line.kind };
  const now = new Date().toISOString();

  let update = supabase
    .from("todos")
    .update({ completed_at: now, closed_reason: line.closedReason, updated_at: now })
    .eq("ward_id", params.wardId)
    .eq("ask_assignment_id", params.assignmentId)
    .is("completed_at", null);
  if (params.onlyTalkOff === true) update = update.not("talk_off_at", "is", null);

  const { data, error } = await update.select("id");

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

// Every OPEN ask on these talks, with who holds it and when it is scheduled. Service role, for the
// same reason as the count above: the handover must see the old conductor's asks whoever makes
// the change. Ids and times only, never a title, notes or steps (D2).
export type OpenAsk = {
  todoId: string;
  assignmentId: string;
  ownerUserId: string;
  scheduledFor: string | null;
  scheduledWithMemberId: string | null;
  // Set once the owner was told the talk is off (f2b).
  talkOffAt: string | null;
};

export async function listOpenAsks(params: {
  wardId: string;
  assignmentIds: readonly string[];
  client?: Client;
}): Promise<OpenAsk[]> {
  if (params.assignmentIds.length === 0) return [];

  const supabase = params.client ?? createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("todos")
    .select("id, ask_assignment_id, user_id, scheduled_for, scheduled_with_member_id, talk_off_at")
    .eq("ward_id", params.wardId)
    .in("ask_assignment_id", [...params.assignmentIds])
    .is("completed_at", null);

  if (error) {
    console.error(`Could not read a Sunday's open asks — ${error.message}`, {
      wardId: params.wardId,
    });
    throw new Error(`Could not read who holds this Sunday's asks: ${error.message}`);
  }

  return (data ?? []).flatMap((row) =>
    row.ask_assignment_id === null
      ? []
      : [
          {
            todoId: row.id,
            assignmentId: row.ask_assignment_id,
            ownerUserId: row.user_id,
            scheduledFor: row.scheduled_for,
            scheduledWithMemberId: row.scheduled_with_member_id,
            talkOffAt: row.talk_off_at,
          },
        ],
  );
}

// Every copy of an ask on these talks, open or closed, with who holds it and when they are meeting
// the speaker — for "Peter Nakamura has this set for …" on another holder's card (f3a,
// lib/todos/timeElsewhere.ts). Service role, because a to-do is owner-only (migration 081) and this
// is the one thing about another leader's copy the holder is shown: a time, who it is with, and the
// holder's name. NEVER a title, notes or steps — the select list is the guarantee.
export async function listAskCopies(params: {
  wardId: string;
  assignmentIds: readonly string[];
  client?: Client;
}): Promise<AskCopy[]> {
  if (params.assignmentIds.length === 0) return [];

  const supabase = params.client ?? createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("todos")
    .select(
      "id, ask_assignment_id, user_id, scheduled_for, completed_at, closed_reason, created_at, owner:users!todos_user_id_fkey (first_name, last_name), scheduled_member:members!todos_scheduled_with_member_id_ward_id_fkey (first_name, last_name)",
    )
    .eq("ward_id", params.wardId)
    .in("ask_assignment_id", [...params.assignmentIds]);

  if (error) {
    console.error(`Could not read the other copies of an ask — ${error.message}`, {
      wardId: params.wardId,
    });
    throw new Error(`Could not check whether another leader has a time set: ${error.message}`);
  }

  return (data ?? []).flatMap((row) =>
    row.ask_assignment_id === null
      ? []
      : [
          {
            todoId: row.id,
            assignmentId: row.ask_assignment_id,
            ownerUserId: row.user_id,
            ownerName: personName(row.owner),
            scheduledFor: row.scheduled_for,
            withName: personName(row.scheduled_member),
            completedAt: row.completed_at,
            closedReason: row.closed_reason,
            createdAt: row.created_at,
          },
        ],
  );
}

function personName(
  row: { first_name: string | null; last_name: string | null } | null,
): string | null {
  if (row === null) return null;
  const name = [row.first_name, row.last_name]
    .filter((part) => part !== null && part !== "")
    .join(" ");
  return name === "" ? null : name;
}

// ---------------------------------------------------------------------------
// HANDOVER — the work follows the conductor (f2, U3 and U6)
// ---------------------------------------------------------------------------
// For each ask: the new owner's CLEAN copy is created FIRST, then the old copy is closed with a
// `handed_over` line naming the new owner. In that order, a run that stops half-way leaves the
// work held twice rather than by nobody, and a repeat finishes it: the new copy meets the partial
// unique index (23505, already there) and the close is conditional on the old copy still being
// open.
//
// NOBODY INHERITS AN APPOINTMENT (f3a, decision A1, 2026-09-30 — reversing f2's "the appointment
// follows the work"). The new copy carries no `scheduled_for`: a time the old conductor arranged
// was arranged around THEIR week, and dropping it silently into the new conductor's My
// Appointments made it look like theirs. The old copy keeps its time as the record, and the new
// holder's card says who had one set (lib/todos/timeElsewhere.ts). The old owner's notes and steps
// never move either — `ask` is built fresh from the talk (buildAsksForTalks), and the old copy is
// closed, never deleted.
export type AskHandover = {
  fromTodoId: string;
  // The previous owner's name, for the new copy's "Taken over from ___" line.
  fromName: string;
  ask: AskToCreate;
};

export async function handOverAsks(params: {
  wardId: string;
  toUserId: string;
  toName: string;
  handovers: readonly AskHandover[];
  assignedByUserId: string;
  today: string;
  client?: Client;
}): Promise<{ createdIds: string[]; closedIds: string[] }> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const createdIds: string[] = [];
  const closedIds: string[] = [];
  const done = () => [...createdIds, ...closedIds];

  for (const handover of params.handovers) {
    const detail = {
      wardId: params.wardId,
      assignmentId: handover.ask.assignmentId,
      fromTodoId: handover.fromTodoId,
    };

    const { data: created, error: createError } = await supabase
      .from("todos")
      .insert({
        ward_id: params.wardId,
        user_id: params.toUserId,
        assigned_by: params.assignedByUserId,
        title: handover.ask.title,
        notes: handover.ask.notes,
        tag: "Sacrament",
        do_date: params.today,
        ask_assignment_id: handover.ask.assignmentId,
      })
      .select("id")
      .single();

    // 23505: the new owner already holds an open ask for this talk — a repeat of a run that
    // stopped after the copy. Theirs stands, and the old copy still has to close.
    if (createError && createError.code !== "23505") {
      fail("Could not create the new conductor's copy of an ask", createError, detail, done());
    }
    if (created) {
      createdIds.push(created.id);
      const { error: takenOverError } = await supabase.from("todo_log_entries").insert({
        ward_id: params.wardId,
        todo_id: created.id,
        kind: "taken_over",
        body: handover.fromName,
      });
      if (takenOverError) {
        fail("Could not write the taken-over line on an ask", takenOverError, detail, done());
      }
    }

    const now = new Date().toISOString();
    const { data: closed, error: closeError } = await supabase
      .from("todos")
      .update({ completed_at: now, closed_reason: "handed_over", updated_at: now })
      .eq("ward_id", params.wardId)
      .eq("id", handover.fromTodoId)
      .is("completed_at", null)
      .select("id");

    if (closeError) fail("Could not close a handed-over ask", closeError, detail, done());

    for (const row of closed ?? []) {
      const { error: logError } = await supabase.from("todo_log_entries").insert({
        ward_id: params.wardId,
        todo_id: row.id,
        kind: "handed_over",
        body: params.toName,
      });
      if (logError) {
        fail("Could not write the handover line on an ask", logError, detail, done());
      }
      closedIds.push(row.id);
    }
  }

  return { createdIds, closedIds };
}

// ---------------------------------------------------------------------------
// THE TALK IS OFF — Sacrament slice f2b
// ---------------------------------------------------------------------------
// Its Sunday holds no meeting any more, or its slot is gone (talkIsOff()). Whoever asked the
// speaker must tell them, so the ask STAYS on their list, stamped `talk_off_at`, with a line saying
// so. The card then offers "Told them" in place of Accepted / Declined. Conditional on the stamp
// still being empty, so a repeat writes nothing twice. `sundayLabel` is the Sunday in words,
// snapshotted into the line.
export async function markAsksTalkOff(params: {
  wardId: string;
  todoIds: readonly string[];
  sundayLabel: string;
  client?: Client;
}): Promise<string[]> {
  if (params.todoIds.length === 0) return [];
  const supabase = params.client ?? createServiceSupabaseClient();
  const detail = { wardId: params.wardId, todoCount: params.todoIds.length };
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("todos")
    .update({ talk_off_at: now, updated_at: now })
    .eq("ward_id", params.wardId)
    .in("id", [...params.todoIds])
    .is("completed_at", null)
    .is("talk_off_at", null)
    .select("id");
  if (error) fail("Could not mark an ask's talk as off", error, detail);

  const marked = (data ?? []).map((row) => row.id);
  if (marked.length === 0) return marked;

  const { error: logError } = await supabase.from("todo_log_entries").insert(
    marked.map((todoId) => ({
      ward_id: params.wardId,
      todo_id: todoId,
      kind: "talk_off",
      body: params.sundayLabel,
    })),
  );
  if (logError) fail("Could not write the talk-off line on an ask", logError, detail, marked);

  return marked;
}

// SOMEBODY MUST BE TOLD IT'S CANCELLED — a to-do linked to what was cancelled and stamped
// `talk_off_at` from the start, so the card offers "Told them". Three kinds (Sacrament slices f2b
// and f2c):
//   - a talk whose speaker had ALREADY ACCEPTED, so no open ask is left to mark: whoever asked them;
//   - a prayer somebody was asked to give (migration 085's `ask_prayer_id`): whoever asked;
//   - a musical number (`musical_number_id`): the person making the change, because nothing
//     records who arranged it.
// Idempotent through the partial unique index on each link (083b, 085c): the owner already holding
// an open item for it is 23505, and that is the outcome wanted.
export type TellLink =
  | { assignmentId: string }
  | { prayerId: string }
  | { musicalNumberId: string };

export type TellToCreate = {
  link: TellLink;
  ownerUserId: string;
  title: string;
  notes: string;
};

function linkColumns(link: TellLink) {
  if ("assignmentId" in link) return { ask_assignment_id: link.assignmentId };
  if ("prayerId" in link) return { ask_prayer_id: link.prayerId };
  return { musical_number_id: link.musicalNumberId };
}

export async function createTellTodos(params: {
  wardId: string;
  tells: readonly TellToCreate[];
  assignedByUserId: string;
  today: string;
  sundayLabel: string;
  client?: Client;
}): Promise<string[]> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const created: string[] = [];
  const now = new Date().toISOString();

  for (const tell of params.tells) {
    const detail = { wardId: params.wardId, ...tell.link };
    const { data, error } = await supabase
      .from("todos")
      .insert({
        ward_id: params.wardId,
        user_id: tell.ownerUserId,
        assigned_by: params.assignedByUserId,
        title: tell.title,
        notes: tell.notes,
        tag: "Sacrament",
        do_date: params.today,
        ...linkColumns(tell.link),
        talk_off_at: now,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") continue;
      fail("Could not create a to-do to tell somebody it's cancelled", error, detail, created);
    }

    const { error: logError } = await supabase.from("todo_log_entries").insert({
      ward_id: params.wardId,
      todo_id: data.id,
      kind: "talk_off",
      body: params.sundayLabel,
    });
    if (logError) {
      fail("Could not write the talk-off line on a new to-do", logError, detail, [
        ...created,
        data.id,
      ]);
    }
    created.push(data.id);
  }

  return created;
}

// Who asked this talk's speaker last: the owner of its most recent ask that was not closed without
// an answer. They are the one to tell a speaker who accepted that the talk is off. A talk accepted
// from its own panel, with no ask at all, has no entry and the caller chooses somebody.
export async function listLatestAskOwners(params: {
  wardId: string;
  assignmentIds: readonly string[];
  client?: Client;
}): Promise<Map<string, string>> {
  const owners = new Map<string, string>();
  if (params.assignmentIds.length === 0) return owners;
  const supabase = params.client ?? createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("todos")
    .select("ask_assignment_id, user_id")
    .eq("ward_id", params.wardId)
    .in("ask_assignment_id", [...params.assignmentIds])
    .is("closed_reason", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Could not read who asked a talk's speaker — ${error.message}`, {
      wardId: params.wardId,
    });
    throw new Error(`Could not read who asked these speakers: ${error.message}`);
  }

  for (const row of data ?? []) {
    if (row.ask_assignment_id !== null && !owners.has(row.ask_assignment_id)) {
      owners.set(row.ask_assignment_id, row.user_id);
    }
  }
  return owners;
}

// ---------------------------------------------------------------------------
// HAS ANYBODY BEEN TOLD YET? — Sacrament slice f2c
// ---------------------------------------------------------------------------
// The save-time reconcile creates a "let them know" to-do only for cancelled work that has NEVER had
// one, open or closed. Asked of the state, a retry finishes a half-done run, and pressing Told them
// can never bring one back.

// Talks with any to-do already stamped `talk_off_at` — a marked ask, or a tell.
export async function listToldAssignmentIds(params: {
  wardId: string;
  assignmentIds: readonly string[];
  client?: Client;
}): Promise<Set<string>> {
  const ids = await linkedIds(params.wardId, "ask_assignment_id", params.assignmentIds, true, params.client);
  return ids;
}

export async function listToldPrayerIds(params: {
  wardId: string;
  prayerIds: readonly string[];
  client?: Client;
}): Promise<Set<string>> {
  return linkedIds(params.wardId, "ask_prayer_id", params.prayerIds, false, params.client);
}

export async function listToldMusicalNumberIds(params: {
  wardId: string;
  musicalNumberIds: readonly string[];
  client?: Client;
}): Promise<Set<string>> {
  return linkedIds(params.wardId, "musical_number_id", params.musicalNumberIds, false, params.client);
}

async function linkedIds(
  wardId: string,
  column: "ask_assignment_id" | "ask_prayer_id" | "musical_number_id",
  ids: readonly string[],
  onlyStamped: boolean,
  client?: Client,
): Promise<Set<string>> {
  const found = new Set<string>();
  if (ids.length === 0) return found;
  const supabase = client ?? createServiceSupabaseClient();

  let query = supabase
    .from("todos")
    .select("ask_assignment_id, ask_prayer_id, musical_number_id")
    .eq("ward_id", wardId)
    .in(column, [...ids]);
  if (onlyStamped) query = query.not("talk_off_at", "is", null);

  const { data, error } = await query;
  if (error) {
    console.error(`Could not read who has been told — ${error.message}`, { wardId, column });
    throw new Error(`Could not check who has been told: ${error.message}`);
  }

  for (const row of data ?? []) {
    const value = row[column];
    if (value !== null) found.add(value);
  }
  return found;
}

// "Told them" on a to-do that is not a talk ask — a cancelled prayer's or musical number's. Only
// this one to-do closes: nobody else holds a copy. Conditional on it still being open.
export async function closeToldTodo(params: {
  wardId: string;
  todoId: string;
  client?: Client;
}): Promise<string[]> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const detail = { wardId: params.wardId, todoId: params.todoId };
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("todos")
    .update({ completed_at: now, closed_reason: "told_not_needed", updated_at: now })
    .eq("ward_id", params.wardId)
    .eq("id", params.todoId)
    .is("completed_at", null)
    .not("talk_off_at", "is", null)
    .select("id");
  if (error) fail("Could not close a to-do as told", error, detail);

  const closed = (data ?? []).map((row) => row.id);
  if (closed.length === 0) return closed;

  const { error: logError } = await supabase.from("todo_log_entries").insert({
    ward_id: params.wardId,
    todo_id: params.todoId,
    kind: "told_not_needed",
    body: null,
  });
  if (logError) fail("Could not write the told line on a to-do", logError, detail, closed);

  return closed;
}
