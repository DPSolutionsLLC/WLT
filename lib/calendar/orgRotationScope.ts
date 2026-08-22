import { BISHOPRIC_ROLES, can, type RoleAccess } from "@/lib/auth/permissions";
import {
  ROTATION_ELIGIBLE_ORG_TYPES,
  type OrganizationType,
  type Role,
  type SessionUser,
} from "@/types/domain";

// Widened to readonly Role[] so includes() accepts any role rather than only the two literals.
// One source of truth for who the bishopric is — CLAUDE.md §7 forbids a second list that could
// drift.
const BISHOPRIC: readonly Role[] = BISHOPRIC_ROLES;

// Split out of lib/calendar/queries.ts, which is where this rule would otherwise live. Every
// module in lib/calendar/ imports createServerSupabaseClient, which imports next/headers, so
// anything importing one becomes server-only — and OrgRotationPanel is a client component that
// needs this rule. `typecheck` and `lint` both pass a boundary violation; only `npm run build`
// catches it (plans/retros/roster-b-picker-and-orgs.md). This file therefore imports types and
// the pure permission helper, and nothing else.
//
// lib/roster/organizationScope.ts is the precedent for the split — but NOT for what the function
// means. That one is explicitly a convenience filter and warns against building a boundary on
// it. This one IS a boundary: it decides whether a write is allowed, not what a list defaults to.
//
// It is the SECOND of two boundaries, never the only one. RLS is the first — migration 024's
// policies refuse an org-scoped write from the database side however the route was called, and
// tests/rls/org-conducting.test.ts is what proves it. This function exists so the route can
// return an honest 403 and the UI can render the right panels, not because the policy needs help.
export function manageableOrgIds(
  user: SessionUser,
  organizations: { id: string; type: OrganizationType }[],
  roleAccess: RoleAccess,
): string[] {
  if (!can(user, "calendar.manage_org_conducting", roleAccess)) return [];

  const eligible = organizations.filter((organization) =>
    ROTATION_ELIGIBLE_ORG_TYPES.includes(organization.type),
  );

  // The bishopric manages every organization's rotation, which is what makes the feature usable
  // in a ward whose presidencies have not been given accounts yet.
  if (BISHOPRIC.includes(user.role)) {
    return eligible.map((organization) => organization.id);
  }

  // An org leader whose org_id was never set gets nothing rather than everything. The roster's
  // equivalent falls back to the whole ward because a wide LIST is a worse default but not a
  // broken page; a wide WRITE is a hole.
  if (user.orgId === null) return [];

  return eligible.some((organization) => organization.id === user.orgId)
    ? [user.orgId]
    : [];
}
