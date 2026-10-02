import { NextResponse } from "next/server";
import { getAssignment } from "@/lib/assignments/queries";
import { recordRequestOutcome } from "@/lib/assignments/requestOutcome";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { recordPrayerOutcome } from "@/lib/prayers/prayerOutcome";
import { getPrayer } from "@/lib/prayers/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  AskLinkWriteError,
  closeAsksForAssignment,
  closeToldTodo,
  resolveAsksForAssignment,
} from "@/lib/todos/askLinks";
import { getTodo } from "@/lib/todos/queries";
import { respondToTodoError } from "@/lib/todos/routeErrors";
import { answerAskSchema, DECLINE_NEEDS_REASON } from "@/lib/validation/talkAsk";
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
//
// "TOLD THEM" (Sacrament slices f2b and f2c). Work that was cancelled — a talk, a prayer, a musical
// number — leaves its owner a to-do stamped `talk_off_at`, and there is no answer to record: the
// owner lets the person know they are not needed and presses Told them. That closes every open copy
// of a talk ask, or the one to-do for a prayer or a musical number, with "Told them they're not
// needed". The cancelled record itself is left exactly as it was.
//
// Told them needs only `personal_tools.use`: it closes the caller's own to-do (RLS proves it is
// theirs) and the other copies of the same talk ask. A ward secretary who cancelled a meeting holds
// the musical number's to-do and no talk permission. Accepted / Declined still need `talks.request`,
// and are refused on anything that is off.
//
// A PRAYER ASK (ITER-036 fb) is answered the same way, through lib/prayers/prayerOutcome.ts — the
// one writer of a prayer's answer. Its decline carries no reason: a prayer keeps no decline history.
// A TALK's decline still needs one, checked here because the schema cannot see which kind of ask
// the URL names.

const NOT_FOUND = "That to-do could not be found.";
const NOT_AN_OPEN_ASK =
  "This is not an open ask. Only an ask that has not been answered yet can record an answer.";
const TALK_GONE = "The talk this ask was for is no longer on the calendar.";
const COPIES_NOT_CLOSED =
  "The answer was recorded on the talk, but not every copy of the ask was closed. Please refresh.";
const TALK_IS_OFF =
  "There is no talk any more. Once you've let them know they're not needed, press Told them.";
const TALK_IS_ON = "The talk is still on. Record their answer with Accepted or Declined.";
const TOLD_NOT_ALL_CLOSED = "Not every copy of this to-do was closed. Please refresh.";
const PRAYER_IS_OFF =
  "This prayer was cancelled. Once you've let them know they're not needed, press Told them.";
const PRAYER_GONE = "The prayer this ask was for is no longer on the calendar.";
const PRAYER_COPIES_NOT_CLOSED =
  "The answer was recorded on the prayer, but its ask could not be closed. Please refresh.";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    const { id } = todoIdSchema.parse(await params);
    const input = answerAskSchema.parse(await readJsonBody(request));

    assertCan(user, input.outcome === "told" ? "personal_tools.use" : "talks.request", roleAccess);

    const todo = await getTodo(user.wardId, id, supabase);
    if (todo === null) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    const isOff = todo.talkOffAt !== null || todo.askSource?.talkOff === true;
    if (input.outcome === "told") {
      if (todo.completedAt !== null || !isOff) {
        return NextResponse.json({ error: TALK_IS_ON }, { status: 400 });
      }
      return await recordTold({
        wardId: user.wardId,
        userId: user.id,
        todoId: id,
        assignmentId: todo.askAssignmentId,
        supabase,
      });
    }

    if (todo.askPrayerId !== null && todo.askAssignmentId === null) {
      if (todo.completedAt !== null) {
        return NextResponse.json({ error: NOT_AN_OPEN_ASK }, { status: 400 });
      }
      if (isOff) {
        return NextResponse.json({ error: PRAYER_IS_OFF }, { status: 400 });
      }
      return await answerPrayerAsk({
        wardId: user.wardId,
        userId: user.id,
        todoId: id,
        prayerId: todo.askPrayerId,
        outcome: input.outcome,
        supabase,
      });
    }

    if (todo.askAssignmentId === null || todo.completedAt !== null) {
      return NextResponse.json({ error: NOT_AN_OPEN_ASK }, { status: 400 });
    }
    if (isOff) {
      return NextResponse.json({ error: TALK_IS_OFF }, { status: 400 });
    }
    if (input.outcome === "declined" && input.declineReason === undefined) {
      return NextResponse.json({ error: DECLINE_NEEDS_REASON }, { status: 400 });
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

// A prayer's Accepted / Declined. The prayer was read through the caller's own client; the answer
// is recorded on it by recordPrayerOutcome(), which then closes the ask. Ids only in the audit.
async function answerPrayerAsk(params: {
  wardId: string;
  userId: string;
  todoId: string;
  prayerId: string;
  outcome: "accepted" | "declined";
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
}): Promise<NextResponse> {
  const existing = await getPrayer(params.wardId, params.prayerId, params.supabase);
  if (existing === null) {
    return NextResponse.json({ error: PRAYER_GONE }, { status: 404 });
  }

  const result = await recordPrayerOutcome({
    wardId: params.wardId,
    existing,
    outcome: params.outcome,
    actorUserId: params.userId,
    client: params.supabase,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 409 });
  }

  await writeAuditLog(
    {
      wardId: params.wardId,
      userId: params.userId,
      action: "prayer_ask_answered",
      module: "talks",
      detail: {
        todoId: params.todoId,
        prayerId: params.prayerId,
        outcome: params.outcome,
        stage: result.prayer.stage,
        todosClosed: result.todosClosed,
      },
    },
    params.supabase,
  );

  if (result.closeFailure !== null) {
    return NextResponse.json({ error: PRAYER_COPIES_NOT_CLOSED }, { status: 500 });
  }

  return NextResponse.json({ outcome: params.outcome, todosClosed: result.todosClosed });
}

// "Told them". Nothing on the cancelled record changes — it stays exactly as it was when it was
// cancelled. Every open copy of a talk ask closes (the conductor's and the assistant's); a prayer's
// or a musical number's to-do closes alone, since nobody else holds one.
async function recordTold(params: {
  wardId: string;
  userId: string;
  todoId: string;
  assignmentId: string | null;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
}): Promise<NextResponse> {
  let todosClosed: string[] = [];
  let closeFailure: AskLinkWriteError | null = null;
  try {
    todosClosed =
      params.assignmentId === null
        ? await closeToldTodo({ wardId: params.wardId, todoId: params.todoId })
        : await closeAsksForAssignment({
            wardId: params.wardId,
            assignmentId: params.assignmentId,
            reason: "told_not_needed",
          });
  } catch (error) {
    if (!(error instanceof AskLinkWriteError)) throw error;
    closeFailure = error;
    todosClosed = [...error.completedIds];
  }

  await writeAuditLog(
    {
      wardId: params.wardId,
      userId: params.userId,
      action: "talk_ask_told_not_needed",
      module: "talks",
      detail: { todoId: params.todoId, assignmentId: params.assignmentId, todosClosed },
    },
    params.supabase,
  );

  if (closeFailure !== null) {
    console.error("POST /api/todos/[id]/answer did not close every copy on Told them", {
      wardId: params.wardId,
      todoId: params.todoId,
      cause: closeFailure.cause,
    });
    return NextResponse.json({ error: TOLD_NOT_ALL_CLOSED }, { status: 500 });
  }

  return NextResponse.json({ outcome: "told", todosClosed });
}
