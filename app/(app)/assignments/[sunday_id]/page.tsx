import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalPanel } from "@/app/(app)/assignments/ApprovalPanel";
import { AssignmentEditButton } from "@/app/(app)/assignments/AssignmentEditButton";
import { CommentThread } from "@/app/(app)/assignments/CommentThread";
import { ContactStagePanel } from "@/app/(app)/assignments/ContactStagePanel";
import { SpeakerLine, speakerDisplayName } from "@/components/assignments/SpeakerLine";
import { StageBadge } from "@/components/assignments/StageBadge";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import {
  listApprovals,
  listAssignments,
  listComments,
  type Assignment,
} from "@/lib/assignments/queries";
import { listTopicOptions } from "@/lib/topics/queries";
import { can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { formatSundayLabel, monthOf } from "@/lib/calendar/dates";
import { conductingNameMap, getSunday, listBishopricUsers } from "@/lib/calendar/queries";
import { listMembers } from "@/lib/roster/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { MEMBER_STATUSES } from "@/types/domain";

// The SECONDARY surface: one Sunday, every assignment on it, expanded. Approvals, comments, the
// contact stages and the confirmation message all live here because none of them fit in a modal
// — and the modal is where the planning itself happens, so this page never becomes the only way
// to use the pipeline (04-talks-pipeline.md's last pitfall).
//
// params is a Promise in Next 16, typed explicitly rather than with the generated PageProps
// helper — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type SundayAssignmentsPageProps = {
  params: Promise<{ sunday_id: string }>;
};

export default async function SundayAssignmentsPage({ params }: SundayAssignmentsPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId);

  // can() rather than assertCan(), for the reason recorded in plans/retros/auth-b-invites-admin.md.
  if (!can(user, "talks.view", roleAccess)) {
    return <NotPermitted detail="Speaking assignments are limited to ward leadership." />;
  }

  const { sunday_id: sundayId } = await params;
  const sunday = await getSunday(user.wardId, sundayId, supabase);

  // A Sunday in another ward and a Sunday RLS refused are indistinguishable here, and both mean
  // "not yours" (plans/retros/foundation-c-services.md).
  if (!sunday) notFound();

  const canPlan = can(user, "talks.plan", roleAccess);
  const canApprove = can(user, "talks.approve", roleAccess);
  const canRequest = can(user, "talks.request", roleAccess);
  const canConfirm = can(user, "talks.confirm", roleAccess);

  const [assignments, topics, bishopricUsers, members, monthComments] = await Promise.all([
    listAssignments(user.wardId, { sundayId: sunday.id }, supabase),
    listTopicOptions(user.wardId, supabase),
    listBishopricUsers(user.wardId, supabase),
    listMembers(user.wardId, { statuses: MEMBER_STATUSES }, supabase),
    listComments(user.wardId, { sundayId: sunday.id }, supabase),
  ]);

  // The approval ROWS, not a count — this is the page that names who is still to decide, and the
  // month planner deliberately carries only the counts (talks-a).
  const approvalsByAssignment = new Map(
    await Promise.all(
      assignments.map(
        async (assignment) =>
          [
            assignment.id,
            await listApprovals(user.wardId, assignment.id, supabase),
          ] as const,
      ),
    ),
  );

  const assignmentComments = new Map(
    await Promise.all(
      assignments.map(
        async (assignment) =>
          [
            assignment.id,
            await listComments(user.wardId, { assignmentId: assignment.id }, supabase),
          ] as const,
      ),
    ),
  );

  const memberById = new Map(members.map((member) => [member.id, member]));
  const memberNames = Object.fromEntries(
    members.map((member) => [member.id, `${member.firstName} ${member.lastName}`.trim()]),
  );
  const topicTitles = new Map(topics.map((topic) => [topic.id, topic.title]));

  // The topic's suggested scriptures, which talks-b recorded as missing: ContactStagePanel was
  // passing an empty list because the stopgap topic read carried only id and title, so every
  // confirmation message silently dropped its scripture sentence. listTopicOptions now returns
  // them (lib/topics/queries.ts).
  const topicScriptures = new Map(
    topics.map((topic) => [topic.id, topic.suggestedScriptures ?? []]),
  );

  // Bishopric names serve three purposes on this page: the approval sentence, the waiver's
  // "recorded by", and the request's "asked by". One map covers all three.
  const bishopricNames = conductingNameMap(bishopricUsers);
  const bishopric = bishopricUsers.map((member) => ({
    id: member.id,
    name: bishopricNames[member.id],
  }));

  const currentUserName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || "You";

  function approvedNamesFor(assignment: Assignment): string[] {
    const approved = new Set(
      (approvalsByAssignment.get(assignment.id) ?? [])
        .filter((approval) => approval.approved === true)
        .map((approval) => approval.userId),
    );

    return bishopric.filter((member) => approved.has(member.id)).map((member) => member.name);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href={`/assignments?month=${monthOf(sunday.date)}`}
          className="text-sm text-primary underline underline-offset-4"
        >
          Back to the month
        </Link>
        <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h1 className="text-xl font-semibold text-foreground">
            {formatSundayLabel(sunday.date)}
          </h1>
          <SundayTypeBadge type={sunday.type} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {sunday.speakingSlots === 0
            ? "No speaking slots"
            : `${sunday.speakingSlots} speaking ${sunday.speakingSlots === 1 ? "slot" : "slots"}`}
        </p>
      </div>

      {assignments.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Nothing is planned for this Sunday yet. Plan a slot from the month view.
          </p>
        </Card>
      ) : (
        assignments.map((assignment) => {
          const approvals = approvalsByAssignment.get(assignment.id) ?? [];
          const approvedNames = approvedNamesFor(assignment);
          const member =
            assignment.memberId === null ? null : (memberById.get(assignment.memberId) ?? null);

          return (
            <Card key={assignment.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-foreground">
                    Slot {assignment.slotNumber ?? "?"} —{" "}
                    <SpeakerLine
                      speaker={assignment}
                      memberNames={memberNames}
                      emptyLabel="No speaker yet"
                    />
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StageBadge stage={assignment.stage} />
                    <span className="text-sm text-muted">
                      {assignment.topicId === null
                        ? "No topic yet"
                        : (topicTitles.get(assignment.topicId) ?? "A topic that has been archived")}
                    </span>
                  </div>
                </div>

                {canPlan && (
                  <AssignmentEditButton
                    user={user}
                    assignment={assignment}
                    sundayId={sunday.id}
                    sundayLabel={formatSundayLabel(sunday.date)}
                    topics={topics}
                    approvedNames={approvedNames}
                  />
                )}
              </div>

              <div className="mt-4 flex flex-col gap-4">
                <section>
                  <h3 className="text-sm font-semibold text-foreground">Approvals</h3>
                  <div className="mt-2">
                    <ApprovalPanel
                      assignmentId={assignment.id}
                      stage={assignment.stage}
                      approvals={approvals}
                      bishopric={bishopric}
                      currentUserId={user.id}
                      canApprove={canApprove}
                      // The same rule reviewToApprove() applies, computed here for the first
                      // paint. The gate is re-evaluated when the transition is actually
                      // requested, so a stale value cannot approve anything.
                      readyToApprove={
                        bishopric.length > 0 && approvedNames.length === bishopric.length
                      }
                    />
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-foreground">
                    Contacting the speaker
                  </h3>
                  <div className="mt-2">
                    <ContactStagePanel
                      assignment={assignment}
                      sundayDate={sunday.date}
                      speakerFirstName={
                        member?.firstName ??
                        speakerDisplayName(assignment, memberNames)?.split(" ")[0] ??
                        null
                      }
                      // Only a ward member has a number on file. An external speaker has none by
                      // construction, which is what the waiver exists to say out loud.
                      speakerPhone={member?.phone ?? null}
                      topicTitle={
                        assignment.topicId === null
                          ? null
                          : (topicTitles.get(assignment.topicId) ?? null)
                      }
                      suggestedScriptures={
                        assignment.topicId === null
                          ? []
                          : (topicScriptures.get(assignment.topicId) ?? [])
                      }
                      waivedByName={
                        assignment.contactWaivedBy === null
                          ? null
                          : (bishopricNames[assignment.contactWaivedBy] ?? null)
                      }
                      requestedByName={
                        assignment.requestedBy === null
                          ? null
                          : (bishopricNames[assignment.requestedBy] ?? null)
                      }
                      canPlan={canPlan}
                      canRequest={canRequest}
                      canConfirm={canConfirm}
                    />
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-foreground">Comments</h3>
                  <div className="mt-2">
                    <CommentThread
                      wardId={user.wardId}
                      target={{ level: "assignment", assignmentId: assignment.id }}
                      initialComments={assignmentComments.get(assignment.id) ?? []}
                      currentUserName={currentUserName}
                      canComment={canPlan}
                    />
                  </div>
                </section>
              </div>
            </Card>
          );
        })
      )}

      <Card>
        <h2 className="text-base font-semibold text-foreground">
          Comments on this Sunday
        </h2>
        <p className="mt-1 text-sm text-muted">
          About the meeting as a whole, rather than about one speaker.
        </p>
        <div className="mt-3">
          <CommentThread
            wardId={user.wardId}
            target={{ level: "month", sundayId: sunday.id }}
            initialComments={monthComments}
            currentUserName={currentUserName}
            canComment={canPlan}
          />
        </div>
      </Card>
    </div>
  );
}
