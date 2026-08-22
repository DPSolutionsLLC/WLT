// @vitest-environment node
//
// PUT /api/members/[id]/organizations and POST /api/roster/bulk-assign.
//
// These two routes are the ones scenario 008's Failure Behavior section used to check by pasting
// `fetch` calls into a browser console. That section is now retired to this file — see the
// scenario for which check maps to which test.
//
// THE PERMISSION CHECK IS THE WHOLE BOUNDARY HERE, and that is unusual enough to state plainly:
// migration 019's ward-scoped policy loop grants INSERT, UPDATE and DELETE on
// `member_organizations` to EVERY authenticated member of the ward
// (plans/roster-a-data-and-pages.md Decision 3). RLS will not stop an org president writing
// these rows. `assertCan(user, "roster.manage")` is the only thing that does, which is why both
// 403 tests below re-read the table afterwards rather than trusting the status code.
//
// See tests/helpers/routeClient.ts for why this needs no server. Runs over the network against
// the shared hosted project (CLAUDE.md §9).

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  actAs,
  errorMessage,
  jsonRequest,
  readResponse,
} from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const BULK_ROUTE = "http://localhost/api/roster/bulk-assign";

async function callSetOrganizations(memberId: string, body: unknown) {
  const { PUT } = await import("@/app/api/members/[id]/organizations/route");
  const request = jsonRequest(
    `http://localhost/api/members/${memberId}/organizations`,
    { method: "PUT", body },
  );
  return readResponse(
    await PUT(request, { params: Promise.resolve({ id: memberId }) }),
  );
}

async function callBulkAssign(body: unknown) {
  const { POST } = await import("@/app/api/roster/bulk-assign/route");
  return readResponse(
    await POST(jsonRequest(BULK_ROUTE, { method: "POST", body })),
  );
}

describe("roster organization routes", () => {
  let fixtures: Fixtures;

  let memberOneId = "";
  let memberTwoId = "";
  let wardBMemberId = "";

  async function seedMember(wardId: string, firstName: string): Promise<string> {
    const { data, error } = await fixtures.service
      .from("members")
      .insert({
        ward_id: wardId,
        first_name: firstName,
        last_name: `Fixture${fixtures.runId}`,
        category: "adult",
      })
      .select("id")
      .single();

    if (error) throw new Error(`Could not seed a member: ${error.message}`);
    return data.id;
  }

  async function readMembershipOrgIds(memberId: string): Promise<string[]> {
    const { data, error } = await fixtures.service
      .from("member_organizations")
      .select("org_id")
      .eq("member_id", memberId);

    if (error) throw new Error(`Could not read memberships: ${error.message}`);
    return (data ?? []).map((row) => row.org_id).sort();
  }

  async function auditRowCount(): Promise<number> {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId);

    if (error) throw new Error(`Could not count audit rows: ${error.message}`);
    return count ?? 0;
  }

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident", "wardBBishop"]);

    memberOneId = await seedMember(fixtures.wardAId, "Alma");
    memberTwoId = await seedMember(fixtures.wardAId, "Bruce");
    wardBMemberId = await seedMember(fixtures.wardBId, "Carla");
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("PUT /api/members/[id]/organizations", () => {
    it("sets a member's organizations and reports what changed", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callSetOrganizations(memberOneId, {
        organizationIds: [fixtures.eldersQuorumId],
      });

      expect(status).toBe(200);
      expect(body.added).toEqual([fixtures.eldersQuorumId]);
      expect(body.removed).toEqual([]);
      expect(await readMembershipOrgIds(memberOneId)).toEqual([
        fixtures.eldersQuorumId,
      ]);
    });

    // "What actually changed, not what was submitted." A month from now the useful question is
    // "when did this member leave the elders quorum", and a record of the whole submitted set
    // cannot answer it. Submitting EQ again alongside RS must therefore report one addition and
    // no removals, not two additions.
    it("audits the delta rather than the submitted set", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callSetOrganizations(memberOneId, {
        organizationIds: [fixtures.eldersQuorumId, fixtures.reliefSocietyId],
      });

      expect(status).toBe(200);
      expect(body.added).toEqual([fixtures.reliefSocietyId]);
      expect(body.removed).toEqual([]);

      const { data } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "member_organizations_updated")
        .order("created_at", { ascending: false })
        .limit(1);

      const detail = data![0].detail as Record<string, unknown>;
      expect(detail.memberId).toBe(memberOneId);
      expect(detail.added).toEqual([fixtures.reliefSocietyId]);
      expect(detail.removed).toEqual([]);
    });

    it("removes what is no longer in the set", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callSetOrganizations(memberOneId, {
        organizationIds: [],
      });

      expect(status).toBe(200);
      expect((body.removed as string[]).sort()).toEqual(
        [fixtures.eldersQuorumId, fixtures.reliefSocietyId].sort(),
      );
      expect(await readMembershipOrgIds(memberOneId)).toEqual([]);
    });

    // Scenario 008 Failure Behavior: "Assigning to an organization id from another ward returns
    // 'That organization is not in your ward.', not a foreign-key error string." The composite
    // key would reject it anyway; the point is that the caller gets a sentence rather than
    // "insert or update on table member_organizations violates foreign key constraint".
    it("refuses an organization from another ward by name, not by constraint", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callSetOrganizations(memberOneId, {
        organizationIds: [fixtures.wardBOrgId],
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("That organization is not in your ward.");
      expect(errorMessage(body)).not.toContain("violates");
      expect(errorMessage(body)).not.toContain("constraint");
      expect(await readMembershipOrgIds(memberOneId)).toEqual([]);
    });

    // Scenario 008 Failure Behavior: "Assigning with an unknown member id returns a message
    // naming the problem, not a constraint."
    it("refuses an unknown member by name, not by constraint", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callSetOrganizations(randomUUID(), {
        organizationIds: [fixtures.eldersQuorumId],
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("That member is not in your ward.");
      expect(errorMessage(body)).not.toContain("constraint");
    });

    it("refuses a member id that is not a uuid", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callSetOrganizations("not-a-uuid", {
        organizationIds: [],
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("That member id is not valid.");
    });

    // Scenario 008 Failure Behavior: "A PUT from an eqpres session returns 403 with a readable
    // message, not 500." Re-read afterwards because RLS would have ALLOWED this write — the
    // permission check is the only boundary.
    it("refuses a role without roster.manage, and writes nothing", async () => {
      await actAs(fixtures, "bishop");
      await callSetOrganizations(memberTwoId, {
        organizationIds: [fixtures.eldersQuorumId],
      });

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callSetOrganizations(memberTwoId, {
        organizationIds: [fixtures.reliefSocietyId],
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toBe("You do not have permission to do that.");

      // The row is untouched — not merely "no error came back".
      expect(await readMembershipOrgIds(memberTwoId)).toEqual([
        fixtures.eldersQuorumId,
      ]);
    });
  });

  describe("POST /api/roster/bulk-assign", () => {
    it("assigns members and reports the count", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callBulkAssign({
        memberIds: [memberOneId],
        organizationId: fixtures.reliefSocietyId,
      });

      expect(status).toBe(200);
      expect(body.assigned).toBe(1);
      expect(body.alreadyMember).toBe(0);
    });

    // Re-running the same assign is not an error. All three numbers go to the audit row, because
    // `assigned` alone cannot be told apart from a write that was refused.
    it("reports an already-member run as 0 assigned, not as a failure", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callBulkAssign({
        memberIds: [memberOneId],
        organizationId: fixtures.reliefSocietyId,
      });

      expect(status).toBe(200);
      expect(body.assigned).toBe(0);
      expect(body.alreadyMember).toBe(1);

      // And no duplicate row.
      const { count } = await fixtures.service
        .from("member_organizations")
        .select("id", { count: "exact", head: true })
        .eq("member_id", memberOneId)
        .eq("org_id", fixtures.reliefSocietyId);

      expect(count).toBe(1);

      const { data } = await fixtures.service
        .from("audit_log")
        .select("detail")
        .eq("ward_id", fixtures.wardAId)
        .eq("action", "members_bulk_assigned")
        .order("created_at", { ascending: false })
        .limit(1);

      const detail = data![0].detail as Record<string, unknown>;
      expect(detail.requested).toBe(1);
      expect(detail.assigned).toBe(0);
      expect(detail.alreadyMember).toBe(1);
    });

    it("refuses an organization from another ward by name, not by constraint", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callBulkAssign({
        memberIds: [memberOneId],
        organizationId: fixtures.wardBOrgId,
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("That organization is not in your ward.");
      expect(errorMessage(body)).not.toContain("constraint");
    });

    // A member id that exists but belongs to ward B is the sharper case than a random uuid:
    // it proves the check is ward-scoped rather than merely an existence check.
    it("refuses members from another ward by name, not by constraint", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callBulkAssign({
        memberIds: [memberOneId, wardBMemberId],
        organizationId: fixtures.eldersQuorumId,
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe(
        "Some of those members are not in your ward. Reload the roster and try again.",
      );
      expect(errorMessage(body)).not.toContain("constraint");

      // Nothing partially applied: the valid member in the same request was not assigned.
      expect(await readMembershipOrgIds(memberOneId)).not.toContain(
        fixtures.eldersQuorumId,
      );
    });

    it("refuses an unknown member id", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callBulkAssign({
        memberIds: [randomUUID()],
        organizationId: fixtures.eldersQuorumId,
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("not in your ward");
    });

    it("refuses an empty member list in the schema's own words", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callBulkAssign({
        memberIds: [],
        organizationId: fixtures.eldersQuorumId,
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toBe("Select at least one member.");
    });

    it("refuses a role without roster.manage, and writes nothing", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callBulkAssign({
        memberIds: [memberTwoId],
        organizationId: fixtures.reliefSocietyId,
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toBe("You do not have permission to do that.");

      expect(await readMembershipOrgIds(memberTwoId)).not.toContain(
        fixtures.reliefSocietyId,
      );
    });

    it("leaves audit_log untouched on every refusal", async () => {
      const before = await auditRowCount();

      await actAs(fixtures, "bishop");
      await callBulkAssign({
        memberIds: [memberOneId],
        organizationId: fixtures.wardBOrgId,
      });
      await callBulkAssign({
        memberIds: [wardBMemberId],
        organizationId: fixtures.eldersQuorumId,
      });
      await callBulkAssign({ memberIds: [], organizationId: fixtures.eldersQuorumId });
      await callSetOrganizations(memberOneId, {
        organizationIds: [fixtures.wardBOrgId],
      });
      await callSetOrganizations(randomUUID(), {
        organizationIds: [fixtures.eldersQuorumId],
      });

      await actAs(fixtures, "eqPresident");
      await callBulkAssign({
        memberIds: [memberTwoId],
        organizationId: fixtures.reliefSocietyId,
      });
      await callSetOrganizations(memberTwoId, { organizationIds: [] });

      expect(await auditRowCount()).toBe(before);
    });
  });
});
