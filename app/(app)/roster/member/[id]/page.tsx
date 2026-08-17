import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberEditor } from "@/app/(app)/roster/member/[id]/MemberEditor";
import { MemberNotes } from "@/app/(app)/roster/member/[id]/MemberNotes";
import { MemberStatusBadge } from "@/components/roster/MemberStatusBadge";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { listMemberNotes } from "@/lib/roster/memberNotes";
import { getMember, listHouseholds } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type MemberDetailPageProps = {
  params: Promise<{ id: string }>;
};

const CATEGORY_LABELS: Record<string, string> = {
  adult: "Adult",
  youth: "Youth",
  child: "Child",
};

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
};

export default async function MemberDetailPage({ params }: MemberDetailPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  if (!can(user, "roster.view", roleAccess)) {
    return <NotPermitted detail="The ward roster is limited to ward leadership." />;
  }

  const { id } = await params;
  const member = await getMember(user.wardId, id, supabase);

  if (!member) notFound();

  const canManage = can(user, "roster.manage", roleAccess);
  const canSeeAssignmentHistory = can(user, "talks.view", roleAccess);

  // Fetched inside the branch, never fetched and then hidden. A response that carries notes the
  // page chose not to render is one refactor away from rendering them.
  const notes = canManage ? await listMemberNotes(user.wardId, id, supabase) : [];
  const households = canManage
    ? await listHouseholds(user.wardId, undefined, supabase)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/roster" className="text-sm text-primary underline underline-offset-4">
          Back to the roster
        </Link>
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h1 className="text-xl font-semibold text-foreground">
            {member.firstName} {member.lastName}
          </h1>
          <MemberStatusBadge status={member.status} />
        </div>
      </div>

      <Card>
        <dl className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-32">Household</dt>
            <dd className="text-sm text-foreground">
              {member.household ? (
                <Link
                  href={`/roster/household/${member.household.id}`}
                  className="text-primary underline underline-offset-4"
                >
                  {member.household.familyName}
                </Link>
              ) : (
                "No household"
              )}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-32">Category</dt>
            <dd className="text-sm text-foreground">
              {member.category ? CATEGORY_LABELS[member.category] : "Not set"}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-32">Gender</dt>
            <dd className="text-sm text-foreground">
              {member.gender ? GENDER_LABELS[member.gender] : "Not set"}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-32">Phone</dt>
            <dd className="text-sm text-foreground">
              {member.phone ? (
                <a
                  href={`tel:${member.phone}`}
                  className="text-primary underline underline-offset-4"
                >
                  {member.phone}
                </a>
              ) : (
                "Not set"
              )}
            </dd>
          </div>
        </dl>
      </Card>

      {canManage && (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-foreground">Member details</h2>
          <MemberEditor member={member} households={households} />
        </Card>
      )}

      {canManage && (
        <Card>
          <MemberNotes memberId={member.id} initialNotes={notes} />
        </Card>
      )}

      {/* Bishopric-only from the start, so the tab does not have to be taken away later. An
          explicit "not built yet" beats an empty box that reads as "this member has never
          spoken". Phase 4 fills it (plans/04-talks-pipeline.md). */}
      {canSeeAssignmentHistory && (
        <Card>
          <h2 className="text-base font-semibold text-foreground">Assignment history</h2>
          <p className="mt-2 text-sm text-muted">
            Available once the talk pipeline is built.
          </p>
        </Card>
      )}
    </div>
  );
}
