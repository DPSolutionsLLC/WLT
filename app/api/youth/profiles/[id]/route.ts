import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateActivityProfileSchema } from "@/lib/validation/youth";
import {
  deleteActivityProfile,
  getActivityProfile,
  updateActivityProfile,
} from "@/lib/youth/queries";

// WHICH profiles this caller may change is decided by migration 054d, not by a branch in this
// file (CLAUDE.md rule 2). The permission below answers "may this person manage activities at
// all"; the policy answers "may they manage THIS one", and it says: the creator, the bishopric,
// or the youth's org leaders.
//
// A row that vanished between the read and the write, and a row RLS refused, are the same thing
// from here: not yours (plans/retros/foundation-c-services.md). Both become a 404 with the same
// sentence, because distinguishing them would tell a caller that a profile they may not touch
// exists.
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
    const input = updateActivityProfileSchema.parse(await readJsonBody(request));

    // Reads are ward-wide, so this resolves for anybody in the ward — which is what makes the
    // two failures below distinguishable in the LOG without being distinguishable to the caller:
    // "not in your ward" and "not yours to edit" are different facts and neither is theirs.
    const existing = await getActivityProfile(user.wardId, profileId, supabase);

    if (!existing) {
      return NextResponse.json({ error: "That activity is not in your ward." }, { status: 404 });
    }

    const profile = await updateActivityProfile(user.wardId, profileId, input, supabase);

    if (!profile) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_profile_updated",
        module: "youth_activities",
        detail: {
          profileId,
          orgId: profile.orgId,
          changed: Object.keys(input),
        },
      },
      supabase,
    );

    return NextResponse.json({ profile });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/youth/profiles/[id]",
      fallbackMessage: "Could not save that activity. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// Deleting a profile CASCADES to its events (migration 009), and that is correct rather than
// surprising: a game has no meaning without the season it belongs to. The audit row records the
// profile, which is the thing a person chose to remove.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.manage", roleAccess);

    const { id } = await params;
    const profileId = profileIdSchema.parse(id);

    const existing = await getActivityProfile(user.wardId, profileId, supabase);

    if (!existing) {
      return NextResponse.json({ error: "That activity is not in your ward." }, { status: 404 });
    }

    const removed = await deleteActivityProfile(user.wardId, profileId, supabase);

    if (!removed) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_profile_deleted",
        module: "youth_activities",
        detail: {
          profileId,
          orgId: existing.orgId,
          memberId: existing.memberId,
        },
      },
      supabase,
    );

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/youth/profiles/[id]",
      fallbackMessage: "Could not remove that activity. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
