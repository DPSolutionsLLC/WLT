import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type {
  CreateTodoInput,
  ListTodosQuery,
  UpdateStepInput,
  UpdateTodoInput,
} from "@/lib/validation/todo";
import type { Database } from "@/types/database";
import {
  MEETING_TYPES,
  TODO_LOG_KINDS,
  type MeetingType,
  type Todo,
  type TodoAgendaSource,
  type TodoLogEntry,
  type TodoLogKind,
  type TodoStep,
  type TodoSummary,
} from "@/types/domain";

// To Do — reads and writes, always through the CALLER'S session client.
//
// OWNER-ONLY IS RLS'S JOB (migration 081), and there is deliberately no `.eq("user_id", …)` on the
// reads: a redundant filter would mask a policy regression by hiding rows the policy had started
// letting through (lib/visits/appointments.ts states the same rule). Every query DOES filter
// `ward_id`, which is rule 1 and costs nothing.
//
// Writing to ANOTHER person's to-do is never done here. That is lib/todos/sourceLinks.ts (slice
// p5-b), with the service role behind the source's own permission check. The one cross-table write
// here is the REVERSE key — completing a linked to-do flags its action item — and it runs through
// the caller's own client, because `action_items` is ward-wide under migration 019.
//
// SERVER-ONLY — it imports createServerSupabaseClient. The client components import the pure
// halves (progress.ts, viewState.ts, logLines.ts) and only TYPES from here.

type Client = SupabaseClient<Database>;

type TodoRow = {
  id: string;
  title: string;
  notes: string | null;
  tag: string | null;
  do_date: string | null;
  due_date: string | null;
  scheduled_for: string | null;
  scheduled_with_member_id: string | null;
  completed_at: string | null;
  assigned_by: string | null;
  action_item_id: string | null;
  source_completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type AgendaSourceRow = {
  status: string;
  agendas: { meeting_type: string | null; meeting_date: string } | null;
} | null;

type TodoSummaryRow = TodoRow & {
  todo_steps: StepRow[] | null;
  action_items: AgendaSourceRow;
};

type StepRow = {
  id: string;
  todo_id: string;
  label: string;
  position: number;
  done_at: string | null;
};

type LogRow = {
  id: string;
  todo_id: string;
  kind: string;
  body: string | null;
  created_at: string;
};

// One string literal on ONE line each — concatenation widens the type to `string` and defeats
// supabase-js's literal parsing of the select list (plans/retros/calendar-a-rules-and-api.md).
//
// `action_items` has TWO foreign keys to `agendas` (the agenda it is on, and the one it was carried
// from), so the embed names its constraint — without the hint PostgREST refuses the ambiguity.
const TODO_COLUMNS =
  "id, title, notes, tag, do_date, due_date, scheduled_for, scheduled_with_member_id, completed_at, assigned_by, action_item_id, source_completed_at, created_at, updated_at";
const TODO_WITH_STEPS_COLUMNS =
  "id, title, notes, tag, do_date, due_date, scheduled_for, scheduled_with_member_id, completed_at, assigned_by, action_item_id, source_completed_at, created_at, updated_at, todo_steps (id, todo_id, label, position, done_at), action_items (status, agendas!action_items_agenda_id_ward_id_fkey (meeting_type, meeting_date))";
const STEP_COLUMNS = "id, todo_id, label, position, done_at";
const LOG_COLUMNS = "id, todo_id, kind, body, created_at";

// ---------------------------------------------------------------------------
// TWO WRITES, NO TRANSACTION — AND THE SECOND FAILING IS SAID OUT LOUD
// ---------------------------------------------------------------------------
// Checking off a step writes the step, then a timeline line. supabase-js has no transaction, so
// the second can fail after the first succeeded. The STEP ROW IS THE TRUTH and the log is the
// narrative, so nothing is rolled back — but the failure is never swallowed (rule 7): it throws
// this, and the route answers 500 with its sentence.
export class TodoLogWriteError extends Error {
  constructor(cause: unknown) {
    super("Your change was saved, but its line in the timeline was not. Please refresh.");
    this.name = "TodoLogWriteError";
    this.cause = cause;
  }
}

// The same shape for the reverse key: the to-do was saved, and flagging (or unflagging) its agenda
// item was not. The to-do row is the truth; the route says so rather than "Please try again",
// which would suggest the completion itself had failed.
export class TodoLinkWriteError extends Error {
  constructor(cause: unknown) {
    super(
      "Your to-do was saved, but its agenda item could not be updated. Please refresh and try again.",
    );
    this.name = "TodoLinkWriteError";
    this.cause = cause;
  }
}

function toLogKind(value: string): TodoLogKind {
  if (!(TODO_LOG_KINDS as readonly string[]).includes(value)) {
    throw new Error(
      `todo_log_entries.kind holds "${value}", which is not a known value. The CHECK constraint ` +
        "and types/domain.ts have drifted.",
    );
  }
  return value as TodoLogKind;
}

// Explicit objects rather than spreads, so a column added later cannot ride into a response
// nobody reviewed.
function mapTodoRow(row: TodoRow): Todo {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    tag: row.tag,
    doDate: row.do_date,
    dueDate: row.due_date,
    scheduledFor: row.scheduled_for,
    scheduledWithMemberId: row.scheduled_with_member_id,
    completedAt: row.completed_at,
    assignedBy: row.assigned_by,
    actionItemId: row.action_item_id,
    sourceCompletedAt: row.source_completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStepRow(row: StepRow): TodoStep {
  return {
    id: row.id,
    todoId: row.todo_id,
    label: row.label,
    position: row.position,
    doneAt: row.done_at,
  };
}

function mapLogRow(row: LogRow): TodoLogEntry {
  return {
    id: row.id,
    todoId: row.todo_id,
    kind: toLogKind(row.kind),
    body: row.body,
    createdAt: row.created_at,
  };
}

function byPosition(a: TodoStep, b: TodoStep): number {
  return a.position - b.position;
}

function toMeetingType(value: string | null): MeetingType {
  // Migration 012's CHECK allows null; lib/agendas/queries.ts defaults it the same way.
  return value !== null && (MEETING_TYPES as readonly string[]).includes(value)
    ? (value as MeetingType)
    : "bishopric";
}

function mapAgendaSource(row: AgendaSourceRow): TodoAgendaSource | null {
  if (row === null || row.agendas === null) return null;
  return {
    meetingType: toMeetingType(row.agendas.meeting_type),
    meetingDate: row.agendas.meeting_date,
    itemStatus: row.status === "complete" ? "complete" : "open",
  };
}

function mapTodoWithSteps(row: TodoSummaryRow): TodoSummary {
  return {
    ...mapTodoRow(row),
    steps: (row.todo_steps ?? []).map(mapStepRow).sort(byPosition),
    agendaSource: mapAgendaSource(row.action_items),
  };
}

async function resolveClient(client?: Client): Promise<Client> {
  return client ?? (await createServerSupabaseClient());
}

async function writeLogLine(
  supabase: Client,
  wardId: string,
  todoId: string,
  kind: TodoLogKind,
  body: string | null,
): Promise<TodoLogEntry> {
  const { data, error } = await supabase
    .from("todo_log_entries")
    .insert({ ward_id: wardId, todo_id: todoId, kind, body })
    .select(LOG_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not write a to-do timeline line — ${error.message}`, {
      wardId,
      todoId,
      kind,
    });
    throw new TodoLogWriteError(error);
  }

  return mapLogRow(data);
}

// ---------------------------------------------------------------------------
// READS
// ---------------------------------------------------------------------------

export async function listTodos(
  wardId: string,
  filter: ListTodosQuery,
  client?: Client,
): Promise<TodoSummary[]> {
  const supabase = await resolveClient(client);

  let query = supabase.from("todos").select(TODO_WITH_STEPS_COLUMNS).eq("ward_id", wardId);

  query =
    filter.status === "open"
      ? query.is("completed_at", null)
      : query.not("completed_at", "is", null);

  // Ordered explicitly, because heap order shifts under the shared hosted project. The page
  // re-sorts with compareTodos, which needs the ward's date; this is only a stable base.
  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    console.error(`Could not read to-dos — ${error.message}`, { wardId });
    throw new Error(`Could not load your to-dos: ${error.message}`);
  }

  return (data ?? []).map((row) =>
    mapTodoWithSteps(row as unknown as TodoSummaryRow),
  );
}

export async function getTodo(
  wardId: string,
  todoId: string,
  client?: Client,
): Promise<TodoSummary | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("todos")
    .select(TODO_WITH_STEPS_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", todoId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a to-do — ${error.message}`, { wardId, todoId });
    throw new Error(`Could not load that to-do: ${error.message}`);
  }

  return data === null
    ? null
    : mapTodoWithSteps(data as unknown as TodoSummaryRow);
}

// ONE TIMELINE, oldest first, so automatic lines and written notes interleave by time.
export async function listTodoLog(
  wardId: string,
  todoId: string,
  client?: Client,
): Promise<TodoLogEntry[]> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("todo_log_entries")
    .select(LOG_COLUMNS)
    .eq("ward_id", wardId)
    .eq("todo_id", todoId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error(`Could not read a to-do's timeline — ${error.message}`, { wardId, todoId });
    throw new Error(`Could not load the timeline: ${error.message}`);
  }

  return (data ?? []).map(mapLogRow);
}

// ---------------------------------------------------------------------------
// TO-DO WRITES
// ---------------------------------------------------------------------------

// `userId` is a parameter, never a field on the input — it comes from the session, and migration
// 081's INSERT policy refuses any other value anyway.
export async function createTodo(
  wardId: string,
  userId: string,
  input: CreateTodoInput,
  client?: Client,
): Promise<TodoSummary> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("todos")
    .insert({
      ward_id: wardId,
      user_id: userId,
      title: input.title,
      notes: input.notes ?? null,
      tag: input.tag ?? null,
      do_date: input.doDate ?? null,
      due_date: input.dueDate ?? null,
    })
    .select(TODO_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a to-do — ${error.message}`, { wardId });
    throw new Error(`Could not save that to-do: ${error.message}`);
  }

  return { ...mapTodoRow(data), steps: [], agendaSource: null };
}

export type TodoUpdateResult = {
  todo: TodoSummary;
  // Which timeline lines this change wrote, for the route's audit detail.
  loggedKinds: TodoLogKind[];
  changedFields: string[];
};

// Returns null when the to-do is not the caller's to read — RLS's zero rows, which the route turns
// into a 404. The current row is read FIRST so a repeated "complete" writes no second timeline line,
// and so the log records what actually changed rather than what was asked for.
export async function updateTodo(
  wardId: string,
  todoId: string,
  input: UpdateTodoInput,
  client?: Client,
): Promise<TodoUpdateResult | null> {
  const supabase = await resolveClient(client);

  const current = await getTodo(wardId, todoId, supabase);
  if (current === null) return null;

  const row: Database["public"]["Tables"]["todos"]["Update"] = {};
  const changedFields: string[] = [];
  const pendingLines: { kind: TodoLogKind; body: string | null }[] = [];

  if (input.title !== undefined && input.title !== current.title) {
    row.title = input.title;
    changedFields.push("title");
  }
  if (input.notes !== undefined && input.notes !== current.notes) {
    row.notes = input.notes;
    changedFields.push("notes");
  }
  if (input.tag !== undefined && input.tag !== current.tag) {
    row.tag = input.tag;
    changedFields.push("tag");
  }
  if (input.doDate !== undefined && input.doDate !== current.doDate) {
    row.do_date = input.doDate;
    changedFields.push("doDate");
  }
  if (input.dueDate !== undefined && input.dueDate !== current.dueDate) {
    row.due_date = input.dueDate;
    changedFields.push("dueDate");
  }

  if (input.complete !== undefined && input.complete !== (current.completedAt !== null)) {
    row.completed_at = input.complete ? new Date().toISOString() : null;
    changedFields.push("completedAt");
    pendingLines.push({ kind: input.complete ? "completed" : "reopened", body: null });
  }

  if (
    input.scheduledFor !== undefined &&
    !sameInstant(input.scheduledFor, current.scheduledFor)
  ) {
    row.scheduled_for = input.scheduledFor;
    changedFields.push("scheduledFor");
    pendingLines.push({ kind: input.scheduledFor === null ? "unscheduled" : "scheduled", body: null });
    // Unscheduling clears who it was with, so a stale member never outlives the appointment.
    if (input.scheduledFor === null && current.scheduledWithMemberId !== null) {
      row.scheduled_with_member_id = null;
      changedFields.push("scheduledWithMemberId");
    }
  }
  if (
    input.scheduledWithMemberId !== undefined &&
    input.scheduledWithMemberId !== current.scheduledWithMemberId &&
    !changedFields.includes("scheduledWithMemberId")
  ) {
    row.scheduled_with_member_id = input.scheduledWithMemberId;
    changedFields.push("scheduledWithMemberId");
  }

  // Nothing actually differs: answer with the row as it stands rather than writing a no-op.
  if (changedFields.length === 0) {
    return { todo: current, loggedKinds: [], changedFields };
  }

  // No triggers anywhere in this repo (CLAUDE.md §9), so `updated_at` is set here.
  row.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("todos")
    .update(row)
    .eq("ward_id", wardId)
    .eq("id", todoId)
    .select(TODO_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update a to-do — ${error.message}`, { wardId, todoId });
    throw new Error(`Could not save that to-do: ${error.message}`);
  }
  if (data === null) return null;

  for (const line of pendingLines) {
    await writeLogLine(supabase, wardId, todoId, line.kind, line.body);
  }

  if (current.actionItemId !== null && input.complete !== undefined && changedFields.includes("completedAt")) {
    await setActionItemReviewRequest(supabase, wardId, current.actionItemId, input.complete);
  }

  return {
    todo: { ...mapTodoRow(data), steps: current.steps, agendaSource: current.agendaSource },
    loggedKinds: pendingLines.map((line) => line.kind),
    changedFields,
  };
}

// ---------------------------------------------------------------------------
// THE REVERSE KEY — the owner completes, the MEETING decides
// ---------------------------------------------------------------------------
// Completing a linked to-do asks the bishopric to review the agenda item; it never completes the
// item (decisions.md §1, "confirm, don't silently act"). Only an OPEN item is flagged — a completed
// one has nothing left to review, and the `.eq("status", "open")` makes that zero rows rather than
// a second read. Reopening the to-do withdraws the request.
//
// The caller's own client, because `action_items` is ward-wide on every verb (migration 019) — no
// service role is needed in this direction, and none is used.
async function setActionItemReviewRequest(
  supabase: Client,
  wardId: string,
  actionItemId: string,
  requested: boolean,
): Promise<void> {
  const query = requested
    ? supabase
        .from("action_items")
        .update({ completion_review_requested_at: new Date().toISOString() })
        .eq("status", "open")
        .is("completion_review_requested_at", null)
    : supabase
        .from("action_items")
        .update({ completion_review_requested_at: null })
        .not("completion_review_requested_at", "is", null);

  const { error } = await query.eq("ward_id", wardId).eq("id", actionItemId);

  if (error) {
    console.error(`Could not update an action item's review request — ${error.message}`, {
      wardId,
      actionItemId,
      requested,
    });
    throw new TodoLinkWriteError(error);
  }
}

function sameInstant(next: string | null, previous: string | null): boolean {
  if (next === null || previous === null) return next === previous;
  return new Date(next).getTime() === new Date(previous).getTime();
}

export type DeleteTodoResult = "deleted" | "not_found" | "linked_to_open_item";

// "not_found" is RLS's zero rows, which the route turns into a 404. Steps and timeline lines go
// with it by the foreign keys' cascade.
//
// A TO-DO LINKED TO AN OPEN AGENDA ITEM IS NOT DELETED. The meeting assigned that work and still
// expects it; deleting would silently orphan the assignment. The route answers 409 naming the way
// forward — mark it complete, which asks the bishopric to review the item. Once the item is
// complete (or the link is gone), the owner may delete it like any other.
export async function deleteTodo(
  wardId: string,
  todoId: string,
  client?: Client,
): Promise<DeleteTodoResult> {
  const supabase = await resolveClient(client);

  const current = await getTodo(wardId, todoId, supabase);
  if (current === null) return "not_found";

  if (current.actionItemId !== null && (await isActionItemOpen(supabase, wardId, current.actionItemId))) {
    return "linked_to_open_item";
  }

  const { data, error } = await supabase
    .from("todos")
    .delete()
    .eq("ward_id", wardId)
    .eq("id", todoId)
    .select("id");

  if (error) {
    console.error(`Could not delete a to-do — ${error.message}`, { wardId, todoId });
    throw new Error(`Could not remove that to-do: ${error.message}`);
  }

  return (data ?? []).length > 0 ? "deleted" : "not_found";
}

// Read directly rather than from the card's embedded agenda source, which is null for an item that
// sits on no agenda — the refusal must not depend on a display field.
async function isActionItemOpen(
  supabase: Client,
  wardId: string,
  actionItemId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("action_items")
    .select("status")
    .eq("ward_id", wardId)
    .eq("id", actionItemId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a to-do's agenda item — ${error.message}`, {
      wardId,
      actionItemId,
    });
    throw new Error(`Could not check that to-do's agenda item: ${error.message}`);
  }

  return data?.status === "open";
}

// ---------------------------------------------------------------------------
// STEPS
// ---------------------------------------------------------------------------

// Returns null when the parent is not the caller's — read first, so an unknown id answers 404
// rather than an RLS error raised by the INSERT. A new step goes last; there is no reorder in P5.
export async function addStep(
  wardId: string,
  todoId: string,
  label: string,
  client?: Client,
): Promise<TodoStep | null> {
  const supabase = await resolveClient(client);

  const parent = await getTodo(wardId, todoId, supabase);
  if (parent === null) return null;

  const nextPosition = parent.steps.reduce((highest, step) => Math.max(highest, step.position), 0) + 1;

  const { data, error } = await supabase
    .from("todo_steps")
    .insert({ ward_id: wardId, todo_id: todoId, label, position: nextPosition })
    .select(STEP_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not add a step — ${error.message}`, { wardId, todoId });
    throw new Error(`Could not add that step: ${error.message}`);
  }

  return mapStepRow(data);
}

async function getStep(wardId: string, stepId: string, supabase: Client): Promise<TodoStep | null> {
  const { data, error } = await supabase
    .from("todo_steps")
    .select(STEP_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", stepId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a step — ${error.message}`, { wardId, stepId });
    throw new Error(`Could not load that step: ${error.message}`);
  }

  return data === null ? null : mapStepRow(data);
}

export type StepUpdateResult = {
  step: TodoStep;
  loggedKind: TodoLogKind | null;
};

// A change to `done` writes a timeline line carrying the label AS IT IS NOW — a snapshot, so a
// later rename or delete of the step leaves the history saying what was actually checked.
export async function updateStep(
  wardId: string,
  stepId: string,
  input: UpdateStepInput,
  client?: Client,
): Promise<StepUpdateResult | null> {
  const supabase = await resolveClient(client);

  const current = await getStep(wardId, stepId, supabase);
  if (current === null) return null;

  const row: Database["public"]["Tables"]["todo_steps"]["Update"] = {};
  if (input.label !== undefined) row.label = input.label;

  const doneChanged = input.done !== undefined && input.done !== (current.doneAt !== null);
  if (doneChanged) row.done_at = input.done ? new Date().toISOString() : null;

  if (Object.keys(row).length === 0) return { step: current, loggedKind: null };

  const { data, error } = await supabase
    .from("todo_steps")
    .update(row)
    .eq("ward_id", wardId)
    .eq("id", stepId)
    .select(STEP_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update a step — ${error.message}`, { wardId, stepId });
    throw new Error(`Could not save that step: ${error.message}`);
  }
  if (data === null) return null;

  const step = mapStepRow(data);

  if (!doneChanged) return { step, loggedKind: null };

  const kind: TodoLogKind = input.done ? "step_done" : "step_undone";
  await writeLogLine(supabase, wardId, step.todoId, kind, step.label);

  return { step, loggedKind: kind };
}

// Returns the deleted step's to-do id, or null for zero rows. The timeline keeps any line that
// quoted it — the label was snapshotted.
export async function deleteStep(
  wardId: string,
  stepId: string,
  client?: Client,
): Promise<string | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("todo_steps")
    .delete()
    .eq("ward_id", wardId)
    .eq("id", stepId)
    .select("todo_id");

  if (error) {
    console.error(`Could not delete a step — ${error.message}`, { wardId, stepId });
    throw new Error(`Could not remove that step: ${error.message}`);
  }

  return data?.[0]?.todo_id ?? null;
}

// ---------------------------------------------------------------------------
// NOTES
// ---------------------------------------------------------------------------

// A written note is a timeline line of kind `note`. Returns null when the to-do is not the
// caller's. No route edits or deletes a note in P5 — recorded as a follow-up, not a gap.
export async function addNote(
  wardId: string,
  todoId: string,
  body: string,
  client?: Client,
): Promise<TodoLogEntry | null> {
  const supabase = await resolveClient(client);

  const parent = await getTodo(wardId, todoId, supabase);
  if (parent === null) return null;

  const { data, error } = await supabase
    .from("todo_log_entries")
    .insert({ ward_id: wardId, todo_id: todoId, kind: "note", body })
    .select(LOG_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not add a note — ${error.message}`, { wardId, todoId });
    throw new Error(`Could not save that note: ${error.message}`);
  }

  return mapLogRow(data);
}
