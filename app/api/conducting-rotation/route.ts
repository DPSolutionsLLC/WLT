import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { ForbiddenError } from "@/lib/auth/errors";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { formatDateOnly } from "@/lib/calendar/dates";
import { manageableOrgIds } from "@/lib/calendar/orgRotationScope";
import {
  ConductingRotationConflictError,
  listConductingRotation,
  listRotationOrganizations,
  replaceConductingRotation,
} from "@/lib/calendar/queries";
import { activeRotation } from "@/lib/calendar/resolveConductingUser";
import { notifyOrgLeadership } from "@/lib/notifications/notifyOrgLeadership";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { conductingRotationSchema } from "@/lib/validation/calendar";

// calendar-b renders this sentence verbatim next to the rotation editor. 03-calendar.md Step 3
// requires the UI to say it: a bishopric reordering the rotation must be able to see that last
// month's programs are not about to be rewritten underneath them. The cadence is named too,
// because switching to monthly is the change most likely to be expected to rewrite a month —
// and it does not (migration 024, Part 1).
const FORWARD_ONLY_NOTE =
  "This rotation and its cadence apply from the effective date forward. Sundays already " +
  "assigned keep who they have.";

const orgIdQuerySchema = z.uuid("That organization id is not valid.");

// calendar.view, not calendar.manage: the music coordinator and both secretaries need to read
// who conducts to plan against the upcoming Sunday list. That stays true for an organization's
// rotation — who conducts Relief Society is not sensitive, and the Sunday detail page shows it
// to everyone who may see the calendar.
export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "calendar.view", roleAccess);

    // Absent means every rotation in the ward; "null" means the bishopric's. The three-way
    // distinction matters — see listConductingRotation.
    const requestedOrgId = new URL(request.url).searchParams.get("orgId");
    const orgId =
      requestedOrgId === null
        ? undefined
        : requestedOrgId === "null"
          ? null
          : orgIdQuerySchema.parse(requestedOrgId);

    const rotation = await listConductingRotation(user.wardId, { orgId }, supabase);

    // Today in UTC, matching how every date in this module is read. `sundays.date` is a date with
    // no zone, so a local-time "today" would put a ward west of UTC on yesterday's rotation for
    // part of every day.
    const today = formatDateOnly(new Date());
    const active = activeRotation(
      rotation.map((entry) => ({
        position: entry.position,
        userId: entry.userId,
        effectiveFrom: entry.effectiveFrom,
        cadence: entry.cadence,
      })),
      today,
    );

    return NextResponse.json({
      rotation,
      activeFrom: active[0]?.effectiveFrom ?? null,
      cadence: active[0]?.cadence ?? null,
      note: FORWARD_ONLY_NOTE,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/conducting-rotation",
      fallbackMessage: "Could not load the conducting rotation. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// TWO gates, chosen by the body's orgId — not one gate that covers both (calendar-c Decision 5).
//
//   orgId === null   the bishopric's sacrament-meeting rotation → admin.manage_ward, unchanged.
//                    Reordering it is a bishopric composition decision held to the permission
//                    only bishop and counselor carry, even though a ward_secretary may edit any
//                    individual Sunday (calendar-a Decision 5).
//
//   orgId is a uuid  that organization's own rotation → calendar.manage_org_conducting AND that
//                    id being in manageableOrgIds(). BOTH, never either: the permission says
//                    "may manage an org rotation" and the scope says "this one". Widening
//                    calendar.manage instead would have let an Elders Quorum president edit the
//                    sacrament meeting calendar and every Sunday's type.
//
// Neither check is the security boundary. Migration 024's policies are, and
// tests/rls/org-conducting.test.ts proves it — these exist so a refusal is an honest 403 rather
// than a silent zero-row write.
export async function PATCH(request: Request) {
  const user = await requireSessionUser();

  try {
    // The body is parsed BEFORE the permission check here, which is the opposite order to
    // PATCH /api/sundays/[id] — and it has to be, because WHICH permission applies is decided by
    // the body's orgId. A malformed body therefore comes back as a 400 without a permission
    // decision ever being made, which leaks nothing: the schema shape is not a secret.
    const input = conductingRotationSchema.parse(await readJsonBody(request));
    const supabase = await createServerSupabaseClient();
    // Resolved above the branch so BOTH gates see the ward's configuration. It used to be
    // resolved only inside the else, which made this route disagree with itself (ITER-005).
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    let organizationName: string | null = null;

    if (input.orgId === null) {
      // admin.manage_ward is in NON_OVERRIDABLE_PERMISSIONS, so passing roleAccess here cannot
      // change the answer. It is passed for uniformity: "every check resolves" is a rule with no
      // exceptions to remember, which is the whole point of ITER-005.
      assertCan(user, "admin.manage_ward", roleAccess);
    } else {
      assertCan(user, "calendar.manage_org_conducting", roleAccess);

      const organizations = await listRotationOrganizations(user.wardId, supabase);
      if (!manageableOrgIds(user, organizations, roleAccess).includes(input.orgId)) {
        throw new ForbiddenError("calendar.manage_org_conducting");
      }

      organizationName =
        organizations.find((organization) => organization.id === input.orgId)?.name ?? null;
    }

    const rotation = await replaceConductingRotation(user.wardId, input, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "conducting_rotation_updated",
        module: "calendar",
        detail: {
          orgId: input.orgId,
          cadence: input.cadence,
          effectiveFrom: input.effectiveFrom,
          positions: input.positions,
        },
      },
      supabase,
    );

    if (input.orgId === null) {
      await notifyOtherBishopric({
        wardId: user.wardId,
        actingUserId: user.id,
        title: "Conducting rotation changed",
        description: `The conducting rotation was reordered, effective ${input.effectiveFrom}.`,
      });
    } else {
      await notifyOrgLeadership({
        wardId: user.wardId,
        orgId: input.orgId,
        actingUserId: user.id,
        title: "Organization conducting rotation changed",
        description: `The ${organizationName ?? "organization"} conducting rotation was changed, effective ${input.effectiveFrom}.`,
      });
    }

    return NextResponse.json(
      {
        rotation,
        activeFrom: input.effectiveFrom,
        cadence: input.cadence,
        note: FORWARD_ONLY_NOTE,
      },
      { status: 201 },
    );
  } catch (error) {
    // A date that already carries a rotation is the user picking again, not a server fault. The
    // unique constraint from migration 024 is what catches it. The message names the
    // organization because one ward now holds up to seven independent rotations and a bare date
    // no longer identifies which one collided.
    if (error instanceof ConductingRotationConflictError) {
      const scope = error.orgId === null ? "sacrament meeting" : "that organization";
      return NextResponse.json(
        {
          error: `A ${scope} rotation already takes effect on ${error.effectiveFrom}.`,
        },
        { status: 409 },
      );
    }

    return respondToRouteError(error, {
      route: "PATCH /api/conducting-rotation",
      fallbackMessage: "Could not save the conducting rotation. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
