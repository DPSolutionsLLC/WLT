import { randomBytes } from "node:crypto";
import { addDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { CreateInviteInput, RegisterInput } from "@/lib/validation/invite";
import type { Database } from "@/types/database";
import { ROLES, ROLE_LABELS, type Role } from "@/types/domain";

// The invite token is a bearer credential: whoever holds it gets the role it carries. It is
// never logged, never echoed back in an error, and never put in an audit detail object
// (CLAUDE.md rule 8). Every log line in this file identifies an invite by its id instead.

export type InviteRow = Database["public"]["Tables"]["invites"]["Row"];

export const INVITE_EXPIRY_DAYS = 7;

// One answer for "unknown", "already used", and "expired". Telling them apart tells an attacker
// which tokens exist and which are merely stale.
export const INVITE_REFUSED_MESSAGE =
  "This invite link is not valid. It may have expired or already been used. " +
  "Ask a member of the bishopric for a new one.";

export type CreatedInvite = {
  id: string;
  email: string | null;
  role: Role;
  orgId: string | null;
  counselorPosition: 1 | 2 | null;
  expiresAt: string | null;
};

export type CreateInviteResult =
  | { ok: true; invite: CreatedInvite; url: string }
  | { ok: false; message: string };

export type CreateInviteParams = {
  wardId: string;
  invitedBy: string;
  origin: string;
  input: CreateInviteInput;
};

export type InvitePreview = {
  role: Role;
  roleLabel: string;
  email: string | null;
  expiresAt: string | null;
};

export type RedeemInviteResult =
  | { ok: true; userId: string; wardId: string; role: Role; inviteId: string }
  | { ok: false; message: string };

function toCounselorPosition(value: number | null): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

function toRole(value: string | null): Role | null {
  if (value === null) return null;
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : null;
}

async function isOrganizationInWard(
  supabase: SupabaseClient<Database>,
  wardId: string,
  orgId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("organizations")
    .select("id")
    .eq("id", orgId)
    .eq("ward_id", wardId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not verify the organization: ${error.message}`);
  }

  return data !== null;
}

// Inserts through the CALLER's client, not the service client. `invites` is bishopric-only
// under RLS (migration 019), so the policy is the boundary here and going through it is the
// point (CLAUDE.md rule 2).
export async function createInvite(
  params: CreateInviteParams,
  client?: SupabaseClient<Database>,
): Promise<CreateInviteResult> {
  const { wardId, invitedBy, origin, input } = params;
  const supabase = client ?? (await createServerSupabaseClient());

  const orgId = input.orgId ?? null;

  // Checked here so the user reads "That organization is not in your ward" instead of the raw
  // composite-foreign-key violation the database would otherwise raise.
  if (orgId !== null && !(await isOrganizationInWard(supabase, wardId, orgId))) {
    return { ok: false, message: "That organization is not in your ward." };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = addDays(new Date(), INVITE_EXPIRY_DAYS).toISOString();

  const { data, error } = await supabase
    .from("invites")
    .insert({
      ward_id: wardId,
      email: input.email,
      role: input.role,
      org_id: orgId,
      counselor_position: input.counselorPosition ?? null,
      invited_by: invitedBy,
      token,
      expires_at: expiresAt,
    })
    .select("id, email, role, org_id, counselor_position, expires_at")
    .single();

  if (error) {
    console.error("Could not create an invite", {
      wardId,
      invitedBy,
      role: input.role,
      orgId,
      error: error.message,
    });
    throw new Error(`Could not create the invite: ${error.message}`);
  }

  return {
    ok: true,
    invite: {
      id: data.id,
      email: data.email,
      role: input.role,
      orgId: data.org_id,
      counselorPosition: toCounselorPosition(data.counselor_position),
      expiresAt: data.expires_at,
    },
    url: `${origin}/invite/${token}`,
  };
}

// Read-only, for the registration page. Deliberately does NOT claim: opening the link must be
// safe to do twice, and only submitting the form consumes the invite.
export async function readInvitePreview(
  token: string,
  client?: SupabaseClient<Database>,
): Promise<InvitePreview | null> {
  const service = client ?? createServiceSupabaseClient();

  const { data, error } = await service
    .from("invites")
    .select("id, email, role, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("Could not read an invite for display", { error: error.message });
    throw new Error(`Could not read the invite: ${error.message}`);
  }

  if (!data) return null;
  if (data.used_at !== null) return null;
  if (data.expires_at !== null && new Date(data.expires_at) <= new Date()) return null;

  const role = toRole(data.role);
  if (!role) {
    console.error("An invite carries a role the app does not recognise", {
      inviteId: data.id,
    });
    return null;
  }

  return {
    role,
    roleLabel: ROLE_LABELS[role],
    email: data.email,
    expiresAt: data.expires_at,
  };
}

// One conditional UPDATE, which Postgres executes atomically. Zero rows back means the token is
// unknown, already used, or expired — all three answer the same way.
//
// 01-auth-rbac.md describes creating the auth user first and compensating on failure. That
// closes the orphaned-auth-user case but not the race: two people opening the same link at once
// both pass a read-then-check and both get an account. Claiming first closes both, because the
// second UPDATE matches zero rows. This is a deliberate deviation from the phase plan.
export async function claimInvite(
  token: string,
  client?: SupabaseClient<Database>,
): Promise<InviteRow | null> {
  const service = client ?? createServiceSupabaseClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await service
    .from("invites")
    .update({ used_at: nowIso })
    .eq("token", token)
    .is("used_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Could not claim an invite", { error: error.message });
    throw new Error(`Could not claim the invite: ${error.message}`);
  }

  return data ?? null;
}

// Only ever called from redeemInvite's failure paths. A claim that led nowhere must not leave
// the recipient holding a link that now refuses them.
export async function releaseInvite(
  inviteId: string,
  client?: SupabaseClient<Database>,
): Promise<void> {
  const service = client ?? createServiceSupabaseClient();

  const { error } = await service
    .from("invites")
    .update({ used_at: null })
    .eq("id", inviteId);

  if (error) {
    console.error("Could not release a claimed invite", {
      inviteId,
      error: error.message,
    });
  }
}

// Uses the service-role client: the registrant is unauthenticated, `invites` is bishopric-only,
// and there is no INSERT policy on `users` by design. Both facts are documented in
// plans/auth-b-invites-admin.md §Integration Notes.
//
// `input` is a RegisterInput, which has no role and no orgId. Role, organization, counselor
// position, and ward all come off the claimed invite row — the type makes it impossible to read
// them from anywhere else, which is the security control this whole plan turns on.
export async function redeemInvite(
  token: string,
  input: RegisterInput,
  client?: SupabaseClient<Database>,
): Promise<RedeemInviteResult> {
  const service = client ?? createServiceSupabaseClient();

  const invite = await claimInvite(token, service);
  if (!invite) return { ok: false, message: INVITE_REFUSED_MESSAGE };

  const role = toRole(invite.role);
  if (!role) {
    console.error("An invite carries a role the app does not recognise", {
      inviteId: invite.id,
    });
    await releaseInvite(invite.id, service);
    return { ok: false, message: INVITE_REFUSED_MESSAGE };
  }

  if (!invite.email) {
    console.error("An invite has no email, so the account would have no way to sign in", {
      inviteId: invite.id,
    });
    await releaseInvite(invite.id, service);
    return { ok: false, message: INVITE_REFUSED_MESSAGE };
  }

  const { data: created, error: authError } = await service.auth.admin.createUser({
    email: invite.email,
    password: input.password,
    email_confirm: true,
  });

  if (authError || !created?.user) {
    console.error("Could not create the auth user for an invite", {
      inviteId: invite.id,
      error: authError?.message ?? "no user returned",
    });
    await releaseInvite(invite.id, service);
    return {
      ok: false,
      message:
        "Could not create the account. An account may already exist for this email address — " +
        "try signing in instead.",
    };
  }

  const { error: rowError } = await service.from("users").insert({
    id: created.user.id,
    ward_id: invite.ward_id,
    first_name: input.firstName,
    last_name: input.lastName,
    email: invite.email,
    role,
    org_id: invite.org_id,
    counselor_position: invite.counselor_position,
  });

  if (rowError) {
    console.error("Could not create the users row for an invite", {
      inviteId: invite.id,
      error: rowError.message,
    });

    // Both compensations, in this order: delete the auth user so no half-created account is
    // left behind (getSessionUser returns null for one, so it could never sign in), then
    // release the invite so the recipient's link still works.
    const { error: deleteError } = await service.auth.admin.deleteUser(created.user.id);
    if (deleteError) {
      console.error("Could not delete the orphaned auth user after a failed registration", {
        inviteId: invite.id,
        error: deleteError.message,
      });
    }

    await releaseInvite(invite.id, service);

    return {
      ok: false,
      message: "Could not finish setting up the account. Please try the link again.",
    };
  }

  return {
    ok: true,
    userId: created.user.id,
    wardId: invite.ward_id,
    role,
    inviteId: invite.id,
  };
}
