import Link from "next/link";
import { CrossOrgVisibilityToggle } from "@/app/(app)/admin/CrossOrgVisibilityToggle";
import { Card } from "@/components/ui/Card";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/units/queries";
import { readCrossOrgVisibility } from "@/lib/ward/crossOrgVisibility";

// The section index. It exists so the Admin item in NAVIGATION_ITEMS resolves to a real page
// rather than a 404. Role access, notification management, and the audit viewer join this list in
// Phase 11 (plans/11-notifications-admin.md).
//
// The layout above gates the whole section on admin.view. The one thing resolved HERE is
// admin.manage_ward, which is narrower — the settings below are bishopric-only to CHANGE while
// anybody who reaches this page may read them.
//
// can() rather than assertCan(): a ForbiddenError escaping a Server Component becomes a 500 whose
// message Next.js strips in production (plans/retros/auth-b-invites-admin.md).
const ADMIN_PAGES = [
  {
    href: "/admin/users",
    label: "Users",
    description: "Invite new accounts, change roles, and deactivate accounts.",
  },
  {
    href: "/admin/access-requests",
    label: "Access requests",
    description:
      "Ask for something a calling in your ward needs, and read the answer.",
  },
];

// ---------------------------------------------------------------------------
// STAKES & WARDS IS LISTED HERE AND NOT IN NAVIGATION_ITEMS, DELIBERATELY
// ---------------------------------------------------------------------------
//
// `lib/auth/navigation.ts` gates every item on a PERMISSION, and `super_admin` holds all of them
// (SUPER_ADMIN_PERMISSIONS is PERMISSIONS). So there is no permission that would put this in the
// sidebar for a super admin without also putting it there for every bishop — and "anyone who
// belongs to one ward never sees the unit layer at all" is a stated requirement of this phase
// (CLAUDE.md §7), not a nicety.
//
// The question this screen turns on is STRUCTURAL — do you hold a `super_admin` row in
// `unit_assignments` — and that is not expressible as a ward permission. So it is surfaced by
// asking that question directly, here, where the answer is already being resolved.
//
// A NEW `units.*` PERMISSION WOULD BE THE WRONG FIX: `wards.settings.role_access` could then
// widen it, which means a ward could grant itself the right to create the stake above itself.
// app/api/session/active-ward/route.ts refuses a `units.*` permission for exactly this reason.
const SUPER_ADMIN_PAGES = [
  {
    href: "/admin/stakes",
    label: "Stakes & wards",
    description: "The structure above a ward, and the real unit numbers.",
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
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-foreground">Administration</h1>

      <ul className="flex flex-col gap-3">
        {pages.map((page) => (
          <li key={page.href}>
            <Card>
              <Link
                href={page.href}
                className="text-sm font-medium text-primary underline underline-offset-4"
              >
                {page.label}
              </Link>
              <p className="mt-1 text-sm text-muted">{page.description}</p>
            </Card>
          </li>
        ))}
      </ul>

      <h2 className="mt-2 text-lg font-semibold text-foreground">Ward settings</h2>

      <CrossOrgVisibilityToggle
        initialEnabled={crossOrgVisibility}
        canManage={can(user, "admin.manage_ward", roleAccess)}
      />
    </div>
  );
}
