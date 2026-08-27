// @vitest-environment node
//
// PUT and DELETE /api/households/[id]/stewardship.
//
// ---------------------------------------------------------------------------
// THE ASSERTIONS THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// 1. THE PERMISSION IS `visits.manage_goals`, NOT `roster.manage`. An org president owns the
//    decision "which families are ours" and holds `roster.view` but NOT `roster.manage`, so
//    routing it through the roster's household PATCH would either lock those people out or hand
//    them the whole roster. The org-secretary case below is what proves this route kept
//    `visits.manage_goals` rather than the wider `visits.view`.
//
// 2. THIS ROUTE ADJUSTS A NARROWING AND NEVER CREATES ONE. Zero rows means the whole ward, so a
//    PUT against an un-narrowed organization would silently take its denominator from every
//    household to exactly one. Refused with a 409 pointing at the bulk control.
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

const URL_BASE = "http://localhost/api/households";

async function callPut(householdId: string, body: unknown) {
  const { PUT } = await import("@/app/api/households/[id]/stewardship/route");

  return readResponse(
    await PUT(jsonRequest(`${URL_BASE}/${householdId}/stewardship`, { method: "PUT", body }), {
      // `params` is a PROMISE in Next 16.
      params: Promise.resolve({ id: householdId }),
    }),
  );
}

async function callDelete(householdId: string, query = "") {
  const { DELETE } = await import("@/app/api/households/[id]/stewardship/route");

  return readResponse(
    await DELETE(
      jsonRequest(`${URL_BASE}/${householdId}/stewardship${query}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: householdId }) },
    ),
  );
}

describe("PUT/DELETE /api/households/[id]/stewardship", () => {
  let fixtures: Fixtures;

  // `anchor` is what makes the Elders Quorum NARROWED, so every adjustment below is an
  // adjustment rather than the thing that created the narrowing. `subject` is the household
  // actually added and removed.
  let anchorHouseholdId: string;
  let subjectHouseholdId: string;

  const isClaimed = async (householdId: string, orgId: string): Promise<boolean> => {
    // Read with the SERVICE client, because the point of most assertions below is what is really
    // in the table — including after a write the policy refused, which comes back as a zero-row
    // success rather than an error (plans/retros/foundation-c-services.md).
    const { data, error } = await fixtures.service
      .from("household_stewardships")
      .select("id")
      .eq("household_id", householdId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data !== null;
  };

  const countAuditRows = async (action: string): Promise<number> => {
    const { count, error } = await fixtures.service
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("ward_id", fixtures.wardAId)
      .eq("action", action);

    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "eqSecretary",
      "rsPresident",
      "musicCoordinator",
    ]);

    // Explicit family names carrying the run id, so two concurrent runs cannot collide
    // (plans/retros/seed-household-id-collision.md).
    const { data, error } = await fixtures.service
      .from("households")
      .insert([
        { ward_id: fixtures.wardAId, family_name: `Anchor ${fixtures.runId}` },
        { ward_id: fixtures.wardAId, family_name: `Subject ${fixtures.runId}` },
      ])
      .select("id, family_name");

    if (error) throw new Error(error.message);

    anchorHouseholdId = data!.find((row) => row.family_name.startsWith("Anchor"))!.id;
    subjectHouseholdId = data!.find((row) => row.family_name.startsWith("Subject"))!.id;

    // BOTH organizations are narrowed before anything below runs, so the 409 case is a
    // deliberate exception rather than the default state every other test has to work around.
    const { error: seedError } = await fixtures.service
      .from("household_stewardships")
      .insert([
        {
          ward_id: fixtures.wardAId,
          household_id: anchorHouseholdId,
          org_id: fixtures.eldersQuorumId,
        },
        {
          ward_id: fixtures.wardAId,
          household_id: anchorHouseholdId,
          org_id: fixtures.reliefSocietyId,
        },
      ]);

    if (seedError) throw new Error(seedError.message);
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("an organization leader", () => {
    it("adds a household to their own stewardship, and the row is really there", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPut(subjectHouseholdId, {});

      expect(status).toBe(200);
      expect(body.added).toBe(true);
      expect(await isClaimed(subjectHouseholdId, fixtures.eldersQuorumId)).toBe(true);
    });

    // Membership is presence or absence. Asking for a state that already holds is not a failure,
    // and it is not a mutation either — see the audit assertions below.
    it("reports adding an already-claimed household as a no-op rather than failing", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPut(subjectHouseholdId, {});

      expect(status).toBe(200);
      expect(body.added).toBe(false);
      expect(await isClaimed(subjectHouseholdId, fixtures.eldersQuorumId)).toBe(true);
    });

    // REFUSED, NOT SILENTLY OVERWRITTEN. Overwriting would let an EQ president believe they had
    // just changed the Relief Society's stewardship for a family.
    it("gets 403 naming another organization, and nothing is written", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPut(subjectHouseholdId, {
        orgId: fixtures.reliefSocietyId,
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toContain("your own organization");
      expect(await isClaimed(subjectHouseholdId, fixtures.reliefSocietyId)).toBe(false);
    });

    it("accepts naming their OWN organization explicitly", async () => {
      await actAs(fixtures, "rsPresident");

      const { status } = await callPut(subjectHouseholdId, {
        orgId: fixtures.reliefSocietyId,
      });

      expect(status).toBe(200);
      expect(await isClaimed(subjectHouseholdId, fixtures.reliefSocietyId)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // THE SURPRISING JUMP, REFUSED
  // ---------------------------------------------------------------------------
  // Zero rows means the WHOLE WARD. Adding one household to an organization that has narrowed
  // nothing would take it from every household to exactly that one, in a single press, with no
  // sentence anywhere saying so.
  describe("an organization that has narrowed nothing", () => {
    it("gets 409 pointing at the bulk control, and nothing is written", async () => {
      // The Primary has no rows at all — it has narrowed nothing.
      const { data: primary, error } = await fixtures.service
        .from("organizations")
        .insert({
          ward_id: fixtures.wardAId,
          name: `Primary ${fixtures.runId}`,
          type: "primary",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      await actAs(fixtures, "bishop");

      const { status, body } = await callPut(subjectHouseholdId, { orgId: primary!.id });

      expect(status).toBe(409);
      expect(errorMessage(body)).toContain("whole ward");
      expect(await isClaimed(subjectHouseholdId, primary!.id)).toBe(false);
    });
  });

  describe("the bishopric", () => {
    it("adds a household for any organization", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await callPut(anchorHouseholdId, {
        orgId: fixtures.reliefSocietyId,
      });

      // Already claimed in the seed, so this is the no-op path — the point is the 200 rather
      // than a 403.
      expect(status).toBe(200);
      expect(await isClaimed(anchorHouseholdId, fixtures.reliefSocietyId)).toBe(true);
    });

    // A bishopric member has no organization of their own, so an unnamed one cannot be stamped
    // from the session — and an org_id of null would land in the hole `org_id = current_org_id()`
    // creates. Refused with a sentence rather than written into it.
    it("gets 400 with a sentence when no organization is named", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPut(subjectHouseholdId, {});

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("which organization");
    });

    it("gets 404 for an organization that is not in the ward", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPut(subjectHouseholdId, {
        orgId: fixtures.wardBOrgId,
      });

      expect(status).toBe(404);
      expect(errorMessage(body)).toContain("not in your ward");
    });
  });

  describe("permissions", () => {
    // CHECKED AGAINST lib/auth/permissions.ts RATHER THAN INTUITION. An org secretary holds
    // `visits.view` and `visits.create` — they can see this dashboard and log a visit — and does
    // NOT hold `visits.manage_goals`. That is what makes them read-only here, and it is not
    // always the intuitive answer.
    it("refuses an org secretary with 403", async () => {
      await actAs(fixtures, "eqSecretary");

      const { status } = await callPut(subjectHouseholdId, {});

      expect(status).toBe(403);
    });

    it("refuses a music coordinator with 403", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callPut(subjectHouseholdId, {});

      expect(status).toBe(403);
    });
  });

  describe("validation", () => {
    it("refuses a household id that is not a uuid", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPut("not-a-uuid", {});

      expect(status).toBe(400);
    });

    it("refuses an orgId that is not a uuid", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPut(subjectHouseholdId, { orgId: "not-a-uuid" });

      expect(status).toBe(400);
    });
  });

  describe("removing", () => {
    it("removes the household and reports that it did", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callDelete(subjectHouseholdId);

      expect(status).toBe(200);
      expect(body.removed).toBe(true);
      expect(await isClaimed(subjectHouseholdId, fixtures.eldersQuorumId)).toBe(false);
    });

    // Removing something already absent is not an error. A second DELETE reports nothing to
    // remove rather than 500ing — an RLS-refused DELETE is a zero-row success and
    // indistinguishable from this at the data layer, so the route reports the fact rather than
    // guessing at a cause.
    it("reports nothing to remove on a second DELETE, rather than failing", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callDelete(subjectHouseholdId);

      expect(status).toBe(200);
      expect(body.removed).toBe(false);
    });

    // The parameter the handler READS, not the one the client happened to send. A name this
    // handler does not parse is silently ignored rather than refused (roster-b), so the schema
    // and the fetch have to be checked against each other — this asserts the handler genuinely
    // reads `orgId`.
    it("honours ?orgId= from the bishopric", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callDelete(
        subjectHouseholdId,
        `?orgId=${fixtures.reliefSocietyId}`,
      );

      expect(status).toBe(200);
      expect(body.removed).toBe(true);
      expect(await isClaimed(subjectHouseholdId, fixtures.reliefSocietyId)).toBe(false);
    });

    it("refuses an org leader removing another organization's claim", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callDelete(
        anchorHouseholdId,
        `?orgId=${fixtures.reliefSocietyId}`,
      );

      expect(status).toBe(403);
      expect(await isClaimed(anchorHouseholdId, fixtures.reliefSocietyId)).toBe(true);
    });
  });

  describe("the audit trail", () => {
    // Every mutation writes an audit row (CLAUDE.md rule 6), through writeAuditLog() and never
    // an inline insert.
    it("writes a row on a successful add", async () => {
      const before = await countAuditRows("household_stewardship_added");

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callPut(subjectHouseholdId, {});

      expect(status).toBe(200);
      expect(body.added).toBe(true);
      expect(await countAuditRows("household_stewardship_added")).toBe(before + 1);
    });

    // NOTHING MOVED, SO NOTHING IS RECORDED. An audit row for a no-op is a trail saying a leader
    // changed something they did not.
    it("writes no row when the household was already claimed", async () => {
      const before = await countAuditRows("household_stewardship_added");

      await actAs(fixtures, "eqPresident");
      const { body } = await callPut(subjectHouseholdId, {});

      expect(body.added).toBe(false);
      expect(await countAuditRows("household_stewardship_added")).toBe(before);
    });

    it("writes a row on a successful removal", async () => {
      const before = await countAuditRows("household_stewardship_removed");

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callDelete(subjectHouseholdId);

      expect(status).toBe(200);
      expect(body.removed).toBe(true);
      expect(await countAuditRows("household_stewardship_removed")).toBe(before + 1);
    });

    it("writes no row when there was nothing to remove", async () => {
      const before = await countAuditRows("household_stewardship_removed");

      await actAs(fixtures, "eqPresident");
      const { body } = await callDelete(subjectHouseholdId);

      expect(body.removed).toBe(false);
      expect(await countAuditRows("household_stewardship_removed")).toBe(before);
    });
  });
});
