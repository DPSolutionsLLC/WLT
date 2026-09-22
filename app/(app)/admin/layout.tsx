import type { ReactNode } from "react";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/units/queries";

// One guard for the whole /admin section — this page and every page Phase 11 adds under it.
//
// TWO QUESTIONS, NOT ONE, and the second was missing until scenario 067 was walked.
// `admin.view` comes from the WARD CALLING. A super admin's authority does not: it is a
// `unit_assignments` row, which has no ward at all (migration 065b). So a super admin whose ward
// calling happens to be an ordinary one — which is every super admin who is not also their ward's
// bishop — was refused the whole admin section, including the two screens built for them.
//
// It was incoherent as well as wrong: `PATCH /api/access-requests/[id]` gates on `isSuperAdmin`,
// so they could DECIDE a request this layout would not let them SEE.
//
// `countActiveSuperAdmins()` already treats the `unit_assignments` row as the source of truth for
// whether an administrator still exists. Access now asks the same question that guard does.
//
// can() rather than assertCan(): the refusal is rendered, not thrown. See NotPermitted.tsx.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  if (!can(user, "admin.view", roleAccess) && !(await isSuperAdmin(supabase))) {
    return <NotPermitted />;
  }

  return <>{children}</>;
}
