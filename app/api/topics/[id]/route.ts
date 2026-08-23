import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import {
  getTopic,
  isDuplicateTopicTitleError,
  updateTopic,
} from "@/lib/topics/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateTopicSchema } from "@/lib/validation/topic";

// `params` is a Promise in Next 16, and the props are typed explicitly rather than with the
// generated RouteContext helper, which only exists after a build
// (plans/retros/foundation-a-scaffold.md).
//
// THERE IS NO DELETE HANDLER, deliberately. Archiving is how a topic leaves the library, and a
// DELETE would break every assignment that ever referenced it.

const topicIdSchema = z.uuid("That topic id is not valid.");

const NOT_FOUND = "That topic is not in your ward.";

const WRITE_REFUSED = "That topic could not be saved. Reload and try again.";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { id } = await params;
    const topicId = topicIdSchema.parse(id);
    const input = updateTopicSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "topics.manage", roleAccess);

    const existing = await getTopic(user.wardId, topicId, supabase);
    if (!existing) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    let topic;
    try {
      topic = await updateTopic(user.wardId, topicId, input, supabase);
    } catch (error) {
      // 409, not 500. Renaming a topic onto one that already exists is a real conflict the user
      // can act on, not a server fault.
      if (isDuplicateTopicTitleError(error)) {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }

    if (!topic) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    // Only the FIELD NAMES, never their values — a description can carry a member's
    // circumstances, and an audit row is bishopric-readable (CLAUDE.md rule 8).
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: input.status === "archived" ? "topic_archived" : "topic_updated",
        module: "talks",
        detail: {
          topicId,
          changedFields: Object.keys(input),
          status: topic.status,
        },
      },
      supabase,
    );

    return NextResponse.json({ topic });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/topics/[id]",
      fallbackMessage: "Could not update that topic. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
