// @vitest-environment node
//
// GET, PUT and DELETE /api/visits/stewardship — one organization's whole stewardship.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. THE EMPTY REPLACE IS REFUSED WITH A SENTENCE. Zero rows means the WHOLE WARD, so "narrowed
//    to nothing" and "not narrowed" would be the same rows. Silently choosing the second for
//    somebody is how an organization ends up measured against every household in the ward the
//    moment it tries to exclude them all.
//
// 2. THE DERIVATION IS listHouseholds({ organizationId }) WITH A NON-EMPTY members ARRAY. That
//    query narrows the members it ATTACHES, not the households it RETURNS — so a non-empty
//    `members` under an organization filter means exactly "an active member of that organization
//    lives here". The Primary case below is that in one assertion.
//
// See tests/helpers/routeClient.ts for why this needs no server and what exactly is mocked — only
// the client factory, so every query below still runs as a genuinely authenticated user against
// the hosted project and a pass means RLS allowed it.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { actAs, errorMessage, jsonRequest, readResponse } from "@/tests/helpers/routeClient";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientMock } = await import("@/tests/helpers/routeClient");
  return serverClientMock();
});

const STEWARDSHIP_URL = "http://localhost/api/visits/stewardship";

type StewardshipBody = {
  orgId: string;
  narrowed: boolean;
  householdIds: string[];
  matchingHouseholdIds: string[];
  drift: { toAdd: string[]; toRemove: string[] };
};

async function callGet(url = STEWARDSHIP_URL) {
  const { GET } = await import("@/app/api/visits/stewardship/route");
  return readResponse(await GET(jsonRequest(url)));
}

async function callPut(body: unknown) {
  const { PUT } = await import("@/app/api/visits/stewardship/route");
  return readResponse(await PUT(jsonRequest(STEWARDSHIP_URL, { method: "PUT", body })));
}

async function callDelete(query = "") {
  const { DELETE } = await import("@/app/api/visits/stewardship/route");
  return readResponse(
    await DELETE(jsonRequest(`${STEWARDSHIP_URL}${query}`, { method: "DELETE" })),
  );
}

describe("/api/visits/stewardship", () => {
  let fixtures: Fixtures;
  let wardId: string;

  // Two households with an active member of the Elders Quorum, one without. The derivation must
  // find exactly the two.
  let inOrgHouseholdA: string;
  let inOrgHouseholdB: string;
  let outsideOrgHouseholdId: string;
  let wardBHouseholdId: string;

  const stewardshipFrom = (body: Record<string, unknown>): StewardshipBody =>
    body.stewardship as StewardshipBody;

  const claimedIds = async (orgId: string): Promise<string[]> => {
    const { data, error } = await fixtures.service
      .from("household_stewardships")
      .select("household_id")
      .eq("ward_id", wardId)
      .eq("org_id", orgId);

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.household_id).sort();
  };

  const countAuditRows = async (action: string): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", wardId)
      .eq("action", action);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  // Every test that writes starts from a known set, because these tables are shared by every
  // suite running against the hosted project and the order tests run in is not a fixture.
  const resetTo = async (householdIds: string[]): Promise<void> => {
    await fixtures.service
      .from("household_stewardships")
      .delete()
      .eq("ward_id", wardId)
      .eq("org_id", fixtures.eldersQuorumId);

    if (householdIds.length === 0) return;

    const { error } = await fixtures.service.from("household_stewardships").insert(
      householdIds.map((householdId) => ({
        ward_id: wardId,
        household_id: householdId,
        org_id: fixtures.eldersQuorumId,
      })),
    );

    if (error) throw new Error(error.message);
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
      "musicCoordinator",
    ]);
    wardId = fixtures.wardAId;

    const { data: households, error: householdError } = await fixtures.service
      .from("households")
      .insert([
        { ward_id: wardId, family_name: `InOrgA ${fixtures.runId}` },
        { ward_id: wardId, family_name: `InOrgB ${fixtures.runId}` },
        { ward_id: wardId, family_name: `Outside ${fixtures.runId}` },
        { ward_id: fixtures.wardBId, family_name: `WardB ${fixtures.runId}` },
      ])
      .select("id, ward_id, family_name");
    if (householdError) throw new Error(householdError.message);

    const idOf = (prefix: string) =>
      households!.find((row) => row.family_name.startsWith(prefix))!.id;

    inOrgHouseholdA = idOf("InOrgA");
    inOrgHouseholdB = idOf("InOrgB");
    outsideOrgHouseholdId = idOf("Outside");
    wardBHouseholdId = idOf("WardB");

    const { data: members, error: memberError } = await fixtures.service
      .from("members")
      .insert([
        {
          ward_id: wardId,
          household_id: inOrgHouseholdA,
          first_name: "Ada",
          last_name: "InOrg",
          status: "active",
        },
        {
          ward_id: wardId,
          household_id: inOrgHouseholdB,
          first_name: "Bo",
          last_name: "InOrg",
          status: "active",
        },
        {
          ward_id: wardId,
          household_id: outsideOrgHouseholdId,
          first_name: "Cy",
          last_name: "Outside",
          status: "active",
        },
      ])
      .select("id, household_id");
    if (memberError) throw new Error(memberError.message);

    // ONLY the first two are in the Elders Quorum. That is what the derivation has to find, and
    // the third household is the control that proves it is not simply returning everybody.
    const { error: orgMemberError } = await fixtures.service
      .from("member_organizations")
      .insert(
        members!
          .filter((row) => row.household_id !== outsideOrgHouseholdId)
          .map((row) => ({
            ward_id: wardId,
            member_id: row.id,
            org_id: fixtures.eldersQuorumId,
          })),
      );
    if (orgMemberError) throw new Error(orgMemberError.message);
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("reading", () => {
    it("reports an un-narrowed organization as measured against the whole ward", async () => {
      await resetTo([]);
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGet();
      const stewardship = stewardshipFrom(body);

      expect(status).toBe(200);
      expect(stewardship.orgId).toBe(fixtures.eldersQuorumId);
      expect(stewardship.narrowed).toBe(false);
      expect(stewardship.householdIds).toEqual([]);
      // NO DRIFT for an un-narrowed organization, whatever the derivation found. It has made no
      // claim to have drifted from.
      expect(stewardship.drift).toEqual({ toAdd: [], toRemove: [] });
    });

    // THE DERIVATION, in one assertion. Exactly the households where an active member of the
    // Elders Quorum lives — not every household, and not the members themselves.
    it("derives the households with an active member of the organization", async () => {
      await actAs(fixtures, "eqPresident");

      const { body } = await callGet();
      const stewardship = stewardshipFrom(body);

      expect(stewardship.matchingHouseholdIds).toEqual(
        [inOrgHouseholdA, inOrgHouseholdB].sort(),
      );
      expect(stewardship.matchingHouseholdIds).not.toContain(outsideOrgHouseholdId);
    });

    it("reports the stored set and its drift once narrowed", async () => {
      await resetTo([inOrgHouseholdA, outsideOrgHouseholdId]);
      await actAs(fixtures, "eqPresident");

      const { body } = await callGet();
      const stewardship = stewardshipFrom(body);

      expect(stewardship.narrowed).toBe(true);
      expect(stewardship.householdIds).toEqual(
        [inOrgHouseholdA, outsideOrgHouseholdId].sort(),
      );
      // Derived but not stored, and stored but no longer derived.
      expect(stewardship.drift.toAdd).toEqual([inOrgHouseholdB]);
      expect(stewardship.drift.toRemove).toEqual([outsideOrgHouseholdId]);
    });

    // IGNORED, NOT REFUSED — matching app/api/visits/progress/route.ts exactly. Their own
    // organization is the only one they have a stewardship for, and answering "not yours" with
    // somebody else's empty set looks like an organization that has claimed nothing.
    it("ignores another organization's orgId rather than answering with it", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callGet(
        `${STEWARDSHIP_URL}?orgId=${fixtures.reliefSocietyId}`,
      );

      expect(status).toBe(200);
      expect(stewardshipFrom(body).orgId).toBe(fixtures.eldersQuorumId);
    });

    it("lets the bishopric read any organization", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet(
        `${STEWARDSHIP_URL}?orgId=${fixtures.eldersQuorumId}`,
      );

      expect(status).toBe(200);
      expect(stewardshipFrom(body).orgId).toBe(fixtures.eldersQuorumId);
    });

    it("asks the bishopric which organization rather than guessing", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callGet();

      expect(status).toBe(400);
      expect(errorMessage(body)).toMatch(/which organization/i);
    });

    // `visits.view`, not `visits.manage_goals`. An org secretary may READ what their organization
    // is measured against — the panel renders read-only for them — and may not change it.
    it("lets an org secretary READ the stewardship", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callGet();

      expect(status).toBe(200);
    });

    it("refuses a music coordinator with 403", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callGet();

      expect(status).toBe(403);
    });
  });

  describe("replacing", () => {
    // THE ONE SEAM IN THE SINGLE-TABLE MODEL, refused with a sentence naming the alternative
    // rather than silently flipping the organization back to the whole ward.
    it("refuses an empty list with a message pointing at the alternative", async () => {
      await resetTo([inOrgHouseholdA]);
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPut({ householdIds: [] });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("no households at all");
      expect(errorMessage(body)).toContain("whole ward");
      // Unchanged. A refused replace must not have pruned anything on its way to failing.
      expect(await claimedIds(fixtures.eldersQuorumId)).toEqual([inOrgHouseholdA]);
    });

    it("replaces the set wholesale: named rows present, unnamed rows gone", async () => {
      await resetTo([inOrgHouseholdA, outsideOrgHouseholdId]);
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPut({
        householdIds: [inOrgHouseholdA, inOrgHouseholdB],
      });

      expect(status).toBe(200);
      expect(body.added).toBe(1);
      expect(body.removed).toBe(1);

      // Re-read with the SERVICE client. The response is what the route claims; this is what is
      // really in the table.
      expect(await claimedIds(fixtures.eldersQuorumId)).toEqual(
        [inOrgHouseholdA, inOrgHouseholdB].sort(),
      );
    });

    // A household in BOTH the old and the new set keeps its row rather than being deleted and
    // re-inserted — the delete names only what is no longer wanted, so the family is never
    // briefly absent from the denominator.
    it("leaves a household present in both passes untouched", async () => {
      await resetTo([inOrgHouseholdA]);
      await actAs(fixtures, "eqPresident");

      const { body } = await callPut({
        householdIds: [inOrgHouseholdA, inOrgHouseholdB],
      });

      expect(body.added).toBe(1);
      expect(body.removed).toBe(0);
    });

    // A SENTENCE, NOT A FOREIGN-KEY VIOLATION. A composite constraint failure surfaces as a 500
    // blaming the server for the caller's bad id.
    it("refuses a household from another ward with a sentence", async () => {
      await resetTo([inOrgHouseholdA]);
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPut({
        householdIds: [inOrgHouseholdA, wardBHouseholdId],
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
      expect(await claimedIds(fixtures.eldersQuorumId)).toEqual([inOrgHouseholdA]);
    });

    it("refuses an org leader naming another organization with 403", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPut({
        orgId: fixtures.reliefSocietyId,
        householdIds: [inOrgHouseholdA],
      });

      expect(status).toBe(403);
      expect(await claimedIds(fixtures.reliefSocietyId)).toEqual([]);
    });

    it("refuses an org secretary with 403", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPut({ householdIds: [inOrgHouseholdA] });

      expect(status).toBe(403);
    });

    it("writes an audit row on a successful replace", async () => {
      await resetTo([inOrgHouseholdA]);
      const before = await countAuditRows("stewardship_replaced");

      await actAs(fixtures, "eqPresident");
      const { status } = await callPut({ householdIds: [inOrgHouseholdB] });

      expect(status).toBe(200);
      expect(await countAuditRows("stewardship_replaced")).toBe(before + 1);
    });
  });

  describe("clearing", () => {
    it("removes every row and the organization reads un-narrowed afterwards", async () => {
      await resetTo([inOrgHouseholdA, inOrgHouseholdB]);
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callDelete();

      expect(status).toBe(200);
      expect(body.removed).toBe(2);
      expect(await claimedIds(fixtures.eldersQuorumId)).toEqual([]);

      const { body: after } = await callGet();
      expect(stewardshipFrom(after).narrowed).toBe(false);
    });

    // Clearing something already clear is not an error, and it is not a mutation either.
    it("reports nothing removed on a second DELETE, and writes no audit row", async () => {
      const before = await countAuditRows("stewardship_cleared");

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callDelete();

      expect(status).toBe(200);
      expect(body.removed).toBe(0);
      expect(await countAuditRows("stewardship_cleared")).toBe(before);
    });

    it("honours ?orgId= from the bishopric", async () => {
      await resetTo([inOrgHouseholdA]);
      await actAs(fixtures, "bishop");

      const { status, body } = await callDelete(`?orgId=${fixtures.eldersQuorumId}`);

      expect(status).toBe(200);
      expect(body.removed).toBe(1);
      expect(await claimedIds(fixtures.eldersQuorumId)).toEqual([]);
    });

    it("refuses an org leader clearing another organization", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callDelete(`?orgId=${fixtures.reliefSocietyId}`);

      expect(status).toBe(403);
    });
  });
});
