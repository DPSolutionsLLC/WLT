import { BISHOPRIC_ROLES, can, type RoleAccess } from "@/lib/auth/permissions";
import type { SessionUser } from "@/types/domain";

// canUsePlanner()'s shape (lib/sacramentPlanner/access.ts). `zoom.manage_remote_links` alone
// admits a super admin, who holds every permission through can()'s bypass; the bishopric-calling
// check is what keeps the stream's remote links with the bishop and counselors of THIS ward.
// The PUT/DELETE routes call this, and because `zoom_remote_links` has no write policy (migration
// 094), this is the write boundary.
export function canManageRemoteLinks(user: SessionUser, roleAccess: RoleAccess): boolean {
  return (
    can(user, "zoom.manage_remote_links", roleAccess) &&
    (BISHOPRIC_ROLES as readonly string[]).includes(user.role)
  );
}

// The same shape for the join-link pool and the invitee list (ITER-053). Neither table has a write
// policy (migration 095), so the routes behind this are the write boundary — and the only readers
// of a `join_url`, which no authenticated client can select at all.
export function canManageInvitees(user: SessionUser, roleAccess: RoleAccess): boolean {
  return (
    can(user, "zoom.manage_invitees", roleAccess) &&
    (BISHOPRIC_ROLES as readonly string[]).includes(user.role)
  );
}
