import type { SupabaseClient } from "@supabase/supabase-js";
import { clearTalkShapeStamps, type Sunday } from "@/lib/calendar/queries";
import type { UpdateAssignmentInput } from "@/lib/validation/assignment";
import type { Database } from "@/types/database";

// ---------------------------------------------------------------------------
// A STALE "READY" SIGNAL MUST NEVER SURVIVE A REAL EDIT UNDERNEATH IT
// ---------------------------------------------------------------------------
// `sundays.topics_finalized_at` says a member of the bishopric decided what a Sunday's talks are
// ABOUT. The moment somebody changes what they are about, that statement is no longer true and
// nothing else in the app would ever say so — /music would keep reading "ready" over topics that
// had moved, which is precisely the condition the signal exists to report.
//
// The prototype solved this with ONE shared `unfinalizeIfNeeded(key)` called from every handler
// that genuinely changes a day's shape (build note §topics-finalized-readiness). This is that
// helper. One function, three call sites, and a test that reads the SOURCE of those three routes —
// because no assertion about behaviour can see a FOURTH write path that forgot to call it.
//
// ---------------------------------------------------------------------------
// ⚠️ THE RULE IS ABOUT *WHAT* CHANGED, NEVER ABOUT *WHO* MOVED
// ---------------------------------------------------------------------------
// This is the sharpest edge in the slice and the easiest thing to get backwards.
//
// The same build note is explicit that finalizing "never depends on speaker
// confirmation/acceptance, only on the conductor's own explicit click" — which is this ward's
// stated workflow: lay out a whole month of topics FIRST, then go and find people for them.
//
//   A slot's topic set, changed or cleared      un-finalizes
//   `speaking_slots` changed                    un-finalizes — the day's shape changed
//   A new assignment row created                un-finalizes
//   plan -> review -> approve -> request -> …   DOES NOT
//   a speaker accepting or declining            DOES NOT
//   contact state, notify, thank-you            DOES NOT
//
// Get that backwards and a month of finalized topics silently unravels as speakers are contacted,
// one Sunday at a time, with nothing anywhere saying why.
//
// PATCH /api/assignments/[id] carries BOTH KINDS OF CHANGE, which is why topicShapeChanged()
// inspects the PATCH rather than the route inspecting itself.
//
// ---------------------------------------------------------------------------
// SINCE p4-sacrament-c IT CLEARS REFERENCES TOO, AND THE NAME NO LONGER SAYS SO
// ---------------------------------------------------------------------------
// unfinalizeTopicsIfNeeded() clears EVERY stamp that says the day's talks are settled — topics
// and `references_finalized_at` — through clearTalkShapeStamps(). A reference was chosen for a
// topic, so once the topic moves the references are not "ready" either (decided with the user,
// 2026-09-23). A references SKIP survives: "not giving references this round" says nothing about
// what the topics are. The name was kept because three routes and a source-reading test depend
// on it, and a rename is out of that slice's scope.
//
// The explicit topics checkmark still goes through setTopicsFinalized(), which touches topics
// alone — un-finalizing topics BY HAND changes nothing about the references.
//
// SERVER-ONLY. It imports lib/calendar/queries.ts, which reaches next/headers. topicShapeChanged()
// below is pure and is where every rule above is actually tested.

// ---------------------------------------------------------------------------
// PURE, AND EXHAUSTIVELY TESTED — tests/lib/topicsFinalize.test.ts
// ---------------------------------------------------------------------------
// It takes the whole discriminated union rather than just the fields object, so the two
// non-triggering ACTIONS are answered by this function rather than by each caller remembering not
// to call it. `action: "transition"` is every stage move including a decline;
// `action: "waive_contact"` is a fact about how an outside speaker was reached.
//
// `"topicId" in fields` rather than a truthiness check, because CLEARING a topic (`topicId: null`)
// changes the day's shape exactly as much as setting one does — a finalized Sunday with a topic
// removed is not finalized any more. Zod strips unknown keys, so the key is present only when the
// caller actually sent it.
//
// ⚠️ `slotNumber` AND `memberId` ARE DELIBERATELY NON-TRIGGERING, and a later reader will want to
// add them. They do not change WHAT the day is about: moving a topic from slot 2 to slot 3, or
// filling in who gives it, is the second half of the workflow this signal exists to unblock.
// Un-finalizing on those would make the state unreachable in practice — the conductor would
// finalize a month and watch it come undone as they assigned speakers to it.
export function topicShapeChanged(patch: UpdateAssignmentInput): boolean {
  if (patch.action !== "update") return false;

  return "topicId" in patch.fields;
}

// ---------------------------------------------------------------------------
// NEVER THROWS
// ---------------------------------------------------------------------------
// Same contract as stampTopicAssigned() and writeAuditLog(): a readiness signal failing to clear
// must not fail the edit that earned it. The assignment genuinely was changed, and refusing the
// change because a flag could not be cleared would be the tail wagging the dog. It logs with
// context; it does not swallow silently (CLAUDE.md rule 7's two sanctioned exceptions are the
// precedent, and this is the same shape as both).
//
// A null `sundayId` is an ordinary state, not an error: an assignment can outlive the Sunday it
// was planned for, and such a row belongs to no card anywhere. There is nothing to un-finalize.
//
// The read that decides whether to write lives in clearTalkShapeStamps(), which returns early when
// neither stamp is set — so calling this unconditionally on every assignment write
// costs one SELECT in the ordinary case and no UPDATE at all.
//
// ---------------------------------------------------------------------------
// IT RETURNS THE SUNDAY SO A CALLER CAN STOP REPEATING A CLAIM THAT IS NO LONGER TRUE
// ---------------------------------------------------------------------------
// PATCH /api/sundays/[id] read its Sunday BEFORE this ran and answers with it, so without this it
// would hand back a row still reading "finalized" microseconds after the server cleared it —
// ITER-022's two-numbers-one-state failure, in a response body rather than on a card.
//
// NULL MEANS "NOTHING TO REPORT", and it covers every unhappy path at once: no Sunday, a refused
// write, a thrown read. Since this function cannot throw, a caller must treat null as "keep what
// you had" rather than as "it is cleared" — `?? sunday` at the call site. Nothing is asserted
// that was not observed.
export async function unfinalizeTopicsIfNeeded(
  wardId: string,
  sundayId: string | null,
  client?: SupabaseClient<Database>,
): Promise<Sunday | null> {
  if (sundayId === null) return null;

  try {
    return await clearTalkShapeStamps(wardId, sundayId, client);
  } catch (error) {
    console.error("Could not clear a Sunday's finalized stamps", {
      wardId,
      sundayId,
      error,
    });
    return null;
  }
}
