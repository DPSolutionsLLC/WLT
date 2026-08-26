import type { ReactNode } from "react";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Its own shell, not a page under app/(app). The counting screen owns the whole viewport: its
// header is sticky at top 0 and its tab bar sticks directly beneath, which cannot be true
// underneath the app sidebar and TopNav. app/(youth)/layout.tsx set the precedent for a single
// module holding its own chrome.
//
// It also serves the module: 09-meetings-tithing.md §Step B3 asks for "no accidental navigation
// away" on a phone held in one hand while the other hand counts cash. There is exactly one way
// out of this screen and it asks first (TithingCounter.tsx).
//
// THE ACCESS CHECK IS HERE, NOT IN middleware.ts. Middleware runs on the edge with no cheap
// database access, so a role check there costs a round trip on every matched request — the
// reason that file carries a comment saying it holds no role checks at all.
//
// can("tithing.view") rather than a hardcoded ["bishop", "counselor"]: the permission already
// resolves to exactly those two roles, AND it reads the ward's role_access overrides. Comparing
// role strings directly is the precise bug plans/retros/role-access-overrides.md was written
// about — 25 checks that ignored the ward's configuration because they went around can().
export default async function TithingLayout({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "tithing.view", roleAccess)) {
    return (
      <main className="p-4">
        <NotPermitted detail="The tithing calculator is available to the bishopric only." />
      </main>
    );
  }

  return <>{children}</>;
}
