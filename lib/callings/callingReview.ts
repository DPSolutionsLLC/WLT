import { roleNeedsRosterLink } from "@/lib/callings/linkAccess";
import {
  deriveCalling,
  parseLcrCallings,
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
  memberName: string | null;
  callingId: string | null;
  current: CallingTarget | null;
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

function unresolvableRefusal(derived: Extract<DerivedCalling, { kind: "unresolvable" }>): string {
  const organization = ORGANIZATION_TYPE_NAMES[derived.orgType];
  return derived.reason === "no_organization"
    ? `Can't apply: this ward has no ${organization} organization.`
    : `Can't apply: this ward has more than one ${organization} organization.`;
}

type AccountContext = {
  userId: string;
  accountName: string;
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
  return {
    id: fields.id,
    kind: fields.kind,
    userId: context.userId,
    accountName: context.accountName,
    memberName: context.memberName,
    callingId: calling?.id ?? null,
    current: calling
      ? { role: calling.role, orgId: calling.orgId, counselorPosition: calling.counselorPosition }
      : null,
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
