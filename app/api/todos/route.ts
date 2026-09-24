import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createTodo, listTodos } from "@/lib/todos/queries";
import { respondToTodoError } from "@/lib/todos/routeErrors";
import { createTodoSchema, listTodosQuerySchema } from "@/lib/validation/todo";

// A leader's own to-dos: list them, and add one to their OWN list.
//
// There is no way to add one to somebody else's list through this route, and that is not the
// route's doing: the body has no user field (lib/validation/todo.ts) and migration 081's INSERT
// policy refuses any `user_id` but the caller's (D3).
//
// THE AUDIT DETAIL CARRIES IDS AND FIELD NAMES, NEVER A TITLE, A NOTE OR A STEP LABEL. A to-do is
// private to its owner (D2) and the audit log is readable by anyone holding `audit.view`.
//
// The session is resolved OUTSIDE the try block: requireSessionUser() redirects by throwing an
// internal Next.js error, and catching that would turn a redirect into a 500.

export async function GET(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "personal_tools.use", roleAccess);

    const searchParams = new URL(request.url).searchParams;
    const filter = listTodosQuerySchema.parse({
      status: searchParams.get("status") ?? undefined,
    });

    const todos = await listTodos(user.wardId, filter, supabase);

    return NextResponse.json({ todos });
  } catch (error) {
    return respondToTodoError(error, {
      route: "GET /api/todos",
      fallbackMessage: "Could not load your to-dos. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

export async function POST(request: Request) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "personal_tools.use", roleAccess);

    const input = createTodoSchema.parse(await readJsonBody(request));

    const todo = await createTodo(user.wardId, user.id, input, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "todo_created",
        module: "todos",
        detail: { todoId: todo.id },
      },
      supabase,
    );

    return NextResponse.json({ todo }, { status: 201 });
  } catch (error) {
    return respondToTodoError(error, {
      route: "POST /api/todos",
      fallbackMessage: "Could not save that to-do. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
