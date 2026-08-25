import type { SupabaseClient } from "@supabase/supabase-js";
import { programDraftSchema, type ProgramDraft } from "@/lib/program/draft";
import type { PublicProgram } from "@/lib/program/publicProjection";
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

// Every Sunday's program in one read, for the /program list. Returned keyed by sunday_id so the
// page can render eight Sundays without eight round trips — the same shape countApprovalsFor()
// uses on the month planner, and for the same reason.
//
// A Sunday with no program row is ABSENT from the map rather than mapped to null. The list
// renders that as "not built yet", which is a different thing from a program that exists and is
// empty, and an absent key cannot be mistaken for either.
export async function listProgramsBySundays(
  wardId: string,
  sundayIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<Map<string, Program>> {
  if (sundayIds.length === 0) return new Map();

  const supabase = await resolveClient(client);

  const { data, error } = await supabase
    .from("programs")
    .select(PROGRAM_COLUMNS)
    .eq("ward_id", wardId)
    .in("sunday_id", [...sundayIds]);

  if (error) {
    console.error(`Could not read a ward's programs — ${error.message}`, { wardId });
    throw new Error(`Could not read those programs: ${error.message}`);
  }

  return new Map(
    (data ?? [])
      .map(mapProgramRow)
      .flatMap((program) =>
        program.sundayId === null ? [] : [[program.sundayId, program] as const],
      ),
  );
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

  // A program on its way back to draft STOPS BEING PUBLIC in the same update that moves it.
  //
  // public_program's `public_data is not null` guard then makes /public/[slug] go dark rather than
  // keep serving a projection of a program somebody is in the middle of changing. Two writes would
  // leave a window where the status says draft and the open internet still says otherwise.
  //
  // Written as an explicit `null` rather than omitted, because a key omitted from a PostgREST
  // patch leaves the column untouched — which is exactly the stale-projection bug.
  const patch: ProgramUpdate =
    next === "draft" ? { status: next, public_data: null } : { status: next };

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

// The status, BOTH stamps and the public projection move in one update, so no reader can observe
// an approved program that does not say who approved it, or one that is approved and unpublishable.
//
// Same expected-status guard as setProgramStatus, for the same reason: this is the write that a
// double-click would otherwise run twice.
//
// `publicData` is a REQUIRED argument, not an optional one. The caller computes it with
// toPublicProgram() from the draft it just read; making it optional would let a future route
// approve a program and leave the column null, which the public view reads as "not published" with
// nothing anywhere to say why. It is never taken from a request body — see the approve route.
export async function recordProgramApproval(
  wardId: string,
  programId: string,
  approvedByUserId: string,
  publicData: PublicProgram,
  client?: SupabaseClient<Database>,
): Promise<Program | null> {
  const supabase = await resolveClient(client);

  const patch: ProgramUpdate = {
    status: "approved",
    approved_by: approvedByUserId,
    approved_at: new Date().toISOString(),
    public_data: publicData as unknown as Json,
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

// ===============================================================================================
// THE PUBLIC PAGE SLUG
// ===============================================================================================
//
// program-c reads `public_pages` through the restricted view and NOTHING creates a row in it. That
// gap is why /public/[slug] has never been reachable: the projection, the view and the page were
// all shipped, and no ward had a slug. program-d closes it, because the QR code printed on the
// back panel encodes that URL — and a QR pointing at /public/null is the kind of defect that
// survives every test and fails in a chapel.
//
// ONE ACTIVE PROGRAM PAGE PER WARD. A slug identifies a ward's programme PAGE, not a programme:
// the view joins public_pages to programs on ward_id alone, so one slug answers for every Sunday
// the ward has ever distributed and `order by sunday_date desc limit 1` picks the current one
// (lib/program/publicQueries.ts).

export const PROGRAM_PAGE_TYPE = "program";

// ---------------------------------------------------------------------------------------------
// WHY THE SLUG IS RANDOM RATHER THAN THE WARD'S NAME
// ---------------------------------------------------------------------------------------------
// The public page publishes EVERY participant's full name — first and last, by the product
// decision of 2026-08-24 (CLAUDE.md §9). The only thing standing between that and the open web is
// that the page is `noindex` and the URL is not published anywhere but on the ward's own paper.
//
// A slug like "buffalo-ward-program" would be guessable in one try, which quietly undoes both
// protections. Sixteen hex characters is not a secret, but it is not a guess either.
function generateProgramSlug(): string {
  return `program-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// Returns the ward's active programme slug, creating one the first time it is asked for.
//
// Two concurrent first-time calls could each insert a row, leaving a ward with two working slugs.
// That is untidy rather than harmful — both URLs serve the same current programme — and the
// `order by created_at` below makes every later read pick the same one of them, so the QR code
// stays stable from the second generation onwards.
export async function ensureProgramPublicPage(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<string> {
  const supabase = await resolveClient(client);

  const { data: existing, error: readError } = await supabase
    .from("public_pages")
    .select("slug")
    .eq("ward_id", wardId)
    .eq("page_type", PROGRAM_PAGE_TYPE)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (readError) {
    console.error(`Could not read a ward's public page — ${readError.message}`, { wardId });
    throw new Error(`Could not read the ward's public page: ${readError.message}`);
  }

  if (existing) return existing.slug;

  const slug = generateProgramSlug();

  const { data, error } = await supabase
    .from("public_pages")
    .insert({
      ward_id: wardId,
      page_type: PROGRAM_PAGE_TYPE,
      slug,
      is_active: true,
    })
    .select("slug")
    .single();

  if (error) {
    console.error(`Could not create a ward's public page — ${error.message}`, { wardId });
    throw new Error(`Could not create the ward's public page: ${error.message}`);
  }

  return data.slug;
}

// ---------------------------------------------------------------------------------------------
// THE ABSOLUTE URL THE QR CODE ENCODES
// ---------------------------------------------------------------------------------------------
// NEXT_PUBLIC_SITE_URL first, because it is the only one a person has deliberately set.
//
// VERCEL_PROJECT_PRODUCTION_URL second — the STABLE production domain. Deliberately NOT
// VERCEL_URL, which is the per-deployment hostname and changes on every push: a QR encoding one
// would scan correctly today and 404 after the next deploy, on paper that has already been printed
// and handed out.
//
// Returns null rather than guessing at localhost. A programme printed with a QR pointing at
// http://localhost:3000 is worse than one printed with no QR at all, so the back panel renders
// nothing and the route reports a warning saying why.
export function resolveSiteUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProduction) return `https://${vercelProduction.replace(/\/+$/, "")}`;

  return null;
}

export function programPublicUrl(slug: string): string | null {
  const siteUrl = resolveSiteUrl();
  return siteUrl === null ? null : `${siteUrl}/public/${slug}`;
}

// Stores the signed URL of a freshly rendered PDF.
//
// The status filter is `in ('approved', 'distributed')` rather than an exact expected value,
// because both are legitimate states to render from and neither is being CHANGED here. What it
// prevents is the race that matters: somebody reopening the programme as a draft while the render
// was in flight, which would leave pdf_url pointing at a PDF of a programme that is no longer
// approved. Zero rows back means exactly that, and the route says so.
export async function setProgramPdfUrl(
  wardId: string,
  programId: string,
  pdfUrl: string,
  client?: SupabaseClient<Database>,
): Promise<Program | null> {
  const supabase = await resolveClient(client);

  const patch: ProgramUpdate = { pdf_url: pdfUrl };

  const { data, error } = await supabase
    .from("programs")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", programId)
    .in("status", ["approved", "distributed"])
    .select(PROGRAM_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not store a program's PDF link — ${error.message}`, {
      wardId,
      programId,
    });
    throw new Error(`Could not store the PDF link: ${error.message}`);
  }

  return data ? mapProgramRow(data) : null;
}

// THE IRREVERSIBLE ONE. The status and both stamps move in a single UPDATE, so no reader can
// observe a distributed programme that does not say who sent it or when.
//
// Same expected-status guard as recordProgramApproval, and it matters more here: there is no path
// out of `distributed` in LEGAL_TRANSITIONS, so a double-click that sent twice could not be
// undone. `eq("status", "approved")` is what makes the second call match zero rows.
//
// public_data is NOT touched. It was written at approval and is what /public/[slug] serves; the
// view additionally requires status = 'distributed', so this UPDATE is the moment the public page
// lights up.
export async function recordProgramDistribution(
  wardId: string,
  programId: string,
  distributedByUserId: string,
  client?: SupabaseClient<Database>,
): Promise<Program | null> {
  const supabase = await resolveClient(client);

  const patch: ProgramUpdate = {
    status: "distributed",
    distributed_by: distributedByUserId,
    distributed_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("programs")
    .update(patch)
    .eq("ward_id", wardId)
    .eq("id", programId)
    .eq("status", "approved")
    .select(PROGRAM_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not mark a program distributed — ${error.message}`, {
      wardId,
      programId,
    });
    throw new Error(`Could not mark that program distributed: ${error.message}`);
  }

  return data ? mapProgramRow(data) : null;
}
