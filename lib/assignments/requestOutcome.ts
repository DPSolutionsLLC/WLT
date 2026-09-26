import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearSpeaker,
  transitionAssignment,
  writeAssignmentHistory,
  writeRequestOutcome,
  type Assignment,
} from "@/lib/assignments/queries";
import { emitNotification } from "@/lib/notifications/emitNotification";
import type { Database } from "@/types/database";
import type { DeclineReason, RequestOutcome } from "@/types/domain";

// THE ONE SERVER FUNCTION THAT RECORDS A SPEAKER'S ANSWER — Sacrament slice f1.
//
// Two places record an answer: the talk's own panel (PATCH /api/assignments/[id],
// `action: "record_outcome"`) and an ask on the conductor's To Do (POST /api/todos/[id]/answer).
// Both call this, so a decline does the same things wherever it is pressed. The pipeline revamp the
// user has planned changes this one function (plan, Integration Notes).
//
// ---------------------------------------------------------------------------
// WHAT THE ROUTE DID BEFORE THIS FILE, found by reading it (plan Task 3)
// ---------------------------------------------------------------------------
// - A decline was TWO client calls from ContactStagePanel: `update { requestOutcome,
//   requestNotes }`, then `transition { to: "plan", reason }`. A failure between them left a
//   "declined" talk still at `request` with the speaker still named.
// - `request_outcome` was writable at EVERY stage through `update` (talks.plan). Nothing limited it
//   to `request`. So an ask answered while the talk is still at `plan`, `review` or `approve`
//   needed no relaxing of the route. An ask sits beside the pipeline (U5).
// - The transition to `plan` did NOT clear the speaker. The route's decline branch (the PAIR
//   `request` → `plan`) called clearSpeaker() and wrote the `declined` history row from the state
//   BEFORE the clear.
// - canTransition() refuses any backward move without a bishopric actor and a reason. This
//   function moves a declined talk back to `plan` DIRECTLY through transitionAssignment(), because
//   a decline is the answer itself rather than a planner's judgement about the plan. The permission
//   is the caller's `talks.request`, which only the bishopric holds.
//
// ---------------------------------------------------------------------------
// A DECLINE, IN ORDER
// ---------------------------------------------------------------------------
// 1. `request_outcome = 'declined'` and the note, so the answer is on the talk first.
// 2. Back to `plan` unless it is already there — the slot is open again.
// 3. The speaker is cleared — the slot reads as open, not as a speaker who is still coming.
// 4. Speaker history, from the state BEFORE the clear, with its reason. Members only: a visiting
//    speaker has no history row (migration 005, `member_id not null`) — U8.
// 5. The bishopric hears about it (`assignment_declined`, the same trigger the old path used).
//
// Closing the ask to-dos is NOT here. That is lib/todos/askLinks.ts with the service role, and the
// route calls it after this returns. This function runs entirely under the caller's own client.

type Client = SupabaseClient<Database>;

export type RecordOutcomeParams = {
  wardId: string;
  // Read through the caller's OWN client first, so RLS has already admitted it.
  existing: Assignment;
  outcome: RequestOutcome;
  declineReason: DeclineReason | null;
  // Free text. Stored on the talk as `request_notes`; never in an audit row or a timeline line.
  note: string | null;
  actorUserId: string;
  // "Sunday, March 7" for the notification body, resolved by the caller.
  sundayLabel: string;
  client: Client;
};

export type RecordOutcomeResult = {
  // Null when a write came back with zero rows — RLS refused it, and the route answers 404.
  assignment: Assignment | null;
  movedToPlan: boolean;
  historyWritten: boolean;
};

export async function recordRequestOutcome(params: RecordOutcomeParams): Promise<RecordOutcomeResult> {
  const { wardId, existing, client } = params;

  // `undefined` leaves the notes alone. An answer with no note must not erase one typed earlier.
  const notes = params.note === null || params.note === "" ? undefined : params.note;

  const recorded = await writeRequestOutcome(wardId, existing.id, params.outcome, notes, client);
  if (recorded === null) return { assignment: null, movedToPlan: false, historyWritten: false };

  if (params.outcome !== "declined") {
    return { assignment: recorded, movedToPlan: false, historyWritten: false };
  }

  let movedToPlan = false;
  if (existing.stage !== "plan") {
    const moved = await transitionAssignment(
      wardId,
      existing.id,
      "plan",
      { actorUserId: params.actorUserId },
      client,
    );
    if (moved === null) return { assignment: null, movedToPlan: false, historyWritten: false };
    movedToPlan = true;
  }

  const cleared = await clearSpeaker(wardId, existing.id, client);
  if (cleared === null) return { assignment: null, movedToPlan, historyWritten: false };

  const historyWritten = await writeAssignmentHistory(
    wardId,
    existing,
    "declined",
    client,
    params.declineReason,
  );

  await emitNotification({
    wardId,
    triggerKey: "assignment_declined",
    title: "A speaker declined",
    body: `The speaker for slot ${existing.slotNumber ?? "?"} on ${params.sundayLabel} declined. That slot is back at planning and needs somebody else.`,
  });

  return { assignment: cleared, movedToPlan, historyWritten };
}

// Whether a PATCH named a DIFFERENT speaker from the one the talk had. Compared on the saved row
// rather than on the request, so sending the same speaker again is not a change.
export function speakerChanged(before: Assignment, after: Assignment): boolean {
  return (
    before.memberId !== after.memberId ||
    (before.externalSpeakerName ?? "") !== (after.externalSpeakerName ?? "")
  );
}
