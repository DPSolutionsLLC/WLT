import { NextResponse } from "next/server";
import { z } from "zod";
import {
  clearApprovals,
  getAssignment,
  listApprovals,
  recordApproval,
  transitionAssignment,
} from "@/lib/assignments/queries";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { getSunday, listBishopricUsers } from "@/lib/calendar/queries";
import { emitNotification } from "@/lib/notifications/emitNotification";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { approveAssignmentSchema } from "@/lib/validation/assignment";

// One bishopric member's decision on one assignment. It records a DECISION and never moves the
// assignment forward — reaching APPROVE stays an explicit transition through
// PATCH /api/assignments/[id], because a stage that advances as a side effect of something else
// is the phase's first pitfall (04-talks-pipeline.md §Step 3).
//
// A change request is the exception, and deliberately so: `approved: false` is not a decision
// that leaves the plan where it was, it is a decision to send it back.

const assignmentIdSchema = z.uuid("That assignment id is not valid.");

const NOT_FOUND = "That assignment is not in your ward.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const { id } = await params;
    const assignmentId = assignmentIdSchema.parse(id);
    const input = approveAssignmentSchema.parse(await readJsonBody(request));

    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "talks.approve", roleAccess);

    const assignment = await getAssignment(user.wardId, assignmentId, supabase);
    if (!assignment) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    // An approval on a plan that has already moved on is meaningless — and worse, it would sit
    // in the table looking like a live decision about the plan's current shape.
    if (assignment.stage !== "review") {
      return NextResponse.json(
        {
          error:
            "That assignment is not waiting for approval. Reload to see where it is now.",
        },
        { status: 409 },
      );
    }

    const sunday =
      assignment.sundayId === null
        ? null
        : await getSunday(user.wardId, assignment.sundayId, supabase);
    const date = sunday?.date ?? "an unscheduled Sunday";
    const slot = assignment.slotNumber ?? "?";

    // A change request: record the decision WITH its comment, send the plan back to planning, and
    // clear the other approvals — they were decisions about a plan that is now being changed.
    if (!input.approved) {
      await recordApproval(
        user.wardId,
        assignmentId,
        user.id,
        false,
        input.comment ?? null,
        supabase,
      );

      const reverted = await transitionAssignment(
        user.wardId,
        assignmentId,
        "plan",
        { actorUserId: user.id },
        supabase,
      );

      // Every OTHER approval goes. They were decisions about a plan that is now being changed.
      // This member's own row stays, because it carries the comment saying what to change — the
      // only explanation the planner gets.
      const cleared = await clearApprovals(
        user.wardId,
        assignmentId,
        { exceptUserId: user.id },
        supabase,
      );

      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: "assignment_approval_recorded",
          module: "talks",
          detail: {
            assignmentId,
            approved: false,
            stage: "review",
            revertedTo: "plan",
            approvalsCleared: cleared,
          },
        },
        supabase,
      );

      await emitNotification({
        wardId: user.wardId,
        triggerKey: "plan_change_requested",
        title: "A speaking plan needs changes",
        body: `The assignment in slot ${slot} on ${date} was sent back to planning. Open it to read what needs changing.`,
      });

      return NextResponse.json({
        assignment: reverted ?? assignment,
        approved: false,
        readyToApprove: false,
      });
    }

    await recordApproval(
      user.wardId,
      assignmentId,
      user.id,
      true,
      input.comment ?? null,
      supabase,
    );

    const [approvals, bishopric] = await Promise.all([
      listApprovals(user.wardId, assignmentId, supabase),
      listBishopricUsers(user.wardId, supabase),
    ]);

    // Counted over DISTINCT approving users against the bishopric roll, exactly as
    // canTransition() does. This is a hint for the UI to prompt the transition — the gate itself
    // is re-evaluated when that transition is actually requested, so a stale prompt cannot
    // approve anything.
    const approvedBy = new Set(
      approvals
        .filter((approval) => approval.approved === true)
        .map((approval) => approval.userId),
    );

    const outstanding = bishopric.filter((member) => !approvedBy.has(member.id));
    const readyToApprove = bishopric.length > 0 && outstanding.length === 0;

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "assignment_approval_recorded",
        module: "talks",
        detail: {
          assignmentId,
          approved: true,
          stage: assignment.stage,
          approvedCount: approvedBy.size,
          bishopricCount: bishopric.length,
          readyToApprove,
        },
      },
      supabase,
    );

    return NextResponse.json({
      assignment,
      approved: true,
      approvedCount: approvedBy.size,
      bishopricCount: bishopric.length,
      readyToApprove,
    });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/assignments/[id]/approve",
      fallbackMessage: "Could not record that decision. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
