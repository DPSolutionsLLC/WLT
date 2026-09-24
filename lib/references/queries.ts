import type { SupabaseClient } from "@supabase/supabase-js";
import { listAssignments, type Assignment } from "@/lib/assignments/queries";
import { getSunday, type Sunday } from "@/lib/calendar/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import {
  REFERENCE_KINDS,
  REFERENCE_SOURCES,
  type ReferenceKind,
  type ReferenceSource,
  type TalkReference,
} from "@/types/domain";

// Every `talk_references` read and write goes through this module (conventions.md §Data Access).
// Every query filters on `ward_id` (CLAUDE.md rule 1).
//
// NO CITATION TEXT IN ANY LOG LINE. A manual reference is free text, and a bishop can type
// anything into it — the same reason retrieval never logs a query (lib/ai/retrieve.ts).
//
// SERVER-ONLY: it reaches next/headers through the server client.

type TalkReferenceRow = {
  id: string;
  assignment_id: string;
  kind: string;
  citation: string;
  document_id: string | null;
  source: string;
  created_at: string;
};

// One string literal on one line, never a `+` concatenation (lib/calendar/queries.ts says why).
const REFERENCE_COLUMNS = "id, assignment_id, kind, citation, document_id, source, created_at";

export type NewTalkReference = {
  assignmentId: string;
  kind: ReferenceKind;
  citation: string;
  documentId: string | null;
  source: ReferenceSource;
};

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// A CHECK constraint restricts both columns, so an unknown value means migration 079 and
// types/domain.ts have drifted. Throwing is the only safe answer (lib/calendar/queries.ts).
function toEnumValue<Value extends string>(
  value: string,
  allowed: readonly Value[],
  column: string,
): Value {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `${column} holds "${value}", which is not a known value. The CHECK constraint in ` +
        "migration 079 and types/domain.ts have drifted.",
    );
  }
  return value as Value;
}

function mapReferenceRow(row: TalkReferenceRow): TalkReference {
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    kind: toEnumValue(row.kind, REFERENCE_KINDS, "talk_references.kind"),
    citation: row.citation,
    documentId: row.document_id,
    source: toEnumValue(row.source, REFERENCE_SOURCES, "talk_references.source"),
    createdAt: row.created_at,
  };
}

export async function listReferencesForAssignments(
  wardId: string,
  assignmentIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<TalkReference[]> {
  if (assignmentIds.length === 0) return [];

  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("talk_references")
    .select(REFERENCE_COLUMNS)
    .eq("ward_id", wardId)
    .in("assignment_id", [...assignmentIds])
    .order("created_at")
    .order("id");

  if (error) {
    console.error(`Could not read talk references — ${error.message}`, {
      wardId,
      assignmentCount: assignmentIds.length,
    });
    throw new Error(`Could not read the references: ${error.message}`);
  }

  return (data ?? []).map(mapReferenceRow);
}

// Only the assignment column is read. The hub groups these by Sunday in memory through the
// assignment → Sunday map it already holds, rather than embedding a join.
export async function countReferencesByAssignment(
  wardId: string,
  assignmentIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (assignmentIds.length === 0) return counts;

  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("talk_references")
    .select("assignment_id")
    .eq("ward_id", wardId)
    .in("assignment_id", [...assignmentIds]);

  if (error) {
    console.error(`Could not count talk references — ${error.message}`, {
      wardId,
      assignmentCount: assignmentIds.length,
    });
    throw new Error(`Could not count the references: ${error.message}`);
  }

  for (const row of data ?? []) {
    counts.set(row.assignment_id, (counts.get(row.assignment_id) ?? 0) + 1);
  }

  return counts;
}

export async function countReferencesForSunday(
  wardId: string,
  assignmentIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<number> {
  if (assignmentIds.length === 0) return 0;

  const supabase = await resolveClient(client);

  const { count, error } = await supabase
    .from("talk_references")
    .select("id", { count: "exact", head: true })
    .eq("ward_id", wardId)
    .in("assignment_id", [...assignmentIds]);

  if (error) {
    console.error(`Could not count a Sunday's references — ${error.message}`, { wardId });
    throw new Error(`Could not count the references: ${error.message}`);
  }

  return count ?? 0;
}

export async function getReference(
  wardId: string,
  referenceId: string,
  client?: SupabaseClient<Database>,
): Promise<TalkReference | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("talk_references")
    .select(REFERENCE_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", referenceId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a talk reference — ${error.message}`, { wardId, referenceId });
    throw new Error(`Could not read that reference: ${error.message}`);
  }

  return data ? mapReferenceRow(data) : null;
}

// `.select()` after the insert applies the SELECT policy to RETURNING, which admits every writer
// (migration 079's header). An RLS refusal on INSERT raises rather than returning zero rows.
export async function addReference(
  wardId: string,
  input: NewTalkReference,
  client?: SupabaseClient<Database>,
): Promise<TalkReference> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("talk_references")
    .insert({
      ward_id: wardId,
      assignment_id: input.assignmentId,
      kind: input.kind,
      citation: input.citation,
      document_id: input.documentId,
      source: input.source,
    })
    .select(REFERENCE_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not add a talk reference — ${error.message}`, {
      wardId,
      assignmentId: input.assignmentId,
      kind: input.kind,
      source: input.source,
    });
    throw new Error(`Could not add that reference: ${error.message}`);
  }

  return mapReferenceRow(data);
}

// NULL MEANS ZERO ROWS: not found, or refused. A denied DELETE is a zero-row SUCCESS, not an
// error (plans/retros/foundation-c-services.md), so the returned row is the real signal.
export async function removeReference(
  wardId: string,
  referenceId: string,
  client?: SupabaseClient<Database>,
): Promise<{ assignmentId: string } | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("talk_references")
    .delete()
    .eq("ward_id", wardId)
    .eq("id", referenceId)
    .select("assignment_id");

  if (error) {
    console.error(`Could not remove a talk reference — ${error.message}`, {
      wardId,
      referenceId,
    });
    throw new Error(`Could not remove that reference: ${error.message}`);
  }

  const removed = data?.[0];
  return removed ? { assignmentId: removed.assignment_id } : null;
}

// ---------------------------------------------------------------------------
// EVERY REFERENCES ROUTE STARTS HERE
// ---------------------------------------------------------------------------
// The Sunday, and the talks on it that have a topic — the only talks a reference can be for. A
// talk with no topic has nothing to search against, and the prototype's modal lists only those.
//
// Null means the Sunday is not this ward's (or RLS refused it), which every route answers 404.
export type SundayTalks = {
  sunday: Sunday;
  assignments: Assignment[];
  talksWithTopics: Assignment[];
};

function bySlot(left: Assignment, right: Assignment): number {
  return (left.slotNumber ?? Number.MAX_SAFE_INTEGER) - (right.slotNumber ?? Number.MAX_SAFE_INTEGER);
}

export async function loadSundayTalks(
  wardId: string,
  sundayId: string,
  client?: SupabaseClient<Database>,
): Promise<SundayTalks | null> {
  const supabase = await resolveClient(client);

  const sunday = await getSunday(wardId, sundayId, supabase);
  if (!sunday) return null;

  const assignments = await listAssignments(wardId, { sundayId }, supabase);
  const talksWithTopics = assignments
    .filter((assignment) => assignment.topicId !== null)
    .sort(bySlot);

  return { sunday, assignments, talksWithTopics };
}
