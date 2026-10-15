import { Building2 } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { QuickLinksButton } from "@/components/layout/QuickLinksButton";
import { WardSwitcher } from "@/components/layout/WardSwitcher";
import { moduleForPath, unreleasedBuiltModules } from "@/lib/access/releasedModules";
import { visibleNavigationItems, type NavigationItem } from "@/lib/auth/navigation";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { readCallingLabel } from "@/lib/callings/callingLabel";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/units/queries";
import { readQuickLinks } from "@/lib/users/userSettings";

// HOME. The dashboard is the navigation — there is no sidebar, and the chrome bar on every other
// page comes back here. Every module a person can reach is one click from this grid.
//
// No assertCan() here: every role may see their own dashboard. That is the only page in the app
// for which that is true.
//
// ONE LIST, COMPUTED HERE, ON THE SERVER, because only the server holds the RoleAccess. It is
// built AND permitted, and there is no second list: a module somebody cannot open is ABSENT, not
// shown locked. That was a user decision on 2026-09-22 and DashboardGrid's header carries the
// reasoning — a dashboard is a place to start work from, not an inventory of the app.

// ---------------------------------------------------------------------------
// THE SUPER-ADMIN TILE IS APPENDED STRUCTURALLY, NOT BY PERMISSION
// ---------------------------------------------------------------------------
// lib/auth/navigation.tsx gates every item on a PERMISSION, and `super_admin` holds all of them
// (SUPER_ADMIN_PERMISSIONS is PERMISSIONS). So there is no permission that would put Stakes &
// Wards on a super admin's dashboard without also putting it on every bishop's — and "anyone who
// belongs to one ward never sees the unit layer at all" is a stated requirement (CLAUDE.md §7).
//
// A NEW `units.*` PERMISSION WOULD BE THE WRONG FIX: `wards.settings.role_access` could widen it,
// which means a ward could grant itself the right to create the stake above itself.
// app/(app)/admin/page.tsx and app/api/session/active-ward/route.ts both refuse one for this
// reason, and this is the third place the same question is answered the same way.
const STAKES_AND_WARDS_TILE: NavigationItem = {
  label: "Stakes & wards",
  href: "/admin/stakes",
  // Never read — this tile is not filtered by can(). It names the widest permission there is so
  // that nothing which later iterates the list can mistake it for something a ward may grant.
  permission: "admin.manage_ward",
  section: "finance",
  blurb: "The structure above a ward, and the real unit numbers.",
  icon: <Building2 />,
  accent: "pine",
  built: true,
};

export default async function DashboardPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();

  // resolveRoleAccess throws on a read failure, deliberately. Do not add a fallback to
  // ROLE_PERMISSIONS: an override can WIDEN access as well as narrow it (ITER-005), so falling
  // back could grant a role something the ward removed or withhold something it granted.
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  const items = visibleNavigationItems(user, roleAccess);

  if (await isSuperAdmin(supabase)) items.push(STAKES_AND_WARDS_TILE);

  // The same label the chrome bar shows, from the same helper — two sentences about one calling
  // must never disagree about what it is called.
  const callingLabel = await readCallingLabel(user, supabase);

  // Falls back to an empty list rather than throwing: a settings read that failed must not take
  // the dashboard down. Nothing is marked, every tile is still there.
  const pinnedHrefs = await readQuickLinks(user.id, supabase);

  const greetingName = user.firstName ?? user.username ?? "there";

  // RELEASED MODULES (ITER-041). An ordinary person never sees an unreleased tile — can() already
  // filtered it out — so they get one quiet line instead, and only when the ward has a list that
  // withholds something that exists. The super admin sees every tile; an unreleased one carries a
  // badge, and still opens.
  const tileNotes: Record<string, string> = {};
  const releasedModules = user.releasedModules;
  if (user.isSuperAdmin && releasedModules !== null) {
    for (const item of items) {
      const owningModule = moduleForPath(item.href);
      if (owningModule !== null && !releasedModules.includes(owningModule)) {
        tileNotes[item.href] = "Hidden from this ward";
      }
    }
  }

  const showComingSoon =
    !user.isSuperAdmin && unreleasedBuiltModules(user.releasedModules).length > 0;
  const wardName = showComingSoon ? await readWardName(user.wardId, supabase) : null;

  return (
    <div className="flex flex-col gap-4">
      <DashboardHeader
        title={`Hello, ${greetingName}`}
        callingLabel={callingLabel}
        items={items}
        pinnedHrefs={pinnedHrefs}
        tileNotes={tileNotes}
        // Renders nothing at all for the great majority of people, who hold one calling.
        wardSwitcher={<WardSwitcher />}
        quickLinks={<QuickLinksButton items={items} pinnedHrefs={pinnedHrefs} />}
      />
      {showComingSoon && (
        <p className="text-sm text-muted">
          More tools are on the way for {wardName ?? "your ward"}.
        </p>
      )}
    </div>
  );
}

// The same read the (app) layout makes for the chrome bar. A failure falls back to "your ward"
// rather than taking the dashboard down — it is one sentence of courtesy text.
async function readWardName(
  wardId: string,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("wards")
    .select("name")
    .eq("id", wardId)
    .maybeSingle();

  if (error) {
    console.error("Could not read the ward name for the dashboard", {
      wardId,
      error: error.message,
    });
    return null;
  }

  return data?.name ?? null;
}
