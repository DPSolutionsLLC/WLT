import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, listWardOrganizations } from "@/lib/auth/adminUsers";
import {
  buildCallingReview,
  listUnlinkedHolders,
  type CallingReviewRow,
  type UnlinkedHolder,
  type UnlinkedHolderMember,
  type PastedRosterFacts,
  type ReviewMember,
  type ReviewOrganization,
} from "@/lib/callings/callingReview";
import { listActiveWardLinks } from "@/lib/callings/memberLinks";
import { listWardCallings } from "@/lib/callings/queries";
import type { Database } from "@/types/database";
import { MEMBER_STATUSES, type MemberStatus } from "@/types/domain";

// THE READS BEHIND ONE WARD'S CALLING REVIEW (ITER-058 cr2).
//
// THROUGH THE SERVICE-ROLE CLIENT, AFTER THE CALLER'S GATE. The review is read by the bishopric and
// by the super admin, and a super admin acting under a `super_admin` calling is not admitted to the
// ward's links by migration 105a's policy (`user_id = auth.uid() or is_bishopric()`). The route or
// page calls canManageMemberLinks() first; that check is the boundary, exactly as it is for every
// write to `user_member_links`. EVERY QUERY HERE FILTERS ON `ward_id` (CLAUDE.md rule 1), because
// the service role would otherwise read every ward.
//
// `members.callings` is read here and NOWHERE ELSE for a calling: "every 'who holds this role'
// query reads callings" (ward-callings-model). The review is the one place the roster's text is
// compared with the app.

export type CallingReviewData = {
  rows: CallingReviewRow[];
  organizationNames: Map<string, string>;
};

function applyPastedFacts(member: ReviewMember, pasted: PastedRosterFacts): ReviewMember {
  return {
    ...member,
    callings: pasted.callings.has(member.id)
      ? (pasted.callings.get(member.id) ?? null)
      : member.callings,
    status: pasted.statuses.get(member.id) ?? member.status,
  };
}

function toMemberStatus(value: string): MemberStatus {
  if (!(MEMBER_STATUSES as readonly string[]).includes(value)) {
    throw new Error(
      `members.status holds "${value}", which is not a known status. The CHECK constraint and ` +
        "MEMBER_STATUSES in types/domain.ts have drifted.",
    );
  }
  return value as MemberStatus;
}

async function readLinkedMembers(
  wardId: string,
  memberIds: readonly string[],
  service: SupabaseClient<Database>,
): Promise<ReviewMember[]> {
  if (memberIds.length === 0) return [];

  const { data, error } = await service
    .from("members")
    .select("id, first_name, last_name, status, callings")
    .eq("ward_id", wardId)
    .in("id", [...memberIds]);

  if (error) {
    console.error(`Could not read the linked members — ${error.message}`, { wardId });
    throw new Error(`Could not read the linked members: ${error.message}`);
  }

  return (data ?? []).map((member) => ({
    id: member.id,
    name: [member.first_name, member.last_name].filter(Boolean).join(" "),
    status: toMemberStatus(member.status),
    callings: member.callings,
  }));
}

async function readAccountNames(
  userIds: readonly string[],
  service: SupabaseClient<Database>,
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await service
    .from("users")
    .select("id, first_name, last_name, username, email")
    .in("id", [...new Set(userIds)]);

  if (error) {
    console.error(`Could not read the linked accounts' names — ${error.message}`);
    throw new Error(`Could not read the linked accounts: ${error.message}`);
  }

  return new Map(
    (data ?? []).map((account) => [
      account.id,
      displayName({
        firstName: account.first_name,
        lastName: account.last_name,
        username: account.username,
        email: account.email,
      }),
    ]),
  );
}

export async function loadCallingReview(
  wardId: string,
  service: SupabaseClient<Database>,
  pasted?: PastedRosterFacts,
): Promise<CallingReviewData> {
  const links = await listActiveWardLinks(wardId, service);

  const [storedMembers, callings, wardOrganizations, accountNames] = await Promise.all([
    readLinkedMembers(
      wardId,
      links.map((link) => link.memberId),
      service,
    ),
    listWardCallings(wardId, service),
    listWardOrganizations(wardId, service),
    readAccountNames(
      links.map((link) => link.userId),
      service,
    ),
  ]);

  const members = pasted
    ? storedMembers.map((member) => applyPastedFacts(member, pasted))
    : storedMembers;

  const organizations: ReviewOrganization[] = wardOrganizations.map((organization) => ({
    id: organization.id,
    type: organization.type,
    name: organization.name,
  }));

  const rows = buildCallingReview({
    links,
    members,
    callings: callings.map((calling) => ({
      id: calling.id,
      userId: calling.userId,
      role: calling.role,
      orgId: calling.orgId,
      counselorPosition: calling.counselorPosition,
      source: calling.source,
    })),
    organizations,
    accountNames,
  });

  return {
    rows,
    organizationNames: new Map(organizations.map((organization) => [organization.id, organization.name])),
  };
}

// THE READS BEHIND "CALLINGS WITH NO LINKED ACCOUNT" (cr4). Same boundary as loadCallingReview():
// the service role, after canManageMemberLinks(), every query on `ward_id`.
//
// The account email compared is `users.email`, the address the account was invited or created with
// — the same one Supabase Auth signs it in with. It only ever SUPPRESSES an Invite button ("may be
// this person — link them"); it never links anybody, so a stale address costs a hint, not access.

async function readMembersWithCallings(
  wardId: string,
  service: SupabaseClient<Database>,
): Promise<UnlinkedHolderMember[]> {
  const { data, error } = await service
    .from("members")
    .select("id, first_name, last_name, status, callings, email")
    .eq("ward_id", wardId)
    .eq("status", "active")
    .not("callings", "is", null);

  if (error) {
    console.error(`Could not read the ward list's callings — ${error.message}`, { wardId });
    throw new Error(`Could not read the ward list's callings: ${error.message}`);
  }

  return (data ?? []).map((member) => ({
    id: member.id,
    name: [member.first_name, member.last_name].filter(Boolean).join(" "),
    status: toMemberStatus(member.status),
    callings: member.callings,
    email: member.email,
  }));
}

// Every person invite in the ward, newest first, read once. A member is INVITED while any of theirs
// is still usable (unused, not declined, not expired), and DECLINED only when their newest invite was
// answered "No, this isn't me" — an older refusal says nothing once a fresh link has been made.
async function readInviteStates(
  wardId: string,
  service: SupabaseClient<Database>,
): Promise<{ invitedMemberIds: Set<string>; declinedMemberIds: Map<string, string> }> {
  const { data, error } = await service
    .from("invites")
    .select("member_id, used_at, declined_at, expires_at, created_at")
    .eq("ward_id", wardId)
    .not("member_id", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`Could not read the ward's invites — ${error.message}`, { wardId });
    throw new Error(`Could not read the invites: ${error.message}`);
  }

  const now = Date.now();
  const invitedMemberIds = new Set<string>();
  const declinedMemberIds = new Map<string, string>();
  const seen = new Set<string>();

  for (const invite of data ?? []) {
    if (invite.member_id === null) continue;
    const usable =
      invite.used_at === null &&
      invite.declined_at === null &&
      invite.expires_at !== null &&
      new Date(invite.expires_at).getTime() > now;
    if (usable) invitedMemberIds.add(invite.member_id);
    if (!seen.has(invite.member_id) && invite.declined_at !== null) {
      declinedMemberIds.set(invite.member_id, invite.declined_at);
    }
    seen.add(invite.member_id);
  }

  return { invitedMemberIds, declinedMemberIds };
}

async function readUnlinkedAccountsByEmail(
  userIds: readonly string[],
  service: SupabaseClient<Database>,
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();

  const { data, error } = await service
    .from("users")
    .select("id, first_name, last_name, username, email")
    .in("id", [...new Set(userIds)]);

  if (error) {
    console.error(`Could not read the unlinked accounts — ${error.message}`);
    throw new Error(`Could not read the unlinked accounts: ${error.message}`);
  }

  const byEmail = new Map<string, string>();
  for (const account of data ?? []) {
    const email = account.email?.trim().toLowerCase();
    if (!email) continue;
    byEmail.set(
      email,
      displayName({
        firstName: account.first_name,
        lastName: account.last_name,
        username: account.username,
        email: account.email,
      }),
    );
  }
  return byEmail;
}

export async function loadUnlinkedHolders(
  wardId: string,
  service: SupabaseClient<Database>,
): Promise<UnlinkedHolder[]> {
  const [links, members, callings, wardOrganizations, { invitedMemberIds, declinedMemberIds }] = await Promise.all([
    listActiveWardLinks(wardId, service),
    readMembersWithCallings(wardId, service),
    listWardCallings(wardId, service),
    listWardOrganizations(wardId, service),
    readInviteStates(wardId, service),
  ]);

  const linkedUserIds = new Set(links.map((link) => link.userId));
  const unlinkedAccountsByEmail = await readUnlinkedAccountsByEmail(
    callings.map((calling) => calling.userId).filter((userId) => !linkedUserIds.has(userId)),
    service,
  );

  return listUnlinkedHolders({
    members,
    linkedMemberIds: new Set(links.map((link) => link.memberId)),
    invitedMemberIds,
    declinedMemberIds,
    unlinkedAccountsByEmail,
    organizations: wardOrganizations.map((organization) => ({
      id: organization.id,
      type: organization.type,
      name: organization.name,
    })),
  });
}
