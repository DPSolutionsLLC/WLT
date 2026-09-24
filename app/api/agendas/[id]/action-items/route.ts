import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { assertAssigneeInWard } from "@/lib/agendas/assignee";
import { createActionItems, getAgenda } from "@/lib/agendas/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { SourceLinkWriteError, syncActionItemTodo, type ActionItemTodoSync } from "@/lib/todos/sourceLinks";
import { agendaIdSchema, createActionItemSchema } from "@/lib/validation/agenda";

// Add an action item to an agenda.
//
// `carriedFromAgendaId` is deliberately NOT on the request schema: an item created here is raised
// in THIS meeting, and only the create-agenda route copies items forward. A client that could set
// it would be able to fabricate a history the chain is read from.
//
// An item created with `assignedUserId` creates that person's linked to-do (slice p5-b), through
// lib/todos/sourceLinks.ts — see app/api/action-items/[id]/route.ts for the order of writes and
// why the audit row is written even when the to-do write fails.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "agendas.manage", roleAccess);

    const { id } = agendaIdSchema.parse(await params);
    const input = createActionItemSchema.parse(await readJsonBody(request));

    await assertAssigneeInWard(user.wardId, input.assignedUserId, supabase);

    // The agenda is read first so a bad id answers 404 rather than a foreign-key error, which
    // reads like a bug rather than like a missing row.
    const agenda = await getAgenda(user.wardId, id, supabase);
    if (agenda === null) {
      return NextResponse.json({ error: "That agenda could not be found." }, { status: 404 });
    }

    const [item] = await createActionItems(
      user.wardId,
      id,
      [
        {
          description: input.description,
          assignedTo: input.assignedTo,
          assignedUserId: input.assignedUserId,
          dueDate: input.dueDate,
        },
      ],
      supabase,
    );

    let todoLinks: ActionItemTodoSync | null = null;
    let linkError: SourceLinkWriteError | null = null;
    if (item.assignedUserId !== null) {
      try {
        todoLinks = await syncActionItemTodo({
          wardId: user.wardId,
          actionItem: item,
          previousAssignedUserId: null,
          assignedByUserId: user.id,
        });
      } catch (error) {
        if (!(error instanceof SourceLinkWriteError)) throw error;
        linkError = error;
      }
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "action_item_created",
        module: "agendas",
        detail: {
          agendaId: id,
          actionItemId: item.id,
          assignedTo: item.assignedTo,
          assignedUserId: item.assignedUserId,
          todoLinks,
          todoLinkFailed: linkError !== null,
        },
      },
      supabase,
    );

    // NOT linkError.message, whose "Please try again" is right for a PATCH and wrong here: re-sending
    // a POST adds the item a second time. Re-sending the assignee on the new item is the repair.
    if (linkError !== null) {
      return NextResponse.json(
        {
          error:
            "The action item was added, but the assignee's to-do could not be created. Assign the item to them again to retry.",
          actionItem: item,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ actionItem: item }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/agendas/[id]/action-items",
      fallbackMessage: "Could not add the action item. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
