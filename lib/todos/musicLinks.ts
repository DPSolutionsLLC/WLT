import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import type { MusicTodoRole, TodoClosedReason, TodoLogKind } from "@/types/domain";

// WRITES TO THE TO-DOS A SUNDAY'S MUSIC PUTS ON PEOPLE'S LISTS — ITER-038, migration 089b. The
// sibling of lib/todos/askLinks.ts: that file speaks for a talk or a prayer, this one for a Sunday's
// music. Two roles, on `todos.music_role`:
//   - `choose`: the coordinator's "Choose the music for …" (created by finalizing topics —
//     lib/music/topicsHandoff.ts — and reopened with the conductor's note when the music is sent
//     back);
//   - `review`: the conductor's "Review the music for …", created by a submission.
//
// ---------------------------------------------------------------------------
// THE SERVICE ROLE, AND WHAT STANDS IN FOR RLS HERE
// ---------------------------------------------------------------------------
// `todos` is owner-only on every verb and its INSERT refuses any `assigned_by` (migration 081), and
// every to-do here is written onto SOMEBODY ELSE's list. So every caller must have:
//   1. passed the music's own permission check — `music.manage` to submit, `topics.manage` to
//      approve or send back — and
//   2. read the Sunday through its OWN RLS-scoped client first, so the `wardId` and `sundayId`
//      handed here are ones RLS already admitted.
// The service role has no RLS behind it, so EVERY write below sets and filters `ward_id` (rule 1).
//
// NOTHING HERE READS A TO-DO'S TEXT back to the caller. The results are ids, for the audit detail.
// NO AUDIT ROW IS WRITTEN HERE; the route writes one carrying these ids.
//
// ---------------------------------------------------------------------------
// EVERY FUNCTION IS IDEMPOTENT
// ---------------------------------------------------------------------------
// supabase-js has no transaction, so a repeat of the same request must finish a half-run rather than
// double it: creation meets `todos_one_open_music_todo_per_owner` (089b) and 23505 counts as "already
// there"; every close is conditional on the to-do still being open.

type Client = SupabaseClient<Database>;

const MUSIC_TAG = "Music";

// The music's own change was saved, and bringing its to-dos into line was not. The route answers
// 500 with its own sentence, because the change it made already happened. `completedIds` are the
// to-dos this call DID write, so the audit row can still name them (rule 6).
export class MusicLinkWriteError extends Error {
  readonly completedIds: readonly string[];

  constructor(cause: unknown, completedIds: readonly string[] = []) {
    super("The music was saved, but its to-dos could not all be updated. Please try again.");
    this.name = "MusicLinkWriteError";
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
  throw new MusicLinkWriteError(error, completedIds);
}

async function writeLines(
  supabase: Client,
  wardId: string,
  todoIds: readonly string[],
  kind: TodoLogKind,
  body: string | null,
  detail: Record<string, unknown>,
  completedIds: readonly string[],
): Promise<void> {
  if (todoIds.length === 0) return;
  const { error } = await supabase
    .from("todo_log_entries")
    .insert(todoIds.map((todoId) => ({ ward_id: wardId, todo_id: todoId, kind, body })));
  if (error) fail("Could not write a timeline line on a music to-do", error, detail, completedIds);
}

export type MusicTodoContent = { title: string; notes: string };

// ---------------------------------------------------------------------------
// THE COORDINATOR'S "CHOOSE THE MUSIC" — one open per owner per Sunday
// ---------------------------------------------------------------------------
// Per owner, in this order:
//   - an OPEN one already exists: it stands. With a `line`, the line is written on it too, because
//     the line is news (a note sending the music back) that must reach them whichever copy they hold;
//   - a COMPLETED one exists: the latest is REOPENED, retitled, and gets the line — or "Reopened"
//     without one. Their earlier steps and notes are still on it, which is the point of reopening
//     rather than starting a second to-do;
//   - neither: a new one is created.
// `existing` is returned separately, so slice mc can tell nobody twice.
// `existingOwnerIds` names the PEOPLE behind `existingIds`, so a caller can tell who was not told.
export type ChooseTodosResult = {
  createdIds: string[];
  reopenedIds: string[];
  existingIds: string[];
  existingOwnerIds: string[];
};

export async function createChooseTodos(params: {
  wardId: string;
  sundayId: string;
  ownerUserIds: readonly string[];
  content: MusicTodoContent;
  assignedByUserId: string;
  today: string;
  line?: { kind: TodoLogKind; body: string | null };
  client?: Client;
}): Promise<ChooseTodosResult> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const result: ChooseTodosResult = {
    createdIds: [],
    reopenedIds: [],
    existingIds: [],
    existingOwnerIds: [],
  };
  const done = () => [...result.createdIds, ...result.reopenedIds, ...result.existingIds];
  const owners = [...new Set(params.ownerUserIds)];

  for (const ownerId of owners) {
    const detail = { wardId: params.wardId, sundayId: params.sundayId, role: "choose" };

    const { data: rows, error: readError } = await supabase
      .from("todos")
      .select("id, completed_at")
      .eq("ward_id", params.wardId)
      .eq("music_sunday_id", params.sundayId)
      .eq("music_role", "choose")
      .eq("user_id", ownerId)
      .order("created_at", { ascending: false });
    if (readError) fail("Could not read a coordinator's music to-dos", readError, detail, done());

    const open = (rows ?? []).find((row) => row.completed_at === null);
    if (open !== undefined) {
      if (params.line !== undefined) {
        await writeLines(supabase, params.wardId, [open.id], params.line.kind, params.line.body, detail, done());
      }
      result.existingIds.push(open.id);
      result.existingOwnerIds.push(ownerId);
      continue;
    }

    const latest = (rows ?? [])[0];
    if (latest !== undefined) {
      const now = new Date().toISOString();
      const { data: reopened, error: reopenError } = await supabase
        .from("todos")
        .update({
          completed_at: null,
          closed_reason: null,
          title: params.content.title,
          notes: params.content.notes,
          do_date: params.today,
          updated_at: now,
        })
        .eq("ward_id", params.wardId)
        .eq("id", latest.id)
        .not("completed_at", "is", null)
        .select("id");

      // 23505: another request opened one for them in the meantime. Theirs stands.
      if (reopenError && reopenError.code === "23505") {
        result.existingIds.push(latest.id);
        result.existingOwnerIds.push(ownerId);
        continue;
      }
      if (reopenError) fail("Could not reopen a coordinator's music to-do", reopenError, detail, done());

      const reopenedIds = (reopened ?? []).map((row) => row.id);
      await writeLines(
        supabase,
        params.wardId,
        reopenedIds,
        params.line?.kind ?? "reopened",
        params.line?.body ?? null,
        detail,
        done(),
      );
      result.reopenedIds.push(...reopenedIds);
      continue;
    }

    const { data: created, error: createError } = await supabase
      .from("todos")
      .insert({
        ward_id: params.wardId,
        user_id: ownerId,
        assigned_by: params.assignedByUserId,
        title: params.content.title,
        notes: params.content.notes,
        tag: MUSIC_TAG,
        do_date: params.today,
        music_sunday_id: params.sundayId,
        music_role: "choose",
      })
      .select("id")
      .single();

    if (createError) {
      if (createError.code === "23505") {
        result.existingOwnerIds.push(ownerId);
        continue;
      }
      fail("Could not create a coordinator's music to-do", createError, detail, done());
    }
    if (params.line !== undefined) {
      await writeLines(supabase, params.wardId, [created.id], params.line.kind, params.line.body, detail, [
        ...done(),
        created.id,
      ]);
    }
    result.createdIds.push(created.id);
  }

  return result;
}

// ---------------------------------------------------------------------------
// THE CONDUCTOR'S "REVIEW THE MUSIC" — one open per owner per Sunday
// ---------------------------------------------------------------------------
// Always a fresh to-do: a review is about one submission, and the last one's was closed with its
// outcome. 23505 is the conductor already holding one — a second press of Submit — and its id is
// returned with `created: false` so nobody is notified twice.
export async function createReviewTodo(params: {
  wardId: string;
  sundayId: string;
  ownerUserId: string;
  content: MusicTodoContent;
  assignedByUserId: string;
  today: string;
  client?: Client;
}): Promise<{ todoId: string | null; created: boolean }> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const detail = { wardId: params.wardId, sundayId: params.sundayId, role: "review" };

  const { data, error } = await supabase
    .from("todos")
    .insert({
      ward_id: params.wardId,
      user_id: params.ownerUserId,
      assigned_by: params.assignedByUserId,
      title: params.content.title,
      notes: params.content.notes,
      tag: MUSIC_TAG,
      do_date: params.today,
      music_sunday_id: params.sundayId,
      music_role: "review",
    })
    .select("id")
    .single();

  if (!error) return { todoId: data.id, created: true };
  if (error.code !== "23505") fail("Could not create the conductor's music review", error, detail);

  const { data: existing, error: readError } = await supabase
    .from("todos")
    .select("id")
    .eq("ward_id", params.wardId)
    .eq("music_sunday_id", params.sundayId)
    .eq("music_role", "review")
    .eq("user_id", params.ownerUserId)
    .is("completed_at", null)
    .maybeSingle();
  if (readError) fail("Could not read the conductor's open music review", readError, detail);

  return { todoId: existing?.id ?? null, created: false };
}

// ---------------------------------------------------------------------------
// FINISHED — the work this to-do asked for happened
// ---------------------------------------------------------------------------
// The coordinator submitted (`music_submitted`), the conductor approved (`music_approved`) or sent it
// back (`completed`). No `closed_reason`: the to-do did its job.
export async function completeOpenMusicTodos(params: {
  wardId: string;
  sundayId: string;
  role: MusicTodoRole;
  kind: TodoLogKind;
  client?: Client;
}): Promise<string[]> {
  return finishOpen(params, { closedReason: null, kind: params.kind });
}

// ---------------------------------------------------------------------------
// CLOSED — no longer needed
// ---------------------------------------------------------------------------
// The music changed after it was submitted (`music_reopened`), or the Sunday lost its meeting
// (`meeting_cancelled`). Never deleted: whatever the owner wrote on it stays with it. `role`
// omitted closes both.
export async function closeOpenMusicTodos(params: {
  wardId: string;
  sundayId: string;
  role?: MusicTodoRole;
  closedReason: Extract<TodoClosedReason, "music_reopened" | "meeting_cancelled">;
  client?: Client;
}): Promise<string[]> {
  return finishOpen(params, { closedReason: params.closedReason, kind: params.closedReason });
}

async function finishOpen(
  params: { wardId: string; sundayId: string; role?: MusicTodoRole; client?: Client },
  line: { closedReason: TodoClosedReason | null; kind: TodoLogKind },
): Promise<string[]> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const detail = { wardId: params.wardId, sundayId: params.sundayId, kind: line.kind };
  const now = new Date().toISOString();

  let update = supabase
    .from("todos")
    .update({ completed_at: now, closed_reason: line.closedReason, updated_at: now })
    .eq("ward_id", params.wardId)
    .eq("music_sunday_id", params.sundayId)
    .is("completed_at", null);
  if (params.role !== undefined) update = update.eq("music_role", params.role);

  const { data, error } = await update.select("id");
  if (error) fail("Could not close a Sunday's music to-dos", error, detail);

  const closed = (data ?? []).map((row) => row.id);
  await writeLines(supabase, params.wardId, closed, line.kind, null, detail, closed);
  return closed;
}

// ---------------------------------------------------------------------------
// A LINE ON A TO-DO THAT STAYS OPEN
// ---------------------------------------------------------------------------
// The conductor's review when they send the music back ("Sent back: <note>"), and again when it is
// resubmitted ("Music submitted for review"). The review stays open across a send-back so its owner
// can see they are waiting on the coordinator (the user's decision walking scenario 087).
export async function addLineToOpenMusicTodos(params: {
  wardId: string;
  sundayId: string;
  role: MusicTodoRole;
  kind: TodoLogKind;
  body: string | null;
  client?: Client;
}): Promise<string[]> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const detail = { wardId: params.wardId, sundayId: params.sundayId, kind: params.kind };

  const { data, error } = await supabase
    .from("todos")
    .select("id")
    .eq("ward_id", params.wardId)
    .eq("music_sunday_id", params.sundayId)
    .eq("music_role", params.role)
    .is("completed_at", null);
  if (error) fail("Could not read a Sunday's open music to-dos", error, detail);

  const ids = (data ?? []).map((row) => row.id);
  await writeLines(supabase, params.wardId, ids, params.kind, params.body, detail, []);
  return ids;
}

// ---------------------------------------------------------------------------
// READ FOR THE RECONCILE
// ---------------------------------------------------------------------------
// Every OPEN music to-do on these Sundays, with who holds it. Service role, because the answer must
// not depend on who is looking: a ward secretary who changes the conductor cannot see the old
// conductor's to-dos under migration 081. Ids only, never a title or notes.
export type OpenMusicTodo = {
  todoId: string;
  ownerUserId: string;
  sundayId: string;
  role: MusicTodoRole;
};

export async function listOpenMusicTodos(params: {
  wardId: string;
  sundayIds: readonly string[];
  client?: Client;
}): Promise<OpenMusicTodo[]> {
  if (params.sundayIds.length === 0) return [];
  const supabase = params.client ?? createServiceSupabaseClient();

  const { data, error } = await supabase
    .from("todos")
    .select("id, user_id, music_sunday_id, music_role")
    .eq("ward_id", params.wardId)
    .in("music_sunday_id", [...params.sundayIds])
    .is("completed_at", null);

  if (error) {
    console.error(`Could not read a Sunday's open music to-dos — ${error.message}`, {
      wardId: params.wardId,
    });
    throw new Error(`Could not read who holds this Sunday's music to-dos: ${error.message}`);
  }

  return (data ?? []).flatMap((row) =>
    row.music_sunday_id === null || (row.music_role !== "choose" && row.music_role !== "review")
      ? []
      : [
          {
            todoId: row.id,
            ownerUserId: row.user_id,
            sundayId: row.music_sunday_id,
            role: row.music_role,
          },
        ],
  );
}

// Whether this Sunday's music was ever handed to a coordinator — any "Choose the music", open or
// done, held by anybody. Slice mc asks it to tell a FIRST handout from a re-finalize after the topics
// changed (lib/music/topicsHandoff.ts). Service role, for listOpenMusicTodos()'s reason.
export async function hasChooseTodo(params: { wardId: string; sundayId: string }): Promise<boolean> {
  const { count, error } = await createServiceSupabaseClient()
    .from("todos")
    .select("id", { count: "exact", head: true })
    .eq("ward_id", params.wardId)
    .eq("music_sunday_id", params.sundayId)
    .eq("music_role", "choose");

  if (error) {
    console.error(`Could not read whether the music was handed out — ${error.message}`, params);
    throw new Error(`Could not read this Sunday's music to-dos: ${error.message}`);
  }
  return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// HANDOVER — the review follows the conductor
// ---------------------------------------------------------------------------
// handOverAsks()'s order exactly: the new conductor's CLEAN copy first, then the old one closed as
// handed over. A run that stops half-way leaves the review held twice rather than by nobody, and a
// repeat finishes it — the copy meets the partial index (23505, already there) and the close is
// conditional on the old one still being open. The old owner's notes never move.
export async function handOverReviewTodo(params: {
  wardId: string;
  sundayId: string;
  fromTodoId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  content: MusicTodoContent;
  assignedByUserId: string;
  today: string;
  client?: Client;
}): Promise<{ createdIds: string[]; closedIds: string[] }> {
  const supabase = params.client ?? createServiceSupabaseClient();
  const detail = { wardId: params.wardId, sundayId: params.sundayId, fromTodoId: params.fromTodoId };
  const createdIds: string[] = [];
  const closedIds: string[] = [];
  const done = () => [...createdIds, ...closedIds];

  const created = await createReviewTodo({
    wardId: params.wardId,
    sundayId: params.sundayId,
    ownerUserId: params.toUserId,
    content: params.content,
    assignedByUserId: params.assignedByUserId,
    today: params.today,
    client: supabase,
  });
  if (created.created && created.todoId !== null) {
    createdIds.push(created.todoId);
    await writeLines(supabase, params.wardId, [created.todoId], "taken_over", params.fromName, detail, done());
  }

  const now = new Date().toISOString();
  const { data: closed, error: closeError } = await supabase
    .from("todos")
    .update({ completed_at: now, closed_reason: "handed_over", updated_at: now })
    .eq("ward_id", params.wardId)
    .eq("id", params.fromTodoId)
    .is("completed_at", null)
    .select("id");
  if (closeError) fail("Could not close a handed-over music review", closeError, detail, done());

  const closedNow = (closed ?? []).map((row) => row.id);
  await writeLines(supabase, params.wardId, closedNow, "handed_over", params.toName, detail, done());
  closedIds.push(...closedNow);

  return { createdIds, closedIds };
}
