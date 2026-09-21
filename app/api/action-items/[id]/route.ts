import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { deleteActionItem, updateActionItem } from "@/lib/agendas/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { agendaIdSchema, updateActionItemSchema } from "@/lib/validation/agenda";

// Complete, reopen, edit or remove one action item.
//
// ---------------------------------------------------------------------------------------------
// COMPLETING AND REOPENING ARE THE SAME ROUTE
// ---------------------------------------------------------------------------------------------
// A mis-ticked item must be recoverable, and the way back is the same control rather than a
// delete — migration 060a's rule for `closed_at`, on a field with the same power to remove
// something from a list. `completed_at` moves with `status` in lib/agendas/queries.ts so the two
// cannot drift apart.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "agendas.manage", roleAccess);

    const { id } = agendaIdSchema.parse(await params);
    const input = updateActionItemSchema.parse(await readJsonBody(request));

    const item = await updateActionItem(user.wardId, id, input, supabase);

    // Zero rows is an RLS refusal, not an error (CLAUDE.md §8). 404 rather than 403: the reader is
    // not entitled to learn the row exists in another ward.
    if (item === null) {
      return NextResponse.json({ error: "That action item could not be found." }, { status: 404 });
    }

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: input.complete === undefined ? "action_item_updated" : "action_item_status_changed",
        module: "agendas",
        detail: {
          actionItemId: item.id,
          agendaId: item.agendaId,
          status: item.status,
          completedAt: item.completedAt,
        },
      },
      supabase,
    );

    return NextResponse.json({ actionItem: item });
  } catch (error) {
    return respondToRouteError(error, {
      route: "PATCH /api/action-items/[id]",
      fallbackMessage: "Could not update the action item. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}

// ---------------------------------------------------------------------------------------------
// DELETE IS FOR A MISTAKE, AND COMPLETING IS NOT A MISTAKE
// ---------------------------------------------------------------------------------------------
// An item typed by accident should go; an item that was done should be COMPLETED, so the record
// of the meeting keeps it. The screen offers Complete first and Remove second for that reason —
// youth-h's Close-before-Remove shape, and the same reasoning: only one of the two destroys a
// record of what a meeting decided.
//
// It is unconditional, unlike youth-h's gated Remove, and the reason it can be is that nothing
// hangs off an action item. No follow-up, no private note, no author's words — only the line
// itself, and a copy of it already exists on any later agenda that carried it forward.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId);

    assertCan(user, "agendas.manage", roleAccess);

    const { id } = agendaIdSchema.parse(await params);

    await deleteActionItem(user.wardId, id, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "action_item_deleted",
        module: "agendas",
        detail: { actionItemId: id },
      },
      supabase,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return respondToRouteError(error, {
      route: "DELETE /api/action-items/[id]",
      fallbackMessage: "Could not remove the action item. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
