import { NextResponse } from "next/server";
import { z } from "zod";
import { retrieveChunks } from "@/lib/ai/retrieve";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { listDocumentMetadata } from "@/lib/knowledge/queries";
import { loadSundayTalks } from "@/lib/references/queries";
import { toReferenceSuggestions } from "@/lib/references/suggestions";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MAX_SEARCH_RESULTS } from "@/lib/validation/knowledge";
import { referenceSearchSchema } from "@/lib/validation/references";

// SEARCHING THE WARD'S LIBRARY FOR A TALK'S REFERENCES — p4-sacrament-c.
//
// The prototype's UI over WLT's retrieval: the prototype matched keywords because it had no
// backend; this is retrieveChunks() — pgvector, the similarity floor, and the ward's saved
// conference scope, which applies on its own because NO `filters` is passed. That scope is WLT's
// equivalent of the prototype's `conferenceTalkRange`, so there is no second setting.
//
// ---------------------------------------------------------------------------
// NOTHING HERE IS GENERATED
// ---------------------------------------------------------------------------
// These are passages from the ward's own corpus, shown as citations for a person to choose
// between. No model writes anything on this path, so CLAUDE.md rule 3's approval step is the tap
// that adds one — and nothing reaches a row without it.
//
// `talks.plan`, not `talks.view`, because every press spends an embedding call. NO AUDIT ROW —
// it is a read. NEVER LOG THE QUERY: a bishop's search terms can name a member.
//
// AN EMPTY RESULT IS A 200 WITH `[]`, not an error. A narrow scope or a thin library will
// produce it often, and the modal says so in a sentence.

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";
const NOT_ON_THIS_SUNDAY = "That talk is not on this Sunday.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.plan", roleAccess);

    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);
    const input = referenceSearchSchema.parse(await readJsonBody(request));

    const loaded = await loadSundayTalks(user.wardId, sundayId, supabase);
    if (!loaded) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    if (!loaded.talksWithTopics.some((talk) => talk.id === input.assignmentId)) {
      return NextResponse.json({ error: NOT_ON_THIS_SUNDAY }, { status: 400 });
    }

    const chunks = await retrieveChunks(input.query, user.wardId, {
      client: supabase,
      limit: MAX_SEARCH_RESULTS,
      module: "references",
    });

    const documents = await listDocumentMetadata(
      user.wardId,
      [...new Set(chunks.map((chunk) => chunk.documentId))],
      supabase,
    );

    return NextResponse.json({ suggestions: toReferenceSuggestions(chunks, documents) });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/sundays/[id]/references/search",
      fallbackMessage: "Could not search the scriptures and conference talks. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
