import { randomBytes } from "node:crypto";
import { addDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listWardOrganizations } from "@/lib/auth/adminUsers";
import { describeTarget, unresolvableRefusal, type CallingTarget } from "@/lib/callings/callingReview";
import { deriveCalling, parseLcrCallings } from "@/lib/callings/lcrCallingMap";
import { isMemberLinked, linkByInvite } from "@/lib/callings/memberLinks";
import { createCalling } from "@/lib/callings/writeCalling";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { CreateInviteInput, RegisterInput } from "@/lib/validation/invite";
import type { Database } from "@/types/database";
import { ROLES, ROLE_LABELS, type Role } from "@/types/domain";

// The invite token is a bearer credential: whoever holds it gets the calling it leads to. It is
// never logged, never echoed back in an error, and never put in an audit detail object
// (CLAUDE.md rule 8). Every log line in this file identifies an invite by its id instead.
//
// AN INVITE NAMES A PERSON ON THE WARD LIST, NOT A ROLE (ITER-058 cr4, migration 106). The calling
// is derived from that person's ward list callings through lib/callings/lcrCallingMap.ts — when the
// invite is made, when its page is opened, and again when it is redeemed — so the server is never
// asked for a role at all, and a calling that changed in between is the roster's answer rather than
// the one the invite was sent with. An invite made before cr4 still carries a role and still
// redeems exactly as it did.
//
// ONE LIVE LINK PER PERSON (decided walking scenario 105). Making a new invite cancels the person's
// other waiting ones, so a lost or stale link is replaced rather than joined. The bishopric can read
// the waiting link back on Admin → Users (`readWaitingInvite`), fetched when its window opens and
// never written into the page.
//
// "NO, THIS ISN'T ME" KILLS THE LINK (migration 107). `declineInvite` stamps `declined_at`; the claim
// and the preview both refuse a declined invite, and the sender is told.

export type InviteRow = Database["public"]["Tables"]["invites"]["Row"];

export const INVITE_EXPIRY_DAYS = 7;

// One answer for "unknown", "already used", and "expired". Telling them apart tells an attacker
// which tokens exist and which are merely stale.
export const INVITE_REFUSED_MESSAGE =
  "This invite link is not valid. It may have expired or already been used. " +
  "Ask a member of the bishopric for a new one.";

export const INVITE_CALLING_CHANGED_MESSAGE =
  "Your calling has changed since this invite was sent. Ask for a new invite.";

export const INVITE_IDENTITY_REQUIRED_MESSAGE =
  'Tick "Yes, this is me" to continue. If this is not you, ask the person who invited you.';

export const INVITE_ALREADY_LINKED_MESSAGE =
  "This person already has an account. Ask the person who invited you.";

export type CreatedInvite = {
  id: string;
  email: string | null;
  role: Role;
  orgId: string | null;
  counselorPosition: 1 | 2 | null;
  memberId: string;
  callingLabel: string;
  expiresAt: string | null;
};

export type CreateInviteResult =
  | { ok: true; invite: CreatedInvite; url: string; warning: string | null }
  | { ok: false; message: string };

export type WaitingInvite = {
  url: string;
  email: string | null;
  expiresAt: string | null;
};

export type DeclinedInvite = {
  inviteId: string;
  wardId: string;
  memberId: string;
  email: string | null;
  invitedBy: string | null;
};

export const INVITE_REPLACE_FAILED_WARNING =
  "The new link works, but an older link for this person could not be cancelled. " +
  "Make another new link to try again.";

export type CreateInviteParams = {
  wardId: string;
  invitedBy: string;
  origin: string;
  input: CreateInviteInput;
};

export type InvitePreview =
  | { kind: "member"; memberName: string; callingLabel: string; email: string | null; expiresAt: string | null }
  | { kind: "role"; role: Role; roleLabel: string; email: string | null; expiresAt: string | null }
  | { kind: "calling_changed" };

export type RedeemInviteResult =
  | { ok: true; userId: string; wardId: string; role: Role; inviteId: string; memberId: string | null }
  | { ok: false; message: string };

// What the ward list makes of one person, for an invite.
export type MemberCalling =
  | { ok: true; memberName: string; target: CallingTarget; callingLabel: string }
  | { ok: false; reason: "not_found" | "no_calling"; message: string };

function toCounselorPosition(value: number | null): 1 | 2 | null {
  return value === 1 || value === 2 ? value : null;
}

function toRole(value: string | null): Role | null {
  if (value === null) return null;
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : null;
}

// THE ONE DERIVATION BEHIND AN INVITE: read the person, read the ward's organizations, and ask the
// title map. Called through the CALLER's client when an invite is made (the bishopric reads the
// roster under RLS) and through the service client when one is opened or redeemed (the registrant
// has no session). Every query filters on `ward_id`, because the service role would otherwise read
// every ward.
export async function deriveMemberCalling(
  wardId: string,
  memberId: string,
  client: SupabaseClient<Database>,
): Promise<MemberCalling> {
  const { data: member, error } = await client
    .from("members")
    .select("id, first_name, last_name, status, callings")
    .eq("id", memberId)
    .eq("ward_id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the person an invite names — ${error.message}`, { wardId, memberId });
    throw new Error(`Could not read the person: ${error.message}`);
  }

  if (!member || member.status !== "active") {
    return {
      ok: false,
      reason: "not_found",
      message: "That person is not an active member of this ward's list.",
    };
  }

  const memberName = [member.first_name, member.last_name].filter(Boolean).join(" ") || "This person";
  const organizations = await listWardOrganizations(wardId, client);
  const derived = deriveCalling(
    parseLcrCallings(member.callings),
    organizations.map(({ id, type }) => ({ id, type })),
  );

  if (derived.kind === "none") {
    return {
      ok: false,
      reason: "no_calling",
      message: `${memberName} holds no calling the app recognises, so there is nothing to invite them to.`,
    };
  }

  if (derived.kind === "unresolvable") {
    return { ok: false, reason: "no_calling", message: unresolvableRefusal(derived) };
  }

  const target: CallingTarget = {
    role: derived.role,
    orgId: derived.orgId,
    counselorPosition: derived.counselorPosition,
  };
  const organizationNames = new Map(organizations.map((organization) => [organization.id, organization.name]));

  return { ok: true, memberName, target, callingLabel: describeTarget(target, organizationNames) };
}

// Inserts through the CALLER's client, not the service client. `invites` is bishopric-only
// under RLS (migration 019), so the policy is the boundary here and going through it is the
// point (CLAUDE.md rule 2).
//
// The row stores the PERSON and no role: nothing downstream may trust a role written at this
// moment, because the roster can change before the link is opened (cr4).
export async function createInvite(
  params: CreateInviteParams,
  client?: SupabaseClient<Database>,
): Promise<CreateInviteResult> {
  const { wardId, invitedBy, origin, input } = params;
  const supabase = client ?? (await createServerSupabaseClient());

  const calling = await deriveMemberCalling(wardId, input.memberId, supabase);
  if (!calling.ok) return { ok: false, message: calling.message };

  // Read on the service role: `user_member_links` is bishopric-readable, but the answer must not
  // depend on who is asking, and the route's gate has already run.
  if (await isMemberLinked(input.memberId, createServiceSupabaseClient())) {
    return {
      ok: false,
      message: `${calling.memberName} already has an account linked to the ward list. They can sign in as they are.`,
    };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = addDays(new Date(), INVITE_EXPIRY_DAYS).toISOString();

  const { data, error } = await supabase
    .from("invites")
    .insert({
      ward_id: wardId,
      email: input.email,
      member_id: input.memberId,
      role: null,
      org_id: null,
      counselor_position: null,
      invited_by: invitedBy,
      token,
      expires_at: expiresAt,
    })
    .select("id, email, expires_at")
    .single();

  if (error) {
    console.error("Could not create an invite", {
      wardId,
      invitedBy,
      memberId: input.memberId,
      error: error.message,
    });
    throw new Error(`Could not create the invite: ${error.message}`);
  }

  const replaced = await cancelOtherInvites(wardId, input.memberId, data.id, supabase);

  return {
    ok: true,
    warning: replaced ? null : INVITE_REPLACE_FAILED_WARNING,
    invite: {
      id: data.id,
      email: data.email,
      role: calling.target.role,
      orgId: calling.target.orgId,
      counselorPosition: calling.target.counselorPosition,
      memberId: input.memberId,
      callingLabel: calling.callingLabel,
      expiresAt: data.expires_at,
    },
    url: `${origin}/invite/${token}`,
  };
}

// Expires the person's other waiting invites, through the caller's client (019's bishopric UPDATE
// policy). Runs AFTER the new invite is saved, so a failure here leaves two working links — which the
// sender is told about — rather than none. Returns false on failure; never throws, because the invite
// the caller asked for exists either way.
async function cancelOtherInvites(
  wardId: string,
  memberId: string,
  keepInviteId: string,
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("invites")
    .update({ expires_at: nowIso })
    .eq("ward_id", wardId)
    .eq("member_id", memberId)
    .neq("id", keepInviteId)
    .is("used_at", null)
    .is("declined_at", null)
    .gt("expires_at", nowIso);

  if (error) {
    console.error("Could not cancel a person's older invites", {
      wardId,
      memberId,
      keepInviteId,
      error: error.message,
    });
    return false;
  }
  return true;
}

// The person's newest usable invite, for the bishopric to copy again. Read through the CALLER's
// client: `invites` is bishopric-only, so the policy is the boundary (rule 2). The token leaves the
// server only inside the URL this returns, to a caller the route has already checked.
export async function readWaitingInvite(
  wardId: string,
  memberId: string,
  origin: string,
  client?: SupabaseClient<Database>,
): Promise<WaitingInvite | null> {
  const supabase = client ?? (await createServerSupabaseClient());
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("invites")
    .select("id, email, token, expires_at")
    .eq("ward_id", wardId)
    .eq("member_id", memberId)
    .is("used_at", null)
    .is("declined_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Could not read a person's waiting invite", { wardId, memberId, error: error.message });
    throw new Error(`Could not read the waiting invite: ${error.message}`);
  }

  if (!data) return null;
  return { url: `${origin}/invite/${data.token}`, email: data.email, expiresAt: data.expires_at };
}

// "No, this isn't me". One conditional UPDATE on the service role (the person has no session), so
// only a link that is still usable can be declined, and declining twice answers the same as an
// unknown token. Only a PERSON invite can be declined: an invite made before cr4 names nobody.
export async function declineInvite(
  token: string,
  client?: SupabaseClient<Database>,
): Promise<DeclinedInvite | null> {
  const service = client ?? createServiceSupabaseClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await service
    .from("invites")
    .update({ declined_at: nowIso })
    .eq("token", token)
    .not("member_id", "is", null)
    .is("used_at", null)
    .is("declined_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .select("id, ward_id, member_id, email, invited_by")
    .maybeSingle();

  if (error) {
    console.error("Could not decline an invite", { error: error.message });
    throw new Error(`Could not decline the invite: ${error.message}`);
  }

  if (!data || data.member_id === null) return null;
  return {
    inviteId: data.id,
    wardId: data.ward_id,
    memberId: data.member_id,
    email: data.email,
    invitedBy: data.invited_by,
  };
}

// Read-only, for the registration page. Deliberately does NOT claim: opening the link must be
// safe to do twice, and only submitting the form consumes the invite.
//
// A person invite is re-derived here, so the page names the calling the roster gives TODAY — the
// one redemption will create — and says so plainly when there is none any more.
export async function readInvitePreview(
  token: string,
  client?: SupabaseClient<Database>,
): Promise<InvitePreview | null> {
  const service = client ?? createServiceSupabaseClient();

  const { data, error } = await service
    .from("invites")
    .select("id, ward_id, email, role, member_id, expires_at, used_at, declined_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("Could not read an invite for display", { error: error.message });
    throw new Error(`Could not read the invite: ${error.message}`);
  }

  if (!data) return null;
  if (data.used_at !== null) return null;
  if (data.declined_at !== null) return null;
  if (data.expires_at !== null && new Date(data.expires_at) <= new Date()) return null;

  if (data.member_id !== null) {
    const calling = await deriveMemberCalling(data.ward_id, data.member_id, service);
    if (!calling.ok) return { kind: "calling_changed" };
    return {
      kind: "member",
      memberName: calling.memberName,
      callingLabel: calling.callingLabel,
      email: data.email,
      expiresAt: data.expires_at,
    };
  }

  const role = toRole(data.role);
  if (!role) {
    console.error("An invite carries a role the app does not recognise", {
      inviteId: data.id,
    });
    return null;
  }

  return {
    kind: "role",
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
    .is("declined_at", null)
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

type InviteCalling =
  | { ok: true; target: CallingTarget; memberId: string | null }
  | { ok: false; message: string };

// What calling a claimed invite leads to. A person invite asks the roster AS IT IS NOW; an invite
// made before cr4 still reads the role off its own row.
async function resolveInviteCalling(
  invite: InviteRow,
  service: SupabaseClient<Database>,
): Promise<InviteCalling> {
  if (invite.member_id !== null) {
    const calling = await deriveMemberCalling(invite.ward_id, invite.member_id, service);
    if (!calling.ok) return { ok: false, message: INVITE_CALLING_CHANGED_MESSAGE };
    if (await isMemberLinked(invite.member_id, service)) {
      return { ok: false, message: INVITE_ALREADY_LINKED_MESSAGE };
    }
    return { ok: true, target: calling.target, memberId: invite.member_id };
  }

  const role = toRole(invite.role);
  if (!role) {
    console.error("An invite carries a role the app does not recognise", {
      inviteId: invite.id,
    });
    return { ok: false, message: INVITE_REFUSED_MESSAGE };
  }

  return {
    ok: true,
    target: {
      role,
      orgId: invite.org_id,
      counselorPosition: toCounselorPosition(invite.counselor_position),
    },
    memberId: null,
  };
}

// Uses the service-role client: the registrant is unauthenticated, `invites` is bishopric-only,
// and there is no INSERT policy on `users` by design. Both facts are documented in
// plans/auth-b-invites-admin.md §Integration Notes.
//
// `input` is a RegisterInput, which has no role and no orgId. Role, organization, counselor
// position, and ward all come off the claimed invite row or the roster person it names — the type
// makes it impossible to read them from anywhere else, which is the security control this whole
// plan turns on.
export async function redeemInvite(
  token: string,
  input: RegisterInput,
  client?: SupabaseClient<Database>,
): Promise<RedeemInviteResult> {
  const service = client ?? createServiceSupabaseClient();

  const invite = await claimInvite(token, service);
  if (!invite) return { ok: false, message: INVITE_REFUSED_MESSAGE };

  // "Yes, this is me" (cr4). Checked after the claim so it is asked only of a valid link, and the
  // claim is released so the person can tick it and try again.
  if (invite.member_id !== null && input.confirmedIdentity !== true) {
    await releaseInvite(invite.id, service);
    return { ok: false, message: INVITE_IDENTITY_REQUIRED_MESSAGE };
  }

  // BEFORE THE AUTH USER EXISTS: a calling the roster no longer gives, or a person somebody else has
  // since claimed, is refused with nothing to undo.
  const calling = await resolveInviteCalling(invite, service);
  if (!calling.ok) {
    await releaseInvite(invite.id, service);
    return { ok: false, message: calling.message };
  }
  const { target } = calling;

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

  // Both compensations, in this order: delete the auth user so no half-created account is left
  // behind (getSessionUser returns null for one, so it could never sign in), then release the
  // invite so the recipient's link still works.
  //
  // Extracted because there are now THREE writes that can fail — the account, its calling and its
  // ward list link — and any one missing leaves half an account. Deleting the auth user cascades
  // the `users` row, and through it the calling and the link (migrations 002, 068 and 105).
  const undoRegistration = async (reason: string): Promise<void> => {
    console.error(reason, { inviteId: invite.id });

    const { error: deleteError } = await service.auth.admin.deleteUser(created.user.id);
    if (deleteError) {
      console.error("Could not delete the orphaned auth user after a failed registration", {
        inviteId: invite.id,
        error: deleteError.message,
      });
    }

    await releaseInvite(invite.id, service);
  };

  const unfinished = {
    ok: false as const,
    message: "Could not finish setting up the account. Please try the link again.",
  };

  // THE CALLING FACTS ARE NOT WRITTEN HERE. `role`, `org_id` and `counselor_position` belong to
  // the calling this redemption creates (migration 068), and migration 071 drops all three
  // columns — so naming one here is a 400 on every registration the moment it applies. Migration
  // 068d dropped NOT NULL off `users.role` precisely so this insert can stop writing it while the
  // column is still there, which is the window between the deploy and 071.
  const { error: rowError } = await service.from("users").insert({
    id: created.user.id,
    ward_id: invite.ward_id,
    first_name: input.firstName,
    last_name: input.lastName,
    email: invite.email,
  });

  if (rowError) {
    await undoRegistration(
      `Could not create the users row for an invite — ${rowError.message}`,
    );
    return unfinished;
  }

  // THE CALLING. A person invite's calling is the roster's (`source: 'roster'`); an invite made
  // before cr4 is the one the sender typed (`manual`). `input` still cannot supply any of it.
  //
  // `created_by` is the person who SENT the invite, and it is nullable: `invites.invited_by` may
  // be null for the first account in a ward. It must never appear in a policy predicate
  // (`talks-d`), and migration 068c's policy does not mention it.
  try {
    await createCalling(
      {
        userId: created.user.id,
        wardId: invite.ward_id,
        role: target.role,
        orgId: target.orgId,
        counselorPosition: target.counselorPosition,
        createdBy: invite.invited_by,
        source: calling.memberId === null ? "manual" : "roster",
      },
      service,
    );
  } catch (callingError) {
    await undoRegistration(
      `Could not create the calling for an invite — ${
        callingError instanceof Error ? callingError.message : String(callingError)
      }`,
    );
    return unfinished;
  }

  // THE LINK. Without it the new account's calling would be roster-sourced but unlinked, and the
  // Calling review would never look at it again.
  if (calling.memberId !== null) {
    try {
      const linked = await linkByInvite(
        {
          userId: created.user.id,
          wardId: invite.ward_id,
          memberId: calling.memberId,
          invitedBy: invite.invited_by,
        },
        service,
      );
      if (!linked.ok) {
        await undoRegistration(`Could not link the new account to the ward list — ${linked.message}`);
        return { ok: false, message: INVITE_ALREADY_LINKED_MESSAGE };
      }
    } catch (linkError) {
      await undoRegistration(
        `Could not link the new account to the ward list — ${
          linkError instanceof Error ? linkError.message : String(linkError)
        }`,
      );
      return unfinished;
    }
  }

  return {
    ok: true,
    userId: created.user.id,
    wardId: invite.ward_id,
    role: target.role,
    inviteId: invite.id,
    memberId: calling.memberId,
  };
}
