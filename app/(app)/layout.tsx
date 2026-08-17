import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopNav } from "@/components/layout/TopNav";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { visibleNavigationItems } from "@/lib/auth/navigation";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/types/domain";

// The authenticated boundary. Middleware only proves a session exists; this is where the app
// learns who the session belongs to and what they may see.
//
// Props are typed explicitly rather than with a generated helper like LayoutProps<"/">, which
// only exists after a build and so breaks `npm run typecheck` on a clean tree
// (plans/retros/foundation-a-scaffold.md).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();

  // The mirror of the check in app/(youth)/layout.tsx. Together the two make the shells
  // mutually exclusive by construction: a youth account cannot render this layout at all, so
  // no page beneath it can leak through a nav filter that was got wrong.
  if (user.role === "sacrament_manager") redirect("/sacrament");

  const supabase = await createServerSupabaseClient();

  // resolveRoleAccess throws on a read failure, deliberately. Do not add a fallback to
  // ROLE_PERMISSIONS: an override can only ever narrow access, so falling back could grant a
  // role something the ward had removed (plans/retros/foundation-c-services.md).
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);
  const navigationItems = visibleNavigationItems(user, roleAccess);

  const { data: ward, error } = await supabase
    .from("wards")
    .select("name")
    .eq("id", user.wardId)
    .maybeSingle();

  if (error) {
    console.error("Could not read the ward name for the app shell", {
      wardId: user.wardId,
      error: error.message,
    });
  }

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <Sidebar navigationItems={navigationItems} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopNav
          user={user}
          wardName={ward?.name ?? "Ward Leadership Tools"}
          roleLabel={ROLE_LABELS[user.role]}
        />
        {/* The authenticated shell is the only place with a client fetch, so the query cache
            lives here and not in the root layout. The (auth) and (youth) shells have none and
            should not acquire one. */}
        <main className="flex-1 p-4 pb-24 md:pb-4">
          <QueryProvider>{children}</QueryProvider>
        </main>
      </div>
    </div>
  );
}
