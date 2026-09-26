import { NextResponse } from "next/server";
import { getAssignment } from "@/lib/assignments/queries";
import { recordRequestOutcome } from "@/lib/assignments/requestOutcome";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { AskLinkWriteError, resolveAsksForAssignment } from "@/lib/todos/askLinks";
import { getTodo } from "@/lib/todos/queries";
import { respondToTodoError } from "@/lib/todos/routeErrors";
import { answerAskSchema } from "@/lib/validation/talkAsk";
import { todoIdSchema } from "@/lib/validation/todo";
import { DECLINE_REASON_LABELS } from "@/types/domain";

// RECORD A SPEAKER'S ANSWER FROM AN ASK ON YOUR TO DO — Sacrament slice f1.
//
// The to-do is read through the CALLER'S OWN client, which is what proves it is theirs: another
// person's ask is invisible under migration 081, so it answers 404, exactly as GET /api/todos/[id]
// does. The talk is then read the same way, and the answer is recorded ON THE TALK by the one
// function that records an outcome (lib/assignments/requestOutcome.ts). A decline reopens the slot
// and reaches speaker history there.
//
// THEN EVERY OPEN COPY OF THE ASK IS CLOSED, the conductor's and the assistant's alike
// (lib/todos/askLinks.ts). Order: the talk, then the to-dos, then the audit. The audit is written
// even when closing the to-dos failed, because the answer is recorded either way.

const NOT_FOUND = "That to-do could not be found.";
const NOT_AN_OPEN_ASK =
  "This is not an open ask. Only an ask that has not been answered yet can record an answer.";
const TALK_GONE = "The talk this ask was for is no longer on the calendar.";
const COPIES_NOT_CLOSED =
  "The answer was recorded on the talk, but not every copy of the ask was closed. Please refresh.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "talks.request", roleAccess);

    const { id } = todoIdSchema.parse(await params);
    const input = answerAskSchema.parse(await readJsonBody(request));

    const todo = await getTodo(user.wardId, id, supabase);
    if (todo === null) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }
    if (todo.askAssignmentId === null || todo.completedAt !== null) {
      return NextResponse.json({ error: NOT_AN_OPEN_ASK }, { status: 400 });
    }

    const assignmentId = todo.askAssignmentId;
    const existing = await getAssignment(user.wardId, assignmentId, supabase);
    if (existing === null) {
      return NextResponse.json({ error: TALK_GONE }, { status: 404 });
    }

    const declineReason = input.outcome === "declined" ? (input.declineReason ?? null) : null;

    const result = await recordRequestOutcome({
      wardId: user.wardId,
      existing,
      outcome: input.outcome,
      declineReason,
      note: input.note ?? null,
      actorUserId: user.id,
      sundayLabel: todo.askSource?.sundayDate ?? "an unscheduled Sunday",
      client: supabase,
    });

    if (result.assignment === null) {
      return NextResponse.json({ error: TALK_GONE }, { status: 404 });
    }

    let todosClosed: string[] = [];
    let closeFailure: AskLinkWriteError | null = null;
    try {
      todosClosed = await resolveAsksForAssignment({
        wardId: user.wardId,
        assignmentId,
        outcome: input.outcome,
        reasonLabel: declineReason === null ? null : DECLINE_REASON_LABELS[declineReason],
      });
    } catch (error) {
      if (!(error instanceof AskLinkWriteError)) throw error;
      closeFailure = error;
    }

    // Ids and the reason CODE only — never the note, which can carry a member's circumstances,
    // and never a key containing "note" (writeAuditLog() redacts it).
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "talk_ask_answered",
        module: "talks",
        detail: {
          todoId: id,
          assignmentId,
          outcome: input.outcome,
          declineReason,
          movedToPlan: result.movedToPlan,
          historyWritten: result.historyWritten,
          todosClosed,
        },
      },
      supabase,
    );

    if (closeFailure !== null) {
      console.error("POST /api/todos/[id]/answer recorded the answer but not every copy closed", {
        wardId: user.wardId,
        todoId: id,
        cause: closeFailure.cause,
      });
      return NextResponse.json({ error: COPIES_NOT_CLOSED }, { status: 500 });
    }

    return NextResponse.json({ outcome: input.outcome, todosClosed });
  } catch (error) {
    return respondToTodoError(error, {
      route: "POST /api/todos/[id]/answer",
      fallbackMessage: "Could not record that answer. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
