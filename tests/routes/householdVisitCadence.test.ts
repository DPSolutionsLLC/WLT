// @vitest-environment node
//
// PUT and DELETE /api/households/[id]/visit-cadence.
//
// ---------------------------------------------------------------------------
// THE ASSERTION THIS SUITE EXISTS FOR
// ---------------------------------------------------------------------------
// This route exists at all because of ITER-018 Decision 5: an org president owns the decision
// "this family needs more attention" but holds `roster.view` and NOT `roster.manage`. Routing it
// through the roster's household PATCH would either lock those people out or hand them the whole
// roster, so each route keeps exactly one permission — and the org-secretary case below is what
// proves this one kept `visits.manage_goals` rather than the wider `visits.view`.
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
  const { PUT } = await import("@/app/api/households/[id]/visit-cadence/route");

  return readResponse(
    await PUT(jsonRequest(`${URL_BASE}/${householdId}/visit-cadence`, { method: "PUT", body }), {
      // `params` is a PROMISE in Next 16.
      params: Promise.resolve({ id: householdId }),
    }),
  );
}

async function callDelete(householdId: string, query = "") {
  const { DELETE } = await import("@/app/api/households/[id]/visit-cadence/route");

  return readResponse(
    await DELETE(
      jsonRequest(`${URL_BASE}/${householdId}/visit-cadence${query}`, { method: "DELETE" }),
      { params: Promise.resolve({ id: householdId }) },
    ),
  );
}

describe("PUT/DELETE /api/households/[id]/visit-cadence", () => {
  let fixtures: Fixtures;
  let householdId: string;

  // Read with the SERVICE client, because the point of most assertions below is what is really in
  // the table — including after a write the policy refused, which comes back as a zero-row
  // success rather than an error (plans/retros/foundation-c-services.md).
  const readOverride = async (orgId: string) => {
    const { data, error } = await fixtures.service
      .from("household_visit_cadences")
      .select("cadence_amount, cadence_unit")
      .eq("household_id", householdId)
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data;
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

    // An explicit family name carrying the run id, so two concurrent runs cannot collide
    // (plans/retros/seed-household-id-collision.md).
    const { data, error } = await fixtures.service
      .from("households")
      .insert({ ward_id: fixtures.wardAId, family_name: `Whitfield ${fixtures.runId}` })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    householdId = data.id;
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("an organization leader", () => {
    it("sets an override for their own organization, and the row is really there", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPut(householdId, {
        cadenceAmount: 3,
        cadenceUnit: "month",
      });

      expect(status).toBe(200);
      expect(await readOverride(fixtures.eldersQuorumId)).toEqual({
        cadence_amount: 3,
        cadence_unit: "month",
      });
    });

    it("replaces their own override rather than adding a second", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPut(householdId, {
        cadenceAmount: 6,
        cadenceUnit: "week",
      });

      expect(status).toBe(200);
      expect(await readOverride(fixtures.eldersQuorumId)).toEqual({
        cadence_amount: 6,
        cadence_unit: "week",
      });

      const { count, error } = await fixtures.service
        .from("household_visit_cadences")
        .select("id", { count: "exact", head: true })
        .eq("household_id", householdId)
        .eq("org_id", fixtures.eldersQuorumId);

      expect(error).toBeNull();
      expect(count).toBe(1);
    });

    // REFUSED, NOT SILENTLY OVERWRITTEN. Overwriting it would let an EQ president believe they
    // had just changed the Relief Society's cadence for a family.
    it("gets 403 naming another organization, and nothing is written", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callPut(householdId, {
        orgId: fixtures.reliefSocietyId,
        cadenceAmount: 1,
        cadenceUnit: "week",
      });

      expect(status).toBe(403);
      expect(errorMessage(body)).toContain("your own organization");
      expect(await readOverride(fixtures.reliefSocietyId)).toBeNull();
    });

    it("accepts naming their OWN organization explicitly", async () => {
      await actAs(fixtures, "rsPresident");

      const { status } = await callPut(householdId, {
        orgId: fixtures.reliefSocietyId,
        cadenceAmount: 12,
        cadenceUnit: "month",
      });

      expect(status).toBe(200);
      expect(await readOverride(fixtures.reliefSocietyId)).toEqual({
        cadence_amount: 12,
        cadence_unit: "month",
      });
    });
  });

  describe("the bishopric", () => {
    it("sets an override for any organization", async () => {
      await actAs(fixtures, "bishop");

      const { status } = await callPut(householdId, {
        orgId: fixtures.reliefSocietyId,
        cadenceAmount: 4,
        cadenceUnit: "month",
      });

      expect(status).toBe(200);
      expect(await readOverride(fixtures.reliefSocietyId)).toEqual({
        cadence_amount: 4,
        cadence_unit: "month",
      });
    });

    // A bishopric member has no organization of their own, so an unnamed one cannot be stamped
    // from the session — and an org_id of null would land in the hole `org_id = current_org_id()`
    // creates. Refused with a sentence rather than written into it.
    it("gets 400 with a sentence when no organization is named", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPut(householdId, {
        cadenceAmount: 4,
        cadenceUnit: "month",
      });

      expect(status).toBe(400);
      expect(errorMessage(body)).toContain("which organization");
    });

    it("gets 404 for an organization that is not in the ward", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callPut(householdId, {
        orgId: fixtures.wardBOrgId,
        cadenceAmount: 4,
        cadenceUnit: "month",
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

      const { status } = await callPut(householdId, {
        cadenceAmount: 1,
        cadenceUnit: "week",
      });

      expect(status).toBe(403);
    });

    it("refuses a music coordinator with 403", async () => {
      await actAs(fixtures, "musicCoordinator");

      const { status } = await callPut(householdId, {
        cadenceAmount: 1,
        cadenceUnit: "week",
      });

      expect(status).toBe(403);
    });
  });

  describe("validation", () => {
    it("refuses a zero amount", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPut(householdId, {
        cadenceAmount: 0,
        cadenceUnit: "month",
      });

      expect(status).toBe(400);
    });

    it("refuses a unit that is not one of the four", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPut(householdId, {
        cadenceAmount: 2,
        cadenceUnit: "fortnight",
      });

      expect(status).toBe(400);
    });

    it("refuses a household id that is not a uuid", async () => {
      await actAs(fixtures, "eqPresident");

      const { status } = await callPut("not-a-uuid", {
        cadenceAmount: 2,
        cadenceUnit: "month",
      });

      expect(status).toBe(400);
    });
  });

  describe("clearing", () => {
    it("clears the override and reports that it did", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callDelete(householdId);

      expect(status).toBe(200);
      expect(body.cleared).toBe(true);
      expect(await readOverride(fixtures.eldersQuorumId)).toBeNull();
    });

    // Clearing something already clear is not an error. A second DELETE reports nothing to clear
    // rather than 500ing — an RLS-refused DELETE is a zero-row success and indistinguishable from
    // this from the data layer, so the route reports the fact rather than guessing at a cause.
    it("reports nothing to clear on a second DELETE, rather than failing", async () => {
      await actAs(fixtures, "eqPresident");

      const { status, body } = await callDelete(householdId);

      expect(status).toBe(200);
      expect(body.cleared).toBe(false);
    });

    // The parameter the handler READS, not the one the client happened to send. A name this
    // handler does not parse is silently ignored rather than refused (roster-b), so the schema
    // and the fetch have to be checked against each other — this asserts the handler genuinely
    // reads `orgId`.
    it("honours ?orgId= from the bishopric", async () => {
      await actAs(fixtures, "bishop");

      const { status, body } = await callDelete(
        householdId,
        `?orgId=${fixtures.reliefSocietyId}`,
      );

      expect(status).toBe(200);
      expect(body.cleared).toBe(true);
      expect(await readOverride(fixtures.reliefSocietyId)).toBeNull();
    });

    it("refuses an org leader clearing another organization's override", async () => {
      await actAs(fixtures, "rsPresident");
      await callPut(householdId, { cadenceAmount: 9, cadenceUnit: "month" });

      await actAs(fixtures, "eqPresident");
      const { status } = await callDelete(householdId, `?orgId=${fixtures.reliefSocietyId}`);

      expect(status).toBe(403);
      expect(await readOverride(fixtures.reliefSocietyId)).not.toBeNull();
    });
  });

  describe("the audit trail", () => {
    // Every mutation writes an audit row (CLAUDE.md rule 6), through writeAuditLog() and never
    // an inline insert.
    it("writes a row on a successful set", async () => {
      const before = await countAuditRows("household_visit_cadence_set");

      await actAs(fixtures, "eqPresident");
      const { status } = await callPut(householdId, {
        cadenceAmount: 2,
        cadenceUnit: "month",
      });

      expect(status).toBe(200);
      expect(await countAuditRows("household_visit_cadence_set")).toBe(before + 1);
    });

    it("writes a row on a successful clear", async () => {
      const before = await countAuditRows("household_visit_cadence_cleared");

      await actAs(fixtures, "eqPresident");
      const { status, body } = await callDelete(householdId);

      expect(status).toBe(200);
      expect(body.cleared).toBe(true);
      expect(await countAuditRows("household_visit_cadence_cleared")).toBe(before + 1);
    });

    // Nothing happened, so nothing is recorded. An audit row for a no-op is a trail that says a
    // leader changed something they did not.
    it("writes no row when there was nothing to clear", async () => {
      const before = await countAuditRows("household_visit_cadence_cleared");

      await actAs(fixtures, "eqPresident");
      const { body } = await callDelete(householdId);

      expect(body.cleared).toBe(false);
      expect(await countAuditRows("household_visit_cadence_cleared")).toBe(before);
    });
  });
});
