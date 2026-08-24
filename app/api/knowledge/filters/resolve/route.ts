import { NextResponse } from "next/server";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MESSAGE_MAX_TOKENS, callClaudeStructured } from "@/lib/ai/client";
import {
  buildFilterResolverPrompt,
  resolvedFilterSchema,
  toResolvedFilter,
} from "@/lib/ai/resolveFilter";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { todayDateOnly } from "@/lib/knowledge/conferenceMetadata";
import { describeFilter, isApplicable } from "@/lib/knowledge/filterResolution";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { filterResolveSchema } from "@/lib/validation/knowledge";

// THIS ROUTE SAVES NOTHING. It returns a proposal, the panel renders describeFilter()'s sentence,
// and only a POST to /api/knowledge/filters turns it into a row. Propose, show, accept — the same
// shape `topic_candidates` uses, which is CLAUDE.md rule 3 applied to a filter instead of a topic.
//
// tests/routes/knowledge-filters.test.ts asserts that structurally by counting `retrieval_filters`
// rows either side of a resolution.
//
// The system prompt is deliberately NOT buildSystemPrompt. This call has nothing to do with the
// ward's tone, doctrinal emphasis or context — it is a parser matching a phrase against a fixed
// vocabulary, and handing it the ward's settings would spend cache on material that cannot change
// the answer. See lib/ai/resolveFilter.ts.
//
// The session is resolved OUTSIDE the try: requireSessionUser() redirects by throwing an internal
// Next.js error, and catching that would turn a redirect into a 500.

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // `knowledge.manage`, not `view`. Resolving is an act of BUILDING the scope, and it spends
    // money on an outbound vendor call — the same reasoning POST /api/topics/ai-suggest records.
    assertCan(user, "knowledge.manage", roleAccess);

    const input = filterResolveSchema.parse(await readJsonBody(request));

    // No try/catch around this. An AiRequestError reaches respondToRouteError, which maps it to
    // its own status and its own written sentence. Catching it here is how the silent-AI-failure
    // pitfall starts — and because this route writes nothing, a failure leaves the ward's saved
    // filters exactly as they were.
    //
    // `effort: "low"` — vocabulary-matching against a fixed enum, not a judgment call. It keeps
    // the panel responsive, and lib/ai/client.ts records why no drafting call may borrow it.
    const result = await callClaudeStructured({
      system: [{ type: "text", text: buildFilterResolverPrompt(todayDateOnly()) }],
      userPrompt: input.phrase,
      effort: "low",
      maxTokens: MESSAGE_MAX_TOKENS,
      format: zodOutputFormat(resolvedFilterSchema),
    });

    // Narrows the flat model output into the ResolvedFilter union, and refuses an incoherent
    // one — a `filter` that narrows nothing becomes `unresolvable` here rather than being caught
    // by migration 034's CHECK at insert time, after somebody has already pressed accept.
    const filter = toResolvedFilter(result.parsed);

    // THE PHRASE IS LOGGED. It is the user's own words about their own corpus, not generated
    // content, and it is what makes "why did this resolve so strangely" answerable later. The
    // resulting `kind` goes with it, because a ward whose every phrase comes back `semantic` has
    // a teaching problem this log is the only record of.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "retrieval_filter_resolved",
        module: "knowledge",
        detail: {
          phrase: input.phrase,
          kind: filter.kind,
          outputTokens: result.outputTokens,
        },
      },
      supabase,
    );

    // The SENTENCE travels with the proposal rather than being rebuilt in the browser. It is what
    // the user is being asked to agree to, and two implementations of it would eventually
    // disagree about what was approved.
    return NextResponse.json({
      filter,
      description: isApplicable(filter) ? describeFilter(filter) : null,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/knowledge/filters/resolve",
      fallbackMessage: "Could not work out a filter from that. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
