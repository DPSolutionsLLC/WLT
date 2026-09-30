import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ApprovalPanel } from "@/app/(app)/assignments/ApprovalPanel";
import { CommentThread } from "@/app/(app)/assignments/CommentThread";
import { ContactStagePanel } from "@/app/(app)/assignments/ContactStagePanel";
import { sundaySlotEntries } from "@/app/(app)/assignments/SundaySlotList";
import { speakerDisplayName } from "@/components/assignments/SpeakerLine";
import { SundayTypeBadge } from "@/components/calendar/SundayTypeBadge";
import { GoalAlertBanner } from "@/components/goals/GoalAlertBanner";
import type { GoalAlert } from "@/components/goals/GoalAlerts";
import type { ReliabilityFlagKind } from "@/components/roster/ReliabilityFlag";
import { SpeakerCountStepper } from "@/components/sacrament/SpeakerCountStepper";
import { SundayCommentsButton } from "@/components/sacrament/SundayCommentsButton";
import { TalkRow } from "@/components/sacrament/TalkRow";
import { TopicsFinalizedPanel } from "@/components/sacrament/TopicsFinalizedPanel";
import { Card } from "@/components/ui/Card";
import { NotPermitted } from "@/components/ui/NotPermitted";
import {
  listApprovals,
  listComments,
  listSpeakerHistoryByMember,
  type Assignment,
} from "@/lib/assignments/queries";
import { reliabilityFlags } from "@/lib/assignments/reliabilityFlags";
import { BISHOPRIC_ROLES, can, resolveRoleAccess } from "@/lib/auth/permissions";
import { requireSessionUser } from "@/lib/auth/session";
import { formatDateOnly, formatSundayLabel, monthOf, parseDateOnly } from "@/lib/calendar/dates";
import { conductingNameMap, getSunday, listBishopricUsers } from "@/lib/calendar/queries";
import { readDefaultSpeakingSlots } from "@/lib/calendar/wardCalendarSettings";
import {
  GOAL_ALERT_DISMISSAL_COOKIE,
  isMonthDismissed,
} from "@/lib/goals/alertDismissal";
import { listGoalsWithStatus } from "@/lib/goals/queries";
import { listReferencesForAssignments } from "@/lib/references/queries";
import { listMembers } from "@/lib/roster/queries";
import { hasSpeaker, loadSundayAsks } from "@/lib/sacrament/sundayAsks";
import type { TalkAskInput } from "@/lib/sacrament/talkAsks";
import { whoLetsThemKnow } from "@/lib/sacrament/talkRowStatus";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { listLatestAskOwners, listOpenAsks } from "@/lib/todos/askLinks";
import { listTopicHistory } from "@/lib/topics/queries";
import { MEMBER_STATUSES } from "@/types/domain";

// THE TOPICS SCREEN — "What still needs to happen" for one Sunday (Topics rebuild t3, the
// prototype's ModuleView). Both the Topics and the Talks pill on the Sacrament hub land here.
//
// A compact row per talk: the speaker line and the topic line each open their own window and carry
// their own tag. Everything the pipeline needs beyond that — slot length, approvals, contacting,
// comments — is in each talk's Details window (the user's decision, 2026-09-29), and the nine
// stages are unchanged (decision U5). Finalize sits at the BOTTOM, where the decision is made.
//
// EVERY SLOT, not every talk: an open slot is a row with "Nobody yet" / "No topic yet", and its
// first save creates the talk. A talk outside the slots is listed after them, never dropped
// (sundaySlotEntries()).
//
// The row tags read the talks and ask inputs from loadSundayAsks() — the same reader the hub's
// Talks pill uses — so the two cannot disagree.
//
// params is a Promise in Next 16, typed explicitly rather than with the generated PageProps helper
// — that only exists after a build (plans/retros/foundation-a-scaffold.md).
export type SundayAssignmentsPageProps = {
  params: Promise<{ sunday_id: string }>;
};

const OPEN_SLOT_ASK: TalkAskInput = {
  hasSpeaker: false,
  requestOutcome: null,
  openAskCount: 0,
  isOff: false,
};

export default async function SundayAssignmentsPage({ params }: SundayAssignmentsPageProps) {
  const user = await requireSessionUser();
  const supabase = await createServerSupabaseClient();
  const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

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
  // `topics.manage`, which is bishopric-only and is what the finalize route asserts. The PANEL
  // renders for everybody who can open this page; only the CONTROL is gated.
  const canFinalizeTopics = can(user, "topics.manage", roleAccess);
  const canApprove = can(user, "talks.approve", roleAccess);
  const canRequest = can(user, "talks.request", roleAccess);
  const canConfirm = can(user, "talks.confirm", roleAccess);
  const canManageCalendar = can(user, "calendar.manage", roleAccess);
  // What the remove action asserts: it changes the talk AND the Sunday's speaking slots.
  const canRemove = canPlan && canManageCalendar;
  // Speaker history is bishopric-only (migration 019), so it is never read on anybody else's
  // behalf (talks-d) — the same test app/(app)/assignments/page.tsx makes.
  const isBishopric = (BISHOPRIC_ROLES as readonly string[]).includes(user.role);
  // The topic window's "Used before" hint reads the ward's topic history, which is bishopric-only
  // (`topics.view`, the Topic history page's own gate).
  const canReadTopicHistory = can(user, "topics.view", roleAccess);
  const today = formatDateOnly(new Date());

  const [asks, bishopricUsers, members, monthComments, wardDefault, historyByMember, topicHistory] =
    await Promise.all([
      loadSundayAsks(user.wardId, sunday.id, supabase),
      listBishopricUsers(user.wardId, supabase),
      // Every status: a talk can name somebody who has since moved out.
      listMembers(user.wardId, { statuses: MEMBER_STATUSES }, supabase),
      listComments(user.wardId, { sundayId: sunday.id }, supabase),
      readDefaultSpeakingSlots(user.wardId, supabase),
      isBishopric ? listSpeakerHistoryByMember(user.wardId, supabase) : Promise.resolve(null),
      canReadTopicHistory
        ? listTopicHistory(user.wardId, { today }, supabase)
        : Promise.resolve(null),
    ]);

  if (!asks) notFound();
  const assignments = asks.talks;
  const assignmentIds = assignments.map((assignment) => assignment.id);

  const [approvalsByAssignment, assignmentComments, references, openAsks, latestAskOwners] =
    await Promise.all([
      // The approval ROWS, not a count — the Details window names who is still to decide.
      Promise.all(
        assignments.map(
          async (assignment) =>
            [assignment.id, await listApprovals(user.wardId, assignment.id, supabase)] as const,
        ),
      ).then((entries) => new Map(entries)),
      Promise.all(
        assignments.map(
          async (assignment) =>
            [
              assignment.id,
              await listComments(user.wardId, { assignmentId: assignment.id }, supabase),
            ] as const,
        ),
      ).then((entries) => new Map(entries)),
      // The scriptures the planner chose for each talk, for the confirmation message.
      // Bishopric-only (migration 080), so anybody else simply gets none.
      listReferencesForAssignments(user.wardId, assignmentIds, supabase),
      // Who holds each open ask, and who last asked each speaker — the people Delete's confirm
      // names as the one who will let the speaker know (whoLetsThemKnow()). Read the way
      // loadSundayAsks() reads the ask count, so it does not depend on whose list they are on.
      listOpenAsks({ wardId: user.wardId, assignmentIds }),
      listLatestAskOwners({ wardId: user.wardId, assignmentIds }),
    ]);

  const scripturesByAssignment = new Map<string, string[]>();
  for (const reference of references) {
    if (reference.kind !== "scripture") continue;
    const list = scripturesByAssignment.get(reference.assignmentId) ?? [];
    list.push(reference.citation);
    scripturesByAssignment.set(reference.assignmentId, list);
  }

  const speakerFlags: Record<string, readonly ReliabilityFlagKind[]> = {};
  if (historyByMember !== null) {
    const asOf = new Date();
    for (const [memberId, history] of historyByMember) {
      const flags = reliabilityFlags(history, asOf);
      if (flags.length > 0) speakerFlags[memberId] = flags;
    }
  }

  // The speaker window's list, built ONCE for every row. Slim — a name and a category, never a phone
  // or an address — and ACTIVE members only, the roster's own rule for who may be offered in a
  // picker (MemberPicker's resolvePickerFilter). The history rides along only for the bishopric.
  const speakerDirectory = {
    members: members
      .filter((member) => member.status === "active")
      .map((member) => ({
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        category: member.category,
      })),
    historyByMember: historyByMember === null ? null : Object.fromEntries(historyByMember),
    today,
  };

  const memberById = new Map(members.map((member) => [member.id, member]));
  const memberNames = Object.fromEntries(
    members.map((member) => [member.id, `${member.firstName} ${member.lastName}`.trim()]),
  );

  // Bishopric names serve three purposes: the approval sentence, the waiver's "recorded by", and
  // the request's "asked by". One map covers all three.
  const bishopricNames = conductingNameMap(bishopricUsers);
  const bishopric = bishopricUsers.map((member) => ({
    id: member.id,
    name: bishopricNames[member.id],
  }));

  const currentUserName =
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || "You";

  // THE DISMISSAL IS READ HERE, on the server, before anything renders — a cookie travels with the
  // request, so the HTML is right the first time (lib/goals/alertDismissal.ts).
  const monthKey = monthOf(sunday.date);
  const alertsDismissed = isMonthDismissed(
    (await cookies()).get(GOAL_ALERT_DISMISSAL_COOKIE)?.value,
    monthKey,
  );

  // The goal alerts AS OF THIS SUNDAY: by the time this meeting happens, what is outstanding?
  // Gated on `goals.view`, and skipped entirely when there is nothing to show.
  const goalAlerts: GoalAlert[] = can(user, "goals.view", roleAccess) && !alertsDismissed
    ? (await listGoalsWithStatus(user.wardId, {}, parseDateOnly(sunday.date), supabase))
        .flatMap((goal) =>
          goal.status === "overdue" || goal.status === "due_soon"
            ? [{ id: goal.id, title: goal.title, status: goal.status }]
            : [],
        )
        .sort((left, right) =>
          left.status === right.status ? 0 : left.status === "overdue" ? -1 : 1,
        )
    : [];

  function approvedNamesFor(assignment: Assignment): string[] {
    const approved = new Set(
      (approvalsByAssignment.get(assignment.id) ?? [])
        .filter((approval) => approval.approved === true)
        .map((approval) => approval.userId),
    );
    return bishopric.filter((member) => approved.has(member.id)).map((member) => member.name);
  }

  const sundayDate = sunday.date;

  function tellerNameFor(assignment: Assignment, ask: TalkAskInput): string | null {
    const teller = whoLetsThemKnow({
      ask,
      openAskOwnerIds: openAsks
        .filter((openAsk) => openAsk.assignmentId === assignment.id)
        .map((openAsk) => openAsk.ownerUserId),
      latestAskOwnerId: latestAskOwners.get(assignment.id) ?? null,
      currentUserId: user.id,
    });
    if (teller === null) return null;
    if (teller.kind === "you") return "You";
    return bishopricNames[teller.userId] ?? "Whoever holds the ask";
  }

  function detailsFor(assignment: Assignment) {
    const approvedNames = approvedNamesFor(assignment);
    const member =
      assignment.memberId === null ? null : (memberById.get(assignment.memberId) ?? null);
    const comments = assignmentComments.get(assignment.id) ?? [];

    return {
      approvals: (
        <ApprovalPanel
          assignmentId={assignment.id}
          stage={assignment.stage}
          approvals={approvalsByAssignment.get(assignment.id) ?? []}
          bishopric={bishopric}
          currentUserId={user.id}
          canApprove={canApprove}
          // The same rule reviewToApprove() applies, for the first paint. The gate is re-evaluated
          // when the transition is requested, so a stale value cannot approve anything.
          readyToApprove={bishopric.length > 0 && approvedNames.length === bishopric.length}
        />
      ),
      contacting: (
        <ContactStagePanel
          assignment={assignment}
          sundayDate={sundayDate}
          speakerFirstName={
            member?.firstName ??
            speakerDisplayName(assignment, memberNames)?.split(" ")[0] ??
            null
          }
          // Only a ward member has a number on file; the waiver exists for everybody else.
          speakerPhone={member?.phone ?? null}
          topicTitle={assignment.topicTitle}
          suggestedScriptures={scripturesByAssignment.get(assignment.id) ?? []}
          assignmentComments={comments.map((entry) => entry.comment)}
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
      ),
      comments: (
        <CommentThread
          wardId={user.wardId}
          target={{ level: "assignment", assignmentId: assignment.id }}
          initialComments={comments}
          currentUserName={currentUserName}
          canComment={canPlan}
        />
      ),
    };
  }

  const entries = sundaySlotEntries(sunday.speakingSlots, assignments);
  const slotHasSpeaker = Array.from({ length: sunday.speakingSlots }, (_unused, index) =>
    assignments.some(
      (assignment) => assignment.slotNumber === index + 1 && hasSpeaker(assignment),
    ),
  );
  const sundayLabel = formatSundayLabel(sunday.date);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href={`/sacrament?month=${monthKey}`}
          className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
        >
          ← Back to calendar
        </Link>
        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-muted">
          Topics · {sundayLabel}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-xl font-semibold text-foreground">
            What still needs to happen
          </h1>
          <SundayTypeBadge type={sunday.type} />
        </div>
      </div>

      {/* Context for the choices below it rather than a footnote to them. Dismissible for the
          month — see components/goals/GoalAlertBanner.tsx. */}
      <GoalAlertBanner alerts={goalAlerts} monthKey={monthKey} />

      {sunday.speakingSlots === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            This Sunday has no speaking slots, so there are no talks to plan.
          </p>
        </Card>
      ) : (
        <>
          {canManageCalendar ? (
            <SpeakerCountStepper
              sundayId={sunday.id}
              count={sunday.speakingSlots}
              wardDefault={wardDefault}
              slotHasSpeaker={slotHasSpeaker}
              canSetDefault={can(user, "admin.manage_ward", roleAccess)}
            />
          ) : (
            <p className="text-sm text-foreground">
              Speakers this week: {sunday.speakingSlots}
              {sunday.speakingSlots === wardDefault ? " (default)" : ""}
            </p>
          )}

          <Card>
            {entries.map((entry, index) => {
              const assignment = entry.kind === "planned" ? entry.assignment : null;
              const slotNumber =
                entry.kind === "open"
                  ? entry.slotNumber
                  : (entry.assignment.slotNumber ?? index + 1);
              const ask =
                assignment === null
                  ? OPEN_SLOT_ASK
                  : (asks.inputs.get(assignment.id) ?? OPEN_SLOT_ASK);

              return (
                <TalkRow
                  key={assignment?.id ?? `open-${slotNumber}`}
                  sundayId={sunday.id}
                  slotNumber={slotNumber}
                  totalTalks={sunday.speakingSlots}
                  assignment={assignment}
                  speakerName={
                    assignment === null ? null : speakerDisplayName(assignment, memberNames)
                  }
                  ask={ask}
                  tellerName={assignment === null ? null : tellerNameFor(assignment, ask)}
                  approvedNames={assignment === null ? [] : approvedNamesFor(assignment)}
                  speakerFlags={speakerFlags}
                  speakerDirectory={speakerDirectory}
                  topicHistory={topicHistory}
                  canPlan={canPlan}
                  canRemove={canRemove}
                  details={assignment === null ? null : detailsFor(assignment)}
                />
              );
            })}
          </Card>

          <TopicsFinalizedPanel
            sundayId={sunday.id}
            sundayLabel={sundayLabel}
            topicsFinalizedAt={sunday.topicsFinalizedAt}
            canFinalize={canFinalizeTopics}
          />
        </>
      )}

      <SundayCommentsButton count={monthComments.length}>
        <CommentThread
          wardId={user.wardId}
          target={{ level: "month", sundayId: sunday.id }}
          initialComments={monthComments}
          currentUserName={currentUserName}
          canComment={canPlan}
        />
      </SundayCommentsButton>

      <Link
        href={`/program/${sunday.id}`}
        className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
      >
        View the full program for this date →
      </Link>
    </div>
  );
}
