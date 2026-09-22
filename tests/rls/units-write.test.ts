// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// `units` AND `unit_assignments` ARE SELECT-ONLY (migration 065f). There are deliberately no
// INSERT, UPDATE or DELETE policies, so RLS denies every write by default and creation runs
// through the service-role client behind proto-d's `super_admin` check.
//
// THIS SUITE IS WHAT KEEPS THAT TRUE. It would be easy for a later phase to "fix" the missing
// write policies and make the Stakes & Wards screen work through the caller's own client — at
// which point a bishop could create the stake above their own ward, and the guard in
// app/api/units/route.ts would be decorative. 065f's header says an untested write policy is the
// most dangerous thing in this phase; this is the test that makes adding one fail loudly.
//
// A SUPER ADMIN IS INCLUDED ON PURPOSE. They are the only person the app lets create a unit, and
// they still cannot do it at the table — which is the distinction between "who the route lets in"
// and "what the database permits", and the reason the route's check can never be skipped.
//
// A denied INSERT raises; a denied UPDATE or DELETE is a zero-row success. The update and delete
// cases therefore re-read with the service client rather than asserting on `error`.

describe("units and unit_assignments are select-only", () => {
  let fixtures: Fixtures;
  let service: SupabaseClient;
  let bishopA: SupabaseClient;
  let superAdmin: SupabaseClient;

  let wardUnitId = "";

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "superAdmin"]);
    service = createServiceSupabaseClient();
    bishopA = await asRole(fixtures, "bishop");
    superAdmin = await asRole(fixtures, "superAdmin");

    const { data, error } = await service
      .from("units")
      .select("id")
      .eq("type", "ward")
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Could not read a unit to test against: ${error.message}`);
    wardUnitId = data?.id ?? "";
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  it("refuses an authenticated insert from a bishop", async () => {
    const { error } = await bishopA
      .from("units")
      .insert({ type: "stake", name: "A stake the ward invented for itself" });

    expect(error).not.toBeNull();
  });

  // A WARD HAS NO STANDING TO CREATE THE STAKE ABOVE ITSELF, and neither does the app's
  // administrator through an ordinary client. Both go through the route.
  it("refuses an authenticated insert from a super admin", async () => {
    const { error } = await superAdmin
      .from("units")
      .insert({ type: "stake", name: "A stake created straight at the table" });

    expect(error).not.toBeNull();
  });

  it("refuses an authenticated update", async () => {
    if (!wardUnitId) return;

    const { data: before } = await service
      .from("units")
      .select("name")
      .eq("id", wardUnitId)
      .single();

    const { error } = await superAdmin
      .from("units")
      .update({ name: "Renamed without a route" })
      .eq("id", wardUnitId);

    // Zero-row success, so the row itself is the assertion.
    expect(error).toBeNull();

    const { data: after } = await service
      .from("units")
      .select("name")
      .eq("id", wardUnitId)
      .single();

    expect(after?.name).toBe(before?.name);
  });

  it("refuses an authenticated delete", async () => {
    if (!wardUnitId) return;

    const { error } = await superAdmin.from("units").delete().eq("id", wardUnitId);

    expect(error).toBeNull();

    const { count } = await service
      .from("units")
      .select("id", { head: true, count: "exact" })
      .eq("id", wardUnitId);

    expect(count).toBe(1);
  });

  it("refuses an authenticated insert into unit_assignments", async () => {
    // Granting yourself `super_admin` is the escalation this refusal prevents, so that is the row
    // the test tries to write.
    const { error } = await bishopA.from("unit_assignments").insert({
      user_id: fixtures.user("bishop").id,
      unit_id: null,
      role: "super_admin",
    });

    expect(error).not.toBeNull();
  });

  // The READ half is unchanged and load-bearing: a person may see their own assignments, which is
  // what lets the app know whether to offer the unit layer at all.
  it("still lets a person read their own unit assignment", async () => {
    const { data, error } = await superAdmin
      .from("unit_assignments")
      .select("role")
      .eq("user_id", fixtures.user("superAdmin").id);

    expect(error).toBeNull();
    expect(data?.map((row) => row.role)).toContain("super_admin");
  });

  // And a bishop sees none, which is what makes isSuperAdmin() answer false for them without the
  // app having to filter anything itself.
  it("shows a bishop no unit assignments at all", async () => {
    const { data, error } = await bishopA.from("unit_assignments").select("role");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
