import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import {
  createTopic,
  isDuplicateTopicTitleError,
  listTopics,
} from "@/lib/topics/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createTopicSchema, listTopicsQuerySchema } from "@/lib/validation/topic";

// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "topics.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;

    // Read here EXACTLY as TopicList sends them. A client sending a name this handler does not
    // read gets no error, just a silently ignored filter
    // (plans/retros/roster-b-picker-and-orgs.md).
    const filter = listTopicsQuerySchema.parse({
      category: searchParams.get("category") ?? undefined,
      status: searchParams.get("status") ?? undefined,
    });

    const topics = await listTopics(user.wardId, filter, supabase);

    return NextResponse.json({ topics });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/topics",
      fallbackMessage: "Could not load the topic library. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// The MANUAL add path, and the only one a person reaches directly. `source` is set to "manual"
// here and is not a field the request may carry — a caller that could name its own source could
// launder an AI suggestion into the library as if a person had typed it (CLAUDE.md rule 3).
export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "topics.manage", roleAccess);

    const input = createTopicSchema.parse(await readJsonBody(request));

    let topic;
    try {
      topic = await createTopic(user.wardId, input, "manual", supabase);
    } catch (error) {
      // 409, not 500. The ward already has this topic, and "please try again" would be a lie —
      // retrying can never succeed. Migration 018's unique index on (ward_id, lower(title)) is
      // the boundary; this makes its refusal a sentence.
      if (isDuplicateTopicTitleError(error)) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "topic_created",
        module: "talks",
        detail: {
          topicId: topic.id,
          category: topic.category,
          source: topic.source,
        },
      },
      supabase,
    );

    return NextResponse.json({ topic }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/topics",
      fallbackMessage: "Could not create that topic. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
