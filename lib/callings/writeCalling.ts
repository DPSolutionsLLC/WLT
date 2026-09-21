import type { SupabaseClient } from "@supabase/supabase-js";
import { CALLING_COLUMNS, toCalling } from "@/lib/callings/queries";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import type { Calling, Role } from "@/types/domain";

// WRITING A CALLING. Every path that used to write `users.role` / `users.org_id` /
// `users.counselor_position` comes through here instead — redeeming an invite, creating a youth
// account, and the admin role change.
//
// ---------------------------------------------------------------------------
// THE SERVICE-ROLE CLIENT, AND WHY RLS IS NOT THE BOUNDARY HERE
// ---------------------------------------------------------------------------
// `ward_role_assignments` has a SELECT policy and NO WRITE POLICIES (migration 068c), exactly as
// `users` has none and `unit_assignments` has none. Two of the three callers create an account
// that has no session of its own, so there is nothing for a policy to scope by; the third is the
// admin role change, which lib/auth/adminUsers.ts already performs through the service client for
// the same reason.
//
// SO assertCan() IN THE ROUTE IS THE EFFECTIVE BOUNDARY FOR EVERY WRITE IN THIS FILE, and that
// check can never be skipped. This is one of the few places in the app where CLAUDE.md rule 2
// does not hold, and it holds for the read path in lib/callings/queries.ts either way.
//
// NO AUDIT ROW IS WRITTEN HERE. The route writes it (conventions.md §Route Handler Shape), the
// same as every other mutation in the app; writing one in both places would double every entry in
// the trail. lib/auth/youthAccounts.ts carries the identical note for the identical reason.

export type CreateCallingParams = {
  userId: string;
  wardId: string;
  role: Role;
  orgId?: string | null;
  counselorPosition?: 1 | 2 | null;
  startedOn?: string | null;
  // Nullable, and it MUST NEVER APPEAR IN A POLICY PREDICATE — the `talks-d` hole, five sightings.
  // It is null for a calling created by a system path with no acting user, such as the first
  // account in a ward.
  createdBy?: string | null;
};

export type UpdateCallingParams = {
  userId: string;
  wardId: string;
  changes: {
    role?: Role;
    orgId?: string | null;
    counselorPosition?: 1 | 2 | null;
    isActive?: boolean;
  };
};

export type EndCallingParams = {
  userId: string;
  wardId: string;
  endedOn?: string | null;
};

function resolveClient(client?: SupabaseClient<Database>): SupabaseClient<Database> {
  return client ?? createServiceSupabaseClient();
}

// CREATE. Refused by `ward_role_assignments_one_per_ward` if the person already holds an active
// calling in this ward — a unique-violation rather than a silent second row, which is the answer
// that keeps current_user_role() single-valued. The caller turns 23505 into a sentence; it is not
// mapped here, because "they already have a calling here" means different things to an invite
// redemption and to an admin screen.
export async function createCalling(
  params: CreateCallingParams,
  client?: SupabaseClient<Database>,
): Promise<Calling> {
  const service = resolveClient(client);

  const { data, error } = await service
    .from("ward_role_assignments")
    .insert({
      user_id: params.userId,
      ward_id: params.wardId,
      role: params.role,
      org_id: params.orgId ?? null,
      counselor_position: params.counselorPosition ?? null,
      started_on: params.startedOn ?? null,
      created_by: params.createdBy ?? null,
    })
    .select(CALLING_COLUMNS)
    .single();

  if (error) {
    console.error(`Could not create the calling — ${error.message}`, {
      userId: params.userId,
      wardId: params.wardId,
      role: params.role,
    });
    throw new Error(`Could not record the calling: ${error.message}`);
  }

  return toCalling(data);
}

// UPDATE THE ACTIVE CALLING IN PLACE, rather than ending one and creating another.
//
// A role change is a correction to the calling somebody already holds, not a second calling: the
// screen that does it is "change this person's role", and leaving a released row behind for every
// correction would fill the history with rows nobody meant to record. Ending and re-creating is
// what endCalling() plus createCalling() is for, and proto-d owns the screen that decides which
// of the two a given action is.
//
// Returns null when the person holds no active calling in that ward — a zero-row UPDATE, which
// the caller reports as "that account is not in your ward" rather than as a fault.
export async function updateCalling(
  params: UpdateCallingParams,
  client?: SupabaseClient<Database>,
): Promise<Calling | null> {
  const service = resolveClient(client);
  const { changes } = params;

  const { data, error } = await service
    .from("ward_role_assignments")
    .update({
      ...(changes.role !== undefined ? { role: changes.role } : {}),
      ...(changes.orgId !== undefined ? { org_id: changes.orgId } : {}),
      ...(changes.counselorPosition !== undefined
        ? { counselor_position: changes.counselorPosition }
        : {}),
      ...(changes.isActive !== undefined ? { is_active: changes.isActive } : {}),
    })
    .eq("user_id", params.userId)
    .eq("ward_id", params.wardId)
    .eq("is_active", true)
    .select(CALLING_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not update the calling — ${error.message}`, {
      userId: params.userId,
      wardId: params.wardId,
    });
    throw new Error(`Could not update the calling: ${error.message}`);
  }

  return data ? toCalling(data) : null;
}

// RELEASE. Never a delete: a calling somebody held is a record of what happened, and the partial
// unique index is on `where is_active` precisely so the released row can stay. `ended_on` is
// record-keeping and drives no arithmetic — `is_active` is what every query reads.
export async function endCalling(
  params: EndCallingParams,
  client?: SupabaseClient<Database>,
): Promise<Calling | null> {
  const service = resolveClient(client);

  const { data, error } = await service
    .from("ward_role_assignments")
    .update({
      is_active: false,
      ended_on: params.endedOn ?? new Date().toISOString().slice(0, 10),
    })
    .eq("user_id", params.userId)
    .eq("ward_id", params.wardId)
    .eq("is_active", true)
    .select(CALLING_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not end the calling — ${error.message}`, {
      userId: params.userId,
      wardId: params.wardId,
    });
    throw new Error(`Could not end the calling: ${error.message}`);
  }

  return data ? toCalling(data) : null;
}

// ---------------------------------------------------------------------------
// THERE IS DELIBERATELY NO setAccountCallingsActive()
// ---------------------------------------------------------------------------
//
// Deactivating an ACCOUNT does not release its CALLINGS, and nothing in this file should make it
// do so. They are two different facts: `users.is_active` answers "may this account be used",
// `ward_role_assignments.is_active` answers "is this calling current", and a bishop whose account
// was switched off is still the bishop.
//
// Nothing is lost by keeping them apart. can_act_in_ward() joins BOTH (migration 070a), so a
// calling on a deactivated account authorizes nothing; lib/auth/session.ts refuses the session
// before any policy is reached; and every notification helper resolves recipients through the
// same join, so a deactivated leader is not notified either.
//
// Making them move together is the thing that cannot be undone: reactivating an account would
// have to revive its callings, and it could not tell one that was switched off with the account
// from one that was genuinely RELEASED. The account would come back holding a calling somebody
// had ended. Migration 068b's header carries the same argument on the backfill.
