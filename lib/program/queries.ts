import type { SupabaseClient } from "@supabase/supabase-js";
import { programDraftSchema, type ProgramDraft } from "@/lib/program/draft";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database";
import { PROGRAM_STATUSES, type ProgramStatus } from "@/types/domain";

// Every program read and write goes through this module. Route handlers and pages never touch
// Supabase directly (conventions.md §Data Access).
//
// SERVER-ONLY. It imports createServerSupabaseClient, which imports next/headers. A client
// component that imports this file fails `npm run build` while passing both `npm run lint` and
// `npm run typecheck` (plans/retros/roster-b-picker-and-orgs.md). The pure rules live in
// assembleDraft.ts and diff.ts precisely so program-b can render them without touching this file.
//
// Every function takes wardId FIRST and filters on it, even though migration 019's policies also
// do. Both, always (CLAUDE.md rule 1).
//
// THERE IS NO deleteProgram, deliberately. Nothing in Phase 6 deletes a program, and adding one
// now would be a second path to distributed data disappearing — a program that has been emailed
// to a ward is a record of what happened, not a row somebody should be able to tidy away.

export type Program = {
  id: string;
  sundayId: string | null;
  status: ProgramStatus;
  // null when the row has never held a draft, AND when the stored jsonb failed to parse. The two
  // are told apart by draftError, which is non-null only in the second case.
  draft: ProgramDraft | null;
  // Why a stored draft could not be read. Surfaced rather than swallowed (CLAUDE.md rule 7): the
  // program is unusable either way, and a builder that silently opens blank would look like the
  // draft was never written rather than like it was corrupted.
  draftError: string | null;
  pdfUrl: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  distributedAt: string | null;
  distributedBy: string | null;
  createdAt: string;
};

type ProgramRow = {
  id: string;
  sunday_id: string | null;
  status: string;
  draft_data: Json | null;
  pdf_url: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  distributed_at: string | null;
  distributed_by: string | null;
  created_at: string;
};

type ProgramUpdate = Database["public"]["Tables"]["programs"]["Update"];

// One string literal on ONE line, however long it gets, and never a `+` concatenation.
// Concatenation widens the type to `string`, which defeats supabase-js's literal-type parsing of
// the select list (plans/retros/calendar-a-rules-and-api.md).
const PROGRAM_COLUMNS =
  "id, sunday_id, status, draft_data, pdf_url, created_by, approved_by, approved_at, distributed_at, distributed_by, created_at";

// The status machine, as a table rather than as scattered `if` statements.
//
//   draft            -> pending_approval   the secretary sends it for approval
//   pending_approval -> approved           a bishopric member signs it off
//   pending_approval -> draft              the secretary withdraws it, or changes are requested
//   approved         -> distributed        program-d emails the PDF
//   approved         -> draft              a post-approval edit
//
// `approved -> draft` is legal on purpose, and program-d must make it LOUD once a PDF has been
// emailed: the email cannot be recalled, so the paper in somebody's inbox stops matching the
// program in the app. There is no path out of `distributed`, because there is no way to undo it.
const LEGAL_TRANSITIONS: Record<ProgramStatus, readonly ProgramStatus[]> = {
  draft: ["pending_approval"],
  pending_approval: ["approved", "draft"],
  approved: ["distributed", "draft"],
  distributed: [],
};

export function isLegalProgramTransition(from: ProgramStatus, to: ProgramStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

// A CHECK constraint already restricts this column, so an unrecognised value means migration 007
// and types/domain.ts have drifted. Throwing is the only safe answer — the same reasoning as
// toEnumValue() in lib/roster/queries.ts.
function toProgramStatus(value: string): ProgramStatus {
  if (!(PROGRAM_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `programs.status holds "${value}", which is not a known status. The CHECK constraint ` +
        "in migration 007 and types/domain.ts have drifted.",
    );
  }
  return value as ProgramStatus;
}

// Parses draft_data and RETURNS THE PARSE RESULT rather than casting it.
//
// draft_data is untyped jsonb written by three different callers — the assembler, program-b's
// manual editor, and program-b's AI editor. A cast would make a malformed draft into a runtime
// failure somewhere in the PDF renderer, weeks away from the write that caused it. This is the
// boundary where it is caught.
//
// Builds an explicit object rather than spreading the row: a column added to `programs` later
// cannot ride along into a response nobody reviewed.
export function mapProgramRow(row: ProgramRow): Program {
  const parsed =
    row.draft_data === null ? null : programDraftSchema.safeParse(row.draft_data);

  return {
    id: row.id,
    sundayId: row.sunday_id,
    status: toProgramStatus(row.status),
    draft: parsed?.success ? parsed.data : null,
    draftError:
      parsed && !parsed.success
        ? `The stored program could not be read: ${parsed.error.issues[0]?.message ?? "it does not match the expected shape."}`
        : null,
    pdfUrl: row.pdf_url,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    distributedAt: row.distributed_at,
    distributedBy: row.distributed_by,
    createdAt: row.created_at,
  };
}

async function resolveClient(
  client?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  return client ?? (await createServerSupabaseClient());
}

// Returns null when absent — the route turns that into a 404. A row that is not in this ward and
// a row RLS refused are indistinguishable here, and both mean "not yours"
// (plans/retros/foundation-c-services.md).
export async function getProgramBySunday(
  wardId: string,
  sundayId: string,
  client?: SupabaseClient<Database>,
): Promise<Program | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("programs")
    .select(PROGRAM_COLUMNS)
    .eq("ward_id", wardId)
    .eq("sunday_id", sundayId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a Sunday's program — ${error.message}`, {
      wardId,
      sundayId,
    });
    throw new Error(`Could not read that Sunday's program: ${error.message}`);
  }

  return data ? mapProgramRow(data) : null;
}

export async function getProgram(
  wardId: string,
  programId: string,
  client?: SupabaseClient<Database>,
): Promise<Program | null> {
  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("programs")
    .select(PROGRAM_COLUMNS)
    .eq("ward_id", wardId)
    .eq("id", programId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read a program — ${error.message}`, { wardId, programId });
    throw new Error(`Could not read that program: ${error.message}`);
  }

  return data ? mapProgramRow(data) : null;
}

// One program per Sunday. A second build REPLACES the draft rather than inserting a second row,
// which is what makes "the program for this Sunday" an unambiguous phrase.
//
// The status is NOT touched here. Storing an edit is not a decision about where the program is in
// its approval, and a save that quietly moved a program backwards or forwards would be the
// implicit-stage-advancement pitfall the talk pipeline documents (04-talks-pipeline.md §Step 3).
export async function upsertProgramDraft(
  wardId: string,
  sundayId: string,
  draft: ProgramDraft,
  createdByUserId: string,
  client?: SupabaseClient<Database>,
): Promise<Program | null> {
  const supabase = await resolveClient(client);

  const existing = await getProgramBySunday(wardId, sundayId, supabase);
  const draftData = draft as unknown as Json;

  if (existing) {
    const patch: ProgramUpdate = { draft_data: draftData };

    const { data, error } = await supabase
      .from("programs")
      .update(patch)
      .eq("ward_id", wardId)
      .eq("id", existing.id)
      .select(PROGRAM_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error(`Could not save a program draft — ${error.message}`, {
        wardId,
        programId: existing.id,
      });
      throw new Error(`Could not save that program: ${error.message}`);
    }

    return data ? mapProgramRow(data) : null;
  }

  const { data, error } = await supabase
    .from("programs")
    .insert({
      ward_id: wardId,
      sunday_id: sundayId,
      draft_data: draftData,
      status: "draft",
      created_by: createdByUserId,
    })
    .select(PROGRAM_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create a program draft — ${error.message}`, {
      wardId,
      sundayId,
    });
    throw new Error(`Could not create that program: ${error.message}`);
  }

  return mapProgramRow(data);
}

// Moves the status, but ONLY from the status the caller thought it was in.
//
// `expected` is matched in the WHERE clause, not read and then compared, so two people approving
// the same program at the same moment cannot both succeed: the second update matches zero rows
// and comes back null. A status machine that only moves forward from where the caller believed it
// was is how the approve route avoids a double-approval race without a lock.
//
// Returns null when the row was not in `expected` — the route turns that into a 409 whose
// sentence says where the program actually is.
export async function setProgramStatus(
  wardId: string,
  programId: string,
  expected: ProgramStatus,
  next: ProgramStatus,
  client?: SupabaseClient<Database>,
): Promise<Program | null> {
  if (!isLegalProgramTransition(expected, next)) {
    // A caller bug, not a user error: nothing a person can type reaches this. Thrown rather than
    // returned so it cannot be mistaken for the ordinary "somebody else moved it first" null.
    throw new Error(
      `A program cannot move from ${expected} to ${next}. See LEGAL_TRANSITIONS in lib/program/queries.ts.`,
    );
  }

  const supabase = await resolveClient(client);

  const patch: ProgramUpdate = { status: next };

  const { data, error } = await supabase
    .from("programs")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", programId)
    .eq("status", expected)
    .select(PROGRAM_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not move a program's status — ${error.message}`, {
      wardId,
      programId,
      expected,
      next,
    });
    throw new Error(`Could not move that program to ${next}: ${error.message}`);
  }

  return data ? mapProgramRow(data) : null;
}

// The status and BOTH stamps move in one update, so no reader can observe an approved program
// that does not say who approved it or when.
//
// Same expected-status guard as setProgramStatus, for the same reason: this is the write that a
// double-click would otherwise run twice.
export async function recordProgramApproval(
  wardId: string,
  programId: string,
  approvedByUserId: string,
  client?: SupabaseClient<Database>,
): Promise<Program | null> {
  const supabase = await resolveClient(client);

  const patch: ProgramUpdate = {
    status: "approved",
    approved_by: approvedByUserId,
    approved_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("programs")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", programId)
    .eq("status", "pending_approval")
    .select(PROGRAM_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not approve a program — ${error.message}`, { wardId, programId });
    throw new Error(`Could not approve that program: ${error.message}`);
  }

  return data ? mapProgramRow(data) : null;
}
