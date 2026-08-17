import type { SupabaseClient } from "@supabase/supabase-js";
import { clearAttempts } from "@/lib/auth/pinLockout";
import { syntheticYouthEmail } from "@/lib/auth/syntheticYouthEmail";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { CreateYouthAccountInput } from "@/lib/validation/youthAccount";
import type { Database } from "@/types/database";

// The PIN is a credential. It is never returned by anything in this file, never logged, and
// never put in an audit detail object (CLAUDE.md rule 8). It travels in exactly one direction:
// from the request body into Supabase Auth, which hashes it. There is no column holding it and
// no way to read it back — migration 021 dropped users.pin_hash for that reason.

export { syntheticYouthEmail };

// Always sacrament_manager. Set here rather than accepted from the body, the same control as
// the invite flow in auth-b (FEATURES.md §Module 17).
const YOUTH_ROLE = "sacrament_manager";

const USERNAME_TAKEN_MESSAGE = "That username is already taken in this ward.";
const UNIQUE_VIOLATION = "23505";

export type YouthAccount = {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
};

export type CreateYouthAccountResult =
  | { ok: true; account: YouthAccount }
  | { ok: false; message: string };

export type CreateYouthAccountParams = {
  wardId: string;
  actingUserId: string;
  input: CreateYouthAccountInput;
};

export type ResetYouthPinResult =
  | { ok: true; account: YouthAccount }
  | { ok: false; message: string };

export type ResetYouthPinParams = {
  wardId: string;
  actingUserId: string;
  targetUserId: string;
  pin: string;
};

async function isUsernameTaken(
  supabase: SupabaseClient<Database>,
  wardId: string,
  username: string,
): Promise<boolean> {
  // Matched with eq() rather than ilike(): usernameSchema lower-cases at every write path, and
  // the username charset includes `_`, which ilike would treat as a single-character wildcard
  // and quietly match the wrong row. A row that somehow escaped the lower-casing is still
  // caught by users_username_key, whose violation is translated below.
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("ward_id", wardId)
    .eq("username", username)
    .maybeSingle();

  if (error) {
    console.error(`Could not check whether a username is free — ${error.message}`, {
      wardId,
    });
    throw new Error(`Could not check the username: ${error.message}`);
  }

  return data !== null;
}

// Uses the service-role client throughout. `users` has no INSERT policy by design, and the
// account being created has no session of its own — the same reasoning as redeemInvite() in
// lib/auth/invites.ts. assertCan() in the route is therefore the effective boundary here, so
// that check can never be skipped.
export async function createYouthAccount(
  params: CreateYouthAccountParams,
  client?: SupabaseClient<Database>,
): Promise<CreateYouthAccountResult> {
  const { wardId, actingUserId, input } = params;
  const service = client ?? createServiceSupabaseClient();

  // Checked before touching Auth so the bishopric reads a plain sentence instead of a unique
  // constraint violation, and so no auth user is created for a name that cannot be used.
  if (await isUsernameTaken(service, wardId, input.username)) {
    return { ok: false, message: USERNAME_TAKEN_MESSAGE };
  }

  const email = syntheticYouthEmail(input.username, wardId);

  // email_confirm: true matters. There is no inbox to confirm from, and an unconfirmed account
  // cannot sign in — the youth would be stuck with no way for anyone to unstick them.
  const { data: created, error: authError } = await service.auth.admin.createUser({
    email,
    password: input.pin,
    email_confirm: true,
  });

  if (authError || !created?.user) {
    console.error(
      `Could not create the auth user for a youth account — ${authError?.message ?? "no user returned"}`,
      { wardId, actingUserId, username: input.username },
    );
    return {
      ok: false,
      message: "Could not create the account. Please try again.",
    };
  }

  // `email` stays null. The synthetic address lives in auth.users only; a .invalid address in
  // public.users would show up in the admin list as though it were a real one.
  const { error: rowError } = await service.from("users").insert({
    id: created.user.id,
    ward_id: wardId,
    first_name: input.firstName,
    last_name: input.lastName,
    email: null,
    username: input.username,
    role: YOUTH_ROLE,
  });

  if (rowError) {
    console.error(
      `Could not create the users row for a youth account — ${rowError.message}`,
      { wardId, actingUserId, username: input.username },
    );

    // The same compensation as redeemInvite(): delete the auth user so no half-created account
    // is left behind. getSessionUser() returns null for one, so it could never sign in, but it
    // would permanently occupy the synthetic address and block a retry with the same username.
    const { error: deleteError } = await service.auth.admin.deleteUser(created.user.id);
    if (deleteError) {
      console.error(
        `Could not delete the orphaned auth user after a failed youth account creation — ${deleteError.message}`,
        { wardId, username: input.username },
      );
    }

    if (rowError.code === UNIQUE_VIOLATION) {
      return { ok: false, message: USERNAME_TAKEN_MESSAGE };
    }

    return {
      ok: false,
      message: "Could not finish setting up the account. Please try again.",
    };
  }

  return {
    ok: true,
    account: {
      id: created.user.id,
      username: input.username,
      firstName: input.firstName,
      lastName: input.lastName,
    },
  };
}

// No audit row is written here. The route writes it (conventions.md §Route Handler Shape), the
// same as every other mutation in the app; writing one in both places would double every entry
// in the trail.
export async function resetYouthPin(
  params: ResetYouthPinParams,
  client?: SupabaseClient<Database>,
): Promise<ResetYouthPinResult> {
  const { wardId, actingUserId, targetUserId, pin } = params;
  const service = client ?? createServiceSupabaseClient();

  const { data: target, error: readError } = await service
    .from("users")
    .select("id, username, first_name, last_name")
    .eq("id", targetUserId)
    .eq("ward_id", wardId)
    .maybeSingle();

  if (readError) {
    console.error(`Could not read the youth account to reset — ${readError.message}`, {
      wardId,
      actingUserId,
      targetUserId,
    });
    throw new Error(`Could not read the account: ${readError.message}`);
  }

  if (!target) {
    return { ok: false, message: "That account is not in your ward." };
  }

  // An account with no username has no PIN sign-in to reset — it is an email account, and
  // resetting its password here would bypass the reset-email flow entirely.
  if (!target.username) {
    return { ok: false, message: "That account does not sign in with a PIN." };
  }

  const { error: updateError } = await service.auth.admin.updateUserById(targetUserId, {
    password: pin,
  });

  if (updateError) {
    console.error(`Could not set a new PIN — ${updateError.message}`, {
      wardId,
      actingUserId,
      targetUserId,
    });

    // Supabase Auth is asymmetric here: admin.createUser accepts a password of any length,
    // but admin.updateUserById enforces the project's minimum. So a PIN that was fine at
    // creation can be refused at reset, and "Please try again" would be advice that can never
    // work. Its 422 message names the actual rule and contains no PIN, so it is passed
    // through rather than replaced.
    if (updateError.status === 422) {
      return { ok: false, message: updateError.message };
    }

    return { ok: false, message: "Could not set the new PIN. Please try again." };
  }

  // A reset is how the bishopric unblocks someone who is locked out, so it clears the lock
  // rather than leaving them waiting out a window with a PIN that now works.
  await clearAttempts(wardId, target.username, service);

  return {
    ok: true,
    account: {
      id: target.id,
      username: target.username,
      firstName: target.first_name,
      lastName: target.last_name,
    },
  };
}

export type YouthAccountListEntry = YouthAccount & {
  isActive: boolean;
  createdAt: string;
};

// Reads through the CALLER's client: the ward-scoped SELECT policy from migration 020 already
// scopes this correctly, and going through RLS is the point (CLAUDE.md rule 2).
export async function listYouthAccounts(
  wardId: string,
  client: SupabaseClient<Database>,
): Promise<YouthAccountListEntry[]> {
  const { data, error } = await client
    .from("users")
    .select("id, username, first_name, last_name, is_active, created_at")
    .eq("ward_id", wardId)
    .eq("role", YOUTH_ROLE)
    .not("username", "is", null)
    .order("username");

  if (error) {
    console.error(`Could not read the ward's youth accounts — ${error.message}`, {
      wardId,
    });
    throw new Error(`Could not read the ward's youth accounts: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    username: row.username as string,
    firstName: row.first_name,
    lastName: row.last_name,
    isActive: row.is_active,
    createdAt: row.created_at,
  }));
}
