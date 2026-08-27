// @vitest-environment node
//
// `household_stewardships` — a brand-new table with a brand-new policy, which makes this the
// highest-value file in this slice (CLAUDE.md §8 puts RLS first for exactly this reason).
//
// ---------------------------------------------------------------------------
// THE CONTRAST THIS TABLE WAS BUILT AROUND
// ---------------------------------------------------------------------------
// Its SELECT is widened by the ward's cross-org visibility setting; its WRITES are not, and
// `household_visit_cadences` is widened by neither. That contrast is ITER-019 D6 and it is
// asserted in tests/rls/visit-cross-org.test.ts, which owns the setting. THIS file asserts the
// baseline with the setting OFF: one organization's claims are its own, and the bishopric reads
// and writes every organization's.
//
// Everything negative is asserted with an AUTHENTICATED client. Asserting with the service-role
// client would prove nothing — it bypasses RLS entirely. And a refused DELETE is a ZERO-ROW
// SUCCESS rather than an error (plans/retros/foundation-c-services.md), so every write refusal
// below is proven by RE-READING the row with the service client afterwards. Only INSERT raises.
//
// Runs over the network against the shared hosted project, so it seeds with per-run ids and
// cleans up in afterAll — it cannot assume an empty table (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("household_stewardships RLS", () => {
  let fixtures: Fixtures;
  let eqPresident: SupabaseClient<Database>;
  let rsPresident: SupabaseClient<Database>;
  let bishop: SupabaseClient<Database>;
  let wardBEqPresident: SupabaseClient<Database>;

  let wardAId: string;
  let wardBId: string;
  let eqId: string;
  let rsId: string;
  let wardBOrgId: string;

  // ONE household claimed by BOTH organizations, and one claimed by neither — the two states the
  // all-organizations view is built to tell apart.
  let sharedHouseholdId: string;
  let spareHouseholdId: string;
  let wardBHouseholdId: string;

  let eqStewardshipId: string;
  let rsStewardshipId: string;

  const readStewardshipIds = async (
    client: SupabaseClient<Database>,
  ): Promise<string[]> => {
    // Ward-wide, with NO org filter. A filtered read would pass even if a permissive policy had
    // survived and was letting the other organization through (plans/retros/talks-d).
    const { data, error } = await client
      .from("household_stewardships")
      .select("id")
      .eq("ward_id", wardAId);

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id).sort();
  };

  const existsWithService = async (id: string): Promise<boolean> => {
    const { data, error } = await fixtures.service
      .from("household_stewardships")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data !== null;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(
      ["bishop", "eqPresident", "rsPresident", "wardBEqPresident"],
      // OFF, deliberately. This suite asserts the narrow baseline; the widening belongs to
      // tests/rls/visit-cross-org.test.ts, which owns the setting.
      { crossOrgVisibility: false },
    );

    wardAId = fixtures.wardAId;
    wardBId = fixtures.wardBId;
    eqId = fixtures.eldersQuorumId;
    rsId = fixtures.reliefSocietyId;
    wardBOrgId = fixtures.wardBOrgId;

    // Family names carry the run id so two concurrent runs cannot collide
    // (plans/retros/seed-household-id-collision.md).
    const { data: householdRows, error: householdError } = await fixtures.service
      .from("households")
      .insert([
        { ward_id: wardAId, family_name: `Whitfield ${fixtures.runId}` },
        { ward_id: wardAId, family_name: `Unclaimed ${fixtures.runId}` },
        { ward_id: wardBId, family_name: `Other Ward ${fixtures.runId}` },
      ])
      .select("id, ward_id, family_name");

    if (householdError) throw new Error(householdError.message);

    sharedHouseholdId = householdRows!.find((row) =>
      row.family_name.startsWith("Whitfield"),
    )!.id;
    spareHouseholdId = householdRows!.find((row) =>
      row.family_name.startsWith("Unclaimed"),
    )!.id;
    wardBHouseholdId = householdRows!.find((row) => row.ward_id === wardBId)!.id;

    const { data: stewardshipRows, error: stewardshipError } = await fixtures.service
      .from("household_stewardships")
      .insert([
        { ward_id: wardAId, household_id: sharedHouseholdId, org_id: eqId },
        { ward_id: wardAId, household_id: sharedHouseholdId, org_id: rsId },
      ])
      .select("id, org_id");

    if (stewardshipError) throw new Error(stewardshipError.message);

    eqStewardshipId = stewardshipRows!.find((row) => row.org_id === eqId)!.id;
    rsStewardshipId = stewardshipRows!.find((row) => row.org_id === rsId)!.id;

    eqPresident = await asRole(fixtures, "eqPresident");
    rsPresident = await asRole(fixtures, "rsPresident");
    bishop = await asRole(fixtures, "bishop");
    wardBEqPresident = await asRole(fixtures, "wardBEqPresident");
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("the same household, two organizations", () => {
    it("lets the EQ president read only their own organization's claim", async () => {
      expect(await readStewardshipIds(eqPresident)).toEqual([eqStewardshipId]);
    });

    // With cross-org visibility OFF. The ON case is the new behaviour and lives in
    // tests/rls/visit-cross-org.test.ts.
    it("hides the EQ claim from the RS president for the SAME household", async () => {
      const visible = await readStewardshipIds(rsPresident);

      expect(visible).toEqual([rsStewardshipId]);
      expect(visible).not.toContain(eqStewardshipId);
    });

    it("lets the bishopric read both", async () => {
      expect(await readStewardshipIds(bishop)).toEqual(
        [eqStewardshipId, rsStewardshipId].sort(),
      );
    });
  });

  describe("writing", () => {
    it("lets the EQ president claim another household for their own organization", async () => {
      const { data, error } = await eqPresident
        .from("household_stewardships")
        .insert({ ward_id: wardAId, household_id: spareHouseholdId, org_id: eqId })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();

      // Cleared again so the read assertions above stay meaningful for later suites in this file.
      await eqPresident.from("household_stewardships").delete().eq("id", data!.id);
    });

    // INSERT is the one operation that RAISES rather than succeeding with zero rows.
    it("refuses the EQ president an insert naming another organization", async () => {
      const { error } = await eqPresident.from("household_stewardships").insert({
        ward_id: wardAId,
        household_id: spareHouseholdId,
        org_id: rsId,
      });

      expect(error).not.toBeNull();
    });

    // A REFUSED DELETE IS A ZERO-ROW SUCCESS, not an error. Asserting `error` here would pass
    // whether the policy held or not, so the row is re-read with the service client instead.
    it("refuses the EQ president a delete of the RS claim, silently", async () => {
      const { error } = await eqPresident
        .from("household_stewardships")
        .delete()
        .eq("id", rsStewardshipId);

      expect(error).toBeNull();
      expect(await existsWithService(rsStewardshipId)).toBe(true);
    });

    it("lets the bishopric delete any organization's claim", async () => {
      const { data: inserted, error: insertError } = await fixtures.service
        .from("household_stewardships")
        .insert({ ward_id: wardAId, household_id: spareHouseholdId, org_id: rsId })
        .select("id")
        .single();

      expect(insertError).toBeNull();

      const { error } = await bishop
        .from("household_stewardships")
        .delete()
        .eq("id", inserted!.id);

      expect(error).toBeNull();
      expect(await existsWithService(inserted!.id)).toBe(false);
    });

    it("lets the bishopric write for any organization", async () => {
      const { data, error } = await bishop
        .from("household_stewardships")
        .insert({ ward_id: wardAId, household_id: spareHouseholdId, org_id: rsId })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();

      await fixtures.service.from("household_stewardships").delete().eq("id", data!.id);
    });
  });

  describe("across wards", () => {
    it("shows a ward B leader none of ward A's claims", async () => {
      const { data, error } = await wardBEqPresident
        .from("household_stewardships")
        .select("id")
        .eq("ward_id", wardAId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("refuses a ward B leader an insert into ward A", async () => {
      const { error } = await wardBEqPresident.from("household_stewardships").insert({
        ward_id: wardAId,
        household_id: spareHouseholdId,
        org_id: eqId,
      });

      expect(error).not.toBeNull();
    });

    it("refuses a ward B leader a delete of ward A's row, silently", async () => {
      const { error } = await wardBEqPresident
        .from("household_stewardships")
        .delete()
        .eq("id", eqStewardshipId);

      expect(error).toBeNull();
      expect(await existsWithService(eqStewardshipId)).toBe(true);
    });

    // The positive control: ward B's own leader can write in ward B. Without it, every assertion
    // above would also pass against a policy that refused everybody everything.
    it("lets a ward B leader write in their own ward", async () => {
      const { data, error } = await wardBEqPresident
        .from("household_stewardships")
        .insert({
          ward_id: wardBId,
          household_id: wardBHouseholdId,
          org_id: wardBOrgId,
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
    });
  });

  describe("the constraints", () => {
    // PROVED, NOT ASSUMED. plans/retros/ai-d-corpus-scoping.md records a constraint that was
    // silently inert and therefore never rejected anything. Asserted with the SERVICE client,
    // because a constraint has to hold even for a caller RLS allows.
    it("refuses a second claim for the same household and organization", async () => {
      const { error } = await fixtures.service.from("household_stewardships").insert({
        ward_id: wardAId,
        household_id: sharedHouseholdId,
        org_id: eqId,
      });

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/duplicate key|unique/i);
    });

    // org_id is NOT NULL, unlike visit_goals.org_id. A null-org row would land in the hole
    // `org_id = current_org_id()` creates — null is never equal to null in SQL — and would be
    // invisible to its own author (plans/retros/talks-d-reliability-goals.md).
    it("refuses a null organization", async () => {
      const { error } = await fixtures.service.from("household_stewardships").insert({
        ward_id: wardAId,
        household_id: sharedHouseholdId,
        org_id: null as unknown as string,
      });

      expect(error).not.toBeNull();
    });

    // The composite foreign key is what stops a claim naming a household in another ward.
    it("refuses a household from a different ward", async () => {
      const { error } = await fixtures.service.from("household_stewardships").insert({
        ward_id: wardAId,
        household_id: wardBHouseholdId,
        org_id: eqId,
      });

      expect(error).not.toBeNull();
    });

    // `on delete cascade` on the household. A claim is meaningless without the family it names,
    // and an orphan row would keep a deleted household inside a denominator.
    it("removes a claim when its household is deleted", async () => {
      const { data: household, error: householdError } = await fixtures.service
        .from("households")
        .insert({ ward_id: wardAId, family_name: `Cascade ${fixtures.runId}` })
        .select("id")
        .single();
      if (householdError) throw new Error(householdError.message);

      const { data: claim, error: claimError } = await fixtures.service
        .from("household_stewardships")
        .insert({ ward_id: wardAId, household_id: household!.id, org_id: eqId })
        .select("id")
        .single();
      if (claimError) throw new Error(claimError.message);

      await fixtures.service.from("households").delete().eq("id", household!.id);

      expect(await existsWithService(claim!.id)).toBe(false);
    });
  });
});
