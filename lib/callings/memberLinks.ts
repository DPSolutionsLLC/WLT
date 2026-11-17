import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";
import {
  MEMBER_LINK_METHODS,
  MEMBER_LINK_STATUSES,
  type MemberLink,
  type MemberLinkMethod,
  type MemberLinkStatus,
} from "@/types/domain";

// WHICH ROSTER MEMBER AN APP ACCOUNT IS (ITER-058 cr1, migration 105a).
//
// ---------------------------------------------------------------------------
// THE SERVICE-ROLE CLIENT, AND WHY RLS IS NOT THE BOUNDARY HERE
// ---------------------------------------------------------------------------
// `user_member_links` has a SELECT policy and NO WRITE POLICY. A link decides privileges — from cr2
// on, a linked account's calling follows the roster calling of the member it names — so a link a
// user could write themselves is a privilege escalation. Every write is here, on the service role,
// behind the routes' checks (`admin.manage_users` AND a bishopric calling or super admin, for the
// admin paths). tests/lib/callingWriteSites.test.ts keeps this the only writer.
//
// NOBODY LINKS THEIR OWN ACCOUNT EXCEPT THROUGH THE EMAIL MATCH (P3), the super admin included.
// The email match is safe because the roster email arrives through the LCR paste (an admin act)
// and the login email is the one Supabase Auth holds. Anything else is a REQUEST the bishopric
// decides, and the requester never browses the roster or picks a record (P4).
//
// NO AUDIT ROW AND NO NOTIFICATION HERE. The route writes both (conventions.md §Route Handler
// Shape), as lib/callings/writeCalling.ts says for the same reason.
//
// Every function returns a typed result. A unique violation (23505) is a sentence, never a 500.

const LINK_COLUMNS =
  "id, user_id, ward_id, member_id, status, method, requested_at, decided_at, ended_at, created_at";

const OPEN_STATUSES: MemberLinkStatus[] = ["pending", "active"];

export const MEMBER_ALREADY_LINKED_MESSAGE =
  "This roster record is already linked to another account. Ask your bishopric.";
export function memberLinkedElsewhereMessage(memberName: string): string {
  return `${memberName} is already linked to another account. Unlink them first.`;
}
export const ACCOUNT_ALREADY_LINKED_MESSAGE =
  "That account is already linked to someone on the ward list.";
export const SELF_LINK_MESSAGE =
  "You can't link your own account. Another member of the bishopric needs to do it.";
export const EMAIL_MATCH_GONE_MESSAGE =
  "That roster record no longer matches your email. Ask the bishopric to link you instead.";
export const MEMBER_NOT_LINKABLE_MESSAGE =
  "That person is not an active member of this ward's list.";

type LinkRow = {
  id: string;
  user_id: string;
  ward_id: string;
  member_id: string | null;
  status: string;
  method: string | null;
  requested_at: string | null;
  decided_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type LinkResult =
  | { ok: true; link: MemberLink }
  | { ok: false; status: 400 | 403 | 404 | 409; message: string };

export type EmailCandidate = { memberId: string; displayName: string; birthYear: number | null };

export type MyLinkState = { link: MemberLink | null; emailCandidate: EmailCandidate | null };

function toStatus(value: string): MemberLinkStatus {
  if (!(MEMBER_LINK_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `user_member_links.status holds "${value}". The CHECK in migration 105 and ` +
        "MEMBER_LINK_STATUSES in types/domain.ts have drifted.",
    );
  }
  return value as MemberLinkStatus;
}

function toMethod(value: string | null): MemberLinkMethod | null {
  if (value === null) return null;
  if (!(MEMBER_LINK_METHODS as readonly string[]).includes(value)) {
    throw new Error(
      `user_member_links.method holds "${value}". The CHECK in migration 105 and ` +
        "MEMBER_LINK_METHODS in types/domain.ts have drifted.",
    );
  }
  return value as MemberLinkMethod;
}

export function toMemberLink(row: LinkRow): MemberLink {
  return {
    id: row.id,
    userId: row.user_id,
    wardId: row.ward_id,
    memberId: row.member_id,
    status: toStatus(row.status),
    method: toMethod(row.method),
    requestedAt: row.requested_at,
    decidedAt: row.decided_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

function resolveClient(client?: SupabaseClient<Database>): SupabaseClient<Database> {
  return client ?? createServiceSupabaseClient();
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

// A 23505 from an insert or update names which of the two partial unique indexes refused it.
function uniqueViolationMessage(error: { message?: string }): string {
  return (error.message ?? "").includes("one_active_per_member")
    ? MEMBER_ALREADY_LINKED_MESSAGE
    : ACCOUNT_ALREADY_LINKED_MESSAGE;
}

async function readOpenLink(
  service: SupabaseClient<Database>,
  userId: string,
  wardId: string,
): Promise<MemberLink | null> {
  const { data, error } = await service
    .from("user_member_links")
    .select(LINK_COLUMNS)
    .eq("user_id", userId)
    .eq("ward_id", wardId)
    .in("status", OPEN_STATUSES)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the account's roster link — ${error.message}`, { userId, wardId });
    throw new Error(`Could not read the roster link: ${error.message}`);
  }

  return data ? toMemberLink(data) : null;
}

async function isMemberActivelyLinked(
  service: SupabaseClient<Database>,
  memberId: string,
): Promise<boolean> {
  const { count, error } = await service
    .from("user_member_links")
    .select("id", { head: true, count: "exact" })
    .eq("member_id", memberId)
    .eq("status", "active");

  if (error) {
    console.error(`Could not check whether a member is linked — ${error.message}`, { memberId });
    throw new Error(`Could not check the roster link: ${error.message}`);
  }

  return (count ?? 0) > 0;
}

// The login email is the one Supabase Auth holds, not `users.email`, because that is the address
// whose owner proved they can read it.
async function readLoginEmail(service: SupabaseClient<Database>, userId: string): Promise<string | null> {
  const { data, error } = await service.auth.admin.getUserById(userId);

  if (error) {
    console.error(`Could not read the account's login email — ${error.message}`, { userId });
    throw new Error(`Could not read the login email: ${error.message}`);
  }

  const email = data.user?.email?.trim();
  return email ? email : null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

// THE ONE ACTIVE ROSTER MEMBER WHOSE EMAIL IS THE LOGIN EMAIL, compared case-insensitively. Several
// matches — a shared family address — is no candidate at all, so asking is the only path; guessing
// between them would link somebody to their spouse's calling. A member already linked to another
// account is no candidate either.
async function findEmailCandidate(
  service: SupabaseClient<Database>,
  userId: string,
  wardId: string,
): Promise<EmailCandidate | null> {
  const loginEmail = await readLoginEmail(service, userId);
  if (!loginEmail) return null;

  const { data, error } = await service
    .from("members")
    .select("id, first_name, last_name, birth_date")
    .eq("ward_id", wardId)
    .eq("status", "active")
    .ilike("email", escapeLikePattern(loginEmail));

  if (error) {
    console.error(`Could not look for the account's roster email — ${error.message}`, { userId, wardId });
    throw new Error(`Could not look for a roster match: ${error.message}`);
  }

  if (!data || data.length !== 1) return null;

  const [member] = data;
  if (await isMemberActivelyLinked(service, member.id)) return null;

  return {
    memberId: member.id,
    displayName: [member.first_name, member.last_name].filter(Boolean).join(" "),
    birthYear: member.birth_date ? Number(member.birth_date.slice(0, 4)) : null,
  };
}

// What the "Is this you?" card needs: the account's open link in this ward, and — only when there
// is none — the email candidate.
export async function readMyLinkState(
  userId: string,
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<MyLinkState> {
  const service = resolveClient(client);
  const link = await readOpenLink(service, userId, wardId);
  if (link) return { link, emailCandidate: null };
  return { link: null, emailCandidate: await findEmailCandidate(service, userId, wardId) };
}

// "Yes, this is me". The match is RE-CHECKED here rather than trusted from the card, so a member id
// sent by hand links nothing unless it is the account's own email match.
export async function confirmEmailMatch(
  params: { userId: string; wardId: string; memberId: string },
  client?: SupabaseClient<Database>,
): Promise<LinkResult> {
  const service = resolveClient(client);

  const existing = await readOpenLink(service, params.userId, params.wardId);
  if (existing?.status === "active") {
    return { ok: false, status: 409, message: "Your account is already linked to the ward list." };
  }

  const candidate = await findEmailCandidate(service, params.userId, params.wardId);
  if (!candidate || candidate.memberId !== params.memberId) {
    return { ok: false, status: 403, message: EMAIL_MATCH_GONE_MESSAGE };
  }

  const now = new Date().toISOString();
  const values = {
    member_id: candidate.memberId,
    status: "active",
    method: "email_match",
    decided_at: now,
  };

  const { data, error } = existing
    ? await service
        .from("user_member_links")
        .update(values)
        .eq("id", existing.id)
        .eq("status", "pending")
        .select(LINK_COLUMNS)
        .maybeSingle()
    : await service
        .from("user_member_links")
        .insert({ ...values, user_id: params.userId, ward_id: params.wardId })
        .select(LINK_COLUMNS)
        .maybeSingle();

  if (isUniqueViolation(error)) {
    return { ok: false, status: 409, message: uniqueViolationMessage(error ?? {}) };
  }
  if (error) {
    console.error(`Could not link the account by email — ${error.message}`, params);
    throw new Error(`Could not link the account: ${error.message}`);
  }
  if (!data) {
    return { ok: false, status: 409, message: "Your request changed while you were answering. Reload and try again." };
  }

  return { ok: true, link: toMemberLink(data) };
}

// "Ask the bishopric to link me". Idempotent: an open request or link is returned as it is.
export async function requestLink(
  params: { userId: string; wardId: string },
  client?: SupabaseClient<Database>,
): Promise<LinkResult> {
  const service = resolveClient(client);

  const existing = await readOpenLink(service, params.userId, params.wardId);
  if (existing) return { ok: true, link: existing };

  const { data, error } = await service
    .from("user_member_links")
    .insert({
      user_id: params.userId,
      ward_id: params.wardId,
      status: "pending",
      requested_at: new Date().toISOString(),
    })
    .select(LINK_COLUMNS)
    .single();

  if (isUniqueViolation(error)) {
    const raced = await readOpenLink(service, params.userId, params.wardId);
    if (raced) return { ok: true, link: raced };
  }
  if (error) {
    console.error(`Could not record the link request — ${error.message}`, params);
    throw new Error(`Could not record the request: ${error.message}`);
  }

  return { ok: true, link: toMemberLink(data) };
}

// A BISHOPRIC MEMBER (or the super admin) LINKS AN ACCOUNT. Refuses linking your own account (P3)
// — the route refuses it too. Approves a pending request in place, so the requester's card moves
// from "Waiting…" to linked with no second row.
export async function linkByAdmin(
  params: { actorUserId: string; userId: string; wardId: string; memberId: string },
  client?: SupabaseClient<Database>,
): Promise<LinkResult> {
  if (params.actorUserId === params.userId) {
    return { ok: false, status: 403, message: SELF_LINK_MESSAGE };
  }

  const service = resolveClient(client);

  const { data: member, error: memberError } = await service
    .from("members")
    .select("id, status, first_name, last_name")
    .eq("id", params.memberId)
    .eq("ward_id", params.wardId)
    .maybeSingle();

  if (memberError) {
    console.error(`Could not read the member to link — ${memberError.message}`, params);
    throw new Error(`Could not read the member: ${memberError.message}`);
  }
  if (!member || member.status !== "active") {
    return { ok: false, status: 400, message: MEMBER_NOT_LINKABLE_MESSAGE };
  }

  const existing = await readOpenLink(service, params.userId, params.wardId);
  if (existing?.status === "active") {
    return { ok: false, status: 409, message: ACCOUNT_ALREADY_LINKED_MESSAGE };
  }

  // The admin's own sentence: "Ask your bishopric" is the member's path, and the reader here IS
  // the bishopric (walking scenario 103).
  const linkedElsewhereMessage = memberLinkedElsewhereMessage(
    [member.first_name, member.last_name].filter(Boolean).join(" ") || "That person",
  );
  if (await isMemberActivelyLinked(service, params.memberId)) {
    return { ok: false, status: 409, message: linkedElsewhereMessage };
  }

  const now = new Date().toISOString();
  const values = {
    member_id: params.memberId,
    status: "active",
    method: "admin",
    linked_by: params.actorUserId,
    decided_by: params.actorUserId,
    decided_at: now,
  };

  const { data, error } = existing
    ? await service
        .from("user_member_links")
        .update(values)
        .eq("id", existing.id)
        .eq("status", "pending")
        .select(LINK_COLUMNS)
        .maybeSingle()
    : await service
        .from("user_member_links")
        .insert({ ...values, user_id: params.userId, ward_id: params.wardId })
        .select(LINK_COLUMNS)
        .maybeSingle();

  if (isUniqueViolation(error)) {
    const message = uniqueViolationMessage(error ?? {});
    return {
      ok: false,
      status: 409,
      message: message === MEMBER_ALREADY_LINKED_MESSAGE ? linkedElsewhereMessage : message,
    };
  }
  if (error) {
    console.error(`Could not link the account — ${error.message}`, params);
    throw new Error(`Could not link the account: ${error.message}`);
  }
  if (!data) {
    return { ok: false, status: 409, message: "That request changed while you were answering. Reload and try again." };
  }

  return { ok: true, link: toMemberLink(data) };
}

type DecideParams = { actorUserId: string; linkId: string; wardId: string };

async function moveLink(
  params: DecideParams,
  from: MemberLinkStatus,
  values: Database["public"]["Tables"]["user_member_links"]["Update"],
  client?: SupabaseClient<Database>,
): Promise<LinkResult> {
  const service = resolveClient(client);

  const { data, error } = await service
    .from("user_member_links")
    .update(values)
    .eq("id", params.linkId)
    .eq("ward_id", params.wardId)
    .eq("status", from)
    .select(LINK_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error(`Could not change the roster link — ${error.message}`, params);
    throw new Error(`Could not change the roster link: ${error.message}`);
  }
  if (!data) {
    return {
      ok: false,
      status: 404,
      message:
        from === "pending"
          ? "That request is no longer waiting. Reload to see where it stands."
          : "That link is no longer active. Reload to see where it stands.",
    };
  }

  return { ok: true, link: toMemberLink(data) };
}

// Decline a pending request. The requester's card goes back to offering "Ask" again; the declined
// row stays as history.
export async function declineLink(
  params: DecideParams,
  client?: SupabaseClient<Database>,
): Promise<LinkResult> {
  return moveLink(
    params,
    "pending",
    { status: "declined", decided_by: params.actorUserId, decided_at: new Date().toISOString() },
    client,
  );
}

// End an active link — the wrong person was linked. Never a delete. Ending a link changes no
// calling: from cr2 on the account is simply off the review until it is linked again.
export async function endLink(params: DecideParams, client?: SupabaseClient<Database>): Promise<LinkResult> {
  return moveLink(
    params,
    "active",
    { status: "ended", ended_by: params.actorUserId, ended_at: new Date().toISOString() },
    client,
  );
}

export async function readLink(
  linkId: string,
  wardId: string,
  client?: SupabaseClient<Database>,
): Promise<MemberLink | null> {
  const service = resolveClient(client);
  const { data, error } = await service
    .from("user_member_links")
    .select(LINK_COLUMNS)
    .eq("id", linkId)
    .eq("ward_id", wardId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read the roster link — ${error.message}`, { linkId, wardId });
    throw new Error(`Could not read the roster link: ${error.message}`);
  }

  return data ? toMemberLink(data) : null;
}

export type WardLinkSummary = MemberLink & { memberName: string | null };

// Every open link in the ward, with the linked member's name, for Admin → Users. Read through the
// CALLER's client: migration 105a's policy admits the bishopric to the ward's links, which is
// exactly who opens that page.
export async function listOpenWardLinks(
  wardId: string,
  client: SupabaseClient<Database>,
): Promise<WardLinkSummary[]> {
  const { data, error } = await client
    .from("user_member_links")
    .select(LINK_COLUMNS)
    .eq("ward_id", wardId)
    .in("status", OPEN_STATUSES);

  if (error) {
    console.error(`Could not read the ward's roster links — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward's roster links: ${error.message}`);
  }

  const links = (data ?? []).map(toMemberLink);
  const memberIds = links.map((link) => link.memberId).filter((id): id is string => id !== null);
  if (memberIds.length === 0) return links.map((link) => ({ ...link, memberName: null }));

  const { data: members, error: memberError } = await client
    .from("members")
    .select("id, first_name, last_name")
    .eq("ward_id", wardId)
    .in("id", memberIds);

  if (memberError) {
    console.error(`Could not read the linked members' names — ${memberError.message}`, { wardId });
    throw new Error(`Could not read the linked members: ${memberError.message}`);
  }

  const names = new Map(
    (members ?? []).map((member) => [member.id, [member.first_name, member.last_name].filter(Boolean).join(" ")]),
  );

  return links.map((link) => ({
    ...link,
    memberName: link.memberId ? (names.get(link.memberId) ?? null) : null,
  }));
}
