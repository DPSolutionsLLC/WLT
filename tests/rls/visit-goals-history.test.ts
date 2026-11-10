// @vitest-environment node
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// Migration 102 (ITER-055 bv4): one ACTIVE goal per organization is a database fact, an ended goal
// stays readable as history, and a sweep can carry no schedule. Asserted through a signed-in
// client, so the refusal is the index's and the CHECK's, not a route's.

type Client = SupabaseClient<Database>;

describe("visit goal kinds and history (migration 102)", () => {
  let fixtures: Fixtures;
  let eqPresident: Client;
  let bishop: Client;
  let wardId: string;
  let firstGoalId: string;

  const goalRow = (overrides: Record<string, unknown> = {}) => ({
    ward_id: wardId,
    org_id: fixtures.eldersQuorumId,
    title: "History test goal",
    target_type: "all_households",
    cadence_amount: 1,
    cadence_unit: "year",
    notice_amount: 2,
    notice_unit: "month",
    created_by: fixtures.user("eqPresident").id,
    ...overrides,
  });

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "eqPresident"]);
    wardId = fixtures.wardAId;
    eqPresident = await asRole(fixtures, "eqPresident");
    bishop = await asRole(fixtures, "bishop");

    const { data, error } = await eqPresident
      .from("visit_goals")
      .insert(goalRow())
      .select("id, kind, started_on, ended_at")
      .single();
    if (error) throw new Error(error.message);
    firstGoalId = data.id;

    expect(data.kind).toBe("cadence");
    expect(data.started_on).not.toBeNull();
    expect(data.ended_at).toBeNull();
  }, 90_000);

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("refuses a second active goal for the same organization", async () => {
    const { error } = await eqPresident.from("visit_goals").insert(goalRow({ title: "Second" }));

    expect(error?.code).toBe("23505");
  });

  it("refuses an end with no reason, and a reason with no end", async () => {
    const noReason = await eqPresident
      .from("visit_goals")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", firstGoalId);
    const noEnd = await eqPresident
      .from("visit_goals")
      .update({ end_reason: "completed" })
      .eq("id", firstGoalId);

    expect(noReason.error?.code).toBe("23514");
    expect(noEnd.error?.code).toBe("23514");
  });

  it("refuses a sweep carrying a schedule", async () => {
    const { error } = await bishop
      .from("visit_goals")
      .insert(goalRow({ org_id: fixtures.reliefSocietyId, kind: "sweep" }));

    expect(error?.code).toBe("23514");
  });

  it("keeps an ended goal readable, and lets a new one start beside it", async () => {
    const ended = await eqPresident
      .from("visit_goals")
      .update({ ended_at: new Date().toISOString(), end_reason: "completed" })
      .eq("id", firstGoalId);
    expect(ended.error).toBeNull();

    const second = await eqPresident
      .from("visit_goals")
      .insert(goalRow({ title: "After the first", kind: "sweep", cadence_amount: null, cadence_unit: null, notice_amount: null, notice_unit: null }))
      .select("id")
      .single();
    expect(second.error).toBeNull();

    const { data, error } = await eqPresident
      .from("visit_goals")
      .select("id, ended_at, end_reason")
      .eq("ward_id", wardId)
      .eq("org_id", fixtures.eldersQuorumId);

    expect(error).toBeNull();
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(firstGoalId);
    expect(ids).toContain(second.data!.id);
    expect(data?.find((row) => row.id === firstGoalId)?.end_reason).toBe("completed");
  });

  it("treats goals with no organization as one group too (nulls not distinct)", async () => {
    const first = await bishop.from("visit_goals").insert(goalRow({ org_id: null, created_by: fixtures.user("bishop").id }));
    const second = await bishop
      .from("visit_goals")
      .insert(goalRow({ org_id: null, title: "Second ward-level", created_by: fixtures.user("bishop").id }));

    expect(first.error).toBeNull();
    expect(second.error?.code).toBe("23505");
  });
});
