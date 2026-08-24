import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GENERATION_MAX_TOKENS, callClaudeStructured } from "@/lib/ai/client";
import { getActiveAiSettings } from "@/lib/ai/queries";
import { retrieveChunks } from "@/lib/ai/retrieve";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import {
  buildRetrievalQuery,
  buildTopicSuggestionPrompt,
  filterNovelSuggestions,
  formatTalkCitation,
  topicSuggestionsSchema,
} from "@/lib/ai/topicSuggestions";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createCandidates, listCandidates, listTopics } from "@/lib/topics/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { aiSuggestTopicsSchema } from "@/lib/validation/aiRequests";

// Generating topic suggestions. THIS ROUTE MUST NEVER TOUCH `topics`.
//
// It reads titles — to avoid proposing something the ward already has — and that is the whole of
// its relationship with the topic library. Everything it writes goes to `topic_candidates` as
// `pending`, and PATCH /api/topic-candidates is the only path from there into `topics`
// (CLAUDE.md rule 3). tests/routes/ai-suggest.test.ts asserts that structurally by counting
// `topics` rows either side of a generation, including one that fails.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

// Retrieval's full eight, rather than the default six. Topic generation is the most open-ended
// request in the app — there is no assignment, no speaker and no topic to narrow it — so it is
// the one place worth the extra context (05-ai-platform.md).
const RETRIEVAL_LIMIT = 8;

// How many recently-spoken titles are worth naming. Beyond this the "you covered these lately"
// list stops being a signal and becomes the topic library again, which the prompt already has.
const RECENTLY_USED_LIMIT = 10;

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // `topics.manage`, not `topics.view` — the same reasoning PATCH /api/topic-candidates
    // records. Generating candidates is an act of BUILDING the library, not reading it, and it
    // spends money on an outbound vendor call.
    assertCan(user, "topics.manage", roleAccess);

    const input = aiSuggestTopicsSchema.parse(await readJsonBody(request));

    // Archived topics are loaded too. Migration 018's unique index is on
    // `topics (ward_id, lower(title))` and does not care about status, so a suggestion
    // duplicating an archived title would 409 at accept time — after somebody had already read
    // it and decided they wanted it.
    const [settings, activeTopics, archivedTopics, pendingCandidates] = await Promise.all([
      getActiveAiSettings(user.wardId, supabase),
      listTopics(user.wardId, { status: "active" }, supabase),
      listTopics(user.wardId, { status: "archived" }, supabase),
      listCandidates(user.wardId, "pending", supabase),
    ]);

    const takenTitles = [
      ...activeTopics.map((topic) => topic.title),
      ...archivedTopics.map((topic) => topic.title),
      ...pendingCandidates.map((candidate) => candidate.title),
    ];

    // Derived from the topics already loaded rather than by a fourth query. `listTopics` orders
    // by `last_assigned_at` NULLS FIRST, so the most recently used are at the END.
    const recentlyUsedTitles = activeTopics
      .filter((topic) => topic.lastAssignedAt !== null)
      .slice(-RECENTLY_USED_LIMIT)
      .map((topic) => topic.title);

    const retrievalQuery = buildRetrievalQuery({
      seed: input.seed,
      topicPreferences: settings?.topicPreferences ?? null,
      wardContext: settings?.wardContext ?? null,
    });

    // A null query means the ward gave retrieval no signal at all — no seed, no topic
    // preferences, no ward context. Embedding the empty string would return the corpus's
    // arbitrary nearest neighbours dressed up as relevant material. No chunks means
    // buildSystemPrompt omits layer 3, which is a supported state.
    const retrievedChunks =
      retrievalQuery === null
        ? []
        : await retrieveChunks(retrievalQuery, user.wardId, {
            limit: RETRIEVAL_LIMIT,
            client: supabase,
            // Already loaded in the Promise.all above. Passing it saves retrieveChunks a second
            // read of the same row to resolve the ward's conference scope; omitting it would
            // still be correct, which is what keeps ai-d's change non-breaking.
            settings,
            module: "topic_suggestions",
          });

    const system = buildSystemPrompt({
      settings,
      module: "topic_suggestions",
      retrievedChunks,
    });

    // No try/catch around this. An AiRequestError reaches respondToRouteError, which maps it to
    // its own status and its own written sentence. Catching it here is how the silent-AI-failure
    // pitfall starts — and because nothing has been written yet, a failure leaves the queue
    // exactly as it was.
    const result = await callClaudeStructured({
      system,
      userPrompt: buildTopicSuggestionPrompt({
        count: input.count,
        seed: input.seed,
        existingTitles: takenTitles,
        recentlyUsedTitles,
      }),
      effort: "high",
      maxTokens: GENERATION_MAX_TOKENS,
      format: zodOutputFormat(topicSuggestionsSchema),
    });

    const { kept, filteredCount } = filterNovelSuggestions(result.parsed.topics, takenTitles);

    // `pending`, with no reviewer and no accepted topic. createCandidates cannot write anything
    // else, and topic_candidates_review_pair would refuse the combination if it could.
    const candidates = await createCandidates(
      user.wardId,
      kept.map((suggestion) => ({
        title: suggestion.title.trim(),
        category: suggestion.category,
        description: suggestion.description.trim(),
        // Flattened to strings, because that is what the column stores and what
        // mapCandidateRow reads back. See formatTalkCitation.
        suggestedScriptures: suggestion.suggestedScriptures
          .map((reference) => reference.trim())
          .filter((reference) => reference !== ""),
        suggestedTalks: suggestion.suggestedTalks
          .map(formatTalkCitation)
          .filter((citation) => citation !== ""),
      })),
      supabase,
    );

    // All four numbers. "Asked for 5, got 5, inserted 3" is the only way anybody reading this
    // log later understands where the other two went. Never the suggestion text.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "topic_candidates_generated",
        module: "talks",
        detail: {
          requested: input.count,
          returned: result.parsed.topics.length,
          inserted: candidates.length,
          filtered: filteredCount,
          seeded: input.seed !== null,
          retrievedChunks: retrievedChunks.length,
          outputTokens: result.outputTokens,
        },
      },
      supabase,
    );

    // 201 when something was created, 200 when nothing was. "Every suggestion was one you
    // already have" is a real answer with a real count behind it, not an error — and a 201 with
    // an empty array would claim a creation that did not happen.
    return NextResponse.json(
      { candidates, filteredCount, returnedCount: result.parsed.topics.length },
      { status: candidates.length > 0 ? 201 : 200 },
    );
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/topics/ai-suggest",
      fallbackMessage: "Could not suggest topics. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
