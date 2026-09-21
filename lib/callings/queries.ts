import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { ROLES, type Calling, type Role } from "@/types/domain";

// Reads over `ward_role_assignments` (migration 068). Shaped after lib/units/queries.ts: small
// named exports, snake_case → camelCase mapped ONCE, here.
//
// EVERY READ IN THIS FILE IS GOVERNED BY RLS AND NOTHING ELSE (CLAUDE.md rule 2).
// `ward_role_assignments_select` is `ward_id = current_ward_id() or user_id = auth.uid()`;
// nothing here filters for security, and nothing here should start to.
//
// A calling is what current_user_role(), current_org_id() and is_bishopric() read from migration
// 070 on, so a disagreement between this module and those functions is the app and RLS answering
// differently about the same session. That is why lib/auth/session.ts takes the ACTIVE calling
// from session_context() rather than from anything here.

export const CALLING_COLUMNS =
  "id, user_id, ward_id, role, org_id, counselor_position, is_active, started_on, ended_on, created_at";

// A role the TypeScript union does not know means the CHECK constraint in migration 068 and ROLES
// in types/domain.ts have drifted — the same reasoning, and the same refusal to guess, as
// toRole() in lib/auth/session.ts. tests/lib/permissions.test.ts reads all three copies of that
// list from disk so the drift is caught before a row can carry one.
export function toRole(value: string): Role {
  if (!(ROLES as readonly string[]).includes(value)) {
    throw new Error(
      `ward_role_assignments.role holds "${value}", which is not a known role. The CHECK ` +
        "constraint in migration 068 and ROLES in types/domain.ts have drifted.",
    );
  }
  return value as Role;
}

function toCounselorPosition(value: number | null): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

type CallingRow = {
  id: string;
  user_id: string;
  ward_id: string;
  role: string;
  org_id: string | null;
  counselor_position: number | null;
  is_active: boolean;
  started_on: string | null;
  ended_on: string | null;
  created_at: string;
};

export function toCalling(row: CallingRow): Calling {
  return {
    id: row.id,
    userId: row.user_id,
    wardId: row.ward_id,
    role: toRole(row.role),
    orgId: row.org_id,
    counselorPosition: toCounselorPosition(row.counselor_position),
    isActive: row.is_active,
    startedOn: row.started_on,
    endedOn: row.ended_on,
    createdAt: row.created_at,
  };
}

// EVERY CALLING THIS PERSON HOLDS, released ones included. `ward_role_assignments_select` admits
// `user_id = auth.uid()`, so a caller reading their OWN callings sees all of them wherever they
// are; reading somebody else's returns only the ones in the ward the caller is acting in, which
// is an RLS read matching fewer rows rather than an error.
export async function listCallings(
  userId: string,
  client?: SupabaseClient<Database>,
): Promise<Calling[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("ward_role_assignments")
    .select(CALLING_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`Could not read the person's callings — ${error.message}`, { userId });
    throw new Error(`Could not read the callings this person holds: ${error.message}`);
  }

  return (data ?? []).map(toCalling);
}

// THE ONE CALLING A PERSON HOLDS IN A WARD, or null. The partial unique index
// `ward_role_assignments_one_per_ward` is what makes "the one" well defined; without it this
// would have to choose, and current_user_role() could not.
export async function readActiveCalling(
  userId: string,
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<Calling | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("ward_role_assignments")
    .select(CALLING_COLUMNS)
    .eq("user_id", userId)
    .eq("ward_id", wardId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the person's calling in that ward — ${error.message}`, {
      userId,
      wardId,
    });
    throw new Error(`Could not read this person's calling: ${error.message}`);
  }

  return data ? toCalling(data) : null;
}

// THE WARD'S LEADERS — every active calling in one ward. This is what an admin list is built
// from, and it is why the list is no longer "the users whose ward_id is this ward": somebody may
// hold a calling here while their account lives elsewhere, and they are one of this ward's
// leaders exactly as much as anybody else on it.
export async function listWardCallings(
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<Calling[]> {
  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("ward_role_assignments")
    .select(CALLING_COLUMNS)
    .eq("ward_id", wardId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`Could not read the ward's callings — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's callings: ${error.message}`);
  }

  return (data ?? []).map(toCalling);
}

// ---------------------------------------------------------------------------
// DOES THIS PERSON HOLD A CALLING IN THIS WARD? — the membership test that replaces 48 constraints
// ---------------------------------------------------------------------------
//
// ⚠️ READ THIS BEFORE WRITING ANY `user_id` THAT CAME OUT OF A REQUEST BODY.
//
// Migration 069 narrowed every `(user_id, ward_id) -> users (id, ward_id)` foreign key to
// `user_id -> users (id)`, because under the calling model a person can legitimately write in a
// ward their account does not live in. Its header says what is given up — "the database no longer
// proves an author belonged to the ward they wrote in" — and argues that RLS still scopes every
// insert to current_ward_id(), which is the boundary that matters.
//
// THAT ARGUMENT IS SOUND FOR AN AUTHOR AND WRONG FOR A SUBJECT, and the plan for this phase did
// not distinguish the two. An author column is written from `auth.uid()`, so RLS and the session
// already agree about it. A SUBJECT column — `visit_participants.user_id` ("who went"),
// `sundays.conducting_user_id` ("who conducts") — is written from an id the CALLER SUPPLIED, and
// the composite key was the only thing checking it belonged to the ward at all. Narrowing it
// turned a constraint violation into a silently accepted row naming somebody from another ward.
// `tests/routes/visitParticipants.test.ts` caught the first one.
//
// So every path that writes a user id it did not resolve itself calls this first. It is the one
// place that question is answered, rather than each module inventing its own `.eq("ward_id", …)`.
//
// IT ASKS ABOUT THE CALLING, NOT THE ACCOUNT. "Is this person one of this ward's leaders" is
// exactly what `ward_role_assignments` answers, and asking `users.ward_id` instead would refuse
// the cross-ward leader this whole phase exists to support — the same mistake in the opposite
// direction.
//
// Read through the CALLER's client, deliberately: `ward_role_assignments_select` admits the ward
// being acted in, which is the only ward a caller can write to anyway, so RLS stays the boundary
// (CLAUDE.md rule 2) and no definer function is needed.
export async function filterUsersInWard(
  wardId: string,
  userIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const supabase = client ?? (await createServerSupabaseClient());

  const { data, error } = await supabase
    .from("ward_role_assignments")
    .select("user_id")
    .eq("ward_id", wardId)
    .eq("is_active", true)
    .in("user_id", [...new Set(userIds)]);

  if (error) {
    console.error(`Could not check who holds a calling in this ward — ${error.message}`, {
      wardId,
    });
    throw new Error(`Could not check who is in this ward: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => row.user_id));
}

// The refusing half, for a write path that wants a sentence rather than a set. Returns the ids
// that are NOT in the ward, so the caller can name the count without disclosing who — the same
// restraint `youth-h`'s 409 shows about follow-up counts.
export async function findUsersOutsideWard(
  wardId: string,
  userIds: readonly string[],
  client?: SupabaseClient<Database>,
): Promise<string[]> {
  const inWard = await filterUsersInWard(wardId, userIds, client);
  return [...new Set(userIds)].filter((userId) => !inWard.has(userId));
}
