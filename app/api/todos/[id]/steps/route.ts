import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addStep } from "@/lib/todos/queries";
import { respondToTodoError } from "@/lib/todos/routeErrors";
import { createStepSchema, todoIdSchema } from "@/lib/validation/todo";

// Add a step. The first step is what turns a plain to-do into a project — there is no mode to
// switch and nothing else to send.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "personal_tools.use", roleAccess);

    const { id } = todoIdSchema.parse(await params);
    const input = createStepSchema.parse(await readJsonBody(request));

    const step = await addStep(user.wardId, id, input.label, supabase);
    if (step === null) {
      return NextResponse.json({ error: "That to-do could not be found." }, { status: 404 });
    }

    // The label is private (D2), so the audit row carries ids only.
    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "todo_step_added",
        module: "todos",
        detail: { todoId: id, stepId: step.id },
      },
      supabase,
    );

    return NextResponse.json({ step }, { status: 201 });
  } catch (error) {
    return respondToTodoError(error, {
      route: "POST /api/todos/[id]/steps",
      fallbackMessage: "Could not add that step. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
