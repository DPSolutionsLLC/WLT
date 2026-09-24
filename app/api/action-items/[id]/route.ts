import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { assertCan, resolveRoleAccess } from "@/lib/auth/permissions";
import { readJsonBody, respondToRouteError } from "@/lib/auth/routeErrors";
import { requireSessionUser } from "@/lib/auth/session";
import { assertAssigneeInWard } from "@/lib/agendas/assignee";
import { deleteActionItem, getActionItem, updateActionItem } from "@/lib/agendas/queries";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  clearTodoFlagsForReopenedActionItem,
  flagTodosForCompletedActionItem,
  releaseTodosForDeletedActionItem,
  SourceLinkWriteError,
  syncActionItemTodo,
} from "@/lib/todos/sourceLinks";
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
//
// ---------------------------------------------------------------------------------------------
// THE ASSIGNEE'S TO-DO FOLLOWS THE ITEM (slice p5-b), AND NEVER COMPLETES WITH IT
// ---------------------------------------------------------------------------------------------
// Naming `assignedUserId` creates that person's linked to-do and releases the previous assignee's
// (deleted if untouched, otherwise unlinked and kept). Completing the item FLAGS the to-do;
// reopening withdraws the flag. lib/todos/sourceLinks.ts does the writing, with the service role,
// because a to-do is readable by its owner alone.
//
// ORDER: item write → to-do write → audit. The audit row is written even when the to-do write
// failed, because the item change did happen (rule 6); the response is then a 500 naming what was
// not done (rule 7). Re-sending the same request is safe — every to-do write is idempotent.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "agendas.manage", roleAccess);

    const { id } = agendaIdSchema.parse(await params);
    const input = updateActionItemSchema.parse(await readJsonBody(request));

    await assertAssigneeInWard(user.wardId, input.assignedUserId, supabase);

    // Read through the CALLER'S client first: that read is what vouches to sourceLinks.ts that the
    // item is in this ward, and it is the only record of who was assigned before this request.
    const before = await getActionItem(user.wardId, id, supabase);
    const item = before === null ? null : await updateActionItem(user.wardId, id, input, supabase);

    // Zero rows is an RLS refusal, not an error (CLAUDE.md §8). 404 rather than 403: the reader is
    // not entitled to learn the row exists in another ward.
    if (before === null || item === null) {
      return NextResponse.json({ error: "That action item could not be found." }, { status: 404 });
    }

    let todoLinks: Record<string, unknown> = {};
    let linkError: SourceLinkWriteError | null = null;
    try {
      if (input.assignedUserId !== undefined) {
        const sync = await syncActionItemTodo({
          wardId: user.wardId,
          actionItem: item,
          previousAssignedUserId: before.assignedUserId,
          assignedByUserId: user.id,
        });
        todoLinks = { ...todoLinks, ...sync };
      }
      if (input.complete === true) {
        const flagged = await flagTodosForCompletedActionItem({
          wardId: user.wardId,
          actionItemId: id,
        });
        todoLinks = { ...todoLinks, flagged };
      }
      if (input.complete === false) {
        const cleared = await clearTodoFlagsForReopenedActionItem({
          wardId: user.wardId,
          actionItemId: id,
        });
        todoLinks = { ...todoLinks, cleared };
      }
    } catch (error) {
      if (!(error instanceof SourceLinkWriteError)) throw error;
      linkError = error;
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
          assignedUserId: item.assignedUserId,
          todoLinks,
          todoLinkFailed: linkError !== null,
        },
      },
      supabase,
    );

    if (linkError !== null) {
      return NextResponse.json({ error: linkError.message, actionItem: item }, { status: 500 });
    }

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
//
// An assignee's linked to-do (slice p5-b) does not hang off it either: it belongs to its owner.
// An UNTOUCHED one is removed first, so it does not outlive a line typed by mistake; a touched one
// is unlinked and kept.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireSessionUser();

  try {
    const supabase = await createServerSupabaseClient();
    const roleAccess = await resolveRoleAccess(supabase, user.wardId, user.orgType);

    assertCan(user, "agendas.manage", roleAccess);

    const { id } = agendaIdSchema.parse(await params);

    // Only an item the caller's own client can see has its to-dos released: the service role
    // behind releaseTodosForDeletedActionItem() must never be pointed at an id RLS did not admit.
    const existing = await getActionItem(user.wardId, id, supabase);
    const released =
      existing === null
        ? null
        : await releaseTodosForDeletedActionItem({ wardId: user.wardId, actionItemId: id });

    await deleteActionItem(user.wardId, id, supabase);

    await writeAuditLog(
      {
        wardId: user.wardId,
        userId: user.id,
        action: "action_item_deleted",
        module: "agendas",
        detail: { actionItemId: id, todoLinks: released },
      },
      supabase,
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    // Released before the delete, so nothing was removed yet — the sentence says so.
    if (error instanceof SourceLinkWriteError) {
      console.error("DELETE /api/action-items/[id] could not release the assignee's to-do", {
        wardId: user.wardId,
        userId: user.id,
        cause: error.cause,
      });
      return NextResponse.json(
        {
          error:
            "The action item was not removed, because the assignee's to-do could not be updated. Please try again.",
        },
        { status: 500 },
      );
    }
    return respondToRouteError(error, {
      route: "DELETE /api/action-items/[id]",
      fallbackMessage: "Could not remove the action item. Please try again.",
      detail: { wardId: user.wardId, userId: user.id },
    });
  }
}
