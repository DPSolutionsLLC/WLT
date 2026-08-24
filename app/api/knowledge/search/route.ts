import { NextResponse } from "next/server";
import { UNFILTERED_SCOPE, retrieveChunks } from "@/lib/ai/retrieve";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { searchRequestSchema } from "@/lib/validation/knowledge";

// A BISHOPRIC-FACING RETRIEVAL TEST, not an internal API.
//
// SPEC.md §API Routes described this as "semantic search (internal use by AI routes)". It is
// not that and nothing uses it that way: `ai-c`'s routes import retrieveChunks() directly,
// because an in-process function call is the right way for server code to reach server code.
// An internal HTTP hop to your own app costs a round trip, a second auth pass and a cold start,
// and can fail in ways a function call cannot. SPEC.md has been corrected to match.
//
// It exists for a better reason: it is the ONLY way to see what the corpus actually returns.
// When a topic suggestion cites something odd, the question is whether retrieval or the prompt
// is at fault, and one query here answers it.
//
// The session is resolved OUTSIDE the try: requireSessionUser() redirects by throwing an internal
// Next.js error, and catching that would turn a redirect into a 500.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "knowledge.view", roleAccess);

    const input = searchRequestSchema.parse(await readJsonBody(request));

    // SCOPED BY DEFAULT (`useScope` defaults to true in the schema). Searching the ward's saved
    // scope is the HONEST preview — it shows what topic suggestions will actually retrieve, and
    // a bishopric that tested retrieval against the whole corpus would have tested something the
    // AI never sees.
    //
    // Passing UNFILTERED_SCOPE is how "search everything" is expressed, and it is a real need on
    // this screen: deciding WHAT the scope should be is a different question from checking what
    // it does, and it is asked from the same place.
    const results = await retrieveChunks(input.query, user.wardId, {
      limit: input.limit,
      client: supabase,
      filters: input.useScope ? undefined : UNFILTERED_SCOPE,
      module: "retrieval_tester",
    });

    // The RAW similarity goes back, unrounded and unworded. Every other surface in this app
    // prefers a sentence to a number; this one exists to be INSPECTED, and "0.412" tells a
    // bishopric something "fairly relevant" cannot.
    //
    // No audit row. This reads and writes nothing, and unlike the settings preview it does not
    // spend an Anthropic call — the embedding is a fraction of a cent, and logging every
    // keystroke-driven search would bury the log in noise for no accountability gained.
    return NextResponse.json({ results });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/knowledge/search",
      fallbackMessage: "Could not search the knowledge base. Please try again.",
      // The QUERY TEXT is deliberately absent from this detail. A bishop's search terms can
      // name a specific member.
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
