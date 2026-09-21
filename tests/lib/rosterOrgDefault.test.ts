// @vitest-environment node
//
// The per-role organization default (roster-b Decision 4). Pure, so no database and no network:
// the whole point of lifting this out of listMembers was that a default nobody can see is a
// default nobody can test.
//
// Table-driven over ALL TEN roles rather than the interesting ones. A role added to
// types/domain.ts without a decision about its roster scope should fail here, not surprise an
// org president six months later.

import { describe, expect, it } from "vitest";
import { defaultOrganizationFilter } from "@/lib/roster/organizationScope";
import { ROLES, type Role, type SessionUser } from "@/types/domain";

const ORGANIZATION_ID = "00000000-0000-4000-8000-00000000000a";

function sessionUser(role: Role, orgId: string | null): SessionUser {
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
    counselorPosition: null,
    firstName: "Test",
    lastName: "User",
    username: null,
    themePreference: "system",
    isActive: true,
  };
}

// The roles that see the whole ward by default. The bishopric and both secretaries work across
// every organization; the music coordinator and ward council member hold no organization at
// all; sacrament_manager never reaches the roster (it holds no roster.view) but must still get
// an answer rather than a thrown error — a function that throws on a role is a function that
// will throw in production.
const WARD_WIDE_ROLES: readonly Role[] = [
  "bishop",
  "counselor",
  "ward_secretary",
  "executive_secretary",
  "music_coordinator",
  "ward_council_member",
  "sacrament_manager",
  // The unit hierarchy's five (migration 065). All ward-wide, for two different reasons.
  //
  // A STAKE OFFICER HAS NO ORGANIZATION IN THE WARD THEY ARE VISITING — `current_org_id()`
  // returns null across a switch (migration 066b) — so scoping the roster to "their" organization
  // would scope it to nothing. They read the whole ward's roster, which is what `roster.view`
  // in STAKE_OFFICER_PERMISSIONS grants and what a stake officer is there to do.
  //
  // `super_admin` holds every permission, and `resource_center_specialist` holds none and never
  // reaches the roster at all — but it must still get an ANSWER rather than a thrown error, for
  // the same reason `sacrament_manager` is on this list.
  "stake_president",
  "stake_counselor",
  "stake_secretary",
  "super_admin",
  "resource_center_specialist",
];

const ORGANIZATION_SCOPED_ROLES: readonly Role[] = [
  "org_president",
  "org_counselor",
  "org_secretary",
];

describe("defaultOrganizationFilter", () => {
  describe("ward-wide roles", () => {
    it.each(WARD_WIDE_ROLES)("returns undefined for %s", (role) => {
      expect(defaultOrganizationFilter(sessionUser(role, null))).toBeUndefined();
    });

    // Even when the account carries one. A bishop assigned to the bishopric organization still
    // browses the whole ward — the org_id on their row says which body they serve in, not which
    // slice of the roster they may see.
    it.each(WARD_WIDE_ROLES)(
      "returns undefined for %s even with an organization set",
      (role) => {
        expect(
          defaultOrganizationFilter(sessionUser(role, ORGANIZATION_ID)),
        ).toBeUndefined();
      },
    );
  });

  describe("organization-scoped roles", () => {
    it.each(ORGANIZATION_SCOPED_ROLES)(
      "returns the user's organization for %s",
      (role) => {
        expect(defaultOrganizationFilter(sessionUser(role, ORGANIZATION_ID))).toBe(
          ORGANIZATION_ID,
        );
      },
    );

    // An org leader whose org_id was never set gets the whole ward. A worse default than their
    // own organization, but a working page rather than a crash.
    it.each(ORGANIZATION_SCOPED_ROLES)(
      "returns undefined for %s with no organization",
      (role) => {
        expect(defaultOrganizationFilter(sessionUser(role, null))).toBeUndefined();
      },
    );
  });

  // The guard that makes the two lists above exhaustive rather than merely long.
  it("has a decision recorded for every role in ROLES", () => {
    const covered = [...WARD_WIDE_ROLES, ...ORGANIZATION_SCOPED_ROLES].sort();

    expect(covered).toEqual([...ROLES].sort());
  });
});
