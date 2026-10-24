import { ForbiddenError } from "@/lib/auth/errors";
import { BISHOPRIC_ROLES, can, type RoleAccess } from "@/lib/auth/permissions";
import type { SessionUser } from "@/types/domain";

// MIRRORS MIGRATION 093 EXACTLY: `planner.use` AND a bishopric calling in the ward being acted in,
// which is what `ward_id = current_ward_id() and is_bishopric()` answers in RLS. Both halves are
// needed. `planner.use` alone admits a super admin, who holds every permission, while the policy
// refuses anybody whose calling here is not bishopric — so the tile would open onto a page that
// then reads nothing. A mirror of a policy copies all of it (CLAUDE.md §9, 060-D2).
//
// ITER-046 replaces this with title-based access. This function and migration 093 are the two
// places that change lands.
export function canUsePlanner(user: SessionUser, roleAccess: RoleAccess): boolean {
  return (
    can(user, "planner.use", roleAccess) &&
    (BISHOPRIC_ROLES as readonly string[]).includes(user.role)
  );
}

export function assertPlannerAccess(user: SessionUser, roleAccess: RoleAccess): void {
  if (!canUsePlanner(user, roleAccess)) {
    throw new ForbiddenError("planner.use");
  }
}
