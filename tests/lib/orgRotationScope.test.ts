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

function sessionUser(role: Role, orgId: string | null): SessionUser {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    wardId: "00000000-0000-4000-8000-000000000002",
    role,
    orgId,
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

// Everybody else. org_secretary is here deliberately: a secretary may be PICKED to conduct
// (Decision 9), but deciding who conducts is a presidency decision. ward_secretary is here
// despite holding calendar.manage — that permission is about the calendar, not about an
// organization's presidency.
const NO_SCOPE_ROLES: readonly Role[] = ROLES.filter(
  (role) => !BISHOPRIC_ROLES.includes(role) && !ORG_LEADERSHIP_ROLES.includes(role),
);

describe("manageableOrgIds", () => {
  it("covers every role between the three groups", () => {
    expect(
      BISHOPRIC_ROLES.length + ORG_LEADERSHIP_ROLES.length + NO_SCOPE_ROLES.length,
    ).toBe(ROLES.length);
  });

  for (const role of BISHOPRIC_ROLES) {
    it(`gives ${role} every eligible organization`, () => {
      expect(manageableOrgIds(sessionUser(role, null), ORGANIZATIONS)).toEqual(
        ELIGIBLE_IDS,
      );
      expect(manageableOrgIds(sessionUser(role, BISHOPRIC_ORG), ORGANIZATIONS)).toEqual(
        ELIGIBLE_IDS,
      );
    });
  }

  for (const role of ORG_LEADERSHIP_ROLES) {
    it(`gives ${role} their own eligible organization and nobody else's`, () => {
      expect(manageableOrgIds(sessionUser(role, ELDERS_QUORUM), ORGANIZATIONS)).toEqual([
        ELDERS_QUORUM,
      ]);
      expect(manageableOrgIds(sessionUser(role, RELIEF_SOCIETY), ORGANIZATIONS)).toEqual([
        RELIEF_SOCIETY,
      ]);
    });

    it(`gives ${role} nothing when their organization is not eligible`, () => {
      expect(manageableOrgIds(sessionUser(role, BISHOPRIC_ORG), ORGANIZATIONS)).toEqual([]);
      expect(manageableOrgIds(sessionUser(role, OTHER_ORG), ORGANIZATIONS)).toEqual([]);
    });

    // A wide LIST is a worse default but not a broken page; a wide WRITE is a hole. This is the
    // one place lib/roster/organizationScope.ts's fallback would be exactly wrong.
    it(`gives ${role} nothing when their org_id was never set`, () => {
      expect(manageableOrgIds(sessionUser(role, null), ORGANIZATIONS)).toEqual([]);
    });

    it(`gives ${role} nothing for an organization id that is not in the ward`, () => {
      expect(
        manageableOrgIds(
          sessionUser(role, "00000000-0000-4000-8000-0000000000ff"),
          ORGANIZATIONS,
        ),
      ).toEqual([]);
    });
  }

  for (const role of NO_SCOPE_ROLES) {
    it(`gives ${role} nothing, whatever organization they sit in`, () => {
      expect(manageableOrgIds(sessionUser(role, null), ORGANIZATIONS)).toEqual([]);
      expect(manageableOrgIds(sessionUser(role, ELDERS_QUORUM), ORGANIZATIONS)).toEqual([]);
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
    } as const;

    expect(
      manageableOrgIds(sessionUser("org_president", ELDERS_QUORUM), ORGANIZATIONS, narrowed),
    ).toEqual([]);
    expect(manageableOrgIds(sessionUser("bishop", null), ORGANIZATIONS, narrowed)).toEqual(
      [],
    );
  });

  it("returns nothing when the ward has no eligible organizations", () => {
    expect(manageableOrgIds(sessionUser("bishop", null), [])).toEqual([]);
    expect(
      manageableOrgIds(sessionUser("org_president", ELDERS_QUORUM), [
        { id: BISHOPRIC_ORG, type: "bishopric" },
      ]),
    ).toEqual([]);
  });
});
