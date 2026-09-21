import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { createActionItems, getAgenda } from "@/lib/agendas/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { agendaIdSchema, createActionItemSchema } from "@/lib/validation/agenda";

// Add an action item to an agenda.
//
// `carriedFromAgendaId` is deliberately NOT on the request schema: an item created here is raised
// in THIS meeting, and only the create-agenda route copies items forward. A client that could set
// it would be able to fabricate a history the chain is read from.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "agendas.manage", roleAccess);

    const { id } = agendaIdSchema.parse(await params);
    const input = createActionItemSchema.parse(await readJsonBody(request));

    // The agenda is read first so a bad id answers 404 rather than a foreign-key error, which
    // reads like a bug rather than like a missing row.
    const agenda = await getAgenda(user.wardId, id, supabase);
    if (agenda === null) {
      return NextResponse.json({ error: "That agenda could not be found." }, { status: 404 });
    }

    const [item] = await createActionItems(
      user.wardId,
      id,
      [{ description: input.description, assignedTo: input.assignedTo, dueDate: input.dueDate }],
      supabase,
    );

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "action_item_created",
        module: "agendas",
        detail: { agendaId: id, actionItemId: item.id, assignedTo: item.assignedTo },
      },
      supabase,
    );

    return NextResponse.json({ actionItem: item }, { status: 201 });
  } catch (error) {
    return respondToRouteError(error, {
      route: "POST /api/agendas/[id]/action-items",
      fallbackMessage: "Could not add the action item. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
