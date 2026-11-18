import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  countActiveBishops,
  displayName,
  LAST_BISHOP_MESSAGE,
  listWardOrganizations,
} from "@/lib/auth/adminUsers";
import { ForbiddenError, InvalidInputError } from "@/lib/auth/errors";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { describeTarget } from "@/lib/callings/callingReview";
import { roleNeedsRosterLink } from "@/lib/callings/linkAccess";
import { hasActiveLink } from "@/lib/callings/memberLinks";
import { readActiveCalling } from "@/lib/callings/queries";
import { updateCalling } from "@/lib/callings/writeCalling";
import { notifyOtherBishopric } from "@/lib/notifications/notifyOtherBishopric";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import {
  clearCallingOverrideSchema,
  setCallingOverrideSchema,
} from "@/lib/validation/callingReview";
import type { Database } from "@/types/database";
import type { Calling } from "@/types/domain";

// THE SUPER ADMIN'S OVERRIDE (ITER-058 cr2, D3). Admin → Users no longer sets a calling for
// anybody; this is the one hand edit left, and it is MARKED: `source = 'override'` plus who and
// when, shown as "Overridden — differs from the ward list" and put back on every Calling review.
//
// `isSuperAdmin` alone is the gate, read from session_context() (migration 091). Overriding your
// OWN calling is allowed: a super admin already bypasses the matrix, and this is what closes the
// gap where nobody could correct a super admin's own calling (sacrament-planner-import).
//
// POST sets an override; DELETE clears it, after which the review proposes the ward list's value.
// Both go through updateCalling(), the only function that changes an existing calling, so a stale
// Zoom remote link is turned off on the way.

const NO_CALLING_MESSAGE = "That account holds no calling in this ward.";
const NOT_FROM_ROSTER_MESSAGE =
  "This calling is not set from the ward list, so there is nothing to override.";
const NOT_OVERRIDDEN_MESSAGE = "That calling is not overridden.";

async function readTargetCalling(
  userId: string,
  wardId: string,
  service: SupabaseClient<Database>,
): Promise<Calling> {
  const calling = await readActiveCalling(userId, wardId, service);
  if (!calling) throw new InvalidInputError(NO_CALLING_MESSAGE);
  if (!roleNeedsRosterLink(calling.role)) throw new InvalidInputError(NOT_FROM_ROSTER_MESSAGE);
  return calling;
}

async function readAccountName(userId: string, service: SupabaseClient<Database>): Promise<string> {
  const { data, error } = await service
    .from("users")
    .select("first_name, last_name, username, email")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the account's name — ${error.message}`, { userId });
    throw new Error(`Could not read the account: ${error.message}`);
  }

  return data
    ? displayName({
        firstName: data.first_name,
        lastName: data.last_name,
        username: data.username,
        email: data.email,
      })
    : "an account";
}

function changeDetail(before: Calling, after: Calling) {
  return {
    callingId: after.id,
    targetUserId: after.userId,
    beforeRole: before.role,
    afterRole: after.role,
    beforeOrgId: before.orgId,
    afterOrgId: after.orgId,
    beforeCounselorPosition: before.counselorPosition,
    afterCounselorPosition: after.counselorPosition,
  };
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    if (!user.isSuperAdmin) throw new ForbiddenError("super_admin");

    const input = setCallingOverrideSchema.parse(await readJsonBody(request));
    const service = createServiceSupabaseClient();
    const before = await readTargetCalling(input.userId, user.wardId, service);

    const organizations = await listWardOrganizations(user.wardId, service);
    if (input.orgId !== null && !organizations.some((organization) => organization.id === input.orgId)) {
      throw new InvalidInputError("That organization is not in this ward.");
    }

    if (
      before.role === "bishop" &&
      input.role !== "bishop" &&
      (await countActiveBishops(user.wardId, service)) <= 1
    ) {
      return NextResponse.json({ error: LAST_BISHOP_MESSAGE }, { status: 400 });
    }

    const after = await updateCalling(
      {
        userId: input.userId,
        wardId: user.wardId,
        changes: { role: input.role, orgId: input.orgId, counselorPosition: input.counselorPosition },
        actorUserId: user.id,
        source: "override",
      },
      service,
    );
    if (!after) throw new InvalidInputError(NO_CALLING_MESSAGE);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "calling_override_set",
        module: "admin",
        detail: changeDetail(before, after),
      },
      service,
    );

    const organizationNames = new Map(organizations.map((organization) => [organization.id, organization.name]));
    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      title: "Calling overridden",
      description:
        `${displayName(user)} overrode ${await readAccountName(input.userId, service)}'s calling ` +
        `as ${describeTarget(after, organizationNames)}. It differs from the ward list until cleared.`,
    });

    return NextResponse.json({ calling: after });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/callings/override",
      fallbackMessage: "Could not override the calling. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function DELETE(request: Request) {
  const user = await requireSessionUser();

  try {
    if (!user.isSuperAdmin) throw new ForbiddenError("super_admin");

    const input = clearCallingOverrideSchema.parse(await readJsonBody(request));
    const service = createServiceSupabaseClient();
    const before = await readTargetCalling(input.userId, user.wardId, service);
    if (before.source !== "override") throw new InvalidInputError(NOT_OVERRIDDEN_MESSAGE);

    // Back to `roster` when the account is linked, so the review proposes the ward list's value;
    // an unlinked account's calling was typed in by hand, and `manual` is the honest answer there.
    const source = (await hasActiveLink(input.userId, user.wardId, service)) ? "roster" : "manual";

    const after = await updateCalling(
      { userId: input.userId, wardId: user.wardId, changes: {}, actorUserId: user.id, source },
      service,
    );
    if (!after) throw new InvalidInputError(NO_CALLING_MESSAGE);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "calling_override_cleared",
        module: "admin",
        detail: { ...changeDetail(before, after), afterSource: source },
      },
      service,
    );

    await notifyOtherBishopric({
      wardId: user.wardId,
      actingUserId: user.id,
      title: "Calling override cleared",
      description:
        `${displayName(user)} cleared the override on ${await readAccountName(input.userId, service)}'s ` +
        "calling. The Calling review on Admin → Users now proposes the ward list's value.",
    });

    return NextResponse.json({ calling: after });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/callings/override",
      fallbackMessage: "Could not clear the override. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
