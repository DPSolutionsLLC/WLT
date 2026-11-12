// @vitest-environment node
//
// Who may read and write `visit_assignments` (ITER-055 bv5, migration 103a).
//
// A SELECT POLICY AND NO WRITE POLICY. The bishopric reads every assignment, an assignee reads their
// own, an organization the Bishopric shared its visits with reads them (migration 099's question),
// and nobody else reads any. NO authenticated client may insert, update or delete one — the bishop
// included — because the only writer is lib/visits/assignments.ts on the service role. A refused
// UPDATE or DELETE is a zero-row success, so those are proven by RE-READING with the service client
// (CLAUDE.md §8).

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

describe("visit_assignments (migration 103)", () => {
  let fixtures: Fixtures;
  let bishop: Client;
  let counselor1: Client;
  let counselor2: Client;
  let eqPresident: Client;
  let wardBBishop: Client;
  let wardId: string;
  let bishopricOrgId: string;
  let goalId: string;
  let householdId: string;
  let assignmentId: string;

  const readIds = async (client: Client): Promise<string[]> => {
    const { data, error } = await client.from("visit_assignments").select("id");
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => row.id);
  };

  const reread = async () => {
    const { data, error } = await fixtures.service
      .from("visit_assignments")
      .select("id, assigned_to, ended_at")
      .eq("id", assignmentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  };

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "counselor1", "counselor2", "eqPresident", "wardBBishop"]);
    wardId = fixtures.wardAId;
    [bishop, counselor1, counselor2, eqPresident, wardBBishop] = await Promise.all([
      asRole(fixtures, "bishop"),
      asRole(fixtures, "counselor1"),
      asRole(fixtures, "counselor2"),
      asRole(fixtures, "eqPresident"),
      asRole(fixtures, "wardBBishop"),
    ]);

    const { data: organization, error: organizationError } = await fixtures.service
      .from("organizations")
      .insert({ ward_id: wardId, name: "Bishopric", type: "bishopric" })
      .select("id")
      .single();
    if (organizationError) throw new Error(organizationError.message);
    bishopricOrgId = organization.id;

    const { data: goal, error: goalError } = await fixtures.service
      .from("visit_goals")
      .insert({
        ward_id: wardId,
        org_id: bishopricOrgId,
        title: "Visit everyone",
        target_type: "all_households",
        kind: "sweep",
      })
      .select("id")
      .single();
    if (goalError) throw new Error(goalError.message);
    goalId = goal.id;

    const { data: household, error: householdError } = await fixtures.service
      .from("households")
      .insert({ ward_id: wardId, family_name: `Assigned ${fixtures.runId}` })
      .select("id")
      .single();
    if (householdError) throw new Error(householdError.message);
    householdId = household.id;

    const { data: assignment, error: assignmentError } = await fixtures.service
      .from("visit_assignments")
      .insert({
        ward_id: wardId,
        org_id: bishopricOrgId,
        household_id: householdId,
        goal_id: goalId,
        assigned_to: fixtures.user("counselor1").id,
        assigned_by: fixtures.user("bishop").id,
      })
      .select("id")
      .single();
    if (assignmentError) throw new Error(assignmentError.message);
    assignmentId = assignment.id;
  }, 120_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  describe("reading", () => {
    it("lets every member of the bishopric read the assignment", async () => {
      expect(await readIds(bishop)).toContain(assignmentId);
      expect(await readIds(counselor1)).toContain(assignmentId);
      expect(await readIds(counselor2)).toContain(assignmentId);
    });

    it("hides it from an org president until the bishopric shares its visits with them", async () => {
      expect(await readIds(eqPresident)).not.toContain(assignmentId);

      const { error } = await fixtures.service.from("visit_org_sharing").insert({
        ward_id: wardId,
        owner_org_id: bishopricOrgId,
        viewer_org_id: fixtures.eldersQuorumId,
      });
      if (error) throw new Error(error.message);

      expect(await readIds(eqPresident)).toContain(assignmentId);

      await fixtures.service.from("visit_org_sharing").delete().eq("ward_id", wardId);
      expect(await readIds(eqPresident)).not.toContain(assignmentId);
    });

    it("hides it from another ward's bishop", async () => {
      expect(await readIds(wardBBishop)).not.toContain(assignmentId);
    });
  });

  describe("writing — no authenticated client, the bishop included", () => {
    it("refuses an insert", async () => {
      const { error } = await bishop.from("visit_assignments").insert({
        ward_id: wardId,
        org_id: bishopricOrgId,
        household_id: householdId,
        goal_id: goalId,
        assigned_to: fixtures.user("bishop").id,
      });
      expect(error).not.toBeNull();
    });

    it("refuses an update, which the row proves by not changing", async () => {
      await bishop
        .from("visit_assignments")
        .update({ assigned_to: fixtures.user("bishop").id })
        .eq("id", assignmentId);
      expect((await reread())?.assigned_to).toBe(fixtures.user("counselor1").id);
    });

    it("refuses the assignee ending their own assignment", async () => {
      await counselor1
        .from("visit_assignments")
        .update({ ended_at: new Date().toISOString(), end_reason: "unassigned" })
        .eq("id", assignmentId);
      expect((await reread())?.ended_at).toBeNull();
    });

    it("refuses a delete, which the row proves by still being there", async () => {
      await bishop.from("visit_assignments").delete().eq("id", assignmentId);
      expect(await reread()).not.toBeNull();
    });
  });

  describe("the database rules", () => {
    it("allows only one open assignment per household per organization", async () => {
      const { error } = await fixtures.service.from("visit_assignments").insert({
        ward_id: wardId,
        org_id: bishopricOrgId,
        household_id: householdId,
        goal_id: goalId,
        assigned_to: fixtures.user("counselor2").id,
      });
      expect(error?.code).toBe("23505");
    });

    it("refuses an end with no reason", async () => {
      const { error } = await fixtures.service
        .from("visit_assignments")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", assignmentId);
      expect(error?.code).toBe("23514");
      expect((await reread())?.ended_at).toBeNull();
    });
  });
});
