import { InviteForm } from "@/app/(app)/admin/users/InviteForm";
import { UserRow } from "@/app/(app)/admin/users/UserRow";
import { YouthAccountForm } from "@/app/(app)/admin/users/YouthAccountForm";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listWardOrganizations, listWardUsers } from "@/lib/auth/adminUsers";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { listYouthAccounts } from "@/lib/auth/youthAccounts";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// The layout above already gated on admin.view. This second check is not redundant: Phase 11's
// Role Access page can widen admin.view without widening admin.manage_users.
export default async function AdminUsersPage() {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "admin.manage_users", roleAccess)) {
    return <NotPermitted detail="Managing accounts is limited to the bishopric." />;
  }

  const [users, organizations, youthAccounts] = await Promise.all([
    listWardUsers(user.wardId, supabase),
    listWardOrganizations(user.wardId, supabase),
    listYouthAccounts(user.wardId, supabase),
  ]);

  // Youth accounts get their own section below, so the adult list does not show rows with no
  // email, no organization, and controls that do not apply to them.
  const adultUsers = users.filter((wardUser) => wardUser.role !== "sacrament_manager");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Users</h1>
        <p className="mt-1 text-sm text-muted">
          {users.length} {users.length === 1 ? "account" : "accounts"} in this ward
          {youthAccounts.length > 0 &&
            `, ${youthAccounts.length} of them youth ${
              youthAccounts.length === 1 ? "account" : "accounts"
            }`}
          .
        </p>
      </div>

      <InviteForm organizations={organizations} />

      {/* One list at every width: stacked cards on a phone, aligned columns from md up. A
          table that scrolls sideways at 375px is not usable. */}
      <section className="flex flex-col gap-3">
        <div className="hidden px-3 text-xs font-medium text-muted md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_auto] md:gap-3">
          <span>Name</span>
          <span>Role</span>
          <span>Organization</span>
          <span>Status</span>
        </div>

        <ul className="flex flex-col gap-3">
          {adultUsers.map((wardUser) => (
            <UserRow
              key={wardUser.id}
              user={wardUser}
              organizations={organizations}
              isSelf={wardUser.id === user.id}
            />
          ))}
        </ul>
      </section>

      <YouthAccountForm accounts={youthAccounts} />
    </div>
  );
}
