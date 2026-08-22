import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { manageableOrgIds } from "@/lib/calendar/orgRotationScope";
import {
  getSunday,
  listRotationOrganizations,
  listSundayOrgConducting,
  readConductorName,
  setSundayOrgConducting,
} from "@/lib/calendar/queries";
import { notifyOrgLeadership } from "@/lib/notifications/notifyOrgLeadership";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { sundayOrgConductingSchema } from "@/lib/validation/calendar";
import { holdsSacramentMeeting } from "@/types/domain";

const sundayIdSchema = z.uuid("That Sunday id is not valid.");

const NOT_IN_WARD = "That Sunday is not on your ward's calendar.";

const NO_MEETING = "That Sunday holds no meeting, so no organization conducts.";

// One organization's conductor for one Sunday. Deliberately ONE organization per request: a bulk
// save over six organizations makes a partial failure impossible to report honestly, so the UI
// saves each row on its own and there is no "save all".
//
// The same paired check as PATCH /api/conducting-rotation — calendar.manage_org_conducting AND
// the organization being in manageableOrgIds(). Neither is the boundary; migration 024's policies
// are. These make the refusal an honest 403.
//
// `params` is a Promise in Next 16 and the props are typed explicitly rather than with the
// generated RouteContext helper, which only exists after a build
// (plans/retros/foundation-a-scaffold.md).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { id } = await params;
    const sundayId = sundayIdSchema.parse(id);
    const input = sundayOrgConductingSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "calendar.manage_org_conducting", roleAccess);

    const organizations = await listRotationOrganizations(user.wardId, supabase);
    if (!manageableOrgIds(user, organizations, roleAccess).includes(input.orgId)) {
      throw new ForbiddenError("calendar.manage_org_conducting");
    }

    // A Sunday in another ward and a Sunday RLS refused are indistinguishable here, and both mean
    // "not yours" (plans/retros/foundation-c-services.md).
    const sunday = await getSunday(user.wardId, sundayId, supabase);
    if (!sunday) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    // 409, not 403. The caller's permissions are fine — the Sunday's STATE is what refuses, and a
    // 403 would send them to an administrator who cannot help.
    //
    // This check is the enforcement, not a convenience. sundays has a CHECK constraint for the
    // equivalent rule; sunday_org_conducting deliberately has none, because a constraint there
    // cannot see the Sunday's type and this repo has no triggers (migration 027, Part 3). That
    // makes this route and lib/calendar/queries.ts the only things keeping the rule.
    if (!holdsSacramentMeeting(sunday.type)) {
      return NextResponse.json({ error: NO_MEETING }, { status: 409 });
    }

    // Read before writing so the notification fires on a REAL change only, matching how
    // PATCH /api/sundays/[id] only notifies when conductingUserId actually moved. Saving a form
    // without touching the select should not tell two other people that something changed.
    const before = await listSundayOrgConducting(user.wardId, sundayId, supabase);
    const previousUserId =
      before.find((row) => row.orgId === input.orgId)?.userId ?? null;

    const saved = await setSundayOrgConducting(
      user.wardId,
      sundayId,
      input.orgId,
      input.userId,
      supabase,
    );

    if (!saved) {
      return NextResponse.json({ error: NOT_IN_WARD }, { status: 404 });
    }

    const organizationName =
      organizations.find((organization) => organization.id === input.orgId)?.name ?? null;

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "sunday_org_conducting_updated",
        module: "calendar",
        detail: {
          sundayId,
          date: sunday.date,
          orgId: input.orgId,
          userId: input.userId,
          changed: previousUserId !== saved.userId,
        },
      },
      supabase,
    );

    if (previousUserId !== saved.userId) {
      const conductorName = saved.userId
        ? await readConductorName(user.wardId, saved.userId, supabase)
        : null;

      await notifyOrgLeadership({
        wardId: user.wardId,
        orgId: input.orgId,
        actingUserId: user.id,
        title: "Organization conducting changed",
        description: saved.userId
          ? `${conductorName ?? "Someone else"} now conducts ${organizationName ?? "your organization"} on ${sunday.date}.`
          : `Nobody is assigned to conduct ${organizationName ?? "your organization"} on ${sunday.date}.`,
      });
    }

    return NextResponse.json({ orgConducting: saved });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/sundays/[id]/org-conducting",
      fallbackMessage: "Could not set who conducts. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
