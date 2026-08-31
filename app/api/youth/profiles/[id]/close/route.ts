import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { closeActivityProfileSchema } from "@/lib/validation/youth";
import { closeActivityProfile, getActivityProfile } from "@/lib/youth/queries";

// CLOSING A SEASON OUT, AND REOPENING ONE — the primary control on an activity, and the reason
// `Remove` could be narrowed to an activity with nothing recorded against it (ITER-028/ITER-031).
//
// ---------------------------------------------------------------------------
// ITS OWN ROUTE, NOT A FIELD ON PATCH /api/youth/profiles/[id]
// ---------------------------------------------------------------------------
// Closing a season is a distinct decision and it gets its own audit action, on the precedent
// `approve` sets on assignments and programs. Folded into the ordinary patch it would appear in
// the audit log as `youth_activity_profile_updated` with `changed: ["closed"]`, which is the
// reasoning updateActivityProfileSchema already gives for keeping `memberId` and `orgId` off it.
//
// TWO ACTIONS, NOT ONE WITH A BOOLEAN IN THE PAYLOAD. An audit reader scanning for the events that
// changed what a ward sees should not have to parse a detail object to tell closing from
// reopening.
//
// ---------------------------------------------------------------------------
// `.manage`, NOT `.log`
// ---------------------------------------------------------------------------
// A closed season is a COORDINATION decision — it ends a ranking — not a pastoral note. A leader
// who may write follow-ups (`org_secretary` holds `.log` and not `.manage`) may not end somebody
// else's season.
//
// WHICH profiles this caller may close is decided by migration 054d, not by a branch here
// (CLAUDE.md rule 2). Migration 060 adds NO policy of its own: closing is an ordinary UPDATE, and
// 054d's `youth_activity_profiles_update` already describes exactly the right boundary, including
// the explicit `org_id is null` arm for a ward council member with no organization.
//
// NOTHING IS NOTIFIED. Nothing in this module notifies on a coordination edit, and emitting the
// first one here would be a decision this slice was not asked to take.
const WRITE_REFUSED =
  "That activity could not be changed. It may belong to another organization. Reload and try again.";

const profileIdSchema = z.uuid("That activity id is not valid.");

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    // `params` is a PROMISE in Next 16. Awaiting it is not optional and a route test calls it as
    // `PATCH(request, { params: Promise.resolve({ id }) })`.
    const { id } = await params;
    const profileId = profileIdSchema.parse(id);
    const input = closeActivityProfileSchema.parse(await readJsonBody(request));

    // Reads are ward-wide, so this resolves for anybody in the ward — which is what keeps "not in
    // your ward" and "not yours to close" distinguishable in the LOG without being
    // distinguishable to the caller.
    const existing = await getActivityProfile(user.wardId, profileId, supabase);

    if (!existing) {
      return NextResponse.json({ error: "That activity is not in your ward." }, { status: 404 });
    }

    // THE SERVER DECIDES THE INSTANT. The body carries a boolean, never a timestamp: the history
    // page recomputes a closed season's final numbers against this moment, so a client-supplied
    // clock could freeze them at an instant nobody chose.
    const closedAt = input.closed ? new Date().toISOString() : null;

    const profile = await closeActivityProfile(user.wardId, profileId, closedAt, supabase);

    if (!profile) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: input.closed
          ? "youth_activity_profile_closed"
          : "youth_activity_profile_reopened",
        module: "youth_activities",
        detail: {
          profileId,
          orgId: profile.orgId,
          memberId: profile.memberId,
          closedAt: profile.closedAt,
        },
      },
      supabase,
    );

    return NextResponse.json({ profile });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/youth/profiles/[id]/close",
      fallbackMessage: "Could not close that activity. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
