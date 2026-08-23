import { GoalBoard } from "@/app/(app)/goals/GoalBoard";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { listGoalsWithStatus } from "@/lib/goals/queries";
import { listHouseholds, listMembers } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listWardOrganizations } from "@/lib/auth/adminUsers";

// The goals board, at /goals — where lib/auth/navigation.ts has linked since auth-a.
//
// `goals.view` and `goals.manage` reach the bishopric AND org leadership, while migration 019 puts
// `goals` in the ward-scoped policy loop, so RLS is wider than the permission matrix. The route is
// the write boundary and this page is the read gate. Recorded rather than tightened here: Phase 11
// owns the role access matrix and inherits this asymmetry along with the `member_organizations`
// one roster-b handed it.

export default async function GoalsPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500
  // whose message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
  if (!can(user, "goals.view", roleAccess)) {
    return <NotPermitted detail="The goals board is limited to ward and organization leadership." />;
  }

  const canManage = can(user, "goals.manage", roleAccess);

  // The DEFAULT filter — every target type. GoalBoard seeds its cache from this and refetches for
  // any other value.
  const goals = await listGoalsWithStatus(user.wardId, {}, new Date(), supabase);

  // The target choices, fetched only for somebody who can create a goal. A read-only viewer gets
  // no roster payload they were not going to use.
  const [members, households, organizations] = canManage
    ? await Promise.all([
        listMembers(user.wardId, {}, supabase),
        listHouseholds(user.wardId, undefined, supabase),
        listWardOrganizations(user.wardId, supabase),
      ])
    : [[], [], []];

  const targetOptions = {
    member: members.map((member) => ({
      id: member.id,
      label: `${member.firstName} ${member.lastName}`.trim(),
    })),
    household: households.map((household) => ({
      id: household.id,
      label: household.familyName,
    })),
    org: organizations.map((organization) => ({
      id: organization.id,
      label: organization.name,
    })),
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Goals</h1>
        <p className="mt-1 text-sm text-muted">
          Overdue goals come first, and the overdue and due-soon ones also greet you when you
          open a Sunday to plan its speakers.
        </p>
      </div>

      <GoalBoard initialGoals={goals} targetOptions={targetOptions} canManage={canManage} />
    </div>
  );
}
