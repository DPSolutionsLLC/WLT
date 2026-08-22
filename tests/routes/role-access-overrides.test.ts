// @vitest-environment node
//
// The end-to-end proof for ITER-005: a ward's stored role_access actually reaches the route
// guards. Before this change, 25 of the app's 62 permission checks read the hardcoded defaults
// and silently ignored the ward's configuration.
//
// Called as real handlers against the hosted project — see tests/helpers/routeClient.ts for why
// this needs no server and what exactly is mocked. Runs over the network against the shared
// hosted project (CLAUDE.md §9): every fixture is deleted in afterAll and nothing assumes an
// empty table.
//
// ORDERING: each case sets its own override on ward A before acting, so these must not run
// concurrently. vitest.config.ts already sets fileParallelism: false and tests within a file run
// in order, so sequential it() blocks are safe. Do not use it.concurrent.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, setRoleAccess, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

describe("ward role_access overrides reach the route guards", () => {
  let fixtures: Fixtures;
  let memberId = "";
  let householdId = "";

  async function callSetOrganizations(organizationIds: string[]) {
    const { PUT } = await import("@/app/api/members/[id]/organizations/route");
    return readResponse(
      await PUT(
        jsonRequest(`http://localhost/api/members/${memberId}/organizations`, {
          method: "PUT",
          body: { organizationIds },
        }),
        // params is a Promise in Next 16.
        { params: Promise.resolve({ id: memberId }) },
      ),
    );
  }

  async function callBulkAssign() {
    const { POST } = await import("@/app/api/roster/bulk-assign/route");
    return readResponse(
      await POST(
        jsonRequest("http://localhost/api/roster/bulk-assign", {
          method: "POST",
          body: {
            memberIds: [memberId],
            organizationId: fixtures.eldersQuorumId,
          },
        }),
      ),
    );
  }

  async function callAdminUsers() {
    const { GET } = await import("@/app/api/admin/users/route");
    return readResponse(await GET());
  }

  async function callSundays() {
    const { GET } = await import("@/app/api/sundays/route");
    return readResponse(
      await GET(
        jsonRequest("http://localhost/api/sundays?from=2027-05-01&to=2027-05-31"),
      ),
    );
  }

  // Re-read with the SERVICE client. An RLS-denied UPDATE or DELETE succeeds with zero rows
  // rather than raising (plans/retros/foundation-c-services.md), so the only honest way to prove
  // a write did not happen is to look at the row.
  async function memberOrganizationIds(): Promise<string[]> {
    const { data, error } = await fixtures.service
      .from("member_organizations")
      .select("org_id")
      .eq("member_id", memberId);

    if (error) {
      throw new Error(`Could not read member_organizations: ${error.message}`);
    }
    return (data ?? []).map((row) => row.org_id);
  }

  async function clearMemberOrganizations(): Promise<void> {
    const { error } = await fixtures.service
      .from("member_organizations")
      .delete()
      .eq("member_id", memberId);
    if (error) {
      throw new Error(`Could not clear member_organizations: ${error.message}`);
    }
  }

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "counselor1",
      "wardSecretary",
      "wardCouncilMember",
    ]);

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({
        ward_id: fixtures.wardAId,
        family_name: `Override Fixture ${fixtures.runId}`,
      })
      .select("id")
      .single();
    if (householdError) {
      throw new Error(`Could not seed a household: ${householdError.message}`);
    }
    householdId = household.id;

    const { data: member, error: memberError } = await fixtures.service
      .from("members")
      .insert({
        ward_id: fixtures.wardAId,
        household_id: householdId,
        first_name: "Override",
        last_name: `Fixture${fixtures.runId}`,
        category: "adult",
      })
      .select("id")
      .single();
    if (memberError) {
      throw new Error(`Could not seed a member: ${memberError.message}`);
    }
    memberId = member.id;

    const { error: sundayError } = await fixtures.service.from("sundays").insert({
      ward_id: fixtures.wardAId,
      date: "2027-05-02",
      type: "standard",
      speaking_slots: 2,
    });
    if (sundayError) {
      throw new Error(`Could not seed a Sunday: ${sundayError.message}`);
    }
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  // These two routes are the sharpest cases in the app. Migration 019's ward-scoped policy loop
  // grants INSERT/UPDATE/DELETE on member_organizations to EVERY authenticated member of the
  // ward, so RLS is not a boundary here at all and assertCan is the only thing standing in the
  // way. CLAUDE.md rule 2 says RLS is the security boundary; lib/roster/organizations.ts:16
  // documents this as the exception. That is exactly why a guard reading the wrong permission
  // list here is a hole rather than a cosmetic bug.
  describe("narrowing is honoured", () => {
    it("refuses the bishop a roster write the ward took away", async () => {
      await clearMemberOrganizations();
      await setRoleAccess(fixtures, { bishop: { remove: ["roster.manage"] } });
      await actAs(fixtures, "bishop");

      const { status, body } = await callSetOrganizations([fixtures.eldersQuorumId]);

      expect(status, errorMessage(body)).toBe(403);
      expect(await memberOrganizationIds()).toEqual([]);
    });

    it("refuses the same write through bulk-assign", async () => {
      await clearMemberOrganizations();
      await setRoleAccess(fixtures, { bishop: { remove: ["roster.manage"] } });
      await actAs(fixtures, "bishop");

      const { status, body } = await callBulkAssign();

      expect(status, errorMessage(body)).toBe(403);
      expect(await memberOrganizationIds()).toEqual([]);
    });

    // CLAUDE.md §7: bishopric admin authority is shared. The override named only the bishop, so
    // a counselor allowed through here would be the equivalence rule failing in production.
    it("refuses the counselor identically, though the override named only the bishop", async () => {
      await clearMemberOrganizations();
      await setRoleAccess(fixtures, { bishop: { remove: ["roster.manage"] } });
      await actAs(fixtures, "counselor1");

      const { status, body } = await callSetOrganizations([fixtures.eldersQuorumId]);

      expect(status, errorMessage(body)).toBe(403);
      expect(await memberOrganizationIds()).toEqual([]);
    });
  });

  // roster.manage is bishopric-only by default — ward_secretary holds roster.view and NOT
  // roster.manage (lib/auth/permissions.ts is the source of truth; the intuitive answer is wrong
  // often enough to have cost a slice before). That is what makes it a clean pair with the
  // narrowing case above.
  describe("widening is honoured", () => {
    it("allows the ward secretary a roster write the ward granted", async () => {
      await clearMemberOrganizations();
      await setRoleAccess(fixtures, { ward_secretary: { add: ["roster.manage"] } });
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callSetOrganizations([fixtures.eldersQuorumId]);

      expect(status, errorMessage(body)).toBe(200);
      // RLS permits this write, which is precisely why the route check is the whole boundary.
      expect(await memberOrganizationIds()).toEqual([fixtures.eldersQuorumId]);
    });

    it("still refuses the ward secretary without the override", async () => {
      await clearMemberOrganizations();
      await setRoleAccess(fixtures, {});
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callSetOrganizations([fixtures.eldersQuorumId]);

      expect(status, errorMessage(body)).toBe(403);
      expect(await memberOrganizationIds()).toEqual([]);
    });
  });

  describe("admin.* is not overridable", () => {
    // The case that matters most. lib/auth/adminUsers.ts writes with the SERVICE-ROLE client
    // because `users` has no INSERT policy and no UPDATE policy for other people's rows
    // (migration 019), so assertCan is the effective boundary and RLS is not behind it. A
    // successful call here would let this role change anyone's role — including granting itself
    // bishop. That is self-escalation through a settings blob.
    it("ignores an override granting admin.manage_users to a ward council member", async () => {
      await setRoleAccess(fixtures, {
        ward_council_member: { add: ["admin.manage_users"] },
      });
      await actAs(fixtures, "wardCouncilMember");

      const { status, body } = await callAdminUsers();

      expect(status, errorMessage(body)).toBe(403);
    });

    // The other direction. Because removal is locked too, "never remove the last bishopric
    // member's admin access" (plans/11-notifications-admin.md) is structurally unreachable
    // rather than a guard the Phase 11 UI has to remember to implement.
    it("ignores an override removing admin.manage_users from the bishop", async () => {
      await setRoleAccess(fixtures, { bishop: { remove: ["admin.manage_users"] } });
      await actAs(fixtures, "bishop");

      const { status, body } = await callAdminUsers();

      expect(status, errorMessage(body)).toBe(200);
    });
  });

  // A route from a different module than every case above, so the retrofit is shown to be
  // general rather than roster-specific. GET /api/sundays never resolved the override before.
  describe("the fix is general, not roster-specific", () => {
    it("refuses the ward secretary a calendar read the ward took away", async () => {
      await setRoleAccess(fixtures, { ward_secretary: { remove: ["calendar.view"] } });
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callSundays();

      expect(status, errorMessage(body)).toBe(403);
    });

    it("allows it again once the override is cleared", async () => {
      await setRoleAccess(fixtures, {});
      await actAs(fixtures, "wardSecretary");

      const { status, body } = await callSundays();

      expect(status, errorMessage(body)).toBe(200);
    });
  });
});
