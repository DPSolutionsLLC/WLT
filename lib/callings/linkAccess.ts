import { BISHOPRIC_ROLES, can, type RoleAccess } from "@/lib/auth/permissions";
import type { Role, SessionUser } from "@/types/domain";

// WHO MAY LINK, DECLINE OR END ANOTHER ACCOUNT'S ROSTER LINK (ITER-058 cr1): `admin.manage_users`
// — non-overridable, held by the bishop and both counselors — AND a bishopric calling, or the super
// admin. canManageInvitees()'s shape (lib/zoom/access.ts). Both halves, because a link decides
// privileges from cr2 on and `user_member_links` has no write policy: this check is the boundary.
export function canManageMemberLinks(user: SessionUser, roleAccess: RoleAccess): boolean {
  if (!can(user, "admin.manage_users", roleAccess)) return false;
  return user.isSuperAdmin || (BISHOPRIC_ROLES as readonly string[]).includes(user.role);
}

// WHO IS OFFERED "IS THIS YOU?". A calling that is not an LCR calling here has no roster record to
// link: the youth PIN account, a calling whose role is `super_admin`, and the stake roles (P7).
const NO_ROSTER_LINK_ROLES: ReadonlySet<Role> = new Set<Role>([
  "sacrament_manager",
  "super_admin",
  "stake_president",
  "stake_counselor",
  "stake_secretary",
]);

export function roleNeedsRosterLink(role: Role): boolean {
  return !NO_ROSTER_LINK_ROLES.has(role);
}

export function needsRosterLink(user: SessionUser): boolean {
  return roleNeedsRosterLink(user.role);
}
