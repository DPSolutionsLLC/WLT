import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GENERATION_MAX_TOKENS, callClaudeStructured } from "@/lib/ai/client";
import { AiRequestError } from "@/lib/ai/errors";
import {
  DEFAULT_HYMN_SUGGESTIONS,
  buildHymnSuggestionPrompt,
  hymnSuggestionsSchema,
  validateSuggestions,
} from "@/lib/ai/hymnSuggestions";
import { getActiveAiSettings } from "@/lib/ai/queries";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { formatSundayLabelWithYear } from "@/lib/calendar/dates";
import { getSunday } from "@/lib/calendar/queries";
import { buildCandidates } from "@/lib/music/hymnCandidates";
import { listHymns } from "@/lib/music/queries";
import { listSundayTopicTitles } from "@/lib/music/sundayTopics";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { suggestHymnsQuerySchema } from "@/lib/validation/music";
import { holdsSacramentMeeting } from "@/types/domain";

// AI hymn suggestions.
//
// ---------------------------------------------------------------------------------------------
// THIS ROUTE WRITES NOTHING BUT AN AUDIT ROW
// ---------------------------------------------------------------------------------------------
// No hymn_selections insert, no candidate queue, no cache. Suggestions are returned and held in
// the coordinator's browser until they press accept, at which point POST /api/hymns/select is a
// separate request they made on purpose (CLAUDE.md rule 3, and ai-c's shape). Navigating away
// loses them, which is correct: nothing was decided.
//
// Hymn suggestions are lighter than topic suggestions and need no queue table. The rule is
// identical — nothing is saved by generating.
//
// ---------------------------------------------------------------------------------------------
// EVERY NUMBER IS CHECKED AGAINST THE TABLE
// ---------------------------------------------------------------------------------------------
// The candidate list goes into the prompt so the model RANKS rather than RECALLS, and
// validateSuggestions() drops any number that was not on it. See lib/music/hymnCandidates.ts for
// why (ITER-016).
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // `music.manage`, not `music.view`. Generating is an act of BUILDING the Sunday's music, and
    // it spends money on an outbound vendor call — the same reasoning POST /api/topics/ai-suggest
    // records for topics.manage.
    assertCan(user, "music.manage", roleAccess);

    const searchParams = new URL(request.url).searchParams;
    const query = suggestHymnsQuerySchema.parse({
      sundayId: searchParams.get("sundayId") ?? undefined,
      hymnType: searchParams.get("hymnType") ?? undefined,
    });

    const sunday = await getSunday(user.wardId, query.sundayId, supabase);

    // Null means the Sunday is not in this ward, or RLS refused it. The two are indistinguishable
    // here and both mean "not yours" (plans/retros/foundation-c-services.md).
    if (sunday === null) {
      return NextResponse.json({ error: "That Sunday is not on this ward's calendar." }, {
        status: 404,
      });
    }

    // 422 rather than an empty list. There are no hymns for a meeting that is not held, and
    // returning suggestions for one would be an answer to a question nobody can act on — the same
    // refusal POST /api/programs makes.
    if (!holdsSacramentMeeting(sunday.type)) {
      return NextResponse.json(
        { error: "That Sunday holds no sacrament meeting, so it has no hymns." },
        { status: 422 },
      );
    }

    const [settings, hymns, topicsBySunday] = await Promise.all([
      getActiveAiSettings(user.wardId, supabase),
      listHymns(supabase),
      listSundayTopicTitles(user.wardId, [sunday], supabase),
    ]);

    const topicTitles = topicsBySunday.get(sunday.id) ?? [];

    const candidates = buildCandidates({
      topicTitles,
      hymns,
      hymnType: query.hymnType,
    });

    // A hymnbook this app can vouch for nothing in cannot produce a suggestion, and asking Claude
    // to choose from an empty list would spend money to be told so. Its own sentence, because
    // "no suggestions" would read as "nothing fits your topics".
    if (candidates.length === 0) {
      return NextResponse.json(
        {
          error:
            "There are no verified hymns to choose from yet. The hymnbook has not been loaded, " +
            "so suggestions cannot be made — choose a hymn by number instead.",
        },
        { status: 422 },
      );
    }

    // NO RETRIEVAL. Layers 1 and 2 of the system prompt carry the ward's voice and settings; layer
    // 3 searches the scripture corpus, and nothing in it names a hymn. Embedding a topic title to
    // pull six verses that the model then does not use would spend an embedding call and a
    // thousand tokens to change nothing about which of forty hymns it picks. buildSystemPrompt
    // treats an empty chunk list as a supported state (ai-b).
    const system = buildSystemPrompt({
      settings,
      module: "hymn_suggestions",
      retrievedChunks: [],
    });

    const userPrompt = buildHymnSuggestionPrompt({
      sundayLabel: formatSundayLabelWithYear(sunday.date),
      hymnType: query.hymnType,
      topicTitles,
      candidates,
      count: DEFAULT_HYMN_SUGGESTIONS,
    });

    // No try/catch around this. An AiRequestError reaches respondToRouteError, which maps each of
    // its six kinds to its own status and its own written sentence. Catching it here is how the
    // silent-AI-failure pitfall starts — and because nothing is written, a failure leaves the
    // Sunday exactly as it was.
    const result = await callClaudeStructured({
      system,
      userPrompt,
      // "high", matching topic generation. This is a generative ranking task over forty options
      // with a one-line justification each, not a formatting job.
      effort: "high",
      maxTokens: GENERATION_MAX_TOKENS,
      format: zodOutputFormat(hymnSuggestionsSchema),
    });

    const { kept, droppedNumbers } = validateSuggestions(result.parsed.suggestions, candidates);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "hymn_suggestions_generated",
        // "music", a module value this app has not used before. The Music screen is its own
        // module in FEATURES.md and in the sidebar, and filing its actions under "program" would
        // make them unfindable in the Phase 11 audit viewer under the one word somebody would
        // search for.
        module: "music",
        detail: {
          sundayId: sunday.id,
          hymnType: query.hymnType,
          topicCount: topicTitles.length,
          candidateCount: candidates.length,
          returned: result.parsed.suggestions.length,
          kept: kept.length,
          // The NUMBERS, not just how many. A model inventing hymn 402 twice a week is a fact
          // somebody should be able to find, and it is the evidence ITER-016 asked for.
          droppedNumbers,
          outputTokens: result.outputTokens,
        },
      },
      supabase,
    );

    // ALL DROPPED IS AN ERROR WITH ITS OWN SENTENCE, NOT AN EMPTY LIST.
    //
    // An empty array renders as "no hymns fit this Sunday", which is a statement about the ward's
    // topics. The truth is that the model returned numbers that are not hymns this app can vouch
    // for, and the coordinator needs to know that retrying is worth doing and that nothing about
    // their Sunday is wrong.
    if (kept.length === 0) {
      console.error("Every hymn suggestion was rejected as not being on the candidate list", {
        wardId: user.wardId,
        sundayId: sunday.id,
        droppedNumbers,
      });
      throw new AiRequestError(
        "refused",
        "The suggested hymn numbers were not ones this ward's hymnbook could confirm, so none " +
          "are shown. Nothing was saved — try again, or choose a hymn by number.",
      );
    }

    return NextResponse.json({
      suggestions: kept,
      // Reported rather than hidden. A response that quietly showed two of three suggestions
      // would make the validation invisible, and the count is what tells somebody the check is
      // doing work.
      droppedCount: droppedNumbers.length,
      candidateCount: candidates.length,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/hymns/suggest",
      fallbackMessage: "Could not suggest hymns. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
