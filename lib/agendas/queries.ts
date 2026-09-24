import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { agendaTemplate, countAgendaItems, type AgendaSections } from "@/lib/agendas/sections";
import { agendaSectionsSchema } from "@/lib/validation/agenda";
import type { ActionItem } from "@/lib/agendas/carryForward";
import type { Database } from "@/types/database";
import type { MeetingType } from "@/types/domain";

// The data layer for meeting agendas. SERVER ONLY — it imports the server client, which reaches
// for `next/headers`. Nothing under app/(app) that carries "use client" may import this file;
// lib/agendas/sections.ts and lib/agendas/carryForward.ts are the halves the browser renders, and
// that split is the whole reason there are three files rather than one.

type Client = SupabaseClient<Database>;

export type Agenda = {
  id: string;
  meetingType: MeetingType;
  meetingDate: string;
  sections: AgendaSections;
  status: "draft" | "published";
  publishedAt: string | null;
  publishedBy: string | null;
  pdfUrl: string | null;
  emailSentAt: string | null;
  emailRecipientCount: number | null;
  createdAt: string;
  // Computed from `sections` on the way out, never stored. A count beside a list it does not match
  // is the ITER-022 defect, and the only way it cannot drift is for it to be derived here from the
  // same value the page renders.
  itemCount: number;
};

const AGENDA_COLUMNS =
  "id, meeting_type, meeting_date, sections, status, published_at, published_by, pdf_url, " +
  "email_sent_at, email_recipient_count, created_at";

const ACTION_ITEM_COLUMNS =
  "id, agenda_id, description, assigned_to, assigned_user_id, completion_review_requested_at, " +
  "due_date, status, carried_from_agenda_id, completed_at, created_at";

// ---------------------------------------------------------------------------
// READING `sections` DEFENSIVELY, AND WHY THIS IS NOT THE SAME AS VALIDATING IT
// ---------------------------------------------------------------------------
// Every WRITE runs `agendaSectionsSchema` and refuses a malformed blob. This is the READ, and it
// must never refuse: migration 012 gave `sections` no shape at all, so a row written before that
// schema existed — or by hand, or by a future slice — can be any JSON at all, and an agenda
// somebody already held a meeting from must still open.
//
// So a blob that does not parse becomes an EMPTY agenda rather than an exception. The screen then
// shows a document with no sections, which is visibly wrong and recoverable by editing, instead of
// a 500 that names a Zod path nobody can act on. This is lib/youth/roster.ts's rule for an
// unreadable date, applied to a whole document.
function parseSections(raw: unknown): AgendaSections {
  const parsed = agendaSectionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

type AgendaRow = {
  id: string;
  meeting_type: string | null;
  meeting_date: string;
  sections: unknown;
  status: string;
  published_at: string | null;
  published_by: string | null;
  pdf_url: string | null;
  email_sent_at: string | null;
  email_recipient_count: number | null;
  created_at: string;
};

function toAgenda(row: AgendaRow): Agenda {
  const sections = parseSections(row.sections);
  return {
    id: row.id,
    // Migration 012's CHECK allows null. Defaulting to `bishopric` rather than throwing keeps a
    // malformed row openable, for the same reason parseSections does not throw.
    meetingType: (row.meeting_type ?? "bishopric") as MeetingType,
    meetingDate: row.meeting_date,
    sections,
    status: row.status === "published" ? "published" : "draft",
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    pdfUrl: row.pdf_url,
    emailSentAt: row.email_sent_at,
    emailRecipientCount: row.email_recipient_count,
    createdAt: row.created_at,
    itemCount: countAgendaItems(sections),
  };
}

type ActionItemRow = {
  id: string;
  agenda_id: string | null;
  description: string;
  assigned_to: string | null;
  assigned_user_id: string | null;
  completion_review_requested_at: string | null;
  due_date: string | null;
  status: string;
  carried_from_agenda_id: string | null;
  completed_at: string | null;
  created_at: string;
};

function toActionItem(row: ActionItemRow): ActionItem {
  return {
    id: row.id,
    agendaId: row.agenda_id,
    description: row.description,
    assignedTo: row.assigned_to,
    assignedUserId: row.assigned_user_id,
    completionReviewRequestedAt: row.completion_review_requested_at,
    dueDate: row.due_date,
    status: row.status === "complete" ? "complete" : "open",
    carriedFromAgendaId: row.carried_from_agenda_id,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export async function listAgendas(
  wardId: string,
  options: { meetingType?: MeetingType; includePast?: boolean; asOf: Date },
  client?: Client,
): Promise<Agenda[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  let query = supabase
    .from("agendas")
    .select(AGENDA_COLUMNS)
    .eq("ward_id", wardId)
    .order("meeting_date", { ascending: false });

  if (options.meetingType !== undefined) {
    query = query.eq("meeting_type", options.meetingType);
  }

  // THE DEFAULT VIEW IS A WORKING SCREEN, NOT AN ARCHIVE. Without `includePast` the list shows
  // meetings from the last 60 days forward — far enough back that last fortnight's ward council is
  // still one click from the action items it produced, and not so far that a ward two years in
  // opens a wall of history. A `date` column compared against a ward-day string, never an instant.
  if (options.includePast !== true) {
    const cutoff = new Date(options.asOf.getTime() - 60 * 24 * 60 * 60 * 1000);
    query = query.gte("meeting_date", cutoff.toISOString().slice(0, 10));
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load agendas: ${error.message}`);

  return (data ?? []).map((row) => toAgenda(row as unknown as AgendaRow));
}

export async function getAgenda(
  wardId: string,
  agendaId: string,
  client?: Client,
): Promise<Agenda | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("agendas")
    .select(AGENDA_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", agendaId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the agenda: ${error.message}`);
  return data === null ? null : toAgenda(data as unknown as AgendaRow);
}

// The most recent PUBLISHED agenda of this meeting type, which is what a new one carries from.
//
// PUBLISHED, NOT MERELY LATEST, and the distinction is the whole of §Step A3's "the most recent
// published agenda of that type". A draft is a meeting that has not happened: carrying its action
// items forward would copy items nobody has discussed into a meeting after it, and pressing
// Create twice would then duplicate them. Published is the only state that means "this meeting
// took place".
export async function previousPublishedAgenda(
  wardId: string,
  meetingType: MeetingType,
  beforeDate: string,
  client?: Client,
): Promise<Agenda | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("agendas")
    .select(AGENDA_COLUMNS)
    .eq("ward_id", wardId)
    .eq("meeting_type", meetingType)
    .eq("status", "published")
    .lt("meeting_date", beforeDate)
    .order("meeting_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not load the previous agenda: ${error.message}`);
  return data === null ? null : toAgenda(data as unknown as AgendaRow);
}

export async function listActionItems(
  wardId: string,
  agendaId: string,
  client?: Client,
): Promise<ActionItem[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("action_items")
    .select(ACTION_ITEM_COLUMNS)
    .eq("ward_id", wardId)
    .eq("agenda_id", agendaId)
    .order("created_at");

  if (error) throw new Error(`Could not load the action items: ${error.message}`);
  return (data ?? []).map((row) => toActionItem(row as unknown as ActionItemRow));
}

// Every action item on a set of agendas, keyed by agenda — one round trip for a whole list screen
// rather than one per agenda (lib/youth/attendees.ts's rule).
export async function listActionItemsForAgendas(
  wardId: string,
  agendaIds: readonly string[],
  client?: Client,
): Promise<Map<string, ActionItem[]>> {
  const byAgenda = new Map<string, ActionItem[]>();
  if (agendaIds.length === 0) return byAgenda;

  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("action_items")
    .select(ACTION_ITEM_COLUMNS)
    .eq("ward_id", wardId)
    .in("agenda_id", [...agendaIds])
    .order("created_at");

  if (error) throw new Error(`Could not load the action items: ${error.message}`);

  for (const row of data ?? []) {
    const item = toActionItem(row as unknown as ActionItemRow);
    if (item.agendaId === null) continue;
    const existing = byAgenda.get(item.agendaId);
    if (existing) existing.push(item);
    else byAgenda.set(item.agendaId, [item]);
  }

  return byAgenda;
}

export async function createAgenda(
  wardId: string,
  input: { meetingType: MeetingType; meetingDate: string; sections?: AgendaSections },
  client?: Client,
): Promise<Agenda> {
  const supabase = client ?? (await createServerSupabaseClient());

  const sections = input.sections ?? agendaTemplate();

  const { data, error } = await supabase
    .from("agendas")
    .insert({
      ward_id: wardId,
      meeting_type: input.meetingType,
      meeting_date: input.meetingDate,
      sections,
      status: "draft",
    })
    .select(AGENDA_COLUMNS)
    .single();

  if (error) throw new Error(`Could not create the agenda: ${error.message}`);
  return toAgenda(data as unknown as AgendaRow);
}

export async function updateAgenda(
  wardId: string,
  agendaId: string,
  patch: { meetingDate?: string; sections?: AgendaSections },
  client?: Client,
): Promise<Agenda | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const row: Database["public"]["Tables"]["agendas"]["Update"] = {};
  if (patch.meetingDate !== undefined) row.meeting_date = patch.meetingDate;
  if (patch.sections !== undefined) row.sections = patch.sections;

  const { data, error } = await supabase
    .from("agendas")
    .update(row)
    .eq("ward_id", wardId)
    .eq("id", agendaId)
    .select(AGENDA_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`Could not update the agenda: ${error.message}`);
  // A zero-row UPDATE is an RLS refusal, not an error — the caller turns null into a 404 (the rule
  // CLAUDE.md §8 states for route tests, and the reason updates here return the row).
  return data === null ? null : toAgenda(data as unknown as AgendaRow);
}

export async function getActionItem(
  wardId: string,
  itemId: string,
  client?: Client,
): Promise<ActionItem | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("action_items")
    .select(ACTION_ITEM_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", itemId)
    .maybeSingle();

  if (error) throw new Error(`Could not load the action item: ${error.message}`);
  return data === null ? null : toActionItem(data as unknown as ActionItemRow);
}

export async function createActionItems(
  wardId: string,
  agendaId: string,
  items: readonly {
    description: string;
    assignedTo?: string | null;
    assignedUserId?: string | null;
    completionReviewRequestedAt?: string | null;
    dueDate?: string | null;
    carriedFromAgendaId?: string | null;
  }[],
  client?: Client,
): Promise<ActionItem[]> {
  if (items.length === 0) return [];

  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("action_items")
    .insert(
      items.map((item) => ({
        ward_id: wardId,
        agenda_id: agendaId,
        description: item.description,
        assigned_to: item.assignedTo ?? null,
        assigned_user_id: item.assignedUserId ?? null,
        completion_review_requested_at: item.completionReviewRequestedAt ?? null,
        due_date: item.dueDate ?? null,
        status: "open",
        carried_from_agenda_id: item.carriedFromAgendaId ?? null,
      })),
    )
    .select(ACTION_ITEM_COLUMNS);

  if (error) throw new Error(`Could not add the action item: ${error.message}`);
  return (data ?? []).map((row) => toActionItem(row as unknown as ActionItemRow));
}

export async function updateActionItem(
  wardId: string,
  itemId: string,
  patch: {
    description?: string;
    assignedTo?: string | null;
    assignedUserId?: string | null;
    dueDate?: string | null;
    complete?: boolean;
  },
  client?: Client,
): Promise<ActionItem | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const row: Database["public"]["Tables"]["action_items"]["Update"] = {};
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.assignedTo !== undefined) row.assigned_to = patch.assignedTo;
  if (patch.assignedUserId !== undefined) row.assigned_user_id = patch.assignedUserId;
  if (patch.dueDate !== undefined) row.due_date = patch.dueDate;

  // THE TIMESTAMP AND THE STATUS MOVE TOGETHER, in one place, because they are one fact. Setting
  // `status` without `completed_at` leaves a completed item with no completion date, which is the
  // kind of half-write that only surfaces months later on a report nobody can explain.
  if (patch.complete !== undefined) {
    row.status = patch.complete ? "complete" : "open";
    row.completed_at = patch.complete ? new Date().toISOString() : null;
    // A REVIEW REQUEST IS ANSWERED EITHER WAY. Completing the item is the bishopric agreeing; a
    // reopen is the meeting saying the work is not done — either way the flag has been read.
    row.completion_review_requested_at = null;
  }

  const { data, error } = await supabase
    .from("action_items")
    .update(row)
    .eq("ward_id", wardId)
    .eq("id", itemId)
    .select(ACTION_ITEM_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`Could not update the action item: ${error.message}`);
  return data === null ? null : toActionItem(data as unknown as ActionItemRow);
}

export async function deleteActionItem(
  wardId: string,
  itemId: string,
  client?: Client,
): Promise<void> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { error } = await supabase
    .from("action_items")
    .delete()
    .eq("ward_id", wardId)
    .eq("id", itemId);

  if (error) throw new Error(`Could not remove the action item: ${error.message}`);
}

// Stamped by the publish route only. Separate from updateAgenda() so that no PATCH body can reach
// these columns — talks-d's hole is a second write path that skips the first one's side effects.
export async function markAgendaPublished(
  wardId: string,
  agendaId: string,
  publishedBy: string,
  pdfUrl: string | null,
  client?: Client,
): Promise<Agenda | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("agendas")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      published_by: publishedBy,
      pdf_url: pdfUrl,
    })
    .eq("ward_id", wardId)
    .eq("id", agendaId)
    .select(AGENDA_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`Could not publish the agenda: ${error.message}`);
  return data === null ? null : toAgenda(data as unknown as AgendaRow);
}

export async function markAgendaEmailSent(
  wardId: string,
  agendaId: string,
  recipientCount: number,
  client?: Client,
): Promise<Agenda | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("agendas")
    .update({
      email_sent_at: new Date().toISOString(),
      email_recipient_count: recipientCount,
    })
    .eq("ward_id", wardId)
    .eq("id", agendaId)
    .select(AGENDA_COLUMNS)
    .maybeSingle();

  if (error) throw new Error(`Could not record the send: ${error.message}`);
  return data === null ? null : toAgenda(data as unknown as AgendaRow);
}
