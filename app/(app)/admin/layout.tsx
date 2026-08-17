import type { ReactNode } from "react";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// One guard for the whole /admin section — this page and every page Phase 11 adds under it.
//
// can() rather than assertCan(): the refusal is rendered, not thrown. See NotPermitted.tsx.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "admin.view", roleAccess)) {
    return <NotPermitted />;
  }

  return <>{children}</>;
}
