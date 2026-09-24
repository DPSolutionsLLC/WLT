import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deleteStep, updateStep } from "@/lib/todos/queries";
import { respondToTodoError } from "@/lib/todos/routeErrors";
import { todoIdSchema, updateStepSchema } from "@/lib/validation/todo";

// One step: rename it, check it off or uncheck it, or remove it. Checking and unchecking are the
// same control, so a mis-tick is recoverable without a delete (migration 060a's rule).

const NOT_FOUND = "That step could not be found.";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "personal_tools.use", roleAccess);

    const { id } = todoIdSchema.parse(await params);
    const input = updateStepSchema.parse(await readJsonBody(request));

    const result = await updateStep(user.wardId, id, input, supabase);
    if (result === null) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "todo_step_updated",
        module: "todos",
        detail: {
          todoId: result.step.todoId,
          stepId: id,
          done: result.step.doneAt !== null,
          renamed: input.label !== undefined,
        },
      },
      supabase,
    );

    return NextResponse.json({ step: result.step });
  } catch (error) {
    return respondToTodoError(error, {
      route: "PATCH /api/todo-steps/[id]",
      fallbackMessage: "Could not save that step. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "personal_tools.use", roleAccess);

    const { id } = todoIdSchema.parse(await params);

    const todoId = await deleteStep(user.wardId, id, supabase);
    if (todoId === null) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "todo_step_deleted",
        module: "todos",
        detail: { todoId, stepId: id },
      },
      supabase,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondToTodoError(error, {
      route: "DELETE /api/todo-steps/[id]",
      fallbackMessage: "Could not remove that step. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
