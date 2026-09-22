// @vitest-environment node
//
// Which organizations a user may manage a conducting rotation for. Pure, so no database and no
// network — but unlike defaultOrganizationFilter this IS a boundary, so it is table-driven over
// ALL TEN roles rather than the interesting ones. A role added to types/domain.ts without a
// decision about its rotation scope should fail here, not surprise an Elders Quorum president
// six months later.
//
// It is the SECOND of two boundaries. Migration 024's policies are the first, and
// tests/rls/org-conducting.test.ts is what proves those.

import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { manageableOrgIds } from "@/lib/calendar/orgRotationScope";
import { ROLES, type OrganizationType, type Role, type SessionUser } from "@/types/domain";

const ELDERS_QUORUM = "00000000-0000-4000-8000-00000000000a";
const RELIEF_SOCIETY = "00000000-0000-4000-8000-00000000000b";
const BISHOPRIC_ORG = "00000000-0000-4000-8000-00000000000c";
const OTHER_ORG = "00000000-0000-4000-8000-00000000000d";

const ORGANIZATIONS: { id: string; type: OrganizationType }[] = [
  { id: ELDERS_QUORUM, type: "elders_quorum" },
  { id: RELIEF_SOCIETY, type: "relief_society" },
  // Ineligible: the bishopric's rotation IS the sacrament-meeting one, keyed by a NULL org_id,
  // and `other` has no presidency to rotate.
  { id: BISHOPRIC_ORG, type: "bishopric" },
  { id: OTHER_ORG, type: "other" },
];

const ELIGIBLE_IDS = [ELDERS_QUORUM, RELIEF_SOCIETY];

function sessionUser(
  role: Role,
  orgId: string | null,
  orgType: OrganizationType | null = null,
): SessionUser {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    wardId: "00000000-0000-4000-8000-000000000002",
    // A session at HOME: the effective ward and the home ward are the same and
    // nothing is switched. lib/auth/session.ts reads all of these from session_context().
    homeWardId: "00000000-0000-4000-8000-000000000002",
    activeWardId: null,
    // The CALLING this session is acting under (migration 068). `role` and `orgId` below
    // are ITS facts, not the person\'s — a fixed id is enough here because nothing in
    // these tests reads it.
    callingId: "00000000-0000-4000-8000-00000000ca11",
    role,
    orgId,
    orgType,
    counselorPosition: null,
    firstName: "Test",
    lastName: "User",
    username: null,
    themePreference: "system",
    isActive: true,
  };
}

// Bishop and counselor hold every permission (CLAUDE.md §7), so they manage every eligible
// organization — which is what makes the feature usable in a ward whose presidencies have not
// been given accounts yet.
const BISHOPRIC_ROLES: readonly Role[] = ["bishop", "counselor"];

// Holds calendar.manage_org_conducting, narrowed to their own organization.
const ORG_LEADERSHIP_ROLES: readonly Role[] = ["org_president", "org_counselor"];

// Holds calendar.manage_org_conducting because it holds EVERYTHING (CLAUDE.md §7), and is
// therefore narrowed to its own organization exactly like an org president — NOT widened to the
// whole ward like the bishopric.
//
// That is the right answer and it is worth saying why, because a later reader will want to add
// `super_admin` to the BISHOPRIC list in lib/calendar/orgRotationScope.ts. Super admin bypasses
// the ACCESS MATRIX; it is not a second bishopric, and CLAUDE.md §7 wants exactly one source of
// truth for who the bishopric is. Granting it the whole list and letting the ordinary rules apply
// is one mechanism; a special case here would be a second, and the two would drift.
//
// The three stake roles are NOT here: they are read-only across the stake and hold no
// calendar.manage_org_conducting at all, so they fall out at the first line of the function.
const ALL_PERMISSION_ORG_SCOPED_ROLES: readonly Role[] = ["super_admin"];

// Everybody else. org_secretary is here deliberately: a secretary may be PICKED to conduct
// (Decision 9), but deciding who conducts is a presidency decision. ward_secretary is here
// despite holding calendar.manage — that permission is about the calendar, not about an
// organization's presidency.
const NO_SCOPE_ROLES: readonly Role[] = ROLES.filter(
  (role) =>
    !BISHOPRIC_ROLES.includes(role) &&
    !ORG_LEADERSHIP_ROLES.includes(role) &&
    !ALL_PERMISSION_ORG_SCOPED_ROLES.includes(role),
);

describe("manageableOrgIds", () => {
  it("covers every role between the four groups", () => {
    expect(
      BISHOPRIC_ROLES.length +
        ORG_LEADERSHIP_ROLES.length +
        ALL_PERMISSION_ORG_SCOPED_ROLES.length +
        NO_SCOPE_ROLES.length,
    ).toBe(ROLES.length);
  });

  for (const role of ALL_PERMISSION_ORG_SCOPED_ROLES) {
    it(`narrows ${role} to its own organization rather than the whole ward`, () => {
      expect(
        manageableOrgIds(sessionUser(role, ELDERS_QUORUM), ORGANIZATIONS, ROLE_PERMISSIONS),
      ).toEqual([ELDERS_QUORUM]);
      // And nothing at all when no organization was ever set — a wide WRITE is a hole, and
      // holding every permission does not change that.
      expect(
        manageableOrgIds(sessionUser(role, null), ORGANIZATIONS, ROLE_PERMISSIONS),
      ).toEqual([]);
    });
  }

  // The read-only stake roles fall out at the permission check, before any org reasoning runs.
  it("gives a stake officer nothing, because they hold no conducting permission", () => {
    for (const role of ["stake_president", "stake_counselor", "stake_secretary"] as const) {
      expect(
        manageableOrgIds(sessionUser(role, ELDERS_QUORUM), ORGANIZATIONS, ROLE_PERMISSIONS),
        `"${role}" should manage no rotation`,
      ).toEqual([]);
    }
  });

  for (const role of BISHOPRIC_ROLES) {
    it(`gives ${role} every eligible organization`, () => {
      expect(manageableOrgIds(sessionUser(role, null), ORGANIZATIONS, ROLE_PERMISSIONS)).toEqual(
        ELIGIBLE_IDS,
      );
      expect(manageableOrgIds(sessionUser(role, BISHOPRIC_ORG), ORGANIZATIONS, ROLE_PERMISSIONS)).toEqual(
        ELIGIBLE_IDS,
      );
    });
  }

  for (const role of ORG_LEADERSHIP_ROLES) {
    it(`gives ${role} their own eligible organization and nobody else's`, () => {
      expect(manageableOrgIds(sessionUser(role, ELDERS_QUORUM), ORGANIZATIONS, ROLE_PERMISSIONS)).toEqual([
        ELDERS_QUORUM,
      ]);
      expect(manageableOrgIds(sessionUser(role, RELIEF_SOCIETY), ORGANIZATIONS, ROLE_PERMISSIONS)).toEqual([
        RELIEF_SOCIETY,
      ]);
    });

    it(`gives ${role} nothing when their organization is not eligible`, () => {
      expect(manageableOrgIds(sessionUser(role, BISHOPRIC_ORG), ORGANIZATIONS, ROLE_PERMISSIONS)).toEqual([]);
      expect(manageableOrgIds(sessionUser(role, OTHER_ORG), ORGANIZATIONS, ROLE_PERMISSIONS)).toEqual([]);
    });

    // A wide LIST is a worse default but not a broken page; a wide WRITE is a hole. This is the
    // one place lib/roster/organizationScope.ts's fallback would be exactly wrong.
    it(`gives ${role} nothing when their org_id was never set`, () => {
      expect(manageableOrgIds(sessionUser(role, null), ORGANIZATIONS, ROLE_PERMISSIONS)).toEqual([]);
    });

    it(`gives ${role} nothing for an organization id that is not in the ward`, () => {
      expect(
        manageableOrgIds(
          sessionUser(role, "00000000-0000-4000-8000-0000000000ff"),
          ORGANIZATIONS,
          ROLE_PERMISSIONS,
        ),
      ).toEqual([]);
    });
  }

  for (const role of NO_SCOPE_ROLES) {
    it(`gives ${role} nothing, whatever organization they sit in`, () => {
      expect(manageableOrgIds(sessionUser(role, null), ORGANIZATIONS, ROLE_PERMISSIONS)).toEqual([]);
      expect(manageableOrgIds(sessionUser(role, ELDERS_QUORUM), ORGANIZATIONS, ROLE_PERMISSIONS)).toEqual([]);
    });
  }

  it("returns nothing when the ward has narrowed the permission away", () => {
    const narrowed = {
      bishop: [],
      counselor: [],
      ward_secretary: [],
      executive_secretary: [],
      org_president: [],
      org_counselor: [],
      org_secretary: [],
      music_coordinator: [],
      ward_council_member: [],
      sacrament_manager: [],
      stake_president: [],
      stake_counselor: [],
      stake_secretary: [],
      super_admin: [],
      resource_center_specialist: [],
    } as const;

    expect(
      manageableOrgIds(sessionUser("org_president", ELDERS_QUORUM), ORGANIZATIONS, narrowed),
    ).toEqual([]);
    expect(manageableOrgIds(sessionUser("bishop", null), ORGANIZATIONS, narrowed)).toEqual(
      [],
    );
  });

  it("returns nothing when the ward has no eligible organizations", () => {
    expect(manageableOrgIds(sessionUser("bishop", null), [], ROLE_PERMISSIONS)).toEqual([]);
    expect(
      manageableOrgIds(
        sessionUser("org_president", ELDERS_QUORUM),
        [{ id: BISHOPRIC_ORG, type: "bishopric" }],
        ROLE_PERMISSIONS,
      ),
    ).toEqual([]);
  });
});
