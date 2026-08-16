// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("sacrament administration access", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;
  let activeManager: SupabaseClient<Database>;
  let inactiveManager: SupabaseClient<Database>;

  let sundayId: string;
  let assignmentId: string;
  let poolId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "sacramentManager",
      "sacramentManagerInactive",
    ]);

    bishop = await asRole(fixtures, "bishop");
    activeManager = await asRole(fixtures, "sacramentManager");
    inactiveManager = await asRole(fixtures, "sacramentManagerInactive");

    const { data: sunday, error: sundayError } = await fixtures.service
      .from("sundays")
      .insert({ ward_id: fixtures.wardAId, date: "2026-03-01" })
      .select("id")
      .single();
    if (sundayError) throw new Error(sundayError.message);
    sundayId = sunday.id;

    const { data: assignment, error: assignmentError } = await fixtures.service
      .from("sacrament_assignments")
      .insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayId,
        assignment_type: "bread_blessing",
        member_ids: [],
      })
      .select("id")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);
    assignmentId = assignment.id;

    const { data: pool, error: poolError } = await fixtures.service
      .from("sacrament_rotation_pools")
      .insert({
        ward_id: fixtures.wardAId,
        assignment_type: "bread_blessing",
        member_ids: [],
      })
      .select("id")
      .single();
    if (poolError) throw new Error(poolError.message);
    poolId = pool.id;

    // Only one ACTIVE manager per ward (partial unique index, migration 018), so the
    // inactive fixture is a second row with is_active false.
    const { error: managerError } = await fixtures.service
      .from("sacrament_assignment_managers")
      .insert([
        {
          ward_id: fixtures.wardAId,
          user_id: fixtures.user("sacramentManager").id,
          is_active: true,
        },
        {
          ward_id: fixtures.wardAId,
          user_id: fixtures.user("sacramentManagerInactive").id,
          is_active: false,
        },
      ]);
    if (managerError) throw new Error(managerError.message);
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("the active manager", () => {
    it("reads the month's assignments", async () => {
      const { data, error } = await activeManager
        .from("sacrament_assignments")
        .select("id")
        .eq("id", assignmentId);

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([assignmentId]);
    });

    it("updates an assignment", async () => {
      const { data, error } = await activeManager
        .from("sacrament_assignments")
        .update({ override_reason: "swapped at short notice" })
        .eq("id", assignmentId)
        .select("id");

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([assignmentId]);
    });

    it("records that the message was sent", async () => {
      const { error } = await activeManager.from("sacrament_send_log").insert({
        ward_id: fixtures.wardAId,
        month: "2026-03-01",
        sent_by_user_id: fixtures.user("sacramentManager").id,
      });

      expect(error).toBeNull();
    });

    // The manager adjusts assignments; configuring who is eligible stays with the bishopric.
    it("cannot read the rotation pools", async () => {
      const { data, error } = await activeManager
        .from("sacrament_rotation_pools")
        .select("id")
        .eq("id", poolId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("cannot update the rotation pools", async () => {
      const { data: updated, error } = await activeManager
        .from("sacrament_rotation_pools")
        .update({ member_ids: [] })
        .eq("id", poolId)
        .select("id");

      expect(error).toBeNull();
      expect(updated ?? []).toEqual([]);
    });

    it("cannot create an assignment", async () => {
      const { error } = await activeManager.from("sacrament_assignments").insert({
        ward_id: fixtures.wardAId,
        sunday_id: sundayId,
        assignment_type: "water_blessing",
        member_ids: [],
      });

      expect(error).not.toBeNull();
    });

    it("cannot delete an assignment", async () => {
      const { data: deleted, error } = await activeManager
        .from("sacrament_assignments")
        .delete()
        .eq("id", assignmentId)
        .select("id");

      expect(error).toBeNull();
      expect(deleted ?? []).toEqual([]);

      const { data: after } = await fixtures.service
        .from("sacrament_assignments")
        .select("id")
        .eq("id", assignmentId)
        .maybeSingle();

      expect(after?.id).toBe(assignmentId);
    });
  });

  describe("an inactive manager", () => {
    it("reads zero assignments", async () => {
      const { data, error } = await inactiveManager
        .from("sacrament_assignments")
        .select("id")
        .eq("id", assignmentId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("cannot update an assignment", async () => {
      const { data: updated, error } = await inactiveManager
        .from("sacrament_assignments")
        .update({ override_reason: "should not apply" })
        .eq("id", assignmentId)
        .select("id");

      expect(error).toBeNull();
      expect(updated ?? []).toEqual([]);
    });

    it("reads zero rotation pools", async () => {
      const { data, error } = await inactiveManager
        .from("sacrament_rotation_pools")
        .select("id")
        .eq("id", poolId);

      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });
  });

  describe("the bishopric", () => {
    it("reads and writes both assignments and pools", async () => {
      const { data: assignments, error: assignmentError } = await bishop
        .from("sacrament_assignments")
        .select("id")
        .eq("id", assignmentId);

      expect(assignmentError).toBeNull();
      expect(assignments?.map((row) => row.id)).toEqual([assignmentId]);

      const { data: pools, error: poolError } = await bishop
        .from("sacrament_rotation_pools")
        .select("id")
        .eq("id", poolId);

      expect(poolError).toBeNull();
      expect(pools?.map((row) => row.id)).toEqual([poolId]);

      const { data: updatedPool, error: updateError } = await bishop
        .from("sacrament_rotation_pools")
        .update({ member_ids: [] })
        .eq("id", poolId)
        .select("id");

      expect(updateError).toBeNull();
      expect(updatedPool?.map((row) => row.id)).toEqual([poolId]);
    });
  });
});
