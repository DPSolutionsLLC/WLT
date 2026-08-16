// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resolveSessionWardId,
  scopedQuery,
  scopedWardId,
} from "@/lib/supabase/scoped";
import { anonClient, asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

// Never called. The @ts-expect-error is the assertion: if `hymns` — the sole ward-less table
// — ever becomes accepted by scopedQuery, tsc fails with "unused '@ts-expect-error'".
async function hymnsIsNotWardScoped(client: SupabaseClient<Database>) {
  // @ts-expect-error hymns has no ward_id and must not be reachable through scopedQuery
  await scopedQuery("hymns", client);
}

describe("scopedQuery", () => {
  let fixtures: Fixtures;
  let bishop: SupabaseClient<Database>;

  let wardAHouseholdId: string;
  let wardBHouseholdId: string;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop"]);
    bishop = await asRole(fixtures, "bishop");

    const { data, error } = await fixtures.service
      .from("households")
      .insert([
        { ward_id: fixtures.wardAId, family_name: `A ${fixtures.runId}` },
        { ward_id: fixtures.wardBId, family_name: `B ${fixtures.runId}` },
      ])
      .select("id, ward_id");

    if (error) throw new Error(error.message);

    wardAHouseholdId = data.find((row) => row.ward_id === fixtures.wardAId)!.id;
    wardBHouseholdId = data.find((row) => row.ward_id === fixtures.wardBId)!.id;

    expect(typeof hymnsIsNotWardScoped).toBe("function");
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("returns only the session ward's rows", async () => {
    const { query } = await scopedQuery("households", bishop);
    const { data, error } = await query;

    expect(error).toBeNull();

    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(wardAHouseholdId);
    expect(ids).not.toContain(wardBHouseholdId);
  });

  it("stays filtered when the caller adds their own conditions", async () => {
    const { query } = await scopedQuery("households", bishop);
    const { data, error } = await query.eq("id", wardBHouseholdId);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("reports the resolved ward alongside the builder", async () => {
    const { wardId } = await scopedQuery("households", bishop);

    expect(wardId).toBe(fixtures.wardAId);
  });

  it("resolves the ward from the session for insert paths", async () => {
    expect(await scopedWardId(bishop)).toBe(fixtures.wardAId);
  });

  it("refuses to resolve a ward without a session", async () => {
    await expect(
      resolveSessionWardId(anonClient()),
    ).rejects.toThrow(/No signed-in user/);
  });
});
