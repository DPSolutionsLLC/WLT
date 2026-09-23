import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ChromeBar } from "@/components/layout/ChromeBar";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { readCallingLabel } from "@/lib/callings/callingLabel";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// The authenticated boundary. Middleware only proves a session exists; this is where the app
// learns who the session belongs to and what they may see.
//
// THERE IS NO SIDEBAR. P3 deleted it: the dashboard IS the navigation, and the chrome bar is how
// you get back to it from anywhere. So this layout no longer computes a navigation list at all —
// app/(app)/dashboard/page.tsx computes its own, because it needs the LOCKED items too and this
// layout has no use for either.
//
// Props are typed explicitly rather than with a generated helper like LayoutProps<"/">, which
// only exists after a build and so breaks `npm run typecheck` on a clean tree
// (plans/retros/foundation-a-scaffold.md).
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireSessionUser();

  // The mirror of the check in app/(youth)/layout.tsx. Together the two make the shells
  // mutually exclusive by construction: a youth account cannot render this layout at all, so
  // no page beneath it can leak through a nav filter that was got wrong.
  //
  // `/ordinances`, not `/sacrament`: P4 gave `/sacrament` to the sacrament MEETING hub, and the
  // youth ordinance screen moved out of its way (app/(youth)/ordinances/page.tsx).
  if (user.role === "sacrament_manager") redirect("/ordinances");

  const supabase = await createServerSupabaseClient();

  // resolveRoleAccess throws on a read failure, deliberately. Do not add a fallback to
  // ROLE_PERMISSIONS: an override can WIDEN access as well as narrow it (ITER-005), so falling
  // back could grant a role something the ward removed or withhold something it granted.
  //
  // Resolved here even though this layout renders no permission-gated control, because it is the
  // one read that proves the ward's configuration is reachable before any page runs. Removing it
  // would move that failure into whichever page happened to read first.
  await resolveRoleAccess(supabase, user.wardId, user.orgType);

  // NAMES THE ORGANIZATION, not just the role. "Relief Society President", never the bare
  // "Organization President" the walk of scenario 066 found too vague to act on. Under the calling
  // model this line is what tells somebody holding callings in two wards WHICH ONE is active, so
  // answering only half the question is worse here than it was before.
  const callingLabel = await readCallingLabel(user, supabase);

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
    <div className="flex min-h-full flex-1 flex-col">
      <ChromeBar
        title={ward?.name ?? "Ward Leadership Tools"}
        user={user}
        callingLabel={callingLabel}
      />

      {/* The authenticated shell is the only place with a client fetch, so the query cache
          lives here and not in the root layout. The (auth) and (youth) shells have none and
          should not acquire one.

          No pb-24. That padding existed to clear the mobile drawer's floating action button,
          and the FAB went with the sidebar — left in place it would be 96px of dead space at
          the bottom of every page, forever. */}
      <main className="flex-1 p-4">
        <QueryProvider>{children}</QueryProvider>
      </main>
    </div>
  );
}
