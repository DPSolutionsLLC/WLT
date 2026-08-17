// @vitest-environment node

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole } from "@/tests/helpers/asRole";
import { seedFixtures, type Fixtures } from "@/tests/helpers/seed";

// Migration 020 widened a security policy: `users` SELECT went from self-only to ward-scoped.
// Widening a policy is the moment to prove the new boundary holds, so this suite asserts both
// halves — that a ward member CAN now read their own ward, and that the ward is still where
// it stops.

describe("users ward-scoped read", () => {
  let fixtures: Fixtures;
  let bishopA: SupabaseClient;
  let musicCoordinatorA: SupabaseClient;
  let bishopB: SupabaseClient;

  beforeAll(async () => {
    fixtures = await seedFixtures(["bishop", "musicCoordinator", "wardBBishop"]);

    bishopA = (await asRole(fixtures, "bishop")) as unknown as SupabaseClient;
    musicCoordinatorA = (await asRole(
      fixtures,
      "musicCoordinator",
    )) as unknown as SupabaseClient;
    bishopB = (await asRole(fixtures, "wardBBishop")) as unknown as SupabaseClient;
  });

  afterAll(async () => {
    await fixtures?.cleanup();
  });

  // The point of the migration: "conducting: Bro. Smith" needs a name to select, and the
  // admin user list in auth-b needs the whole ward.
  it("lets a ward member read other members of the same ward", async () => {
    const { data, error } = await bishopA
      .from("users")
      .select("id, role")
      .eq("ward_id", fixtures.wardAId);

    expect(error).toBeNull();

    const ids = (data ?? []).map((row: { id: string }) => row.id);
    expect(ids).toContain(fixtures.user("bishop").id);
    expect(ids).toContain(fixtures.user("musicCoordinator").id);
  });

  it("lets a non-bishopric member read the ward too", async () => {
    const { data, error } = await musicCoordinatorA
      .from("users")
      .select("id")
      .eq("id", fixtures.user("bishop").id);

    expect(error).toBeNull();
    expect((data ?? []).map((row: { id: string }) => row.id)).toEqual([
      fixtures.user("bishop").id,
    ]);
  });

  it("returns no ward B users to a ward A member", async () => {
    const { data, error } = await bishopA
      .from("users")
      .select("id")
      .eq("ward_id", fixtures.wardBId);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("returns no ward B users to a ward A member even when asked by id", async () => {
    const { data } = await bishopA
      .from("users")
      .select("id")
      .eq("id", fixtures.user("wardBBishop").id);

    expect(data ?? []).toEqual([]);
  });

  it("returns no ward A users to a ward B member", async () => {
    const { data, error } = await bishopB
      .from("users")
      .select("id")
      .eq("ward_id", fixtures.wardAId);

    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);
  });

  // Reading the ward is not writing it. users_update_self is still self-only, and an
  // RLS-denied UPDATE returns no error and zero rows rather than raising — so the only proof
  // is re-reading the row with the service client
  // (plans/retros/foundation-c-services.md).
  //
  // theme_preference is the column under test because migration 022 narrowed the authenticated
  // UPDATE grant to that one column. Any other column now fails on the column privilege first,
  // which would prove the grant rather than the ROW boundary this assertion is about.
  it("cannot update another ward member's row", async () => {
    const target = fixtures.user("bishop");

    const { data: updated, error } = await musicCoordinatorA
      .from("users")
      .update({ theme_preference: "dark" })
      .eq("id", target.id)
      .select("id");

    expect(error).toBeNull();
    expect(updated ?? []).toEqual([]);

    const { data: after } = await fixtures.service
      .from("users")
      .select("theme_preference")
      .eq("id", target.id)
      .single();

    expect(after?.theme_preference).toBe("system");
  });

  // Self-UPDATE of one's OWN row is asserted in tests/rls/users-column-grant.test.ts, not here.
  // users_update_self (migration 019) permits it column-for-column; migration 022 narrowed the
  // authenticated grant to theme_preference alone, which is what stops a user rewriting their
  // own role. That is a GRANT boundary rather than a policy boundary, so it has its own suite.

  // No INSERT policy exists — account creation is a service-role operation in auth-b and
  // auth-c, deliberately. INSERT is the one operation RLS refuses with an actual error.
  it("cannot insert a users row", async () => {
    const { error } = await musicCoordinatorA.from("users").insert({
      id: "00000000-0000-4000-8000-0000000000ff",
      ward_id: fixtures.wardAId,
      role: "bishop",
      first_name: "Self",
      last_name: "Appointed",
    });

    expect(error).not.toBeNull();
  });

  // No DELETE policy either. Same shape as UPDATE: zero rows, no error.
  it("cannot delete another ward member's row", async () => {
    const target = fixtures.user("bishop");

    const { data: deleted, error } = await musicCoordinatorA
      .from("users")
      .delete()
      .eq("id", target.id)
      .select("id");

    expect(error).toBeNull();
    expect(deleted ?? []).toEqual([]);

    const { data: after } = await fixtures.service
      .from("users")
      .select("id")
      .eq("id", target.id)
      .maybeSingle();

    expect(after?.id).toBe(target.id);
  });
});
