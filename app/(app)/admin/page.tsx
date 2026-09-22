import { Building2, ShieldQuestionMark, Users } from "lucide-react";
import { CrossOrgVisibilityToggle } from "@/app/(app)/admin/CrossOrgVisibilityToggle";
import { SubDashboard } from "@/components/layout/SubDashboard";
import type { NavigationItem } from "@/lib/auth/navigation";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/units/queries";
import { readCrossOrgVisibility } from "@/lib/ward/crossOrgVisibility";

// The section index, rendered through SubDashboard — the SAME DashboardGrid and the SAME Tile the
// dashboard uses, not a lookalike (decisions.md §1.7, "one mechanism, not two"). Notification
// management and the audit viewer join this list in P12.
//
// The layout above gates the whole section on admin.view OR a structural super admin. The one
// thing resolved HERE is admin.manage_ward, which is narrower — the settings below are
// bishopric-only to CHANGE while anybody who reaches this page may read them.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
//
// THESE ARE PAGES WITHIN A MODULE, NOT MODULES. lib/auth/navigation.tsx carries one entry per
// MODULE and deliberately not one per page, so this list is not a second copy of it — /admin is
// the row there, and these are what lies under it. The NavigationItem SHAPE is reused so the grid
// has one kind of thing to render.
const ADMIN_PAGES: NavigationItem[] = [
  {
    href: "/admin/users",
    label: "Users",
    permission: "admin.view",
    section: "finance",
    blurb: "Invite new accounts, change roles, and deactivate accounts.",
    icon: <Users />,
    accent: "pine",
    built: true,
  },
  {
    href: "/admin/access-requests",
    label: "Access requests",
    permission: "admin.view",
    section: "finance",
    blurb: "Ask for something a calling in your ward needs, and read the answer.",
    icon: <ShieldQuestionMark />,
    accent: "pine",
    built: true,
  },
];

// ---------------------------------------------------------------------------
// STAKES & WARDS IS LISTED HERE AND NOT IN NAVIGATION_ITEMS, DELIBERATELY
// ---------------------------------------------------------------------------
//
// `lib/auth/navigation.tsx` gates every item on a PERMISSION, and `super_admin` holds all of them
// (SUPER_ADMIN_PERMISSIONS is PERMISSIONS). So there is no permission that would put this on a
// super admin's dashboard without also putting it on every bishop's — and "anyone who belongs to
// one ward never sees the unit layer at all" is a stated requirement of this phase
// (CLAUDE.md §7), not a nicety.
//
// The question this screen turns on is STRUCTURAL — do you hold a `super_admin` row in
// `unit_assignments` — and that is not expressible as a ward permission. So it is surfaced by
// asking that question directly, here, where the answer is already being resolved.
//
// A NEW `units.*` PERMISSION WOULD BE THE WRONG FIX: `wards.settings.role_access` could then
// widen it, which means a ward could grant itself the right to create the stake above itself.
// app/api/session/active-ward/route.ts refuses a `units.*` permission for exactly this reason.
const SUPER_ADMIN_PAGES: NavigationItem[] = [
  {
    href: "/admin/stakes",
    label: "Stakes & wards",
    // Never read — this tile is appended structurally, not filtered by can(). See above.
    permission: "admin.manage_ward",
    section: "finance",
    blurb: "The structure above a ward, and the real unit numbers.",
    icon: <Building2 />,
    accent: "pine",
    built: true,
  },
];

export default async function AdminPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

  const crossOrgVisibility = await readCrossOrgVisibility(user.wardId, supabase);
  const pages = (await isSuperAdmin(supabase))
    ? [...ADMIN_PAGES, ...SUPER_ADMIN_PAGES]
    : ADMIN_PAGES;

  return (
    // No backHref: the chrome bar above already carries "← Dashboard" on every page, and passing
    // one here rendered the same link twice (found walking scenario 070).
    <SubDashboard title="Administration" items={pages}>
      <h2 className="mt-2 text-lg font-semibold text-foreground">Ward settings</h2>

      <CrossOrgVisibilityToggle
        initialEnabled={crossOrgVisibility}
        canManage={can(user, "admin.manage_ward", roleAccess)}
      />
    </SubDashboard>
  );
}
