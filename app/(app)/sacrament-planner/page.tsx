import { PlannerFrame } from "@/app/(app)/sacrament-planner/PlannerFrame";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { canUsePlanner } from "@/lib/sacramentPlanner/access";
import { bishopricRoleLabel } from "@/lib/sacramentPlanner/identity";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// The Sacrament tile (ITER-045). The bishopric's Sacrament Planner, unchanged, in a frame under the
// app's chrome bar. Who you are inside it comes from your calling, never from a menu (D6).
export default async function SacramentPlannerPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  if (!canUsePlanner(user, roleAccess)) {
    return <NotPermitted detail="The Sacrament Planner is limited to the bishopric." />;
  }

  return (
    <PlannerFrame
      wardId={user.wardId}
      roleLabel={bishopricRoleLabel(user.role, user.counselorPosition)}
    />
  );
}
