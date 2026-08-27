import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  deleteHouseholdVisitCadence,
  upsertHouseholdVisitCadence,
} from "@/lib/visits/householdCadences";
import {
  clearHouseholdVisitCadenceQuerySchema,
  setHouseholdVisitCadenceSchema,
} from "@/lib/validation/visit";
import type { Role } from "@/types/domain";

// One organization's cadence for one household. PUT sets or replaces it; DELETE clears it back
// to the organization's goal.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT PART OF `PATCH /api/households/[id]`
// ---------------------------------------------------------------------------
// This is ITER-018 Decision 5, and it is the reason for a whole separate route. An org president
// holds `roster.view` but NOT `roster.manage`, so routing a cadence change through the roster's
// household PATCH would either lock out the very people who own the decision, or hand them the
// entire roster to get at one field.
//
// So each route keeps exactly ONE permission: the roster's PATCH asserts `roster.manage`, and
// this one asserts `visits.manage_goals`. A household's cadence is a visit-goal decision that
// happens to be stored next to a household.
//
// Checked through assertCan with the resolved role access, never by comparing `user.role` to a
// string — a hardcoded role bypasses the ward's role_access override, which is exactly the bug
// plans/retros/role-access-overrides.md records.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const householdIdSchema = z.uuid("That household id is not valid.");

// A row that vanished between the read and the write, and a row RLS refused, are the same thing
// from here: not yours (plans/retros/foundation-c-services.md).
const WRITE_REFUSED =
  "That household's cadence could not be saved. Reload and try again.";

const NO_ORGANIZATION =
  "Your account is not attached to an organization, so it cannot set a household's cadence. " +
  "Ask a member of the bishopric to set your organization.";

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

type OrgResolution =
  | { ok: true; orgId: string }
  | { ok: false; response: NextResponse };

// `orgId` follows POST /api/visit-goals VERBATIM, because the rule is the same one: a bishopric
// member configures ANY organization and therefore has to say which; anybody else naming a
// different organization is REFUSED rather than silently overwritten — silently overwriting it
// would let a leader believe they had just changed the Relief Society's cadence for a family.
async function resolveOrgId(
  user: { role: Role; wardId: string; orgId: string | null },
  requestedOrgId: string | undefined,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<OrgResolution> {
  if (isBishopric(user.role)) {
    if (requestedOrgId === undefined) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Choose which organization this cadence is for." },
          { status: 400 },
        ),
      };
    }

    // Checked against the ward's live organizations, because `household_visit_cadences.org_id`
    // carries a composite foreign key that would refuse a foreign id with a constraint violation
    // rather than a sentence anybody can act on.
    const organizations = await listWardOrganizations(user.wardId, supabase);

    if (!organizations.some((organization) => organization.id === requestedOrgId)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "That organization is not in your ward." },
          { status: 404 },
        ),
      };
    }

    return { ok: true, orgId: requestedOrgId };
  }

  if (requestedOrgId !== undefined && requestedOrgId !== user.orgId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You can only set cadences for your own organization." },
        { status: 403 },
      ),
    };
  }

  // An org leader with no organization would write a row that migration 050's policy hides from
  // everyone including its author — `org_id = current_org_id()` is never true when both are
  // null. Refused with a sentence rather than written into a hole
  // (plans/retros/talks-d-reliability-goals.md). `org_id` is NOT NULL on the table for the same
  // reason, so this is belt as well as braces.
  if (user.orgId === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: NO_ORGANIZATION }, { status: 409 }),
    };
  }

  return { ok: true, orgId: user.orgId };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // Not `roster.manage`. See the header: an org president owns this decision and does not own
    // the roster.
    assertCan(user, "visits.manage_goals", roleAccess);

    const { id } = await params;
    const householdId = householdIdSchema.parse(id);
    const input = setHouseholdVisitCadenceSchema.parse(await readJsonBody(request));

    const resolved = await resolveOrgId(user, input.orgId, supabase);
    if (!resolved.ok) return resolved.response;

    const cadence = { amount: input.cadenceAmount, unit: input.cadenceUnit };

    const saved = await upsertHouseholdVisitCadence(
      user.wardId,
      householdId,
      resolved.orgId,
      cadence,
      user.id,
      supabase,
    );

    if (!saved) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "household_visit_cadence_set",
        module: "visits",
        detail: {
          householdId,
          orgId: resolved.orgId,
          cadenceAmount: cadence.amount,
          cadenceUnit: cadence.unit,
        },
      },
      supabase,
    );

    return NextResponse.json({ cadence: saved });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/households/[id]/visit-cadence",
      fallbackMessage: "Could not save that household's cadence. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// Clearing puts the household back on its organization's goal. There is no sentinel row meaning
// "default", so this is a real DELETE.
//
// `orgId` arrives on the QUERY STRING and is parsed with a schema whose field name is checked
// against the fetch in app/(app)/visits/HouseholdCadenceControl.tsx rather than assumed — a
// parameter a handler does not read is silently IGNORED, not refused
// (plans/retros/roster-b-picker-and-orgs.md).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.manage_goals", roleAccess);

    const { id } = await params;
    const householdId = householdIdSchema.parse(id);

    const url = new URL(request.url);
    const query = clearHouseholdVisitCadenceQuerySchema.parse({
      orgId: url.searchParams.get("orgId") ?? undefined,
    });

    const resolved = await resolveOrgId(user, query.orgId, supabase);
    if (!resolved.ok) return resolved.response;

    const cleared = await deleteHouseholdVisitCadence(
      user.wardId,
      householdId,
      resolved.orgId,
      supabase,
    );

    // A second DELETE reports nothing to clear rather than failing. Clearing something already
    // clear is not an error, and an RLS-refused DELETE is a zero-row success indistinguishable
    // from it (plans/retros/foundation-c-services.md) — so the audit row is written only when a
    // row genuinely went.
    if (cleared) {
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "household_visit_cadence_cleared",
          module: "visits",
          detail: { householdId, orgId: resolved.orgId },
        },
        supabase,
      );
    }

    return NextResponse.json({ cleared });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/households/[id]/visit-cadence",
      fallbackMessage: "Could not clear that household's cadence. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
