import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { visibleNavigationItems } from "@/lib/auth/navigation";
import { resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/types/domain";

// Deliberately thin, not unfinished. The real per-role dashboards are Phase 11
// (SPEC.md §Role-Based Dashboards, plans/11-notifications-admin.md). This exists so sign-in
// has somewhere to land.
//
// No assertCan() here: every role may see their own dashboard. That is the only page in the
// app for which that is true.
export default async function DashboardPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);
  const navigationItems = visibleNavigationItems(user, roleAccess);

  const greetingName = user.firstName ?? user.username ?? "there";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Hello, {greetingName}</h1>
        <p className="text-sm text-muted">
          You are signed in as {ROLE_LABELS[user.role]}.
        </p>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-foreground">
          What you can reach
        </h2>

        {navigationItems.length === 0 ? (
          <p className="text-sm text-muted">
            Your role has no modules assigned yet. Contact a member of the bishopric.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {navigationItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="text-sm text-primary underline underline-offset-4"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
