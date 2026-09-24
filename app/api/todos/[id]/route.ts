import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { deleteTodo, getTodo, listTodoLog, updateTodo } from "@/lib/todos/queries";
import { respondToTodoError } from "@/lib/todos/routeErrors";
import { todoIdSchema, updateTodoSchema } from "@/lib/validation/todo";

// One to-do: read it with its timeline, edit / complete / reopen / schedule it, or remove it.
//
// ZERO ROWS IS A 404, NEVER A 403. Another person's to-do is invisible under migration 081, and
// the caller is not entitled to learn that it exists — not even the bishop.

const NOT_FOUND = "That to-do could not be found.";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "personal_tools.use", roleAccess);

    const { id } = todoIdSchema.parse(await params);

    const todo = await getTodo(user.wardId, id, supabase);
    if (todo === null) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    const log = await listTodoLog(user.wardId, id, supabase);

    return NextResponse.json({ todo, log });
  } catch (error) {
    return respondToTodoError(error, {
      route: "GET /api/todos/[id]",
      fallbackMessage: "Could not load that to-do. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

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
    const input = updateTodoSchema.parse(await readJsonBody(request));

    const result = await updateTodo(user.wardId, id, input, supabase);
    if (result === null) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    if (result.changedFields.length > 0) {
      await writeAuditLog(
        {
          wardId: user.wardId,
          userId: user.id,
          action: auditActionFor(result.loggedKinds),
          module: "todos",
          detail: { todoId: id, changedFields: result.changedFields },
        },
        supabase,
      );
    }

    return NextResponse.json({ todo: result.todo });
  } catch (error) {
    return respondToTodoError(error, {
      route: "PATCH /api/todos/[id]",
      fallbackMessage: "Could not save that to-do. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// Completing and reopening get their own audit actions, because "when was this marked done" is
// the question somebody later asks of the log.
function auditActionFor(loggedKinds: readonly string[]): string {
  if (loggedKinds.includes("completed")) return "todo_completed";
  if (loggedKinds.includes("reopened")) return "todo_reopened";
  return "todo_updated";
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

    const deleted = await deleteTodo(user.wardId, id, supabase);
    if (!deleted) {
      return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "todo_deleted",
        module: "todos",
        detail: { todoId: id },
      },
      supabase,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondToTodoError(error, {
      route: "DELETE /api/todos/[id]",
      fallbackMessage: "Could not remove that to-do. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
