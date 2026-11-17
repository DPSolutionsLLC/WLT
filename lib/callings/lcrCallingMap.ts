import type { OrganizationType, Role } from "@/types/domain";

// WHICH LCR CALLING GRANTS WHICH APP CALLING (ITER-058, plans/roster-decides-callings.md).
//
// THE MATCH IS EXACT, AGAINST A KNOWN LIST (D5). A title is compared after trimming and collapsing
// inner whitespace, and CASE-SENSITIVELY, so a change in LCR's wording shows up as "Calling not
// recognised" on the review rather than half-matching. A title that is not here grants nothing:
// a wording change can never grant access by accident.
//
// The list was agreed with the user on 2026-11-16 against Buffalo Ward's real roster (plan §Agreed
// title map). No LCR title maps to `ward_council_member` — every calling the user named as the ward
// council already maps to its own role, which outranks it. Young Men titles map to nothing because
// the bishopric is the Young Men presidency.
//
// ITER-060 (the Callings sandbox) imports parseLcrCallings and LCR_CALLING_MAP from here, so there
// is one mapping and not two.
//
// Pure: no I/O.

export type MappedCalling = {
  role: Role;
  orgType: OrganizationType | null;
  counselorPosition: 1 | 2 | null;
};

const ORGANIZATION_TITLES: ReadonlyArray<readonly [string, OrganizationType]> = [
  ["Elders Quorum", "elders_quorum"],
  ["Relief Society", "relief_society"],
  ["Primary", "primary"],
  ["Young Women", "young_women"],
  ["Sunday School", "sunday_school"],
];

function organizationEntries(): Array<readonly [string, MappedCalling]> {
  return ORGANIZATION_TITLES.flatMap(([prefix, orgType]) => [
    [`${prefix} President`, { role: "org_president", orgType, counselorPosition: null }],
    [`${prefix} First Counselor`, { role: "org_counselor", orgType, counselorPosition: null }],
    [`${prefix} Second Counselor`, { role: "org_counselor", orgType, counselorPosition: null }],
    [`${prefix} Secretary`, { role: "org_secretary", orgType, counselorPosition: null }],
  ] as const);
}

export const LCR_CALLING_MAP: ReadonlyMap<string, MappedCalling> = new Map<string, MappedCalling>([
  ["Bishop", { role: "bishop", orgType: null, counselorPosition: null }],
  ["Bishopric First Counselor", { role: "counselor", orgType: null, counselorPosition: 1 }],
  ["Bishopric Second Counselor", { role: "counselor", orgType: null, counselorPosition: 2 }],
  ["Ward Clerk", { role: "ward_secretary", orgType: null, counselorPosition: null }],
  ["Ward Executive Secretary", { role: "executive_secretary", orgType: null, counselorPosition: null }],
  ...organizationEntries(),
  ["Music Coordinator", { role: "music_coordinator", orgType: null, counselorPosition: null }],
  [
    "Resource Center Specialist",
    { role: "resource_center_specialist", orgType: null, counselorPosition: null },
  ],
]);

// D4: when one person holds two mapped callings, the higher-ranked one wins. Earlier is higher.
export const ROLE_PRECEDENCE: readonly Role[] = [
  "bishop",
  "counselor",
  "ward_secretary",
  "executive_secretary",
  "org_president",
  "org_counselor",
  "org_secretary",
  "music_coordinator",
  "ward_council_member",
  "resource_center_specialist",
];

// The roles the roster decides. Every other role (super_admin, sacrament_manager, the stake roles)
// is not an LCR calling here and is never put on a review (P7).
export const ROSTER_DECIDED_ROLES: ReadonlySet<Role> = new Set(
  [...LCR_CALLING_MAP.values()].map((mapped) => mapped.role),
);

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

// A callings cell is `\n`-separated (roster-paste-import). The sustained and set-apart columns can
// carry a trailing date group, "Ward Clerk (12 Jan 2025)", which is stripped so one parser serves
// all three.
export function parseLcrCallings(text: string | null): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => normalizeTitle(line).replace(/\s*\([^)]*\)$/, ""))
    .filter((title) => title.length > 0);
}

export type OrganizationForMapping = { id: string; type: OrganizationType };

export type SetAsideCalling = { title: string; role: Role };

export type DerivedCalling =
  | {
      kind: "calling";
      role: Role;
      orgId: string | null;
      counselorPosition: 1 | 2 | null;
      title: string;
      setAside: SetAsideCalling[];
      unrecognised: string[];
    }
  | { kind: "none"; unrecognised: string[] }
  | {
      kind: "unresolvable";
      title: string;
      role: Role;
      reason: "no_organization" | "several_organizations";
      orgType: OrganizationType;
      unrecognised: string[];
    };

function rankOf(role: Role): number {
  const rank = ROLE_PRECEDENCE.indexOf(role);
  return rank === -1 ? ROLE_PRECEDENCE.length : rank;
}

// The person's app calling, derived from their roster titles. The organization comes from the
// ward's active organizations by TYPE, and is never guessed (P8): zero or several of that type makes
// the result `unresolvable`, which the review shows and cannot apply. The highest-ranked title is
// the one resolved; a lower one is never used in its place, because falling back would grant a
// calling the roster does not say is this person's main one.
export function deriveCalling(
  titles: readonly string[],
  organizations: readonly OrganizationForMapping[],
): DerivedCalling {
  const unrecognised: string[] = [];
  const mapped: Array<{ title: string; calling: MappedCalling }> = [];

  for (const title of titles) {
    const calling = LCR_CALLING_MAP.get(normalizeTitle(title));
    if (calling) mapped.push({ title: normalizeTitle(title), calling });
    else unrecognised.push(normalizeTitle(title));
  }

  if (mapped.length === 0) return { kind: "none", unrecognised };

  mapped.sort(
    (left, right) =>
      rankOf(left.calling.role) - rankOf(right.calling.role) || left.title.localeCompare(right.title),
  );

  const [chosen, ...rest] = mapped;
  const setAside = rest.map((entry) => ({ title: entry.title, role: entry.calling.role }));

  let orgId: string | null = null;
  if (chosen.calling.orgType !== null) {
    const matches = organizations.filter((organization) => organization.type === chosen.calling.orgType);
    if (matches.length !== 1) {
      return {
        kind: "unresolvable",
        title: chosen.title,
        role: chosen.calling.role,
        reason: matches.length === 0 ? "no_organization" : "several_organizations",
        orgType: chosen.calling.orgType,
        unrecognised,
      };
    }
    orgId = matches[0].id;
  }

  return {
    kind: "calling",
    role: chosen.calling.role,
    orgId,
    counselorPosition: chosen.calling.counselorPosition,
    title: chosen.title,
    setAside,
    unrecognised,
  };
}
