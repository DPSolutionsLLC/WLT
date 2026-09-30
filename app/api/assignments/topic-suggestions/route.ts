import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { GENERATION_MAX_TOKENS, callClaudeStructured } from "@/lib/ai/client";
import { getActiveAiSettings } from "@/lib/ai/queries";
import { retrieveChunks } from "@/lib/ai/retrieve";
import { buildSystemPrompt } from "@/lib/ai/systemPrompt";
import {
  buildRetrievalQuery,
  buildTalkTopicPrompt,
  filterFreshTopicIdeas,
  talkTopicIdeasSchema,
} from "@/lib/ai/topicSuggestions";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { addMonths, formatDateOnly, monthLabel } from "@/lib/calendar/dates";
import { getSunday } from "@/lib/calendar/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listTopicHistory } from "@/lib/topics/queries";
import { RECENT_MONTHS } from "@/lib/topics/topicRotation";
import { talkTopicSuggestionsSchema } from "@/lib/validation/aiRequests";

// TALK TOPIC IDEAS for the topic window's "Suggest topics" (Topics rebuild t5).
//
// THIS ROUTE WRITES NOTHING BUT ITS AUDIT ROW. No topic, no candidate, no assignment: the ideas
// come back as drafts, the planner may tap one into the topic box, and it reaches a talk only when
// they press Save (CLAUDE.md rule 3). There is no topic library to put them in (migration 086).
// tests/routes/topic-suggestions.test.ts counts `assignments`, `topics` and `topic_candidates`
// either side of a success and of a failure.
//
// It avoids what the ward has heard lately and what is already planned: those titles go in the
// prompt, and whatever still resembles one is filtered out by the topic window's own similarity
// rule, so a suggestion is never one the "Used before" hint would flag.
//
// `talks.plan`: choosing a talk's topic is planning, and this spends money on an outbound call.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

// Retrieval's full eight, as the library's generator used: an idea for a topic is the most
// open-ended request in the app, with no talk or speaker to narrow it.
const RETRIEVAL_LIMIT = 8;

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.plan", roleAccess);

    const input = talkTopicSuggestionsSchema.parse(await readJsonBody(request));

    const sunday = await getSunday(user.wardId, input.sundayId, supabase);
    if (!sunday) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    const today = formatDateOnly(new Date());
    const since = addMonths(today, -RECENT_MONTHS);

    const [settings, history] = await Promise.all([
      getActiveAiSettings(user.wardId, supabase),
      listTopicHistory(user.wardId, { today }, supabase),
    ]);

    const recentTitles = history
      .filter((entry) => !entry.isUpcoming && entry.date >= since)
      .map((entry) => entry.topicTitle);
    const upcomingTitles = history
      .filter((entry) => entry.isUpcoming)
      .map((entry) => entry.topicTitle);

    const retrievalQuery = buildRetrievalQuery({
      seed: input.context,
      topicPreferences: settings?.topicPreferences ?? null,
      wardContext: settings?.wardContext ?? null,
    });

    // A null query means nothing to search for; no chunks is a supported state for the prompt.
    const retrievedChunks =
      retrievalQuery === null
        ? []
        : await retrieveChunks(retrievalQuery, user.wardId, {
            limit: RETRIEVAL_LIMIT,
            client: supabase,
            settings,
            module: "topic_suggestions",
          });

    // No try/catch around this. An AiRequestError reaches respondToRouteError, which maps it to
    // its own status and its own sentence — and because nothing is written, a failure changes
    // nothing.
    const result = await callClaudeStructured({
      system: buildSystemPrompt({ settings, module: "topic_suggestions", retrievedChunks }),
      userPrompt: buildTalkTopicPrompt({
        context: input.context,
        recentTitles,
        upcomingTitles,
        alreadyOffered: input.alreadyOffered,
        month: monthLabel(sunday.date),
      }),
      effort: "high",
      maxTokens: GENERATION_MAX_TOKENS,
      format: zodOutputFormat(talkTopicIdeasSchema),
    });

    const { kept, filteredCount } = filterFreshTopicIdeas(result.parsed.topics, [
      ...recentTitles,
      ...upcomingTitles,
      ...input.alreadyOffered,
    ]);

    // Counts only — never a suggestion's words or the planner's context. (No output size either:
    // writeAuditLog() blanks any key containing "token", so it only ever read "[redacted]".)
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "topic_ideas_suggested",
        module: "talks",
        detail: {
          sundayId: sunday.id,
          returned: result.parsed.topics.length,
          kept: kept.length,
          filtered: filteredCount,
          steered: input.context !== null,
          retrievedChunks: retrievedChunks.length,
        },
      },
      supabase,
    );

    return NextResponse.json({ suggestions: kept, filteredCount });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/assignments/topic-suggestions",
      fallbackMessage: "Could not suggest topics. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
