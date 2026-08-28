import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { upsertActivityPrivateNoteSchema } from "@/lib/validation/youth";
import {
  deleteOwnPrivateNote,
  getOwnPrivateNote,
  upsertOwnPrivateNote,
} from "@/lib/youth/privateNotes";
import { getActivityLog } from "@/lib/youth/queries";

// The caller's OWN private note on one youth activity follow-up. The only endpoint in the app
// that touches activity_private_notes.
//
// There is no `userId` parameter on any verb here, and there never may be. The author is always
// auth.uid() — in this route, in lib/youth/privateNotes.ts, and in migration 019's four
// author-only policies — so "read somebody else's note" is not a request this API can express.
// A bishop calling GET on an org secretary's note gets `null`, exactly as a stranger would,
// because the policy denies the ROW rather than the query (CLAUDE.md rule 5).
//
// MIGRATION 057 NARROWED activity_logs AND LEFT THESE FOUR POLICIES ALONE, IN EITHER DIRECTION.
// A ward turning cross-org visibility on widens who can read a SHARED note and does not widen a
// private one by a single row — the same boundary migration 053 drew for visits.
//
// The permission check is `youth_activities.log` PLUS RLS, and THE PERMISSION IS THE WEAKER OF
// THE TWO. Holding it lets somebody write THEIR OWN note; it never widens whose notes they can
// read, because the policy is what decides that and it names auth.uid().
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const activityLogIdSchema = z.uuid("That follow-up id is not valid.");

// 404, not 403, for a follow-up the caller cannot see. A 403 would confirm that it exists, which
// tells an org leader something about another organization's work that they may not have.
const NOT_FOUND = "That follow-up is not in your ward.";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.log", roleAccess);

    const { id } = await params;
    const activityLogId = activityLogIdSchema.parse(id);

    const log = await getActivityLog(user.wardId, activityLogId, supabase);

    if (!log) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    const note = await getOwnPrivateNote(user.wardId, activityLogId, supabase);

    // No audit row on a read. Every mutation writes one (CLAUDE.md rule 6) and this is not one;
    // logging that somebody opened their own note would build the very record of private
    // reflection this table exists to avoid keeping.
    return NextResponse.json({ note });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/youth/logs/[id]/private-note",
      fallbackMessage: "Could not load your private note. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.log", roleAccess);

    const { id } = await params;
    const activityLogId = activityLogIdSchema.parse(id);
    const input = upsertActivityPrivateNoteSchema.parse(await readJsonBody(request));

    const log = await getActivityLog(user.wardId, activityLogId, supabase);

    if (!log) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    const note = await upsertOwnPrivateNote(
      user.wardId,
      activityLogId,
      user.id,
      input.notes,
      supabase,
    );

    // THE FOLLOW-UP ID ONLY. Never the note body, never its length, never a preview.
    // writeAuditLog runs redactSensitive() over `detail`, but relying on that would be relying on
    // a denylist to catch a field nobody added to it — the rule is simply never to pass the text.
    // The audit trail records THAT a private note was written, which is what an audit needs; what
    // it says is between the author and nobody.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_private_note_saved",
        module: "youth_activities",
        detail: { activityLogId },
      },
      supabase,
    );

    return NextResponse.json({ note });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/youth/logs/[id]/private-note",
      fallbackMessage: "Could not save your private note. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.log", roleAccess);

    const { id } = await params;
    const activityLogId = activityLogIdSchema.parse(id);

    const log = await getActivityLog(user.wardId, activityLogId, supabase);

    if (!log) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    const deleted = await deleteOwnPrivateNote(user.wardId, activityLogId, supabase);

    // `deleted: false` covers both "there was no note" and "the note was not yours", which are the
    // same answer to this caller — neither is anything they may act on.
    if (deleted) {
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "youth_activity_private_note_deleted",
          module: "youth_activities",
          detail: { activityLogId },
        },
        supabase,
      );
    }

    return NextResponse.json({ deleted });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/youth/logs/[id]/private-note",
      fallbackMessage: "Could not delete your private note. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
