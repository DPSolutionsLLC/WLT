// @vitest-environment node
//
// Who may read and write `units` and `unit_assignments` (migration 065f).
//
// THE ANSWER FOR WRITES IS "NOBODY", and that is not an omission. There are deliberately no
// INSERT / UPDATE / DELETE policies on either table, so RLS denies every write by default.
// Assignments and units are written through the SERVICE-ROLE client in proto-d, the same shape
// lib/auth/adminUsers.ts already uses for role changes. This suite is what keeps that true: an
// untested write policy is the most dangerous thing in this phase, so the first one added must
// make this file go red.
//
// It also proves the two schema guarantees that a comment cannot: the `nulls not distinct` unique
// index, and the unit_assignments_scope CHECK. Both are attempted rather than assumed.

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";
import type { Database } from "@/types/database";

describe("unit assignments and units", () => {
  let fixtures: Fixtures;
  let stakePresident: SupabaseClient<Database>;
  let superAdmin: SupabaseClient<Database>;
  let eqPresident: SupabaseClient<Database>;

  beforeAll(async () => {
    fixtures = await seedFixtures([
      "eqPresident",
      "stakePresident",
      "outsideStakePresident",
      "superAdmin",
    ]);

    stakePresident = await asRole(fixtures, "stakePresident");
    superAdmin = await asRole(fixtures, "superAdmin");
    eqPresident = await asRole(fixtures, "eqPresident");
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  it("lets a user read their own assignment", async () => {
    const { data, error } = await stakePresident
      .from("unit_assignments")
      .select("id, unit_id, role")
      .eq("user_id", fixtures.user("stakePresident").id);

    expect(error).toBeNull();
    expect(data?.length).toBe(1);
    expect(data?.[0]?.role).toBe("stake_president");
    expect(data?.[0]?.unit_id).toBe(fixtures.stakeUnitId);
  });

  // The whole disclosure this policy makes is "your own rows". Another officer's assignment is
  // somebody else's stewardship and reveals the shape of the hierarchy above them.
  it("does not let a user read another user's assignment", async () => {
    const { data, error } = await stakePresident
      .from("unit_assignments")
      .select("id")
      .eq("user_id", fixtures.user("outsideStakePresident").id);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("returns nothing to a user with no assignment at all", async () => {
    const { data, error } = await eqPresident.from("unit_assignments").select("id");

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("lets a super admin read every assignment", async () => {
    const { data, error } = await superAdmin
      .from("unit_assignments")
      .select("user_id")
      .in("user_id", [
        fixtures.user("stakePresident").id,
        fixtures.user("outsideStakePresident").id,
        fixtures.user("superAdmin").id,
      ]);

    expect(error).toBeNull();
    expect(data?.length).toBe(3);
  });

  it("lets a ward member read their own ward's unit", async () => {
    const { data, error } = await eqPresident
      .from("units")
      .select("id")
      .eq("id", fixtures.wardAUnitId);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([fixtures.wardAUnitId]);
  });

  it("does not let a ward member read an unrelated stake", async () => {
    const { data, error } = await eqPresident
      .from("units")
      .select("id")
      .eq("id", fixtures.outsideStakeUnitId);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  // An assigned unit is readable even though it is not the caller's ward — that is the
  // `assigned_unit_ids()` arm, and it is what lets a switcher name the stake they are under.
  it("lets a stake president read the stake they are assigned over", async () => {
    const { data, error } = await stakePresident
      .from("units")
      .select("id")
      .eq("id", fixtures.stakeUnitId);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toEqual([fixtures.stakeUnitId]);
  });

  // ---------------------------------------------------------------------------
  // Writes — refused for everybody, including a super admin
  // ---------------------------------------------------------------------------

  it("refuses an authenticated insert into unit_assignments", async () => {
    const { error } = await stakePresident.from("unit_assignments").insert({
      user_id: fixtures.user("stakePresident").id,
      unit_id: fixtures.outsideStakeUnitId,
      role: "stake_president",
    });

    expect(error).not.toBeNull();

    const { count } = await fixtures.service
      .from("unit_assignments")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", fixtures.user("stakePresident").id);
    expect(count).toBe(1);
  });

  // A DENIED UPDATE IS A ZERO-ROW SUCCESS, not an error, so this re-reads rather than asserting
  // an error came back — the failure mode a test that only checked `error` would miss entirely.
  it("refuses an authenticated update of unit_assignments", async () => {
    const { error } = await stakePresident
      .from("unit_assignments")
      .update({ role: "super_admin" })
      .eq("user_id", fixtures.user("stakePresident").id);

    expect(error).toBeNull();

    const { data: after } = await fixtures.service
      .from("unit_assignments")
      .select("role")
      .eq("user_id", fixtures.user("stakePresident").id)
      .single();
    expect(after?.role).toBe("stake_president");
  });

  it("refuses an authenticated delete of unit_assignments", async () => {
    const { error } = await stakePresident
      .from("unit_assignments")
      .delete()
      .eq("user_id", fixtures.user("stakePresident").id);

    expect(error).toBeNull();

    const { count } = await fixtures.service
      .from("unit_assignments")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", fixtures.user("stakePresident").id);
    expect(count).toBe(1);
  });

  // Even a super admin. The role bypasses the ACCESS MATRIX, not RLS — there is no write policy
  // for it to satisfy, so proto-d's screen goes through the service client like every other
  // administrative write in this app.
  it("refuses a super admin's insert too", async () => {
    const { error } = await superAdmin.from("unit_assignments").insert({
      user_id: fixtures.user("eqPresident").id,
      unit_id: fixtures.stakeUnitId,
      role: "stake_secretary",
    });

    expect(error).not.toBeNull();
  });

  it("refuses an authenticated insert into units", async () => {
    const { error } = await superAdmin
      .from("units")
      .insert({ type: "stake", name: `Sneaky ${fixtures.runId}` });

    expect(error).not.toBeNull();
  });

  // ---------------------------------------------------------------------------
  // The schema guarantees, attempted rather than assumed
  // ---------------------------------------------------------------------------

  // `nulls not distinct` on unit_assignments_unique. WITHOUT IT THIS INSERT SUCCEEDS, because
  // `null <> null` — a super_admin row has a null unit_id, so two of them would not conflict on
  // an ordinary unique index. This is migration 055's lesson, and the only way to tell the two
  // index definitions apart is to try it.
  it("refuses a second super_admin row for the same person", async () => {
    const { error } = await fixtures.service.from("unit_assignments").insert({
      user_id: fixtures.user("superAdmin").id,
      unit_id: null,
      role: "super_admin",
    });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("23505");

    const { count } = await fixtures.service
      .from("unit_assignments")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", fixtures.user("superAdmin").id);
    expect(count).toBe(1);
  });

  // unit_assignments_scope. Both halves, because a CHECK with one arm wrong passes every test
  // that only exercises the other.
  it("refuses a super_admin row scoped to a unit", async () => {
    const { error } = await fixtures.service.from("unit_assignments").insert({
      user_id: fixtures.user("eqPresident").id,
      unit_id: fixtures.stakeUnitId,
      role: "super_admin",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("unit_assignments_scope");
  });

  it("refuses a stake_president row over no unit at all", async () => {
    const { error } = await fixtures.service.from("unit_assignments").insert({
      user_id: fixtures.user("eqPresident").id,
      unit_id: null,
      role: "stake_president",
    });

    expect(error).not.toBeNull();
    expect(error?.message).toContain("unit_assignments_scope");
  });
});
