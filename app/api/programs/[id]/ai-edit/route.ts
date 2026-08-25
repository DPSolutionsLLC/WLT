import { NextResponse } from "next/server";
import { GENERATION_MAX_TOKENS, callClaudeStructured } from "@/lib/ai/client";
import { buildProgramEditPrompt, programEditOutputFormat } from "@/lib/ai/programEdit";
import { getActiveAiSettings } from "@/lib/ai/queries";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { diffDrafts } from "@/lib/program/diff";
import { programDraftSchema } from "@/lib/program/draft";
import { getProgram } from "@/lib/program/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { aiProgramEditSchema } from "@/lib/validation/aiProgramEdit";
import { programIdSchema } from "@/lib/validation/program";
import { PROGRAM_STATUS_LABELS } from "@/types/domain";

// Editing a program by describing the change. THIS ROUTE WRITES NO PROGRAM ROW, EVER.
//
// It returns a PROPOSED draft and the diff against the one it was given. Saving is still the
// existing POST /api/programs call, made by a person pressing Apply after reading that diff —
// which is CLAUDE.md rule 3, and the reason this is not a mutation. The only row it writes is
// the audit log, which records that a draft was generated, not that anything changed.
//
// tests/routes/program-ai-edit.test.ts asserts that structurally, by re-reading draft_data with
// the service client either side of a call — including a call that fails.
//
// ---------------------------------------------------------------------------------------------
// VALIDATION IS LAYERED AND ALL THREE LAYERS ARE LOAD-BEARING
// ---------------------------------------------------------------------------------------------
//   1  structured output   makes the response PARSEABLE — the API constrains the shape
//   2  programDraftSchema  makes it VALID — the keywords the API downgraded into descriptions
//                          (the `version` literal, the date pattern, the enums) are enforced here
//   3  the diff            makes it VISIBLE — a schema-valid draft that quietly dropped the
//                          benediction passes 1 and 2 and is caught only by a person reading 3
//
// ---------------------------------------------------------------------------------------------
// THE SESSION IS RESOLVED OUTSIDE THE TRY BLOCK
// ---------------------------------------------------------------------------------------------
// requireSessionUser() redirects by throwing an internal Next.js error, and catching that here
// would turn a redirect into a 500.

const NOT_FOUND = "That program is not in your ward.";

// A model that returned something programDraftSchema refuses is a failure that reached Claude
// and came back unusable — the 422 case lib/ai/errors.ts describes, not a 500. The sentence says
// what happened AND that the program is untouched, because the second half is what a secretary
// staring at their unsaved work actually needs to know.
const UNUSABLE_DRAFT =
  "The AI sent back a program this app could not read, so nothing was changed. Try describing " +
  "the change a different way.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { id } = await params;
    const programId = programIdSchema.parse(id);
    const input = aiProgramEditSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // `program.build`, not `program.view`. Describing a change is an act of BUILDING the program
    // — and it spends money on an outbound vendor call, which reading never does.
    assertCan(user, "program.build", roleAccess);

    const program = await getProgram(user.wardId, programId, supabase);
    if (!program) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // Refused for the same reason the refresh route refuses it: an approved program is reopened
    // as a draft on purpose, not edited underneath the bishopric who signed it off. The panel is
    // hidden at these statuses, so this is the backstop rather than the gate.
    if (program.status === "approved" || program.status === "distributed") {
      return NextResponse.json(
        {
          error: `This program is ${PROGRAM_STATUS_LABELS[program.status].toLowerCase()}. Reopen it as a draft before changing it.`,
        },
        { status: 409 },
      );
    }

    const settings = await getActiveAiSettings(user.wardId, supabase);

    // No retrieval. A program edit is a text change to a document the user is holding — there is
    // no question for the corpus to answer, and the chunk budget is contended enough without a
    // module spending it on nothing (CLAUDE.md §9).
    const system = buildSystemPrompt({ settings, module: "program_edit" });

    // No try/catch around this. An AiRequestError reaches respondToRouteError, which maps each
    // of the six kinds to its own status and its own written sentence. Catching it here is how
    // the silent-AI-failure pitfall starts — and because nothing is written either way, a
    // failure leaves the program exactly as it was.
    const result = await callClaudeStructured({
      system,
      userPrompt: buildProgramEditPrompt({
        draft: input.draft,
        history: input.history,
        instruction: input.instruction,
      }),
      effort: "medium",
      maxTokens: GENERATION_MAX_TOKENS,
      format: programEditOutputFormat,
    });

    // Layer 2. The SDK already ran this schema, so in the ordinary case this costs nothing — it
    // is here because "the SDK parsed it" and "this app can print it" must not be one claim.
    const proposed = programDraftSchema.safeParse(result.parsed);
    if (!proposed.success) {
      console.error(
        `The AI returned an unusable program draft — ${proposed.error.issues[0]?.message ?? "shape mismatch"}`,
        { wardId: user.wardId, programId },
      );
      return NextResponse.json({ error: UNUSABLE_DRAFT }, { status: 422 });
    }

    const changes = diffDrafts(input.draft, proposed.data);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "program_ai_edit_generated",
        module: "program",
        detail: {
          programId,
          // The FIELD NAMES that changed, not their values, matching the refresh route. An audit
          // row is bishopric-readable and records who did what.
          changedFields: changes.map((change) => change.field),
          // Stored as the string "[redacted]" by writeAuditLog's sensitive-key filter today.
          // That is ITER-017, pre-existing and out of scope here — logged anyway, exactly as
          // ai-c's routes do, so this route is fixed along with them when ITER-017 lands.
          outputTokens: result.outputTokens,
        },
      },
      supabase,
    );

    // The PROPOSED draft and the diff. No program row was written, and the client holds this
    // until somebody presses Apply.
    return NextResponse.json({ draft: proposed.data, changes });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/programs/[id]/ai-edit",
      fallbackMessage: "Could not change that program. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
