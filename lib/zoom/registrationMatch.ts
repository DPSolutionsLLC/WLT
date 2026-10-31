import type { SupabaseClient } from "@supabase/supabase-js";
import { closeMatchTodos, MATCHED_LINE } from "@/lib/todos/zoomLinks";
import { assertPickableMember } from "@/lib/zoom/invitees";
import type { Database } from "@/types/database";

// MATCH A PUBLIC SIGN-UP TO A ROSTER MEMBER (ITER-052 z3b, plan D3).
//
// The member is checked through the CALLER's client (assertPickableMember: active members only,
// `members` RLS decides what is reachable), then the write is the service role — the tables have no
// write policy, and the route has already passed canManageInvitees(). Every query filters
// `ward_id` (rule 1).
//
// If the sign-up was approved, its invitee gains the same member, so ITER-054's attendance and the
// Invitees list both know who it is. The invitee's `display_name` stays: it is the name the person
// gave, kept as a snapshot. A re-match (the wrong person was picked) is allowed.

type Client = SupabaseClient<Database>;

export type MatchResult =
  | { status: "not_found" }
  | { status: "declined" }
  | { status: "matched"; previousMemberId: boolean; inviteeId: string | null; closedTodoIds: string[] };

// The registration and the invitee were saved; closing the to-dos was not. The route audits the
// match that DID happen and answers 500 with this sentence.
export class MatchTodoCloseError extends Error {
  readonly previousMemberId: boolean;

  constructor(previousMemberId: boolean, cause: unknown) {
    super("They were matched, but the to-dos that go with it could not be closed. Please try again.");
    this.name = "MatchTodoCloseError";
    this.previousMemberId = previousMemberId;
    this.cause = cause;
  }
}

export async function matchRegistration(
  params: { wardId: string; registrationId: string; memberId: string; userId: string },
  callerClient: Client,
  service: Client,
): Promise<MatchResult> {
  await assertPickableMember(callerClient, params.memberId);

  const detail = { wardId: params.wardId, registrationId: params.registrationId };

  const { data: current, error: readError } = await service
    .from("zoom_registrations")
    .select("id, status, member_id, invitee_id")
    .eq("ward_id", params.wardId)
    .eq("id", params.registrationId)
    .maybeSingle();

  if (readError) {
    console.error(`Could not read a Zoom sign-up to match it — ${readError.message}`, detail);
    throw new Error(`Could not read the sign-up: ${readError.message}`);
  }
  if (!current) return { status: "not_found" };
  if (current.status === "declined") return { status: "declined" };

  const now = new Date().toISOString();
  const { error: updateError } = await service
    .from("zoom_registrations")
    .update({ member_id: params.memberId, matched_by: params.userId, matched_at: now, updated_at: now })
    .eq("ward_id", params.wardId)
    .eq("id", params.registrationId);

  if (updateError) {
    console.error(`Could not match a Zoom sign-up — ${updateError.message}`, detail);
    throw new Error(`Could not save the match: ${updateError.message}`);
  }

  if (current.invitee_id) {
    const { error: inviteeError } = await service
      .from("zoom_invitees")
      .update({ member_id: params.memberId, updated_at: now })
      .eq("ward_id", params.wardId)
      .eq("id", current.invitee_id);

    if (inviteeError) {
      console.error(`Could not match a Zoom sign-up's invitee — ${inviteeError.message}`, detail);
      throw new Error(`Could not save the match: ${inviteeError.message}`);
    }
  }

  const previousMemberId = current.member_id !== null;
  let closedTodoIds: string[];
  try {
    closedTodoIds = await closeMatchTodos(
      { wardId: params.wardId, registrationId: params.registrationId, line: MATCHED_LINE },
      service,
    );
  } catch (error) {
    throw new MatchTodoCloseError(previousMemberId, error);
  }

  return { status: "matched", previousMemberId, inviteeId: current.invitee_id, closedTodoIds };
}
