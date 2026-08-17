import Link from "next/link";
import { notFound } from "next/navigation";
import { HouseholdEditor } from "@/app/(app)/roster/household/[id]/HouseholdEditor";
import { MemberStatusBadge } from "@/components/roster/MemberStatusBadge";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { getHousehold } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type HouseholdDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function HouseholdDetailPage({ params }: HouseholdDetailPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "roster.view", roleAccess)) {
    return <NotPermitted detail="The ward roster is limited to ward leadership." />;
  }

  const { id } = await params;
  const household = await getHousehold(user.wardId, id, supabase);

  // A household in another ward reads as missing rather than forbidden — RLS returns no row,
  // and "not found" is the honest answer to a caller who cannot know it exists.
  if (!household) notFound();

  const canManage = can(user, "roster.manage", roleAccess);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/roster"
          className="text-sm text-primary underline underline-offset-4"
        >
          Back to the roster
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground">
          {household.familyName}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {household.address ?? "No address on file"}
        </p>
      </div>

      <Card>
        <h2 className="text-base font-semibold text-foreground">
          Members ({household.members.length})
        </h2>

        {household.members.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No members are recorded in this household yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {household.members.map((member) => (
              <li
                key={member.id}
                className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0 md:flex-row md:items-center md:justify-between"
              >
                <Link
                  href={`/roster/member/${member.id}`}
                  className="text-sm text-primary underline underline-offset-4"
                >
                  {member.firstName} {member.lastName}
                </Link>
                <MemberStatusBadge status={member.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage && (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-foreground">
            Household details
          </h2>
          <HouseholdEditor household={household} />
        </Card>
      )}
    </div>
  );
}
