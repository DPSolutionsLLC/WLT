import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { canTransition, type PipelineAssignment } from "@/lib/assignments/pipeline";
import {
  clearApprovals,
  clearSpeaker,
  getAssignment,
  listApprovals,
  transitionAssignment,
  updateAssignmentFields,
  waiveContactStages,
  writeAssignmentHistory,
  type Assignment,
} from "@/lib/assignments/queries";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  BISHOPRIC_ROLES,
  assertCan,
  resolveRoleAccess,
  type KnownPermission,
} from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday, listBishopricUsers } from "@/lib/calendar/queries";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { stampTopicAssigned } from "@/lib/topics/queries";
import { updateAssignmentSchema } from "@/lib/validation/assignment";
import type { Database } from "@/types/database";
import {
  PIPELINE_STAGE_LABELS,
  type PipelineStage,
  type Role,
  type SessionUser,
} from "@/types/domain";

// The one route in this slice with non-obvious side effects, so every one of them is named here
// rather than left to be discovered.
//
// `params` is a Promise in Next 16, and the props are typed explicitly rather than with the
// generated RouteContext helper, which only exists after a build
// (plans/retros/foundation-a-scaffold.md).

const assignmentIdSchema = z.uuid("That assignment id is not valid.");

const NOT_FOUND = "That assignment is not in your ward.";

// A row that vanished between the read and the write. Both mean "not yours"
// (plans/retros/foundation-c-services.md).
const WRITE_REFUSED = "That assignment could not be saved. Reload and try again.";

function isBishopric(role: Role): boolean {
  return (BISHOPRIC_ROLES as readonly string[]).includes(role);
}

// The permission depends on the stage being ENTERED, because that is what the five talks
// permissions describe: approving a plan, making the request, confirming the message. Everything
// else — submitting for review, marking the meeting done, sending the thank-you, and every
// backward move — is planning work.
function permissionForTransition(
  from: PipelineStage,
  to: PipelineStage,
): KnownPermission {
  if (from === "review" && to === "approve") return "talks.approve";
  if (from === "approve" && to === "request") return "talks.request";
  if (from === "confirm" && to === "notify") return "talks.confirm";
  return "talks.plan";
}

function toPipelineAssignment(assignment: Assignment): PipelineAssignment {
  return {
    stage: assignment.stage,
    memberId: assignment.memberId,
    externalSpeakerName: assignment.externalSpeakerName,
    topicId: assignment.topicId,
    slotNumber: assignment.slotNumber,
    requestOutcome: assignment.requestOutcome,
    notifyMessage: assignment.notifyMessage,
    notifySentAt: assignment.notifySentAt,
    sundayConfirmedAt: assignment.sundayConfirmedAt,
    thankYouSentAt: assignment.thankYouSentAt,
    contactWaivedAt: assignment.contactWaivedAt,
  };
}

// The date reads better than an id in a notification body, and a Sunday that has been deleted
// under the assignment must not take the notification down with it.
async function describeSunday(
  user: SessionUser,
  assignment: Assignment,
  client: SupabaseClient<Database>,
): Promise<string> {
  if (assignment.sundayId === null) return "an unscheduled Sunday";

  try {
    const sunday = await getSunday(user.wardId, assignment.sundayId, client);
    return sunday ? sunday.date : "an unscheduled Sunday";
  } catch (error) {
    console.error("Could not read a Sunday for a notification body", {
      wardId: user.wardId,
      sundayId: assignment.sundayId,
      error,
    });
    return "an unscheduled Sunday";
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { id } = await params;
    const assignmentId = assignmentIdSchema.parse(id);
    const input = updateAssignmentSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    const existing = await getAssignment(user.wardId, assignmentId, supabase);
    if (!existing) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    if (input.action === "update") {
      assertCan(user, "talks.plan", roleAccess);

      const assignment = await updateAssignmentFields(
        user.wardId,
        assignmentId,
        input.fields,
        supabase,
      );

      if (!assignment) {
        return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
      }

      // An approval is a decision about the plan AS IT STOOD. Editing it invalidates every
      // approval on it — without this a counselor can approve a plan and have it changed
      // underneath them, and nothing anywhere would say so (04-talks-pipeline.md §Step 3).
      const invalidated = await clearApprovals(
        user.wardId,
        assignmentId,
        undefined,
        supabase,
      );

      // Only the FIELD NAMES, never their values. request_notes and the two message columns can
      // carry a member's circumstances, and an audit row is bishopric-readable (CLAUDE.md rule 8).
      const changedFields = Object.keys(input.fields);

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "assignment_updated",
          module: "talks",
          detail: {
            assignmentId,
            stage: assignment.stage,
            changedFields,
            approvalsInvalidated: invalidated > 0,
            approvalsCleared: invalidated,
          },
        },
        supabase,
      );

      if (invalidated > 0) {
        const date = await describeSunday(user, assignment, supabase);

        await emitNotification({
          wardId: user.wardId,
          triggerKey: "plan_change_requested",
          title: "An approved assignment changed",
          body: `The assignment in slot ${assignment.slotNumber ?? "?"} on ${date} was edited, so its ${invalidated} ${invalidated === 1 ? "approval" : "approvals"} no longer stand. It needs approving again.`,
        });
      }

      return NextResponse.json({ assignment, approvalsInvalidated: invalidated > 0 });
    }

    if (input.action === "waive_contact") {
      assertCan(user, "talks.request", roleAccess);

      // The assignments_waiver_external_only CHECK is the real boundary. Refusing here first is
      // what makes the answer an honest sentence rather than a 500 carrying a constraint name.
      if (existing.memberId !== null) {
        return NextResponse.json(
          {
            error:
              "This speaker is on the ward roster — contact them rather than waiving it.",
          },
          { status: 409 },
        );
      }

      const assignment = await waiveContactStages(
        user.wardId,
        assignmentId,
        user.id,
        supabase,
      );

      if (!assignment) {
        return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
      }

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "assignment_contact_waived",
          module: "talks",
          detail: {
            assignmentId,
            stage: assignment.stage,
            externalSpeaker: assignment.externalSpeakerName !== null,
          },
        },
        supabase,
      );

      // Deliberately does NOT move the stage. A waiver is a fact about the assignment; advancing
      // it is still a separate, explicit transition (04-talks-pipeline.md §Step 1).
      return NextResponse.json({ assignment });
    }

    const from = existing.stage;
    const to = input.to;

    assertCan(user, permissionForTransition(from, to), roleAccess);

    const [approvals, bishopric] = await Promise.all([
      listApprovals(user.wardId, assignmentId, supabase),
      listBishopricUsers(user.wardId, supabase),
    ]);

    const verdict = canTransition(from, to, {
      assignment: toPipelineAssignment(existing),
      approvals: approvals.map((approval) => ({
        userId: approval.userId,
        approved: approval.approved,
      })),
      bishopricUserIds: bishopric.map((member) => member.id),
      actorIsBishopric: isBishopric(user.role),
      reason: input.reason,
    });

    // 409, not 400. The request was perfectly well formed; the assignment simply is not ready,
    // and a 400 would tell the caller they made a syntax mistake they did not make.
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.message }, { status: 409 });
    }

    const assignment = await transitionAssignment(
      user.wardId,
      assignmentId,
      to,
      { actorUserId: user.id },
      supabase,
    );

    if (!assignment) {
      return NextResponse.json({ error: WRITE_REFUSED }, { status: 404 });
    }

    // A decline: the speaker said no. The stage move alone would leave their name in the slot,
    // reading as a speaker who is still coming. `request` -> `plan` is the only backward move
    // that means this, which is why the check is on the PAIR and not on the target alone.
    const isDecline = from === "request" && to === "plan";

    let historyWritten = false;
    let current = assignment;

    if (isDecline) {
      // Reassigned from the clear's own returned row rather than left as the pre-clear read: the
      // response must not still name a speaker the server has just removed.
      current = (await clearSpeaker(user.wardId, assignmentId, supabase)) ?? assignment;

      // The history row records the speaker who declined, so it is written from the state BEFORE
      // the clear. External speakers never enter speaker history at all — writeAssignmentHistory
      // returns false rather than writing one (ITER-004).
      historyWritten = await writeAssignmentHistory(
        user.wardId,
        existing,
        "declined",
        supabase,
      );
    }

    if (to === "complete") {
      historyWritten = await writeAssignmentHistory(
        user.wardId,
        assignment,
        "completed",
        supabase,
      );
    }

    // The topic is stamped as used at APPROVE, and at no other stage.
    //
    // Not at `plan`: a plan that never gets approved should not burn the topic. Not at
    // `complete`: the whole point is to stop the bishopric PLANNING a repeat, which happens
    // weeks before the talk is given, so a signal that arrives afterwards arrives too late to
    // be worth anything (04-talks-pipeline.md).
    //
    // A BACKWARD move deliberately does not un-stamp it. The topic genuinely was chosen for a
    // Sunday, and rolling the stamp back would re-offer a topic the bishopric had just
    // discussed. The stamp records consideration, not completion.
    //
    // A stamp failure logs and continues — it must not fail the transition. Same contract as
    // writeAuditLog (lib/topics/queries.ts).
    let topicStamped = false;

    if (to === "approve" && assignment.topicId !== null) {
      topicStamped = await stampTopicAssigned(user.wardId, assignment.topicId, supabase);
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "assignment_stage_changed",
        module: "talks",
        detail: {
          assignmentId,
          from,
          to,
          // A backward move with no reason was already refused by canTransition, so this is
          // never empty when it matters.
          reason: input.reason ?? null,
          declined: isDecline,
          historyWritten,
          topicStamped,
        },
      },
      supabase,
    );

    const date = await describeSunday(user, current, supabase);
    const slot = current.slotNumber ?? "?";

    if (to === "review") {
      await emitNotification({
        wardId: user.wardId,
        triggerKey: "plan_submitted",
        title: "A speaking plan needs review",
        body: `The assignment in slot ${slot} on ${date} is ready for the bishopric to approve.`,
      });
    }

    if (to === "approve") {
      await emitNotification({
        wardId: user.wardId,
        triggerKey: "plan_approved",
        title: "A speaking plan was approved",
        body: `The assignment in slot ${slot} on ${date} has all its approvals and is ready to request.`,
      });
    }

    if (isDecline) {
      await emitNotification({
        wardId: user.wardId,
        triggerKey: "assignment_declined",
        title: "A speaker declined",
        body: `The speaker for slot ${slot} on ${date} declined. That slot is back at planning and needs somebody else.`,
      });
    }

    return NextResponse.json({
      assignment: current,
      from,
      to,
      stageLabel: PIPELINE_STAGE_LABELS[to],
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/assignments/[id]",
      fallbackMessage: "Could not update that assignment. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
