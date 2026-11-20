import { roleNeedsRosterLink } from "@/lib/callings/linkAccess";
import {
  deriveCalling,
  parseLcrCallings,
  ROLE_PRECEDENCE,
  type DerivedCalling,
  type OrganizationForMapping,
} from "@/lib/callings/lcrCallingMap";
import {
  describeCalling,
  type CallingSource,
  type MemberStatus,
  type OrganizationType,
  type Role,
} from "@/types/domain";

// THE CALLING REVIEW (ITER-058 cr2, plans/roster-decides-callings.md P5).
//
// COMPUTED WHEN READ, NEVER STORED. For every account linked to someone on the ward list, compare
// the calling the roster gives that person (through lib/callings/lcrCallingMap.ts) with the
// calling the app holds, and say what differs. Admin → Users (cr2) and the paste review (cr3) both
// call this one function, so the two screens cannot disagree; a paste preview passes the PASTED
// callings text in place of the stored one.
//
// NOTHING HERE APPLIES ANYTHING. Every row starts unticked (P9): a calling change moves access in
// one direction or the other, and decisions.md §4.4 says never auto-change access in either. The
// writes are lib/callings/applyCallingReview.ts's, which recomputes this before acting on a tick.
//
// ROW IDS CARRY THE TARGET, not only the calling. `calling:{callingId}:{target}` means "change this
// calling TO THIS". If the roster changes between the page loading and Apply, the recomputed row
// has a different id and the tick is counted as stale rather than applied to a target the person
// never saw. The prefixes never collide with the paste review's `new:` / `member:` / `household:` /
// `moveout:` ids, so cr3 can put both on one checklist.
//
// Pure: no I/O.

export type CallingReviewKind = "change" | "call" | "release" | "override" | "unresolvable";

export type CallingTarget = {
  role: Role;
  orgId: string | null;
  counselorPosition: 1 | 2 | null;
};

export type ReviewLink = { userId: string; memberId: string };

export type ReviewMember = {
  id: string;
  name: string;
  status: MemberStatus;
  callings: string | null;
};

export type ReviewCalling = CallingTarget & {
  id: string;
  userId: string;
  source: CallingSource;
};

export type ReviewOrganization = OrganizationForMapping & { name: string };

// WHAT A PASTE WOULD MAKE TRUE, keyed by member id (cr3). A preview reads the review as if the paste
// had landed: the pasted callings text, and the status of anybody it brings back or leaves off.
// Absent means "use what is stored", so a paste with no Callings column changes no calling.
export type PastedRosterFacts = {
  callings: ReadonlyMap<string, string | null>;
  statuses: ReadonlyMap<string, MemberStatus>;
};

export type CallingReviewInput = {
  links: readonly ReviewLink[];
  members: readonly ReviewMember[];
  callings: readonly ReviewCalling[];
  organizations: readonly ReviewOrganization[];
  accountNames: ReadonlyMap<string, string>;
};

export type CallingReviewRow = {
  id: string;
  kind: CallingReviewKind;
  userId: string;
  accountName: string;
  memberId: string;
  memberName: string | null;
  callingId: string | null;
  current: CallingTarget | null;
  currentLabel: string | null;
  // null on a release: the row ends the calling.
  target: CallingTarget | null;
  sentence: string;
  details: string[];
  defaultSelected: false;
  canApply: boolean;
  refusal: string | null;
};

const ORGANIZATION_TYPE_NAMES: Record<OrganizationType, string> = {
  bishopric: "Bishopric",
  elders_quorum: "Elders Quorum",
  relief_society: "Relief Society",
  young_men: "Young Men",
  young_women: "Young Women",
  primary: "Primary",
  sunday_school: "Sunday School",
  other: "Other",
};

const KIND_ORDER: Record<CallingReviewKind, number> = {
  change: 0,
  call: 1,
  override: 2,
  release: 3,
  unresolvable: 4,
};

const COUNSELOR_LABELS: Record<1 | 2, string> = { 1: "1st Counselor", 2: "2nd Counselor" };

export function describeTarget(
  target: CallingTarget,
  organizationNames: ReadonlyMap<string, string>,
): string {
  if (target.role === "counselor" && target.counselorPosition !== null) {
    return COUNSELOR_LABELS[target.counselorPosition];
  }
  const organizationName = target.orgId ? (organizationNames.get(target.orgId) ?? null) : null;
  return describeCalling(target.role, organizationName);
}

function fingerprint(target: CallingTarget | null): string {
  if (target === null) return "none";
  return `${target.role}.${target.orgId ?? "-"}.${target.counselorPosition ?? "-"}`;
}

function sameCalling(left: CallingTarget, right: CallingTarget): boolean {
  return (
    left.role === right.role &&
    left.orgId === right.orgId &&
    left.counselorPosition === right.counselorPosition
  );
}

function detailsOf(derived: DerivedCalling): string[] {
  const details: string[] = [];
  if (derived.kind === "calling") {
    for (const setAside of derived.setAside) {
      details.push(`Also holds ${setAside.title}, set aside for ${derived.title}`);
    }
  }
  for (const title of derived.unrecognised) {
    details.push(`Calling not recognised: ${title}`);
  }
  return details;
}

export function unresolvableRefusal(derived: Extract<DerivedCalling, { kind: "unresolvable" }>): string {
  const organization = ORGANIZATION_TYPE_NAMES[derived.orgType];
  return derived.reason === "no_organization"
    ? `Can't apply: this ward has no ${organization} organization.`
    : `Can't apply: this ward has more than one ${organization} organization.`;
}

type AccountContext = {
  userId: string;
  accountName: string;
  memberId: string;
  memberName: string | null;
  calling: ReviewCalling | null;
  derived: DerivedCalling;
  leftRoster: boolean;
  organizationNames: ReadonlyMap<string, string>;
};

function row(
  context: AccountContext,
  fields: Pick<CallingReviewRow, "id" | "kind" | "target" | "sentence"> &
    Partial<Pick<CallingReviewRow, "canApply" | "refusal">>,
): CallingReviewRow {
  const { calling } = context;
  const current: CallingTarget | null = calling
    ? { role: calling.role, orgId: calling.orgId, counselorPosition: calling.counselorPosition }
    : null;
  return {
    id: fields.id,
    kind: fields.kind,
    userId: context.userId,
    accountName: context.accountName,
    memberId: context.memberId,
    memberName: context.memberName,
    callingId: calling?.id ?? null,
    current,
    currentLabel: current ? describeTarget(current, context.organizationNames) : null,
    target: fields.target,
    sentence: fields.sentence,
    details: detailsOf(context.derived),
    defaultSelected: false,
    canApply: fields.canApply ?? true,
    refusal: fields.refusal ?? null,
  };
}

function reviewAccount(context: AccountContext): CallingReviewRow | null {
  const { calling, derived, accountName, organizationNames } = context;
  const label = (target: CallingTarget) => describeTarget(target, organizationNames);
  const who = context.memberName ?? accountName;

  if (derived.kind === "unresolvable") {
    if (calling && calling.role === derived.role) return null;
    return row(context, {
      id: `unresolvable:${context.userId}:${derived.role}.${derived.orgType}`,
      kind: "unresolvable",
      target: null,
      sentence: `${accountName}: the ward list says ${derived.title}.`,
      canApply: false,
      refusal: unresolvableRefusal(derived),
    });
  }

  if (derived.kind === "calling") {
    const target: CallingTarget = {
      role: derived.role,
      orgId: derived.orgId,
      counselorPosition: derived.counselorPosition,
    };

    if (!calling) {
      return row(context, {
        id: `call:${context.userId}:${fingerprint(target)}`,
        kind: "call",
        target,
        sentence: `${accountName} holds no calling in the app. The ward list says ${label(target)}.`,
      });
    }

    if (sameCalling(calling, target)) return null;

    if (calling.source === "override") {
      return row(context, {
        id: `override:${calling.id}:${fingerprint(target)}`,
        kind: "override",
        target,
        sentence:
          `${accountName}: overridden by the super admin as ${label(calling)}. ` +
          `The ward list says ${label(target)}. Tick to clear the override and use the ward list.`,
      });
    }

    return row(context, {
      id: `calling:${calling.id}:${fingerprint(target)}`,
      kind: "change",
      target,
      sentence: `${accountName}: from ${label(calling)} to ${label(target)}.`,
    });
  }

  if (!calling) return null;

  // No LCR title maps to `ward_council_member` (plan §Agreed title map), so a roster with no
  // recognised calling cannot say such a person was released. Only leaving the roster can.
  if (calling.role === "ward_council_member" && !context.leftRoster) return null;

  const reason = context.leftRoster
    ? `${who} is no longer on the ward list`
    : `${who} holds no calling the app recognises`;

  if (calling.source === "override") {
    return row(context, {
      id: `override:${calling.id}:none`,
      kind: "override",
      target: null,
      sentence:
        `${accountName}: overridden by the super admin as ${label(calling)}. ${reason}. ` +
        "Tick to clear the override and release the calling.",
    });
  }

  return row(context, {
    id: `release:${calling.id}`,
    kind: "release",
    target: null,
    sentence: `${reason}. Release their ${label(calling)} calling?`,
  });
}

export function buildCallingReview(input: CallingReviewInput): CallingReviewRow[] {
  const membersById = new Map(input.members.map((member) => [member.id, member]));
  const callingsByUser = new Map(input.callings.map((calling) => [calling.userId, calling]));
  const organizationNames = new Map(
    input.organizations.map((organization) => [organization.id, organization.name]),
  );
  const mappingOrganizations = input.organizations.map(({ id, type }) => ({ id, type }));

  const rows: CallingReviewRow[] = [];

  for (const link of input.links) {
    const calling = callingsByUser.get(link.userId) ?? null;

    // Not an LCR calling here (P7): the youth PIN account, a `super_admin` calling, the stake
    // roles. The roster has nothing to say about them, so they are never put on a review.
    if (calling && !roleNeedsRosterLink(calling.role)) continue;

    const member = membersById.get(link.memberId) ?? null;
    const leftRoster = member === null || member.status === "moved_out";
    const derived: DerivedCalling = leftRoster
      ? { kind: "none", unrecognised: [] }
      : deriveCalling(parseLcrCallings(member.callings), mappingOrganizations);

    const reviewed = reviewAccount({
      userId: link.userId,
      accountName: input.accountNames.get(link.userId) ?? "An account",
      memberId: link.memberId,
      memberName: member?.name ?? null,
      calling,
      derived,
      leftRoster,
      organizationNames,
    });

    if (reviewed) rows.push(reviewed);
  }

  return rows.sort(
    (left, right) =>
      KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
      left.accountName.localeCompare(right.accountName) ||
      left.id.localeCompare(right.id),
  );
}

export function describeRowTarget(
  reviewRow: Pick<CallingReviewRow, "target">,
  organizationNames: ReadonlyMap<string, string>,
): string {
  return reviewRow.target ? describeTarget(reviewRow.target, organizationNames) : "released";
}

// ---------------------------------------------------------------------------
// CALLINGS WITH NO LINKED ACCOUNT (ITER-058 cr4)
// ---------------------------------------------------------------------------
// Everybody the ward list gives an app calling whose record no account is linked to. NOT a review
// row: there is nothing to tick or apply — the act is an invite — so it is kept out of
// buildCallingReview(), out of Apply, and off the paste checklist, while reading the same title map.
//
// "No linked account" is not "no account": until every existing account is linked (D1), most of a
// ward's leaders have an account the ward list does not know about yet. So a row whose roster email
// is an unlinked ward account's login email says so and offers no Invite — inviting them would make
// a second account for somebody who already has one. One already invited says so and offers Invite
// again, since the first link may have been lost. One whose latest invite was answered "No, this
// isn't me" says so and offers Invite again: the email is the likely mistake, and checking it is the
// sender's job.

export type UnlinkedHolderState = "invite" | "invited" | "declined" | "maybe_account";

export type UnlinkedHolderMember = ReviewMember & { email: string | null };

export type UnlinkedHolderInput = {
  members: readonly UnlinkedHolderMember[];
  linkedMemberIds: ReadonlySet<string>;
  invitedMemberIds: ReadonlySet<string>;
  // Member id → when the person said their LATEST invite was not them.
  declinedMemberIds: ReadonlyMap<string, string>;
  // Lower-cased login email → account name, for ward accounts with no active link.
  unlinkedAccountsByEmail: ReadonlyMap<string, string>;
  organizations: readonly ReviewOrganization[];
};

export type UnlinkedHolder = {
  memberId: string;
  memberName: string;
  email: string | null;
  role: Role;
  callingLabel: string;
  state: UnlinkedHolderState;
  possibleAccountName: string | null;
  declinedAt: string | null;
};

export function listUnlinkedHolders(input: UnlinkedHolderInput): UnlinkedHolder[] {
  const organizationNames = new Map(
    input.organizations.map((organization) => [organization.id, organization.name]),
  );
  const mappingOrganizations = input.organizations.map(({ id, type }) => ({ id, type }));

  const holders: UnlinkedHolder[] = [];

  for (const member of input.members) {
    if (member.status !== "active" || input.linkedMemberIds.has(member.id)) continue;

    const derived = deriveCalling(parseLcrCallings(member.callings), mappingOrganizations);
    if (derived.kind !== "calling" || !roleNeedsRosterLink(derived.role)) continue;

    const email = member.email?.trim() ? member.email.trim() : null;
    const possibleAccountName = email
      ? (input.unlinkedAccountsByEmail.get(email.toLowerCase()) ?? null)
      : null;

    holders.push({
      memberId: member.id,
      memberName: member.name,
      email,
      role: derived.role,
      callingLabel: describeTarget(
        { role: derived.role, orgId: derived.orgId, counselorPosition: derived.counselorPosition },
        organizationNames,
      ),
      state: holderState(member.id, possibleAccountName, input),
      possibleAccountName,
      declinedAt: input.declinedMemberIds.get(member.id) ?? null,
    });
  }

  return holders.sort(
    (left, right) =>
      rankOfRole(left.role) - rankOfRole(right.role) || left.memberName.localeCompare(right.memberName),
  );
}

function holderState(
  memberId: string,
  possibleAccountName: string | null,
  input: UnlinkedHolderInput,
): UnlinkedHolderState {
  if (possibleAccountName) return "maybe_account";
  if (input.invitedMemberIds.has(memberId)) return "invited";
  if (input.declinedMemberIds.has(memberId)) return "declined";
  return "invite";
}

function rankOfRole(role: Role): number {
  const rank = ROLE_PRECEDENCE.indexOf(role);
  return rank === -1 ? ROLE_PRECEDENCE.length : rank;
}
