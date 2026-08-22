import Link from "next/link";
import { notFound } from "next/navigation";
import { OrgConductingEditor } from "@/app/(app)/calendar/sunday/[id]/OrgConductingEditor";
import { SundayEditor } from "@/app/(app)/calendar/sunday/[id]/SundayEditor";
import { PipelineStatusSummary } from "@/components/assignments/PipelineStatusSummary";
import { SpeakerList } from "@/components/assignments/SpeakerList";
import { ConductingLabel } from "@/components/calendar/ConductingLabel";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import { listAssignments, type Assignment } from "@/lib/assignments/queries";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { formatSundayLabel, monthOf } from "@/lib/calendar/dates";
import { manageableOrgIds } from "@/lib/calendar/orgRotationScope";
import {
  conductingNameMap,
  getSunday,
  listBishopricUsers,
  listConductingRotation,
  listOrgLeadershipUsers,
  listRotationOrganizations,
  listSundayOrgConducting,
} from "@/lib/calendar/queries";
import { listMembers } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES, SUNDAY_TYPE_LABELS } from "@/types/domain";

// params is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type SundayDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SundayDetailPage({ params }: SundayDetailPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(), for the reason recorded in plans/retros/auth-b-invites-admin.md.
  if (!can(user, "calendar.view", roleAccess)) {
    return <NotPermitted detail="The ward calendar is limited to ward leadership." />;
  }

  const { id } = await params;
  const sunday = await getSunday(user.wardId, id, supabase);

  // A Sunday in another ward and a Sunday RLS refused are indistinguishable here, and both mean
  // "not yours" (plans/retros/foundation-c-services.md).
  if (!sunday) notFound();

  const canManage = can(user, "calendar.manage", roleAccess);
  const canSeeSpeakers = can(user, "talks.view", roleAccess);

  const bishopricUsers = await listBishopricUsers(user.wardId, supabase);
  const bishopricNames = conductingNameMap(bishopricUsers);

  const [organizations, orgLeadershipUsers, rotation, orgConducting] = await Promise.all([
    listRotationOrganizations(user.wardId, supabase),
    listOrgLeadershipUsers(user.wardId, undefined, supabase),
    listConductingRotation(user.wardId, {}, supabase),
    listSundayOrgConducting(user.wardId, sunday.id, supabase),
  ]);

  const orgLeadershipNames = conductingNameMap(orgLeadershipUsers);

  // Skipped entirely for a viewer without talks.view rather than fetched and hidden. Every
  // status, not only the active ones — an assignment can name somebody who has since moved out,
  // and dropping their name would render the slot as open.
  const [assignments, speakerNames] = canSeeSpeakers
    ? await Promise.all([
        listAssignments(user.wardId, { sundayId: sunday.id }, supabase),
        listMembers(user.wardId, { statuses: MEMBER_STATUSES }, supabase).then((members) =>
          Object.fromEntries(
            members.map((member) => [
              member.id,
              `${member.firstName} ${member.lastName}`.trim(),
            ]),
          ),
        ),
      ])
    : [[] as Assignment[], {} as Record<string, string>];

  // Only organizations that HAVE a rotation. An organization that has never been given one has
  // nothing to show and nothing to override, and a row reading "Not set" for all six would bury
  // the two that matter.
  const organizationsWithRotation = new Set(
    rotation.flatMap((row) => (row.orgId === null ? [] : [row.orgId])),
  );

  const manageableIds = new Set(manageableOrgIds(user, organizations, roleAccess));
  const conductorByOrgId = new Map(
    orgConducting.map((row) => [row.orgId, row.userId]),
  );

  const orgConductingRows = organizations
    .filter((organization) => organizationsWithRotation.has(organization.id))
    .map((organization) => ({
      orgId: organization.id,
      organizationName: organization.name,
      userId: conductorByOrgId.get(organization.id) ?? null,
      canManage: manageableIds.has(organization.id),
      candidates: orgLeadershipUsers
        .filter((leader) => leader.orgId === organization.id)
        .map((leader) => ({ id: leader.id, name: orgLeadershipNames[leader.id] })),
    }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/calendar?month=${monthOf(sunday.date)}`}
          className="text-sm text-primary underline underline-offset-4"
        >
          Back to the calendar
        </Link>
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h1 className="text-xl font-semibold text-foreground">
            {formatSundayLabel(sunday.date)}
          </h1>
          <SundayTypeBadge type={sunday.type} />
        </div>
      </div>

      <Card>
        <dl className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Type</dt>
            <dd className="text-sm text-foreground">{SUNDAY_TYPE_LABELS[sunday.type]}</dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Conducting</dt>
            <dd className="text-sm">
              <ConductingLabel
                conductingUserId={sunday.conductingUserId}
                names={bishopricNames}
              />
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Speaking slots</dt>
            <dd className="text-sm text-foreground">{sunday.speakingSlots}</dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Presiding</dt>
            <dd className="text-sm text-foreground">
              {sunday.presidingOverride ?? "The bishopric member conducting"}
            </dd>
          </div>

          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Fast Sunday pin</dt>
            <dd className="text-sm text-foreground">
              {sunday.fastSundayPinned ? "Pinned" : "Not pinned"}
            </dd>
          </div>

          {/* The full text lives here; the grid clamps it to two lines. */}
          <div className="flex flex-col gap-0.5 md:flex-row md:gap-3">
            <dt className="text-sm text-muted md:w-40">Notes</dt>
            <dd className="text-sm text-foreground">{sunday.notes ?? "None"}</dd>
          </div>
        </dl>
      </Card>

      {canManage && (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-foreground">Edit this Sunday</h2>
          <SundayEditor
            sunday={sunday}
            bishopricUsers={bishopricUsers}
            bishopricNames={bishopricNames}
          />
        </Card>
      )}

      {/* Gated on calendar.view along with the rest of the page, and deliberately NOT on
          talks.view — that gate belongs to the Speakers stub below, and who conducts Relief
          Society is not talk-pipeline data. */}
      {orgConductingRows.length > 0 && (
        <Card>
          <h2 className="mb-3 text-base font-semibold text-foreground">
            Organization meetings
          </h2>
          <OrgConductingEditor
            sundayId={sunday.id}
            rows={orgConductingRows}
            names={orgLeadershipNames}
          />
        </Card>
      )}

      {/* Gated on talks.view from the start, so the section is bishopric-only now rather than
          being narrowed later — exactly what roster-a did with the assignment-history tab.

          A SUMMARY with a link, not a second planner. The planning surface is /assignments and
          the per-Sunday detail is /assignments/[sunday_id]; duplicating either here would give
          the ward two places to edit the same slot and two places to keep in step. */}
      {canSeeSpeakers && (
        <Card>
          <h2 className="text-base font-semibold text-foreground">Speakers</h2>

          <div className="mt-2 flex flex-col gap-2">
            <SpeakerList
              speakingSlots={sunday.speakingSlots}
              assignments={assignments}
              memberNames={speakerNames}
            />
            <PipelineStatusSummary
              stages={assignments.map((assignment) => assignment.stage)}
            />

            {sunday.speakingSlots === 0 && (
              <p className="text-sm text-muted">
                This Sunday has no speaking slots.
              </p>
            )}

            <Link
              href={`/assignments/${sunday.id}`}
              className="text-sm text-primary underline underline-offset-4"
            >
              Plan the speakers for this Sunday
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
