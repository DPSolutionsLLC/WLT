import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addNote } from "@/lib/todos/queries";
import { respondToTodoError } from "@/lib/todos/routeErrors";
import { createNoteSchema, todoIdSchema } from "@/lib/validation/todo";

// Write a note on a to-do's timeline.
//
// THE NOTE'S TEXT NEVER REACHES THE AUDIT LOG. The detail key is `logEntryId`, deliberately not
// anything containing "note" — writeAuditLog() redacts such keys as a backstop, and an id that
// arrived as "[redacted]" would be useless to whoever reads the log.
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
    const input = createNoteSchema.parse(await readJsonBody(request));

    const entry = await addNote(user.wardId, id, input.body, supabase);
    if (entry === null) {
      return NextResponse.json({ error: "That to-do could not be found." }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "todo_note_added",
        module: "todos",
        detail: { todoId: id, logEntryId: entry.id },
      },
      supabase,
    );

    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    return respondToTodoError(error, {
      route: "POST /api/todos/[id]/notes",
      fallbackMessage: "Could not save that note. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
