import { NextResponse } from "next/server";
import {
  createComment,
  getAssignment,
  listComments,
} from "@/lib/assignments/queries";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday } from "@/lib/calendar/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  createCommentSchema,
  listCommentsQuerySchema,
} from "@/lib/validation/assignment";

// Both comment levels through one route. `assignment_comments` is ONE table serving an
// assignment-level thread and a month-level one, so splitting month comments awkwardly under
// /api/sundays/[id] would mean two routes writing the same rows. SPEC.md §API Routes does not
// list this route; it is recorded there in the same change (CLAUDE.md §1).
//
// Realtime is talks-b's job. This route only has to make the row exist — Supabase Realtime
// publishes it to subscribed clients with no server round trip.

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "talks.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;
    const assignmentId = searchParams.get("assignmentId");

    // Exactly one filter. The parameter names are `assignmentId` and `sundayId`, read here
    // exactly as talks-b sends them — a name this handler does not read is silently ignored
    // rather than refused (plans/retros/roster-b-picker-and-orgs.md).
    const filter = listCommentsQuerySchema.parse(
      assignmentId !== null
        ? { assignmentId }
        : { sundayId: searchParams.get("sundayId") ?? undefined },
    );

    const comments = await listComments(user.wardId, filter, supabase);

    return NextResponse.json({ comments });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/assignment-comments",
      fallbackMessage: "Could not load the comments. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "talks.plan", roleAccess);

    const input = createCommentSchema.parse(await readJsonBody(request));

    // The thing being commented on has to be this ward's. RLS would refuse the insert anyway
    // through the composite foreign key, but a 404 naming what was not found is a far better
    // answer than a constraint violation.
    if (input.level === "assignment") {
      const assignment = await getAssignment(user.wardId, input.assignmentId, supabase);
      if (!assignment) {
        return NextResponse.json(
          { error: "That assignment is not in your ward." },
          { status: 404 },
        );
      }
    } else {
      const sunday = await getSunday(user.wardId, input.sundayId, supabase);
      if (!sunday) {
        return NextResponse.json(
          { error: "That Sunday is not on your ward's calendar." },
          { status: 404 },
        );
      }
    }

    const comment = await createComment(user.wardId, input, user.id, supabase);

    // The comment BODY is not in the audit detail. It is free text somebody typed about a
    // member, and an audit row is bishopric-readable (CLAUDE.md rule 8).
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "assignment_comment_created",
        module: "talks",
        detail: {
          commentId: comment.id,
          level: comment.level,
          assignmentId: comment.assignmentId,
          sundayId: comment.sundayId,
        },
      },
      supabase,
    );

    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/assignment-comments",
      fallbackMessage: "Could not post that comment. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
