import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileSundayAsks, type ReconcileResult } from "@/lib/sacrament/conductorHandover";
import { AskLinkWriteError } from "@/lib/todos/askLinks";
import type { Database } from "@/types/database";

// DELETE ON A TALK — the user's decision, 2026-09-29 (plans/sacrament-topics-screen-rebuild.md,
// decision 2). The talk is CANCELLED and kept as a record, every later talk moves up one slot, and
// the Sunday has one fewer speaker. Migration 087's remove_talk() does all three in one
// transaction under the caller's own policies.
//
// THEN THE PEOPLE ARE TOLD, by the same save-time reconcile a calendar edit runs (Sacrament slice
// f2c): a member's `cancelled` speaker-history row, and a "Let ___ know it's cancelled" to-do for
// whoever asked them. It asks of the state what is still missing, so pressing Delete's retry after
// a half-finished run finishes it — and a failure there does not undo the removal, which really
// happened. It is logged and reported, as PATCH /api/sundays/[id] does.
//
// SERVER-ONLY: conductorHandover.ts reaches next/headers.

export type RemoveTalkRefusal = "not_found" | "already_cancelled" | "last_talk";

export type RemoveTalkResult =
  | {
      ok: true;
      sundayId: string;
      slotNumber: number | null;
      shiftedCount: number;
      reconciled: ReconcileResult | null;
      // True when the talk was removed but not everybody could be told yet.
      reconcileIncomplete: boolean;
    }
  | { ok: false; refusal: RemoveTalkRefusal };

// The message keys migration 087 raises. Part of that function's contract.
const REFUSALS: readonly RemoveTalkRefusal[] = ["not_found", "already_cancelled", "last_talk"];

function refusalIn(message: string): RemoveTalkRefusal | null {
  return REFUSALS.find((refusal) => message.includes(`remove_talk:${refusal}`)) ?? null;
}

type RemovedTalk = { sunday_id: string; slot_number: number | null; shifted_count: number };

export async function removeTalk(params: {
  wardId: string;
  assignmentId: string;
  actingUserId: string;
  client: SupabaseClient<Database>;
}): Promise<RemoveTalkResult> {
  const { wardId, assignmentId, client } = params;

  const { data, error } = await client.rpc("remove_talk", { p_assignment_id: assignmentId });

  if (error) {
    const refusal = refusalIn(error.message);
    if (refusal !== null) return { ok: false, refusal };

    console.error(`Could not remove a talk — ${error.message}`, { wardId, assignmentId });
    throw new Error(`Could not remove that talk: ${error.message}`);
  }

  const removed = data as unknown as RemovedTalk;

  let reconciled: ReconcileResult | null = null;
  let reconcileIncomplete = false;
  try {
    reconciled = await reconcileSundayAsks({
      wardId,
      sundayIds: [removed.sunday_id],
      actingUserId: params.actingUserId,
      client,
    });
  } catch (reconcileError) {
    if (!(reconcileError instanceof AskLinkWriteError)) throw reconcileError;
    console.error("A talk was removed but not everybody could be told yet", {
      wardId,
      assignmentId,
      cause: reconcileError.cause,
    });
    reconcileIncomplete = true;
  }

  return {
    ok: true,
    sundayId: removed.sunday_id,
    slotNumber: removed.slot_number,
    shiftedCount: removed.shifted_count,
    reconciled,
    reconcileIncomplete,
  };
}
