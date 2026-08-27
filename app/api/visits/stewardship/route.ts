import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { assertCan, BISHOPRIC_ROLES, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { listHouseholds } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  clearStewardship,
  readStewardshipScope,
  replaceStewardship,
} from "@/lib/visits/stewardship";
import { compareStewardshipDrift } from "@/lib/visits/stewardshipScope";
import {
  replaceStewardshipSchema,
  stewardshipQuerySchema,
} from "@/lib/validation/visit";
import type { Role } from "@/types/domain";

// One organization's whole stewardship. GET reads it and its drift; PUT replaces it; DELETE
// stops narrowing.
//
// THE SET, NOT A ROW. The single-household route beside it adjusts an existing narrowing; this
// one is where a narrowing is created and destroyed, which is why the "Choose which households
// are ours" control writes here.
//
// NO AUDIT ROW ON GET. CLAUDE.md rule 6 asks for one on every mutation, and a read is not one.
//
// THIS FILE DOES NOT IMPORT lib/visits/privateNotes.ts, AND MUST NOT — the same sentence
// app/api/visits/route.ts and lib/visits/progress.ts carry, so a reviewer can confirm it from
// the import list alone (CLAUDE.md rule 5).
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

const NO_ORGANIZATION =
  "Your account is not attached to an organization, so there is no stewardship to read. " +
  "Ask a member of the bishopric to set your organization.";

const WHICH_ORGANIZATION = "Say which organization's stewardship to load.";

const WHICH_ORGANIZATION_TO_WRITE = "Choose which organization this stewardship is for.";

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

type OrgResolution =
  | { ok: true; orgId: string }
  | { ok: false; response: NextResponse };

// ---------------------------------------------------------------------------
// THE READ AND THE WRITE RESOLVE THE ORGANIZATION DIFFERENTLY, ON PURPOSE
// ---------------------------------------------------------------------------
// On the READ, a non-bishopric caller's `?orgId=` is IGNORED rather than refused — exactly as
// app/api/visits/progress/route.ts does it, and for the same reason: their own organization is
// the only one they have a stewardship for, and answering "not yours" with somebody else's empty
// set looks like an organization that has claimed nothing.
//
// On the WRITE it is REFUSED with a 403, because a request that could name its own organization
// could replace the Relief Society's stewardship from the Elders Quorum's screen.
function resolveOrgForRead(
  user: { role: Role; orgId: string | null },
  requestedOrgId: string | undefined,
): OrgResolution {
  const orgId = isBishopric(user.role) ? requestedOrgId : user.orgId;

  if (!orgId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: isBishopric(user.role) ? WHICH_ORGANIZATION : NO_ORGANIZATION },
        { status: 400 },
      ),
    };
  }

  return { ok: true, orgId };
}

// The strict version, reused from app/api/households/[id]/visit-cadence/route.ts: the bishopric
// must name an organization and it is checked against the ward's live list; anybody else naming
// another organization is refused rather than silently overwritten.
async function resolveOrgForWrite(
  user: { role: Role; wardId: string; orgId: string | null },
  requestedOrgId: string | undefined,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<OrgResolution> {
  if (isBishopric(user.role)) {
    if (requestedOrgId === undefined) {
      return {
        ok: false,
        response: NextResponse.json({ error: WHICH_ORGANIZATION_TO_WRITE }, { status: 400 }),
      };
    }

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

  if (user.orgId === null) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Your account is not attached to an organization, so it cannot set a stewardship. " +
            "Ask a member of the bishopric to set your organization.",
        },
        { status: 409 },
      ),
    };
  }

  return { ok: true, orgId: user.orgId };
}

// ---------------------------------------------------------------------------
// THE DERIVATION, AND WHY IT IS THIS QUERY AND NOT A NEW ONE
// ---------------------------------------------------------------------------
// listHouseholds() narrows the members it ATTACHES, not the households it RETURNS. So under an
// `organizationId` filter, a household whose `members` array is NON-EMPTY is precisely a
// household where an active member of that organization lives — which is exactly "the families
// with a child in Primary". No new query is needed, and adding a fourth filtering axis to
// listHouseholds() would move the household count underneath somebody applying a category filter
// (plans/retros/roster-b-picker-and-orgs.md, Decision 4).
//
// DERIVATION IS NOT THE STORAGE MODEL. An Elders Quorum's stewardship is a hand-drawn ministering
// district rather than "households containing an elder", so the stored set is authoritative and
// this only ever powers the pre-tick and the drift banner.
async function deriveHouseholdIds(
  wardId: string,
  orgId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<string[]> {
  const households = await listHouseholds(wardId, { organizationId: orgId }, supabase);

  return households
    .filter((household) => household.members.length > 0)
    .map((household) => household.id)
    .sort();
}

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    // `visits.view`, not `visits.manage_goals`. An org secretary may READ what their organization
    // is measured against — the panel renders read-only for them — and may not change it.
    assertCan(user, "visits.view", roleAccess);

    const searchParams = new URL(request.url).searchParams;
    const query = stewardshipQuerySchema.parse({
      orgId: searchParams.get("orgId") ?? undefined,
    });

    const resolved = resolveOrgForRead(user, query.orgId);
    if (!resolved.ok) return resolved.response;

    const [scope, matchingHouseholdIds] = await Promise.all([
      readStewardshipScope(user.wardId, resolved.orgId, supabase),
      deriveHouseholdIds(user.wardId, resolved.orgId, supabase),
    ]);

    return NextResponse.json({
      stewardship: {
        orgId: resolved.orgId,
        narrowed: scope.hasNarrowed,
        // Sorted, so two renders of the same set cannot disagree on order.
        householdIds: [...scope.subjectIds].sort(),
        matchingHouseholdIds,
        // Empty on both sides when nothing has been narrowed: an organization that has made no
        // claim has nothing to have drifted from.
        drift: compareStewardshipDrift(scope, matchingHouseholdIds),
      },
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "GET /api/visits/stewardship",
      fallbackMessage: "Could not load the stewardship. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function PUT(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.manage_goals", roleAccess);

    const input = replaceStewardshipSchema.parse(await readJsonBody(request));

    const resolved = await resolveOrgForWrite(user, input.orgId, supabase);
    if (!resolved.ok) return resolved.response;

    // VALIDATED BEFORE ANYTHING IS WRITTEN, so a bad id fails with a sentence rather than as a
    // composite foreign-key violation surfacing as a 500 that blames the server for the caller's
    // typo. The same reasoning resolveOrgForWrite uses for `org_id`.
    const wardHouseholdIds = new Set(
      (await listHouseholds(user.wardId, undefined, supabase)).map((household) => household.id),
    );

    const unknownId = input.householdIds.find((id) => !wardHouseholdIds.has(id));

    if (unknownId !== undefined) {
      return NextResponse.json(
        { error: "One of those households is not in your ward. Reload and try again." },
        { status: 404 },
      );
    }

    const { added, removed } = await replaceStewardship(
      user.wardId,
      resolved.orgId,
      input.householdIds,
      user.id,
      supabase,
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "stewardship_replaced",
        module: "visits",
        detail: {
          orgId: resolved.orgId,
          count: input.householdIds.length,
          added,
          removed,
        },
      },
      supabase,
    );

    return NextResponse.json({ added, removed, count: input.householdIds.length });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PUT /api/visits/stewardship",
      fallbackMessage: "Could not save that stewardship. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// STOPS NARROWING — the organization goes back to being measured against the whole ward. There
// is no sentinel row meaning "everything", so this is a real DELETE of every row.
export async function DELETE(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "visits.manage_goals", roleAccess);

    const searchParams = new URL(request.url).searchParams;
    const query = stewardshipQuerySchema.parse({
      orgId: searchParams.get("orgId") ?? undefined,
    });

    const resolved = await resolveOrgForWrite(user, query.orgId, supabase);
    if (!resolved.ok) return resolved.response;

    const removed = await clearStewardship(user.wardId, resolved.orgId, supabase);

    // Written only when rows genuinely went. An organization that had narrowed nothing is
    // already measured against the whole ward, so asking for that again changed nothing.
    if (removed > 0) {
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "stewardship_cleared",
          module: "visits",
          detail: { orgId: resolved.orgId, removed },
        },
        supabase,
      );
    }

    return NextResponse.json({ removed });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/visits/stewardship",
      fallbackMessage: "Could not stop narrowing that stewardship. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
