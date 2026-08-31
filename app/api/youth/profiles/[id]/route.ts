import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateActivityProfileSchema } from "@/lib/validation/youth";
import {
  countActivityProfileFollowUps,
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

// REMOVING AN ACTIVITY IS NOW THE EXCEPTION, AND IT CANNOT DESTROY A PASTORAL RECORD.
//
// ---------------------------------------------------------------------------
// WHAT THIS DELETE USED TO DO
// ---------------------------------------------------------------------------
// It deleted unconditionally. Migration 009 cascades youth_activity_profiles → activity_events →
// {activity_attendees, activity_logs → activity_private_notes}, so one press destroyed a season,
// every sign-up, every follow-up AND the private notes CLAUDE.md rule 5 calls private forever.
// `2809aef` added a confirm dialog; a dialog can be clicked through and is not protection for a
// record somebody else wrote (ITER-031).
//
// ---------------------------------------------------------------------------
// THE REFUSAL, AND WHY IT NEEDS A `security definer` COUNT
// ---------------------------------------------------------------------------
// The DELETE policy (054d) and the log SELECT policy (057c) are scoped differently: `entered_by =
// auth.uid()` admits a delete and appears nowhere in the read. So a leader who created an activity
// and has since been recalled to a different organization may delete it while being unable to read
// one follow-up written on it, and a count through their own client would return zero. More
// generally, whether an activity may be destroyed is a fact about the ACTIVITY and must not depend
// on who is asking (migration 056c's uniform-evaluability rule). Migration 060b's
// `activity_profile_followup_count` answers it the same way for everybody, returns a COUNT and
// never a row, and is ward-scoped so it cannot probe another ward.
//
// THE COUNT IS NOT DISCLOSED, AND NEITHER IS ANY CONTENT. The deleter may not be entitled to know
// whose follow-ups those are or how many — that is rule 5, and it is a judgement rather than an
// obvious call, so it is written down here. "Has follow-ups recorded against it" is the right
// amount to say.
//
// REFUSED, NOT CONFIRMED, and the sentence NAMES THE ALTERNATIVE in the same breath. That is
// visits-f's empty-bulk-replace precedent: a refusal that leaves somebody with no way forward is
// a dead end, and Close is the way forward — it destroys nothing and it is what they wanted.
//
// NO AUDIT ROW FOR THE REFUSAL. A refused write is not a mutation; scenario 049's walk established
// that refused calls leave no audit rows, and a row here would make the audit log disagree.
//
// AN ACTIVITY WITH EVENTS BUT NO FOLLOW-UPS STILL DELETES. Close is advice, not a lock: only a
// WRITTEN ACCOUNT is protected, because that is the thing nobody can reconstruct.
const HAS_FOLLOW_UPS =
  "This activity has follow-ups recorded against it, so it cannot be removed. Close it instead — " +
  "its history stays readable and it leaves the support ranking.";

// Deleting a profile CASCADES to its events (migration 009), and that is correct rather than
// surprising: a game has no meaning without the season it belongs to.
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

    // BEFORE ANYTHING IS DESTROYED. The client-side gate in ActivityProfileList only renders
    // `Remove` at `eventCount === 0`, but the UI gate and this one are two expressions of one rule
    // and neither is the boundary on its own (CLAUDE.md rule 2).
    if ((await countActivityProfileFollowUps(profileId, supabase)) > 0) {
      return NextResponse.json({ error: HAS_FOLLOW_UPS }, { status: 409 });
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
        // WHAT WAS LOST, not only which row. Three bare ids was ITER-031's other half of the
        // defect: an audit reader could not tell a mistyped activity removed the same afternoon
        // from a season of fixtures. `eventCount` is the embedded count on the profile that was
        // read a moment ago, so it is the number that actually went.
        detail: {
          profileId,
          orgId: existing.orgId,
          memberId: existing.memberId,
          activityName: existing.activityName,
          eventCount: existing.eventCount,
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
