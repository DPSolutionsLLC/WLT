import Link from "next/link";
import { notFound } from "next/navigation";
import { MemberEditor } from "@/app/(app)/roster/member/[id]/MemberEditor";
import { MemberNotes } from "@/app/(app)/roster/member/[id]/MemberNotes";
import { MemberOrganizations } from "@/app/(app)/roster/member/[id]/MemberOrganizations";
import { SpeakerHistoryTab } from "@/app/(app)/roster/member/[id]/SpeakerHistoryTab";
import { MemberStatusBadge } from "@/components/roster/MemberStatusBadge";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listSpeakerHistory } from "@/lib/assignments/queries";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { listMemberNotes } from "@/lib/roster/memberNotes";
import { listMemberOrganizations } from "@/lib/roster/organizations";
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

  // TWO conditions, not one. talks.view is the module gate and a ward_secretary holds it; the
  // bishopric check is the leak defence, and it matches the RLS policy behind `assignment_history`
  // exactly (migration 019). A viewer who fails either sees NO SECTION AT ALL — not a disabled
  // one, which advertises that the data exists and who to ask for it.
  const canSeeAssignmentHistory =
    can(user, "talks.view", roleAccess) &&
    (BISHOPRIC_ROLES as readonly string[]).includes(user.role);

  // Fetched inside the branch, never fetched and then hidden. A response that carries notes the
  // page chose not to render is one refactor away from rendering them.
  const notes = canManage ? await listMemberNotes(user.wardId, id, supabase) : [];
  const households = canManage
    ? await listHouseholds(user.wardId, undefined, supabase)
    : [];

  // Fetched inside the branch for the same reason the notes are. Speaker history is read by its
  // OWN call and is never a field on the member type — a field on a shared type is one refactor
  // away from a response a non-bishopric caller receives (04-talks-pipeline.md §Pitfalls).
  const speakerHistory = canSeeAssignmentHistory
    ? await listSpeakerHistory(user.wardId, id, supabase)
    : [];

  // Memberships are read for everyone who can view the roster — which organizations someone
  // belongs to is not sensitive. The list of organizations to CHOOSE from is only needed by a
  // caller who can edit, so it is fetched inside the branch.
  const memberships = await listMemberOrganizations(user.wardId, id, supabase);
  const organizations = canManage
    ? await listWardOrganizations(user.wardId, supabase)
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

      <Card>
        <MemberOrganizations
          memberId={member.id}
          organizations={organizations}
          initialMemberships={memberships}
          canManage={canManage}
        />
      </Card>

      {canManage && (
        <Card>
          <MemberNotes memberId={member.id} initialNotes={notes} />
        </Card>
      )}

      {/* Bishopric-only from the start, so the section never had to be taken away later. The
          "available once the talk pipeline is built" placeholder roster-a left here is what
          talks-d replaces (plans/04-talks-pipeline.md §Step 8). */}
      {canSeeAssignmentHistory && (
        <Card>
          <SpeakerHistoryTab history={speakerHistory} asOf={new Date()} />
        </Card>
      )}
    </div>
  );
}
