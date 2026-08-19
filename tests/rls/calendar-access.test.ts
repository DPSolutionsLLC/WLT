// @vitest-environment node
//
// Cross-ward isolation for the two calendar tables, plus the read-for-all grant every calendar
// consumer depends on.
//
// This suite also DOCUMENTS an asymmetry rather than asserting a lie. Migration 019 puts
// `sundays` and `conducting_rotation` in the ward-scoped policy loop, which grants INSERT, UPDATE
// and DELETE to every authenticated member of the ward — an org_secretary included. RLS stops a
// cross-WARD write and nothing else, so `assertCan(user, "calendar.manage")` in the route is the
// real write boundary here. Asserting a denial that does not exist would be worse than naming the
// gap.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("calendar access", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient<Database>;

  let wardASundayId = "";
  let wardBSundayId = "";

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "bishop",
      "wardSecretary",
      "executiveSecretary",
      "musicCoordinator",
      "eqSecretary",
      "wardBBishop",
    ]);

    bishopA = await asRole(fixtures, "bishop");

    const seedSunday = async (wardId: string, date: string) => {
      const { data, error } = await fixtures.service
        .from("sundays")
        .insert({ ward_id: wardId, date, type: "standard", speaking_slots: 3 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    };

    wardASundayId = await seedSunday(fixtures.wardAId, "2027-02-07");
    wardBSundayId = await seedSunday(fixtures.wardBId, "2027-02-07");

    const { error: rotationError } = await fixtures.service
      .from("conducting_rotation")
      .insert([
        {
          ward_id: fixtures.wardBId,
          position: 1,
          user_id: fixtures.user("wardBBishop").id,
          effective_from: "2027-01-01",
        },
      ]);
    if (rotationError) throw new Error(rotationError.message);
  });

  afterAll(async () => {
    await fixtures.cleanup();
  });

  it("hides another ward's Sundays", async () => {
    const { data, error } = await bishopA
      .from("sundays")
      .select("id")
      .eq("id", wardBSundayId);

    // An RLS refusal is a zero-row success, not an error.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("hides another ward's conducting rotation", async () => {
    const { data, error } = await bishopA
      .from("conducting_rotation")
      .select("id")
      .eq("ward_id", fixtures.wardBId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("refuses a write into another ward", async () => {
    const { data, error } = await bishopA
      .from("sundays")
      .update({ notes: "not mine" })
      .eq("id", wardBSundayId)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: untouched } = await fixtures.service
      .from("sundays")
      .select("notes")
      .eq("id", wardBSundayId)
      .single();

    expect(untouched?.notes).toBeNull();
  });

  it("refuses an insert that names another ward", async () => {
    const { error } = await bishopA
      .from("sundays")
      .insert({ ward_id: fixtures.wardBId, date: "2027-03-07" })
      .select("id");

    // An INSERT that fails its WITH CHECK is a hard error, unlike a filtered UPDATE.
    expect(error).not.toBeNull();
  });

  it("lets every calendar-reading role in the ward see its Sundays", async () => {
    for (const handle of [
      "wardSecretary",
      "executiveSecretary",
      "musicCoordinator",
    ] as const) {
      const client = await asRole(fixtures, handle);
      const { data, error } = await client
        .from("sundays")
        .select("id")
        .eq("id", wardASundayId);

      expect(error, `${handle} could not read the calendar`).toBeNull();
      expect(data, `${handle} saw no Sundays`).toHaveLength(1);
    }
  });

  // Documenting the gap, not asserting a denial that does not exist. An org_secretary holds
  // neither calendar.view nor calendar.manage in lib/auth/permissions.ts, yet migration 019 lets
  // them write this table directly. Every mutating calendar route therefore carries
  // assertCan(user, "calendar.manage") — that check, not RLS, is what stops them.
  //
  // If this test ever starts FAILING, migration 019 has been tightened and that is good news:
  // update this test rather than loosening the policy back.
  it("shows that ward-level RLS alone does not stop an org_secretary writing a Sunday", async () => {
    const orgSecretary = await asRole(fixtures, "eqSecretary");

    const { data, error } = await orgSecretary
      .from("sundays")
      .update({ notes: "written directly through the anon client" })
      .eq("id", wardASundayId)
      .select("id");

    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    await fixtures.service
      .from("sundays")
      .update({ notes: null })
      .eq("id", wardASundayId);
  });
});
