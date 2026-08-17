import type { Role, SessionUser } from "@/types/domain";

// Split out of lib/roster/organizations.ts, which roster-b named as this function's home. That
// module imports createServerSupabaseClient, which imports next/headers, so anything importing
// it becomes server-only — and MemberPicker is a client component that needs this rule. This
// file therefore imports types and nothing else, and organizations.ts re-exports it so a server
// caller still finds it where the plan says it lives.

// Roles whose default view of the roster is their own organization. The rest — the bishopric,
// both secretaries, the music coordinator, the ward council member, and the youth
// sacrament_manager — see the whole ward by default.
const ORGANIZATION_SCOPED_ROLES: readonly Role[] = [
  "org_president",
  "org_counselor",
  "org_secretary",
];

// A CONVENIENCE, NEVER A BOUNDARY. `members` and `member_organizations` are ward-scoped in
// migration 019, so an org president who clears this filter genuinely does see the whole ward
// roster — and that is intended (FEATURES.md gives every ward leader roster visibility). Do not
// describe this function as security anywhere, and do not build a boundary on top of it.
//
// Returns undefined rather than throwing for a role with no organization: an org leader whose
// org_id was never set gets the whole ward, which is a worse default than their own
// organization but not a broken page.
export function defaultOrganizationFilter(user: SessionUser): string | undefined {
  if (!ORGANIZATION_SCOPED_ROLES.includes(user.role)) return undefined;
  return user.orgId ?? undefined;
}
