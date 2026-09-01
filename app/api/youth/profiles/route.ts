import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { notifyOrgLeadership } from "@/lib/notifications/notifyOrgLeadership";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createActivityProfileSchema } from "@/lib/validation/youth";
import { createActivityProfile, listActivityProfiles } from "@/lib/youth/queries";
import { ACTIVITY_TYPE_LABELS, type Role } from "@/types/domain";

// Youth activity profiles — "this young man plays for the school basketball team".
//
// ---------------------------------------------------------------------------
// THE READ IS WARD-WIDE AND THE WRITE IS ORG-SCOPED, AND THAT IS THE WHOLE MODULE
// ---------------------------------------------------------------------------
// Migration 054's header carries the argument in full. The short version: FEATURES.md §Module 10
// gives the ward council the FULL calendar, because seeing across the organizations is the entire
// point of a ward council — but an Elders Quorum president entering an activity "for the Young
// Women" is not coordination, it is somebody believing they did something they did not.
//
// So the GET below applies NO org filter, deliberately, and the POST stamps ownership FROM THE
// SESSION and never from the request body.
//
// Modelled on app/api/visit-goals/route.ts, which solves the same ownership problem — with ONE
// deliberate departure, documented at the case where it happens.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

export async function GET() {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "youth_activities.view", roleAccess);

    // EVERY profile in the ward, with no org filter. That is not an oversight and it is not RLS
    // doing something surprising — `youth_activity_profiles_ward_select` from migration 019
    // survives untouched by 054 for exactly this. A `.eq("org_id", user.orgId)` added here later
    // would silently take the ward council's reason to exist away.
    const profiles = await listActivityProfiles(user.wardId, supabase);

    return NextResponse.json({ profiles });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/youth/profiles",
      fallbackMessage: "Could not load the youth activities. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // Not `youth_activities.view`. An org secretary can read this list and cannot add to it, and
    // the permission matrix is what says so — never a comparison of `user.role` to a string,
    // which bypasses the ward's role_access override (plans/retros/role-access-overrides.md).
    assertCan(user, "youth_activities.manage", roleAccess);

    const input = createActivityProfileSchema.parse(await readJsonBody(request));
    const bishopricAuthor = isBishopric(user.role);

    if (bishopricAuthor && input.orgId !== undefined) {
      // Checked against the ward's live organizations, because `org_id` carries a composite
      // foreign key that would otherwise answer a foreign id with a constraint violation nobody
      // can act on.
      const organizations = await listWardOrganizations(user.wardId, supabase);

      if (!organizations.some((organization) => organization.id === input.orgId)) {
        return NextResponse.json(
          { error: "That organization is not in your ward." },
          { status: 404 },
        );
      }
    } else if (!bishopricAuthor && input.orgId !== undefined && input.orgId !== user.orgId) {
      // REFUSED RATHER THAN IGNORED. Silently overwriting it would let a leader believe they had
      // just entered an activity on the Young Women's board.
      return NextResponse.json(
        { error: "You can only enter activities for your own organization." },
        { status: 403 },
      );
    }

    // ---------------------------------------------------------------------
    // WHERE THIS ROUTE DEPARTS FROM visit-goals, AND WHY
    // ---------------------------------------------------------------------
    // visit-goals returns 409 to an author with no organization, because migration 019 makes an
    // org-scoped goal invisible to a null-org author — the row would be written into a hole.
    //
    // A PROFILE WITH NO ORGANIZATION IS NOT A HOLE. It is a ward-wide profile: readable by
    // everyone with `youth_activities.view`, writable by its creator, and explicitly permitted by
    // policy 054d's `org_id is null` branch. So it is written rather than refused.
    //
    // `ward_council_member` is the role that lands here most often, and it is the role
    // 08-youth-activities.md calls the widest in the app. Refusing it would have closed the
    // module to one of the two roles it was built for.
    const orgId = bishopricAuthor ? (input.orgId ?? null) : user.orgId;

    const profile = await createActivityProfile(user.wardId, orgId, user.id, input, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "youth_activity_profile_created",
        module: "youth_activities",
        detail: {
          profileId: profile.id,
          activityName: profile.activityName,
          // WHO WAS PUT ON IT AT CREATION, which is the roster the request asked for. Adding
          // somebody later is its own action with its own audit row
          // (`youth_activity_roster_added`), so this is not the whole story of a team's roster and
          // is not meant to be — it is what THIS request did.
          memberIds: profile.roster.map((member) => member.memberId),
          orgId: profile.orgId,
          activityType: profile.activityType,
        },
      },
      supabase,
    );

    // A WARD-WIDE PROFILE HAS NO ORG LEADERSHIP TO NOTIFY. The emit is skipped rather than called
    // with a null orgId — notifyOrgLeadership resolves recipients by `org_id`, so a null would
    // match every user whose organization was never set and send them somebody else's news.
    //
    // No client argument, matching the two existing callers: notifyOrgLeadership addresses rows
    // to OTHER users and reads their notification preferences, neither of which the caller's own
    // session can do. It falls back to the service client on purpose.
    if (profile.orgId !== null) {
      await notifyOrgLeadership({
        wardId: user.wardId,
        orgId: profile.orgId,
        actingUserId: user.id,
        triggerKey: "youth_activity_added",
        title: "A youth activity was added",
        description: `${profile.activityName} (${
          ACTIVITY_TYPE_LABELS[profile.activityType]
        })`,
      });
    }

    return NextResponse.json({ profile }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/youth/profiles",
      fallbackMessage: "Could not save that activity. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
