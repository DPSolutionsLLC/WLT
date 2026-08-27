import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  addHouseholdStewardship,
  readStewardshipScope,
  removeHouseholdStewardship,
} from "@/lib/visits/stewardship";
import {
  clearHouseholdStewardshipQuerySchema,
  setHouseholdStewardshipSchema,
} from "@/lib/validation/visit";
import type { Role } from "@/types/domain";

// ONE household's membership of ONE organization's stewardship. PUT adds it; DELETE removes it.
//
// ---------------------------------------------------------------------------
// WHY THIS IS NOT PART OF `PATCH /api/households/[id]`
// ---------------------------------------------------------------------------
// The same reasoning as the cadence route beside it (ITER-018 Decision 5, restated by ITER-019
// D4): an org president owns the decision "which families are ours" and holds `roster.view` but
// NOT `roster.manage`. Routing this through the roster's household PATCH would either lock out
// the very people who own the decision, or hand them the entire roster to get at one membership.
//
// So each route keeps exactly ONE permission. This one asserts `visits.manage_goals`, checked
// through assertCan with the resolved role access and never by comparing `user.role` to a string
// — a hardcoded role bypasses the ward's role_access override, which is the bug
// plans/retros/role-access-overrides.md records.
//
// ---------------------------------------------------------------------------
// THIS ROUTE ADJUSTS A NARROWING. IT NEVER CREATES ONE.
// ---------------------------------------------------------------------------
// Absence of rows means the whole ward, so a PUT against an organization that has narrowed
// NOTHING would take its denominator from 200 to 1 in one press. That is refused with a 409
// pointing at the bulk control — see NOT_NARROWED below.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const householdIdSchema = z.uuid("That household id is not valid.");

// A row that vanished between the read and the write, and a row RLS refused, are the same thing
// from here: not yours (plans/retros/foundation-c-services.md).
const WRITE_REFUSED =
  "That household could not be added to your stewardship. Reload and try again.";

const NO_ORGANIZATION =
  "Your account is not attached to an organization, so it cannot claim a household. " +
  "Ask a member of the bishopric to set your organization.";

const NOT_NARROWED =
  "Your organization is measured against the whole ward. Choose which households are yours " +
  "first, then add or remove them one at a time.";

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

type OrgResolution =
  | { ok: true; orgId: string }
  | { ok: false; response: NextResponse };

// REUSED VERBATIM from app/api/households/[id]/visit-cadence/route.ts, which took it verbatim
// from POST /api/visit-goals, because the rule is the same one every time: a bishopric member
// configures ANY organization and therefore has to say which; anybody else naming a different
// organization is REFUSED rather than silently overwritten — silently overwriting it would let a
// leader believe they had just changed the Relief Society's stewardship.
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
          { error: "Choose which organization this stewardship is for." },
          { status: 400 },
        ),
      };
    }

    // Checked against the ward's live organizations, because `household_stewardships.org_id`
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
        { error: "You can only change the stewardship of your own organization." },
        { status: 403 },
      ),
    };
  }

  // An org leader with no organization would write a row that migration 052's policy hides from
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
    const input = setHouseholdStewardshipSchema.parse(await readJsonBody(request));

    const resolved = await resolveOrgId(user, input.orgId, supabase);
    if (!resolved.ok) return resolved.response;

    const scope = await readStewardshipScope(user.wardId, resolved.orgId, supabase);

    // THE SURPRISING JUMP, REFUSED. See the header: adding one household to an organization that
    // has narrowed nothing would silently narrow it to exactly that household.
    if (!scope.hasNarrowed) {
      return NextResponse.json({ error: NOT_NARROWED }, { status: 409 });
    }

    // Already ours is not an error. `addHouseholdStewardship` ignores the duplicate and returns
    // no row, which is indistinguishable from an RLS refusal from the data layer — so the scope
    // is re-read and THAT decides, rather than a guess about which of the two happened.
    const added = await addHouseholdStewardship(
      user.wardId,
      householdId,
      resolved.orgId,
      user.id,
      supabase,
    );

    if (added === null) {
      const after = await readStewardshipScope(user.wardId, resolved.orgId, supabase);

      if (!after.subjectIds.has(householdId)) {
        return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
      }

      // It was already in the stewardship. Nothing moved, so no audit row (CLAUDE.md rule 6 asks
      // for one on every MUTATION, and this was not one).
      return NextResponse.json({ added: false });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "household_stewardship_added",
        module: "visits",
        detail: { householdId, orgId: resolved.orgId },
      },
      supabase,
    );

    return NextResponse.json({ added: true, stewardship: added });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/households/[id]/stewardship",
      fallbackMessage: "Could not add that household to your stewardship. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// Removing the last household would leave zero rows, which means THE WHOLE WARD — so a leader
// removing families one at a time eventually widens their denominator back to everybody. That is
// the model rather than a bug, and it is the same statement "Measure against the whole ward"
// makes deliberately; the panel says so out loud on every load.
//
// `orgId` arrives on the QUERY STRING and is parsed with a schema whose field name is checked
// against the fetch in app/(app)/visits/StewardshipPanel.tsx rather than assumed — a parameter a
// handler does not read is silently IGNORED, not refused
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
    const query = clearHouseholdStewardshipQuerySchema.parse({
      orgId: url.searchParams.get("orgId") ?? undefined,
    });

    const resolved = await resolveOrgId(user, query.orgId, supabase);
    if (!resolved.ok) return resolved.response;

    const removed = await removeHouseholdStewardship(
      user.wardId,
      householdId,
      resolved.orgId,
      supabase,
    );

    // A second DELETE reports nothing to remove rather than failing. Removing something already
    // absent is not an error, and an RLS-refused DELETE is a zero-row success indistinguishable
    // from it (plans/retros/foundation-c-services.md) — so the audit row is written only when a
    // row genuinely went.
    if (removed) {
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "household_stewardship_removed",
          module: "visits",
          detail: { householdId, orgId: resolved.orgId },
        },
        supabase,
      );
    }

    return NextResponse.json({ removed });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/households/[id]/stewardship",
      fallbackMessage:
        "Could not remove that household from your stewardship. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
