import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import {
  ROLES,
  THEME_PREFERENCES,
  type Role,
  type SessionUser,
  type ThemePreference,
} from "@/types/domain";

// The optional client is what makes this testable without mocking next/headers — the same
// shape writeAuditLog, scopedQuery, and emitNotification already use.

// The users.role CHECK constraint (migration 002) already restricts this to ROLES, so an
// unrecognised value means the constraint and the TypeScript union have drifted. Throwing is
// the only safe answer — defaulting to any role would grant permissions nobody chose.
function toRole(value: string): Role {
  if (!(ROLES as readonly string[]).includes(value)) {
    throw new Error(
      `users.role holds "${value}", which is not a known role. The CHECK constraint in ` +
        "migration 002 and ROLES in types/domain.ts have drifted.",
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

  const { data, error } = await supabase
    .from("users")
    .select(
      "id, ward_id, role, org_id, counselor_position, first_name, last_name, username, theme_preference, is_active",
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

  return {
    id: data.id,
    wardId: data.ward_id,
    role: toRole(data.role),
    orgId: data.org_id,
    counselorPosition: toCounselorPosition(data.counselor_position),
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
