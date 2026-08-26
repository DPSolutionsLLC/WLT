import Link from "next/link";
import { CrossOrgVisibilityToggle } from "@/app/(app)/admin/CrossOrgVisibilityToggle";
import { Card } from "@/components/ui/Card";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
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
];

export default async function AdminPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  const crossOrgVisibility = await readCrossOrgVisibility(user.wardId, supabase);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-foreground">Administration</h1>

      <ul className="flex flex-col gap-3">
        {ADMIN_PAGES.map((page) => (
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
