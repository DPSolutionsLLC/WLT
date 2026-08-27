// @vitest-environment node
//
// `household_visit_cadences` — a brand-new table with a brand-new policy, which makes this the
// highest-value file in this slice (CLAUDE.md §8 puts RLS first for exactly this reason).
//
// THE CASE THE JOIN TABLE EXISTS FOR is `an RS leader cannot read EQ's override for the same
// household`. A column on `households` could not have expressed two organizations disagreeing
// about one family at all, let alone hidden one from the other — which is why ITER-018
// Decision 2 was reversed mid-planning.
//
// Everything negative is asserted with an AUTHENTICATED client. Asserting with the service-role
// client would prove nothing — it bypasses RLS entirely. And a refused UPDATE or DELETE is a
// ZERO-ROW SUCCESS rather than an error (plans/retros/foundation-c-services.md), so every write
// refusal below is proven by RE-READING the row with the service client afterwards. Only INSERT
// raises.
//
// Runs over the network against the shared hosted project, so it seeds with per-run ids and
// cleans up in afterAll — it cannot assume an empty table (CLAUDE.md §9).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("household_visit_cadences RLS", () => {
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

  // ONE household, shared by both organizations. That is the whole point: the same family, two
  // different cadences, at the same time.
  let householdId: string;
  let wardBHouseholdId: string;

  let eqCadenceId: string;
  let rsCadenceId: string;

  const readCadenceIds = async (client: SupabaseClient<Database>): Promise<string[]> => {
    // Ward-wide, with NO org filter. A filtered read would pass even if a permissive policy had
    // survived and was letting the other organization through (plans/retros/talks-d).
    const { data, error } = await client
      .from("household_visit_cadences")
      .select("id")
      .eq("ward_id", wardAId);

    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id).sort();
  };

  const readAmountWithService = async (id: string): Promise<number | null> => {
    const { data, error } = await fixtures.service
      .from("household_visit_cadences")
      .select("cadence_amount")
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    return data?.cadence_amount ?? null;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "eqPresident",
      "rsPresident",
      "wardBEqPresident",
    ]);

    wardAId = fixtures.wardAId;
    wardBId = fixtures.wardBId;
    eqId = fixtures.eldersQuorumId;
    rsId = fixtures.reliefSocietyId;
    wardBOrgId = fixtures.wardBOrgId;

    // Explicit ids on every seeded household. createHousehold in the harness keys its id on the
    // family name, so two households with the same name collide on the primary key
    // (plans/retros/seed-household-id-collision.md) — the same discipline applies to a suite that
    // seeds two wards.
    const { data: householdRows, error: householdError } = await fixtures.service
      .from("households")
      .insert([
        { ward_id: wardAId, family_name: `Whitfield ${fixtures.runId}` },
        { ward_id: wardBId, family_name: `Other Ward ${fixtures.runId}` },
      ])
      .select("id, ward_id");

    if (householdError) throw new Error(householdError.message);

    householdId = householdRows!.find((row) => row.ward_id === wardAId)!.id;
    wardBHouseholdId = householdRows!.find((row) => row.ward_id === wardBId)!.id;

    const { data: cadenceRows, error: cadenceError } = await fixtures.service
      .from("household_visit_cadences")
      .insert([
        {
          ward_id: wardAId,
          household_id: householdId,
          org_id: eqId,
          cadence_amount: 3,
          cadence_unit: "month",
        },
        {
          ward_id: wardAId,
          household_id: householdId,
          org_id: rsId,
          cadence_amount: 12,
          cadence_unit: "month",
        },
      ])
      .select("id, org_id");

    if (cadenceError) throw new Error(cadenceError.message);

    eqCadenceId = cadenceRows!.find((row) => row.org_id === eqId)!.id;
    rsCadenceId = cadenceRows!.find((row) => row.org_id === rsId)!.id;

    eqPresident = await asRole(fixtures, "eqPresident");
    rsPresident = await asRole(fixtures, "rsPresident");
    bishop = await asRole(fixtures, "bishop");
    wardBEqPresident = await asRole(fixtures, "wardBEqPresident");
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("the same household, two organizations", () => {
    // The single most important assertion in this file.
    it("lets the EQ president read only their own organization's override", async () => {
      expect(await readCadenceIds(eqPresident)).toEqual([eqCadenceId]);
    });

    it("hides the EQ override from the RS president for the SAME household", async () => {
      const visible = await readCadenceIds(rsPresident);

      expect(visible).toEqual([rsCadenceId]);
      expect(visible).not.toContain(eqCadenceId);
    });

    it("lets the bishopric read both", async () => {
      expect(await readCadenceIds(bishop)).toEqual([eqCadenceId, rsCadenceId].sort());
    });
  });

  describe("writing", () => {
    it("lets the EQ president update their own override", async () => {
      const { error } = await eqPresident
        .from("household_visit_cadences")
        .update({ cadence_amount: 4 })
        .eq("id", eqCadenceId);

      expect(error).toBeNull();
      expect(await readAmountWithService(eqCadenceId)).toBe(4);
    });

    // A REFUSED UPDATE IS A ZERO-ROW SUCCESS, not an error. Asserting `error` here would pass
    // whether the policy held or not, so the row is re-read with the service client instead.
    it("refuses the EQ president an update to the RS override, silently", async () => {
      const before = await readAmountWithService(rsCadenceId);

      const { error } = await eqPresident
        .from("household_visit_cadences")
        .update({ cadence_amount: 1 })
        .eq("id", rsCadenceId);

      expect(error).toBeNull();
      expect(await readAmountWithService(rsCadenceId)).toBe(before);
    });

    it("refuses the EQ president a delete of the RS override, silently", async () => {
      const { error } = await eqPresident
        .from("household_visit_cadences")
        .delete()
        .eq("id", rsCadenceId);

      expect(error).toBeNull();
      expect(await readAmountWithService(rsCadenceId)).not.toBeNull();
    });

    // INSERT is the one operation that RAISES rather than succeeding with zero rows.
    it("refuses the EQ president an insert naming another organization", async () => {
      const { error } = await eqPresident.from("household_visit_cadences").insert({
        ward_id: wardAId,
        household_id: householdId,
        org_id: rsId,
        cadence_amount: 1,
        cadence_unit: "week",
      });

      expect(error).not.toBeNull();
    });

    it("lets the bishopric write for any organization", async () => {
      const { error } = await bishop
        .from("household_visit_cadences")
        .update({ cadence_amount: 6 })
        .eq("id", rsCadenceId);

      expect(error).toBeNull();
      expect(await readAmountWithService(rsCadenceId)).toBe(6);
    });
  });

  describe("across wards", () => {
    it("shows a ward B leader none of ward A's overrides", async () => {
      const { data, error } = await wardBEqPresident
        .from("household_visit_cadences")
        .select("id")
        .eq("ward_id", wardAId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("refuses a ward B leader an insert into ward A", async () => {
      const { error } = await wardBEqPresident.from("household_visit_cadences").insert({
        ward_id: wardAId,
        household_id: householdId,
        org_id: eqId,
        cadence_amount: 1,
        cadence_unit: "week",
      });

      expect(error).not.toBeNull();
    });

    it("refuses a ward B leader an update to ward A's row, silently", async () => {
      const before = await readAmountWithService(eqCadenceId);

      const { error } = await wardBEqPresident
        .from("household_visit_cadences")
        .update({ cadence_amount: 99 })
        .eq("id", eqCadenceId);

      expect(error).toBeNull();
      expect(await readAmountWithService(eqCadenceId)).toBe(before);
    });

    // The positive control: ward B's own leader can write in ward B. Without it, every assertion
    // above would also pass against a policy that refused everybody everything.
    it("lets a ward B leader write in their own ward", async () => {
      const { data, error } = await wardBEqPresident
        .from("household_visit_cadences")
        .insert({
          ward_id: wardBId,
          household_id: wardBHouseholdId,
          org_id: wardBOrgId,
          cadence_amount: 2,
          cadence_unit: "month",
        })
        .select("id")
        .single();

      expect(error).toBeNull();
      expect(data?.id).toBeTruthy();
    });
  });

  describe("the constraints", () => {
    // ONE cadence per organization per household. The whole model in one line, and the route
    // upserts against it — so a second row for the same pair must be impossible rather than
    // merely unlikely.
    it("refuses a second override for the same household and organization", async () => {
      const { error } = await fixtures.service.from("household_visit_cadences").insert({
        ward_id: wardAId,
        household_id: householdId,
        org_id: eqId,
        cadence_amount: 9,
        cadence_unit: "week",
      });

      expect(error).not.toBeNull();
      expect(error?.message).toMatch(/duplicate key|unique/i);
    });

    // PROVED, NOT ASSUMED. plans/retros/ai-d-corpus-scoping.md records a CHECK that was silently
    // inert — `array_length` returns NULL on an empty array, so it never rejected anything.
    // Asserted with the SERVICE client, because a CHECK has to hold even for a caller RLS allows.
    it("refuses a zero or negative cadence amount", async () => {
      for (const amount of [0, -1]) {
        const { error } = await fixtures.service.from("household_visit_cadences").insert({
          ward_id: wardAId,
          household_id: householdId,
          org_id: rsId,
          cadence_amount: amount,
          cadence_unit: "month",
        });

        expect(error).not.toBeNull();
        expect(error?.message).toMatch(/check constraint|cadence_amount/i);
      }
    });

    it("refuses a cadence unit that is not one of the four", async () => {
      const { error } = await fixtures.service.from("household_visit_cadences").insert({
        ward_id: wardAId,
        household_id: householdId,
        org_id: rsId,
        // Deliberately not a CadenceUnit. The cast is what lets the test send what the type
        // system exists to prevent, which is exactly what the CHECK is the last line against.
        cadence_amount: 1,
        cadence_unit: "fortnight" as unknown as "month",
      });

      expect(error).not.toBeNull();
    });

    // org_id is NOT NULL, unlike visit_goals.org_id. A null-org row would land in the hole
    // `org_id = current_org_id()` creates — null is never equal to null in SQL — and would be
    // invisible to its own author (plans/retros/talks-d-reliability-goals.md).
    it("refuses a null organization", async () => {
      const { error } = await fixtures.service.from("household_visit_cadences").insert({
        ward_id: wardAId,
        household_id: householdId,
        org_id: null as unknown as string,
        cadence_amount: 1,
        cadence_unit: "month",
      });

      expect(error).not.toBeNull();
    });
  });
});
