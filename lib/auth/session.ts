import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import {
  ORGANIZATION_TYPES,
  ROLES,
  THEME_PREFERENCES,
  type OrganizationType,
  type Role,
  type SessionUser,
  type ThemePreference,
} from "@/types/domain";

// The optional client is what makes this testable without mocking next/headers — the same
// shape writeAuditLog, scopedQuery, and emitNotification already use.

// The ward_role_assignments.role CHECK constraint (migration 068) already restricts this to
// ROLES, so an unrecognised value means the constraint and the TypeScript union have drifted.
// Throwing is the only safe answer — defaulting to any role would grant permissions nobody chose.
function toRole(value: string): Role {
  if (!(ROLES as readonly string[]).includes(value)) {
    throw new Error(
      `A calling holds the role "${value}", which the app does not know. The CHECK constraint in ` +
        "migration 068 and ROLES in types/domain.ts have drifted.",
    );
  }
  return value as Role;
}

// Unlike role, an unexpected theme is cosmetic — "system" is the column default and the safe
// answer, so this falls back rather than failing the request.
function toThemePreference(value: string): ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : "system";
}

function toCounselorPosition(value: number | null): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

// THROWS like toRole, and for the same reason rather than by analogy: from P2 on this value
// DECIDES PERMISSIONS (an org_president in Young Women may manage youth activities, one in
// Sunday School may not), so an unrecognised type must never fall back to a default that grants
// something nobody chose. The organizations.type CHECK in migration 002 already restricts it to
// ORGANIZATION_TYPES, so a value outside that list means the constraint and the union drifted.
//
// Null is not an error — it is a calling with no organization, which a bishop, a ward secretary
// and a ward_council_member all legitimately are.
function toOrganizationType(value: string | null): OrganizationType | null {
  if (value === null) return null;
  if (!(ORGANIZATION_TYPES as readonly string[]).includes(value)) {
    throw new Error(
      `A calling's organization has the type "${value}", which the app does not know. The CHECK ` +
        "constraint in migration 002 and ORGANIZATION_TYPES in types/domain.ts have drifted.",
    );
  }
  return value as OrganizationType;
}

async function resolveSessionUser(
  client?: SupabaseClient<Database>,
): Promise<SessionUser | null> {
  const supabase = client ?? (await createServerSupabaseClient());

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  // AuthSessionMissingError is the ordinary signed-out case, not a fault. Every other auth
  // error also means "no usable session", so all of them resolve to null rather than throwing.
  if (authError || !user) return null;

  // THE CALLING FACTS ARE NOT SELECTED HERE AND MUST NOT BE. `role`, `org_id` and
  // `counselor_position` belong to the CALLING IN THE WARD BEING ACTED IN, which session_context()
  // answers from the same place RLS reads it from (migration 070e). Reading them off this row
  // would be the app and RLS disagreeing about what role a session holds — and migration 071
  // drops the three columns outright, so a select naming one is a 400 on every page.
  //
  // `ward_id` is still selected and is deliberately NOT the one returned below: it is the HOME
  // ward, and session_context() answers the effective one. If you find yourself reaching for
  // `data.ward_id`, that is the bug this whole design exists to prevent.
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, ward_id, first_name, last_name, username, theme_preference, is_active",
    )
    .eq("id", user.id)
    .maybeSingle();

  // A database failure is not the same as "signed out". Returning null here would bounce a
  // signed-in user to /login with no explanation and no trace.
  if (error) {
    console.error("Could not read the session user's row", {
      userId: user.id,
      error: error.message,
    });
    throw new Error(`Could not resolve the signed-in user: ${error.message}`);
  }

  // An auth.users row with no public.users row is a half-created account. auth-b's
  // compensating delete is what prevents one from existing.
  if (!data) return null;

  // Deactivation is enforced here rather than by revoking the token: the server does not hold
  // the user's JWT, and is_active arrives on the same row as the role at no extra cost.
  if (!data.is_active) return null;

  // THE EFFECTIVE WARD AND THE CALLING ARE READ FROM THE DATABASE, NEVER RECOMPUTED HERE.
  //
  // current_ward_id() re-validates the switch on every read (migration 070b) — somebody released
  // from their second calling falls back to their home ward the moment that row stops being
  // active. If this function did `active_ward_id ?? ward_id` instead, the app and RLS would
  // disagree about which ward the session is in: the page frame would name ward B while every
  // query returned ward A's rows, and every audit row would be filed under the wrong ward.
  //
  // The ROLE comes from the same round trip for the same reason. It belongs to the calling in the
  // ward being acted in, not to the person (migration 070b reverses 066 on exactly this), so
  // reading it anywhere else is the app answering a different question from every policy.
  // ONE ROUND TRIP, ONE ANSWER, BOTH SIDES AGREE. getSessionUser is wrapped in cache(), so it is
  // one query per request.
  const { data: contextRows, error: contextError } = await supabase.rpc("session_context");

  // THROWS RATHER THAN FALLING BACK TO data.ward_id, deliberately. A silent fall back is exactly
  // the app-and-RLS disagreement this design exists to prevent, and it would be invisible
  // (CLAUDE.md rule 7). The `users` read above throws for the same reason.
  if (contextError) {
    console.error("Could not read the session context", {
      userId: user.id,
      error: contextError.message,
    });
    throw new Error(
      `Could not resolve the ward this session is acting in: ${contextError.message}`,
    );
  }

  const context = contextRows?.[0];
  if (!context) {
    throw new Error(
      `session_context() returned no row for ${user.id}, although their users row was read. ` +
        "Check that migration 070 has been applied.",
    );
  }

  // NO CALLING IN THE WARD THIS SESSION RESOLVED TO. session_context() LEFT JOINs deliberately, so
  // this arrives as a row with a null role rather than as no row at all — "no row" would read as
  // a half-created account and bounce the user to /login with nothing said.
  //
  // It should be unreachable: migration 068's backfill gave every account a calling in its home
  // ward, current_ward_id() falls back to that ward, and every path that creates an account
  // creates a calling with it. So this is a real fault rather than a state to render, and it
  // throws with a sentence naming the cause (CLAUDE.md rule 7) rather than defaulting to a role
  // nobody chose.
  if (!context.role || !context.calling_id) {
    console.error("A session resolved to a ward the user holds no active calling in", {
      userId: user.id,
      wardId: context.ward_id,
    });
    throw new Error(
      `${user.id} holds no active calling in ward ${context.ward_id}, so this session has no ` +
        "role. Check ward_role_assignments for this account.",
    );
  }

  // `?? null` on active_ward_id and org_id is NOT redundant, whatever the generated type says.
  // `supabase gen types` declares every column of a table-returning function as non-nullable
  // because Postgres does not record nullability for a RETURNS TABLE signature. Both of these are
  // genuinely null most of the time — active_ward_id for anybody who has not switched, org_id for
  // any calling without an organization — so the normalisation is what keeps `undefined` and a
  // nullable column from meeting somewhere further downstream.
  return {
    id: data.id,
    wardId: context.ward_id,
    homeWardId: context.home_ward_id,
    activeWardId: context.active_ward_id ?? null,
    callingId: context.calling_id,
    // THE CALLING'S role, org and counselor position — all three from the same round trip as the
    // ward, so none of them can disagree with what RLS reads (migration 070e).
    role: toRole(context.role),
    orgId: context.org_id ?? null,
    orgType: toOrganizationType(context.org_type ?? null),
    counselorPosition: toCounselorPosition(context.counselor_position ?? null),
    firstName: data.first_name,
    lastName: data.last_name,
    username: data.username,
    themePreference: toThemePreference(data.theme_preference),
    isActive: data.is_active,
  };
}

// cache() dedupes the query across one request, so a page rendering ten components issues one
// read. It only wraps the no-argument path; a test passing its own client calls through
// uncached, which is what keeps fixtures from leaking between assertions.
export const getSessionUser = cache(
  async (client?: SupabaseClient<Database>): Promise<SessionUser | null> =>
    resolveSessionUser(client),
);

// redirect() works by throwing an internal Next.js error. Never call this inside a try/catch
// that swallows — the redirect would be caught and the caller would carry on unauthenticated.
export async function requireSessionUser(
  client?: SupabaseClient<Database>,
): Promise<SessionUser> {
  const user = await getSessionUser(client);
  if (!user) redirect("/login");
  return user;
}
